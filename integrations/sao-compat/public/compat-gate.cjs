'use strict'
// A private Bedrock-only projection. Agent/native Java use the unmodified lane.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), readline = require('node:readline')
const mc = require('minecraft-protocol'), data = require('minecraft-data')('1.20.1')
const { remapChunk } = require('./native-chunk-remap.cjs')
const Block = require('prismarine-block')(data)
const globalBits = Math.ceil(Math.log2(Math.max(...Object.keys(data.blocksByStateId).map(Number)) + 1))
const clone = value => Buffer.isBuffer(value) ? value : Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value
function bedrockName (name) {
  if (typeof name !== 'string' || !name || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) throw Error('invalid_bedrock_name')
  return /^[A-Za-z0-9_]{1,14}$/.test(name) ? 'b_' + name : 'bh' + crypto.createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 14)
}
function dimensionSections (codec, name) {
  const value = require('prismarine-nbt').simplify(codec)
  const dimension = value['minecraft:dimension_type']?.value?.find(row => row.name === name)?.element
  if (!dimension || !Number.isInteger(dimension.height) || dimension.height % 16 !== 0 || dimension.height < 16 || dimension.height > 1024 || !Number.isInteger(dimension.min_y) || dimension.min_y % 16 !== 0) throw Error('invalid_native_dimension_height')
  return dimension.height / 16
}
function projection (root, iconCatalog = null) {
  const base = path.join(root, 'server/maw-sao/registry'), meta = JSON.parse(fs.readFileSync(path.join(base, 'current.json')))
  const rows = name => fs.readFileSync(path.join(base, meta.serverEpoch, name + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  const items = new Map(), states = new Map(), entities = new Map(), blocks = new Map(), nativeItems = rows('items'), vanillaItems = {}
  for (const row of nativeItems) if (row.name.startsWith('minecraft:') && data.itemsByName[row.name.slice(10)]) vanillaItems[data.itemsByName[row.name.slice(10)].id] = row.name
  let catalog = { items: [] }
  if (iconCatalog && fs.existsSync(iconCatalog)) catalog = JSON.parse(fs.readFileSync(iconCatalog))
  const icons = new Map((catalog.items || catalog).map(row => [row.nativeItem, row]))
  for (const row of nativeItems) {
    const vanilla = row.name.startsWith('minecraft:') && data.itemsByName[row.name.slice(10)]
    const carrier = vanilla || data.itemsByName[row.food ? 'bread' : 'paper']
    items.set(row.id, { ...row, base: carrier.id, vanilla: !!vanilla, icon: icons.get(row.name) })
  }
  for (const row of rows('states')) {
    const known = row.name.startsWith('minecraft:') && data.blocksByName[row.name.slice(10)]
    let id
    if (known) {
      const properties = Object.fromEntries(Object.entries(row.properties).map(([k, v]) => [k, v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v]))
      try { id = Block.fromProperties(known.id, properties, 0).stateId } catch { throw Error('vanilla_state_projection_unavailable:' + row.name) }
    }
    else id = row.isAir ? data.blocksByName.air.defaultState : row.shapeAvailable && row.collisionShapes.length === 0 ? data.blocksByName.grass.defaultState : data.blocksByName.stone.defaultState
    states.set(row.id, id)
    blocks.set(row.blockId, data.blocksByStateId[id].id)
  }
  for (const row of rows('entities')) {
    const known = row.name.startsWith('minecraft:') && data.entitiesByName[row.name.slice(10)]
    entities.set(row.id, { ...row, vanilla: !!known, base: (known || data.entitiesByName[row.category === 'monster' ? 'zombie' : 'armor_stand']).id })
  }
  function slot (value) {
    if (!value?.present) return value
    const item = items.get(value.itemId)
    if (!item) throw Error('unregistered_native_item_id')
    const out = clone(value); out.itemId = item.base
    if (!item.vanilla) {
      const tag = out.nbtData ||= { type: 'compound', name: '', value: {} }
      tag.value ||= {}; const display = tag.value.display ||= { type: 'compound', value: {} }
      display.value ||= {}
      if (!display.value.Name) display.value.Name = { type: 'string', value: JSON.stringify({ text: item.icon?.displayName || item.name, italic: false }) }
      if (item.icon) tag.value.CustomModelData = { type: 'int', value: item.icon.customModelData }
      tag.value.maw_native_item = { type: 'string', value: item.name }
    }
    return out
  }
  function walkSlots (object) {
    if (Buffer.isBuffer(object) || !object || typeof object !== 'object') return object
    if ('present' in object && (object.present === false || 'itemId' in object)) return slot(object)
    if (Array.isArray(object)) return object.map(walkSlots)
    return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, walkSlots(v)]))
  }
  function tags (packet) {
    return { tags: packet.tags.map(group => {
      const convert = group.tagType === 'minecraft:item' ? id => items.get(id)?.base
        : group.tagType === 'minecraft:block' ? id => blocks.get(id)
          : group.tagType === 'minecraft:entity_type' ? id => entities.get(id)?.base : id => id
      return { ...group, tags: group.tags.map(tag => ({ ...tag, entries: [...new Set(tag.entries.map(convert).filter(Number.isInteger))] })) }
    }) }
  }
  return { meta, items, nativeItems, states, blocks, entities, vanillaItems, slot, walkSlots, tags }
}
function start (config) {
  if (config.port !== 39694 || config.backendPort !== 39676) throw Error('private_sao_bedrock_ports_required')
  const { attachForge } = require(config.forgeClientModule || '../forge_client.cjs')
  const projected = projection(config.root, config.iconCatalog)
  const connections = new Set(), customPackets = { '1.20': { play: { toClient: { types: { packet_declare_recipes: ['container', [{ name: 'nativeRecipeBytes', type: 'restBuffer' }]] } } } } }
  const server = mc.createServer({ host: '127.0.0.1', port: config.port, version: '1.20.1', 'online-mode': false,
    enforceSecureProfile: false, keepAlive: false, motd: 'SAO Bedrock compatibility', customPackets,
    beforeLogin: client => { client.bedrockName = client.username; client.username = bedrockName(client.username); client.uuid = require('minecraft-protocol/src/datatypes/uuid').nameToMcOfflineUUID(client.username) } })
  server.on('error', error => console.error(JSON.stringify({ event: 'bedrock_gate_error', message: error.message })))
  server.on('login', front => {
    connections.add(front)
    const back = mc.createClient({ host: '127.0.0.1', port: config.backendPort, version: '1.20.1', auth: 'offline', username: front.username, customPackets, hideErrors: true })
    const entityTypes = new Map(); let window = null, blockedWindow = null, backendReady = false, queued = [], queuedBytes = 0, failed = false, codec, sectionCount
    attachForge(back, config.root)
    const fail = error => { if (failed) return; failed = true; console.error(JSON.stringify({ event: 'bedrock_projection_failure', name: error.name, message: error.message?.slice(0, 220) })); front.end('SAO 兼容数据暂不可用，请稍后重连；不会重放物品操作。'); back.end('bedrock projection failed') }
    back.on('error', fail); front.on('error', error => { console.error(JSON.stringify({ event: 'bedrock_front_error', message: error.message?.slice(0, 180) })); back.end('frontend error') })
    back.on('end', () => front.end('SAO connection closed')); front.on('end', () => { connections.delete(front); back.end('Bedrock client disconnected') })
    back.on('packet', (packet, meta) => {
      if (failed || meta.state !== mc.states.PLAY || front.state !== mc.states.PLAY) return
      try {
        let value = packet
        if (meta.name === 'login') {
          codec = packet.dimensionCodec; sectionCount = dimensionSections(codec, packet.worldType)
          backendReady = true
          for (const message of queued) back.write(message.name, message.value)
          queued = []; queuedBytes = 0
        }
        if (meta.name === 'respawn') sectionCount = dimensionSections(codec, packet.dimension)
        if (meta.name === 'custom_payload') {
          // Native private receipts are for SDK clients, never game chat. No
          // mod client screen packet is misrepresented as a vanilla screen.
          if (!['minecraft:brand', 'minecraft:register', 'minecraft:unregister'].includes(packet.channel)) return
        }
        if (meta.name === 'declare_recipes') value = { nativeRecipeBytes: Buffer.from([0]) }
        if (meta.name === 'unlock_recipes') return
        if (meta.name === 'tags') value = projected.tags(packet)
        if (meta.name === 'map_chunk') value = { ...packet, chunkData: remapChunk(packet.chunkData, id => {
          const result = projected.states.get(id); if (result === undefined) throw Error('unknown_native_block_state'); return result
        }, globalBits, { sectionCount }), blockEntities: packet.blockEntities.filter(row => row.type < 42) }
        if (meta.name === 'block_change') value = { ...packet, type: projected.states.get(packet.type) ?? data.blocksByName.stone.defaultState }
        if (meta.name === 'multi_block_change') value = { ...packet, records: packet.records.map(record => ((projected.states.get(record >>> 12) ?? data.blocksByName.stone.defaultState) * 4096) + (record & 4095)) }
        if (meta.name === 'spawn_entity') { const type = projected.entities.get(packet.type); if (!type) throw Error('unknown_native_entity_type'); entityTypes.set(packet.entityId, type); value = { ...packet, type: type.base } }
        if (meta.name === 'entity_metadata' && entityTypes.get(packet.entityId)?.vanilla === false) value = { ...packet, metadata: packet.metadata.filter(row => row.key <= 14) }
        if (meta.name === 'open_window') {
          const layouts = require('prismarine-windows')('1.20.1')
          if (!layouts.createWindow(packet.windowId, packet.inventoryType, packet.windowTitle)) {
            // Refuse this unadapted screen, not the entire game session. Close
            // it through the normal server menu path so held stacks return by
            // Minecraft's own rules; never invent chest slots or click targets.
            blockedWindow = packet.windowId
            back.write('close_window', { windowId: packet.windowId })
            front.write('system_chat', { content: JSON.stringify({ text: '这个模组的专用界面尚未适配基岩版，已安全关闭。世界和物品仍会保留；完整界面请使用对应整合包的 Java 客户端。', color: 'yellow' }), isActionBar: false })
            console.log(JSON.stringify({ event: 'unsupported_bedrock_menu_closed', nativeMenuType: packet.inventoryType }))
            return
          }
          blockedWindow = null
          window = { id: packet.windowId }; value = packet
        }
        if (['window_items', 'set_slot', 'craft_progress_bar', 'close_window'].includes(meta.name) && packet.windowId !== 0 && packet.windowId === blockedWindow) return
        if (['window_items', 'set_slot', 'entity_equipment', 'trade_list', 'entity_metadata', 'advancements'].includes(meta.name)) value = projected.walkSlots(value)
        front.write(meta.name, value)
      } catch (error) {
        if (meta.name === 'map_chunk' && config.failureCaptureDirectory) {
          const dest = path.resolve(config.failureCaptureDirectory); fs.mkdirSync(dest, { recursive: true })
          try { fs.writeFileSync(path.join(dest, 'failed-chunk.bin'), packet.chunkData, { flag: 'wx' }); fs.writeFileSync(path.join(dest, 'failed-chunk.json'), JSON.stringify({ x: packet.x, z: packet.z, bytes: packet.chunkData.length, error: error.message })) } catch (capture) { if (capture.code !== 'EEXIST') console.error('chunk_capture_failed') }
        }
        fail(error)
      }
    })
    front.on('packet', (packet, meta) => {
      if (meta.state !== mc.states.PLAY || ['keep_alive', 'custom_payload'].includes(meta.name)) return
      try {
        let value = packet
        if (meta.name === 'window_click') {
          // Preserve actual input/state/slot. Client item-stack predictions are
          // omitted; Minecraft executes the ordinary click against native
          // inventory and sends authoritative resulting slots/cursor back.
          value = { ...packet, changedSlots: [], cursorItem: { present: false } }
        }
        if (meta.name === 'set_creative_slot') return
        if (!backendReady) { queuedBytes += 128; if (queued.length >= 128 || queuedBytes > 16384) throw Error('prelogin_input_budget'); queued.push({ name: meta.name, value }); return }
        back.write(meta.name, value)
      } catch (error) { fail(error) }
    })
  })
  readline.createInterface({ input: process.stdin }).on('line', line => {
    if (line === '{"kind":"shutdown"}') { for (const front of connections) front.end('Server maintenance'); server.close(); setTimeout(() => process.exit(0), 250).unref() }
  })
  return { server, projection: projected }
}
if (require.main === module) start(JSON.parse(fs.readFileSync(process.argv[2])))
module.exports = { bedrockName, dimensionSections, projection, start }
