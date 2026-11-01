'use strict'

const crypto = require('node:crypto')
const zlib = require('node:zlib')
const value = s => s === 'true' ? true : s === 'false' ? false : /^-?\d+$/.test(s) ? Number(s) : s
const localName = name => name.startsWith('minecraft:') ? name.slice(10) : name

function properties (rows) {
  return Object.keys(rows[0].properties).map(name => {
    const values = [...new Set(rows.map(r => r.properties[name]))].map(value)
    const index = rows.findIndex(r => r.properties[name] !== rows[0].properties[name])
    return { name, type: 'enum', values, num_values: values.length, run: index < 0 ? rows.length : index }
  }).sort((a, b) => b.run - a.run || a.name.localeCompare(b.name)).map(({ run, ...rest }) => rest)
}

function applyRegistry (registry, data) {
  if (data.schemaVersion !== 1 || data.minecraft !== '26.3' || data.protocol !== 777 ||
      !/^[a-f0-9-]{36}$/.test(data.serverEpoch)) throw new Error('invalid_native_registry_identity')
  const oldBlocks = registry.blocksByName; const oldItems = registry.itemsByName; const oldEntities = registry.entitiesByName
  for (const kind of ['blocks', 'items', 'entities']) {
    registry[kind] = {}; registry[kind + 'ByName'] = {}; registry[kind + 'Array'] = []
  }
  registry.blocksByStateId = {}
  const groups = new Map(); const seen = new Set()
  const collision = { blocks: {}, shapes: [] }; const shapeIds = new Map()
  const shapeId = boxes => {
    const key = JSON.stringify(boxes)
    if (!shapeIds.has(key)) { shapeIds.set(key, collision.shapes.length); collision.shapes.push(boxes) }
    return shapeIds.get(key)
  }
  let unknownShapes = 0
  for (const row of data.states) {
    if (!Number.isSafeInteger(row.id) || row.id < 0 || seen.has(row.id)) throw new Error('duplicate_or_invalid_native_state')
    seen.add(row.id)
    if (!groups.has(row.blockId)) groups.set(row.blockId, [])
    groups.get(row.blockId).push(row)
  }
  for (const [id, rows] of groups) {
    rows.sort((a, b) => a.id - b.id)
    const first = rows[0]; const name = localName(first.name); const states = properties(rows)
    if (states.reduce((n, p) => n * p.num_values, 1) !== rows.length) throw new Error('native_state_product_mismatch')
    rows.forEach((row, offset) => {
      if (row.id !== first.id + offset || row.name !== first.name) throw new Error('native_state_contiguity_mismatch')
      let n = offset
      for (let i = states.length - 1; i >= 0; i--) {
        const p = states[i]
        if (p.values[n % p.num_values] !== value(row.properties[p.name])) throw new Error('native_state_property_order_mismatch')
        n = Math.floor(n / p.num_values)
      }
    })
    const block = { ...oldBlocks[name], id, name, nativeId: first.name, translationKey: first.translationKey,
      displayName: oldBlocks[name]?.displayName || first.name, minStateId: first.id, maxStateId: rows.at(-1).id,
      defaultState: first.defaultStateId, states, hardness: first.hardness, diggable: first.hardness >= 0,
      transparent: !first.canOcclude, boundingBox: rows.every(r => r.shapeAvailable && !r.collisionShapes.length) ? 'empty' : 'block',
      shapeStatus: rows.every(r => r.shapeAvailable) ? 'static_empty_world_context' : 'unknown_requires_live_context',
      material: oldBlocks[name]?.material || 'unknown', drops: [], harvestTools: {} }
    collision.blocks[name] = rows.map(r => {
      if (!r.shapeAvailable) unknownShapes++
      // A conservative collision fallback is explicitly unknown, never air.
      return shapeId(r.shapeAvailable ? r.collisionShapes : [[0, 0, 0, 1, 1, 1]])
    })
    registry.blocks[id] = block; registry.blocksByName[name] = block; registry.blocksArray.push(block)
    for (const row of rows) registry.blocksByStateId[row.id] = block
  }
  for (const row of data.items) {
    const name = localName(row.name)
    if (registry.items[row.id]) throw new Error('duplicate_native_item')
    const item = { ...oldItems[name], id: row.id, name, nativeId: row.name, stackSize: row.stackSize,
      displayName: oldItems[name]?.displayName || row.name, translationKey: row.translationKey }
    registry.items[row.id] = item; registry.itemsByName[name] = item; registry.itemsArray.push(item)
  }
  registry.foods = {}; registry.foodsByName = {}; registry.foodsArray = []
  for (const row of data.items) if (row.food) {
    const name = localName(row.name)
    const food = { id: row.id, name, displayName: registry.items[row.id].displayName, foodPoints: row.food.nutrition,
      saturation: row.food.saturation, canAlwaysEat: row.food.canAlwaysEat }
    registry.foods[row.id] = food; registry.foodsByName[name] = food; registry.foodsArray.push(food)
  }
  for (const row of data.entities) {
    const name = localName(row.name)
    if (registry.entities[row.id]) throw new Error('duplicate_native_entity')
    const entity = { ...oldEntities[name], ...row, name, nativeId: row.name, internalId: row.id,
      displayName: oldEntities[name]?.displayName || row.name, type: oldEntities[name]?.type || 'other' }
    registry.entities[row.id] = entity; registry.entitiesByName[name] = entity; registry.entitiesArray.push(entity)
  }
  registry.blockCollisionShapes = collision
  // Vanilla crafting data was indexed with a different item registry. Fail
  // closed until real server recipes are queried; never craft the wrong ID.
  registry.recipes = {}
  registry.mawNativeRegistry = { schemaVersion: 1, serverEpoch: data.serverEpoch, observedAt: data.observedAt,
    nativeIdsPreserved: true, states: seen.size, blocks: groups.size, items: data.items.length,
    entities: data.entities.length, unknownShapes, menus: data.menus, components: data.components }
  return registry.mawNativeRegistry
}

function fabricConfiguration (client, getData) {
  client.on('state', state => {
    if (state !== 'configuration') return
    client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('fabric:registry/sync', 'utf8') })
  })
  client.on('custom_payload', packet => {
    if (packet.channel !== 'fabric:registry/sync') return
    const native = getData()
    const actual = crypto.createHash('sha256').update(packet.data).digest('hex')
    if (!native || actual !== native.fabricSyncSha256) {
      client.emit('error', new Error('fabric_registry_sync_does_not_match_native_snapshot'))
      client.end('fabric_registry_sync_mismatch')
      return
    }
    // This acknowledges the already-imported same-JVM tables, not a pretend
    // Fabric installation. Never acknowledge an unknown or changed registry.
    client.mawFabricRegistries = native.fabricRegistries
    client.write('custom_payload', { channel: 'fabric:registry/sync/complete', data: Buffer.alloc(0) })
    client.emit('maw_fabric_sync', { verified: true, registries: Object.keys(native.fabricRegistries).length })
  })
}

function loginBootstrap (client, { timeoutMs = 30000 } = {}) {
  let offer; let finish; let failed; let ack
  const promise = new Promise((resolve, reject) => { finish = resolve; failed = reject })
  // Attach rejection handling immediately; MF's async registry hook consumes it.
  promise.catch(() => {})
  const timer = setTimeout(() => failed(new Error('native_registry_offer_timeout')), timeoutMs)
  timer.unref?.()
  const defaults = client.listeners('login_plugin_request').filter(f => f.name === 'onLoginPluginRequest')
  if (defaults.length !== 1) throw new Error('Pinned protocol login query handler differs')
  client.removeListener('login_plugin_request', defaults[0])
  client.on('login_plugin_request', packet => {
    client.emit('maw_login_query', { channel: packet.channel, bytes: packet.data.length })
    if (packet.channel !== 'maw_agent:registry_offer' && packet.channel !== 'maw_agent:registry_data') return defaults[0](packet)
    try {
      if (packet.channel.endsWith('registry_offer')) {
        if (offer || packet.data.length > 4096) throw new Error('invalid_native_offer')
        offer = JSON.parse(packet.data.toString('utf8'))
        if (offer.schemaVersion !== 1 || offer.minecraft !== '26.3' || offer.compression !== 'gzip' ||
            !/^[a-f0-9]{64}$/.test(offer.sha256) || !Number.isInteger(offer.bytes) || offer.bytes > 900 * 1024) throw new Error('invalid_native_offer')
        client.write('login_plugin_response', { messageId: packet.messageId, data: Buffer.from([1]) })
      } else {
        if (!offer || ack || packet.data.length !== offer.bytes || crypto.createHash('sha256').update(packet.data).digest('hex') !== offer.sha256) throw new Error('native_registry_hash_mismatch')
        const raw = zlib.gunzipSync(packet.data, { maxOutputLength: 64 * 1024 * 1024 })
        const data = JSON.parse(raw.toString('utf8'))
        if (data.serverEpoch !== offer.serverEpoch) throw new Error('native_registry_epoch_mismatch')
        ack = () => client.write('login_plugin_response', { messageId: packet.messageId, data: Buffer.from(offer.sha256, 'ascii') })
        clearTimeout(timer); finish(data)
      }
    } catch (error) { clearTimeout(timer); failed(error); client.emit('error', error); client.end('invalid_native_registry') }
  })
  client.once('end', () => { clearTimeout(timer); failed(new Error('connection_ended_before_native_registry')) })
  return { promise, ready: () => { if (!ack) throw new Error('Native registry not ready'); ack() } }
}

module.exports = { properties, applyRegistry, loginBootstrap, fabricConfiguration }
