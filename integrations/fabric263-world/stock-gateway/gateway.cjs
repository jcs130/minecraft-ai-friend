'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const { connectBackend, vanillaProtocol } = require('./backend.cjs')
const { Projection, text, empty } = require('./projection.cjs')
const { ChunkProjection } = require('./chunks.cjs')
const { parseQuery, query, sendPrivate } = require('./queries.cjs')

function validateConfig (config) {
  if (config.labOnly !== true || config.bindHost !== '127.0.0.1' || config.backendHost !== '127.0.0.1') throw new Error('loopback_lab_only_no_public_authentication_implementation')
  for (const field of ['bindPort', 'backendPort']) if (!Number.isInteger(config[field]) || config[field] < 1024 || config[field] > 65535) throw new Error('invalid_port:' + field)
  if (config.bindPort === config.backendPort || !path.isAbsolute(config.runtime)) throw new Error('distinct_ports_and_absolute_runtime_required')
  if (!Number.isInteger(config.maxConnections) || config.maxConnections < 1 || config.maxConnections > 8) throw new Error('maxConnections_requires_1_to_8')
  return config
}

function createGateway (config, logger = row => process.stdout.write(JSON.stringify(row) + '\n')) {
  validateConfig(config)
  const req = createRequire(path.resolve(config.runtime, 'package.json'))
  const protocol = req('minecraft-protocol')
  const vanilla = req('minecraft-data')('26.3')
  const nbt = req('prismarine-nbt')
  const server = new protocol.Server('26.3', vanillaProtocol(vanilla), false)
  Object.assign(server, { mcversion: vanilla.version, motd: 'My Agent World - stock client gateway QA', maxPlayers: config.maxConnections, playerCount: 0 })
  const sessions = new Map()
  const publish = () => {
    if (!config.statusFile) return
    const file = path.resolve(config.statusFile)
    const value = { activeCount: sessions.size, observedAt: new Date().toISOString(),
      sessions: [...sessions.values()].map(session => ({ name: session.name, ready: !!session.joined })) }
    fs.writeFileSync(file + '.tmp', JSON.stringify(value))
    fs.renameSync(file + '.tmp', file)
  }
  publish()
  if (config.statusFile) {
    const heartbeat = setInterval(() => {
      try { publish() } catch (error) { logger({ event: 'session_state_write_failed', message: error.message }) }
    }, 1000)
    heartbeat.unref()
  }
  const options = { version: '26.3', kickTimeout: 30000, checkTimeoutInterval: 4000,
    // ViaProxy has an explicit 26.3 target; its external Agent entry advertises
    // the stable stock protocol so Mineflayer auto-detection does not choose an
    // unsupported native 26.3 stack.
    beforePing: response => ({ ...response, version: { name: 'My Agent World stock 1.21.1 / native 26.3', protocol: 767 } }) }
  const moduleRoot = path.dirname(req.resolve('minecraft-protocol/package.json'))
  server.on('connection', peer => {
    logger({ event: 'stock_front_connected' })
    if (sessions.size >= config.maxConnections) { peer.end('gateway_capacity'); return }
    req(path.join(moduleRoot, 'src/server/handshake.js'))(peer, server, options)
    req(path.join(moduleRoot, 'src/server/ping.js'))(peer, server, options)
    req(path.join(moduleRoot, 'src/server/keepalive.js'))(peer, server, options)
    let s
    const loginTimer = setTimeout(() => peer.end('gateway_login_timeout'), 30000)
    peer.on('error', error => { logger({ event: 'stock_front_error', message: error.message }); s?.fail('frontend_protocol_error'); if (!s) peer.end('frontend_protocol_error') })
    peer.once('end', () => {
      clearTimeout(loginTimer)
      if (s) { s.closed = true; sessions.delete(s.name); s.endBackend('controlling_client_disconnected'); server.playerCount = sessions.size; publish() }
    })
    peer.once('login_start', packet => {
      logger({ event: 'stock_front_login_start', body: packet.username })
      if (!/^[A-Za-z0-9_]{1,16}$/.test(packet.username || '') || sessions.has(packet.username)) { peer.end('invalid_or_already_controlled_body'); return }
      const name = packet.username
      s = { name, peer, runtime: config.runtime, backend: null, projection: null, windows: new Map(), entities: new Map(), activeWindow: 0,
        attributes: [], omitted: new Map(), health: null, position: null, dimensionName: null,
        registryData: new Map(), features: null, pending: [], pendingBytes: 0, closed: false, joined: false,
        queryTokens: 8, queryAt: Date.now(), fail: null, send: null }
      sessions.set(name, s); server.playerCount = sessions.size; publish()
      s.endBackend = reason => { if (!s.backendEndRequested) { s.backendEndRequested = true; s.backend?.client.end(reason) } }
      s.fail = reason => {
        if (s.closed) return
        s.closed = true
        logger({ event: 'stock_session_closed', body: name, reason })
        peer.end(reason)
        s.endBackend(reason)
      }
      s.send = (name, data, bytes = 1024) => {
        if (s.closed) return
        if (peer.state !== 'play') {
          s.pendingBytes += bytes
          if (s.pendingBytes > 16 * 1024 * 1024 || s.pending.length >= 4096) throw new Error('frontend_initial_packet_budget')
          s.pending.push({ name, data }); return
        }
        if (peer.socket?.writableLength > 8 * 1024 * 1024) throw new Error('frontend_backpressure_budget')
        peer.write(name, data)
      }
      try {
        s.backend = connectBackend(req, { host: config.backendHost, port: config.backendPort, username: name })
      } catch (error) { logger({ event: 'backend_initialization_error', message: error.message }); s.fail('backend_initialization_error'); return }
      s.backend.ready.then(({ data }) => { s.projection = new Projection(data, vanilla, req) }).catch(error => { logger({ event: 'native_catalog_error', message: error.message }); s.fail('native_catalog_error') })
      const back = s.backend.client
      back.on('error', error => { logger({ event: 'native_backend_error', body: name, message: error.message }); s.fail('native_backend_protocol_error') })
      back.once('end', reason => { s.backendEndRequested = true; s.fail('native_backend_disconnected:' + String(reason).slice(0, 120)) })
      back.on('open_window', packet => guarded(() => {
        const layout = s.backend.menus.layouts.get(packet.windowId)
        if (!layout) throw new Error('actual_native_menu_layout_missing')
        const projection = s.projection.menu(layout)
        s.windows.set(packet.windowId, { layout, projection, items: [], stateId: -1, observedAt: null })
        s.activeWindow = packet.windowId
        s.send('open_window', { ...packet, inventoryType: projection.carrierType,
          windowTitle: text(layout.nativeId + ' [原生容器]') })
      }))
      back.on('packet', (packet, meta) => guarded(() => {
        if (meta.state === 'configuration') {
          if (meta.name === 'registry_data') s.registryData.set(packet.id, packet)
          if (meta.name === 'feature_flags') s.features = packet
          return
        }
        if (meta.state !== 'play') return
        const kind = meta.name
        if (kind === 'login') {
          if (!s.projection) throw new Error('native_projection_not_ready')
          const registry = s.registryData.get('minecraft:dimension_type')
          const dimension = registry?.entries?.[packet.worldState.dimension]
          if (!dimension?.value) throw new Error('actual_dimension_data_required')
          const values = nbt.simplify(dimension.value)
          if (!Number.isInteger(values.min_y) || !Number.isInteger(values.height) || values.height < 16 || values.height > 4096) throw new Error('invalid_native_dimension_bounds')
          // Chunk decoding uses actual native max-state bits and collision data.
          const { applyRegistry } = require('../mineflayer/native_registry.cjs')
          const actual = req('prismarine-registry')('26.3'); applyRegistry(actual, s.backend.data)
          s.chunks = new ChunkProjection(req, actual, vanilla, s.projection, { minY: values.min_y, worldHeight: values.height })
          s.entityId = packet.entityId; s.dimensionName = packet.worldState.name
          peer.uuid = back.uuid; peer.username = name
          const hash = crypto.createHash('md5').update('OfflinePlayer:' + name).digest(); hash[6] = (hash[6] & 15) | 48; hash[8] = (hash[8] & 63) | 128
          if (back.uuid.replaceAll('-', '') !== hash.toString('hex')) throw new Error('backend_body_identity_mismatch')
          s.backend.read('status').then(snapshot => {
            if (s.closed) return
            if (snapshot.status !== 'ok') throw new Error('authoritative_body_bridge_unavailable')
            s.snapshot = snapshot
            peer.write('compress', { threshold: 256 }); peer.compressionThreshold = 256
            peer.write('success', { uuid: back.uuid, username: name, properties: [], sessionId: s.backend.loginIdentity.sessionId })
            s.joined = true
            publish()
          }).catch(error => { logger({ event: 'body_bridge_bootstrap_error', message: error.message }); s.fail('authoritative_body_bridge_unavailable') })
        }
        const output = transform(s, kind, packet, vanilla)
        if (output) s.send(kind, output, meta.size)
      }))
      peer.once('login_acknowledged', () => guarded(() => {
        if (!s.joined) throw new Error('frontend_ack_before_backend_identity')
        peer.state = 'configuration'
        for (const data of s.registryData.values()) if (data.id.startsWith('minecraft:')) peer.write('registry_data', data)
        if (s.features) peer.write('feature_flags', s.features)
        peer.once('finish_configuration', () => guarded(() => {
          peer.state = 'play'; clearTimeout(loginTimer)
          for (const packet of s.pending) peer.write(packet.name, packet.data)
          s.pending = []; s.pendingBytes = 0
          logger({ event: 'stock_body_ready', body: name, uuid: back.uuid, epoch: s.backend.data.serverEpoch })
          sendPrivate(peer, { schemaVersion: 1, kind: 'help', status: 'ok', bodyId: back.uuid,
            message: '原生物品身份在 custom_data.maw_native；/agent help 按需查询。普通名称是明确的原版载体。' })
        }))
        peer.write('finish_configuration', {})
      }))
      peer.on('packet', (packet, meta) => {
        if (meta.state !== 'play' || s.closed) return
        guarded(() => fromFront(s, packet, meta.name))
      })
      function guarded (fn) {
        if (s.closed) return
        try { fn() } catch (error) { logger({ event: 'stock_projection_error', body: name, message: error.message, stack: error.stack }); s.fail('unsupported_native_projection:' + error.message.slice(0, 150)) }
      }
    })
  })
  server.on('error', error => logger({ event: 'stock_gateway_error', message: error.message }))
  return { server, sessions, listen: () => new Promise((resolve, reject) => {
    server.once('error', reject); server.once('listening', resolve); server.listen(config.bindPort, config.bindHost)
  }), close: () => server.close() }
}

function transform (s, kind, packet, vanilla) {
  const p = s.projection
  if (kind === 'start_configuration') throw new Error('native_reconfiguration_requires_explicit_reconnect')
  if (['keep_alive', 'open_window', 'custom_payload'].includes(kind)) return null
  if (['recipe_book_add', 'recipe_book_remove', 'recipe_book_settings', 'declare_commands', 'advancements', 'select_advancement_tab'].includes(kind)) {
    s.omitted.set(kind, (s.omitted.get(kind) || 0) + 1); return null
  }
  if (kind === 'position') s.position = { x: packet.x, y: packet.y, z: packet.z }
  if (kind === 'update_health') s.health = { current: packet.health, food: packet.food, saturation: packet.foodSaturation }
  if (kind === 'respawn') {
    const dimensions = s.registryData.get('minecraft:dimension_type')?.entries
    const value = dimensions?.[packet.worldState.dimension]?.value
    if (!value) throw new Error('new_dimension_not_previously_registered')
    const req = createRequire(path.resolve(s.runtime, 'package.json'))
    const dimensionsData = req('prismarine-nbt').simplify(value)
    const actual = req('prismarine-registry')('26.3')
    require('../mineflayer/native_registry.cjs').applyRegistry(actual, s.backend.data)
    s.chunks = new ChunkProjection(req, actual, vanilla, p, { minY: dimensionsData.min_y, worldHeight: dimensionsData.height })
    s.windows.clear(); s.activeWindow = 0; s.position = null; s.snapshot = null; s.dimensionName = packet.worldState.name
  }
  if (kind === 'map_chunk') return s.chunks.project(packet)
  if (kind === 'unload_chunk') s.chunks.columns.delete(packet.chunkX + ',' + packet.chunkZ)
  if (kind === 'block_change') { s.chunks.update(packet.location, packet.type); return { ...packet, type: p.block(packet.type).stateId } }
  if (kind === 'multi_block_change') return { ...packet, records: packet.records.map(record => {
    const state = Math.floor(record / 4096); const local = record & 4095
    s.chunks.update({ x: packet.chunkCoordinates.x * 16 + (local >> 8), y: packet.chunkCoordinates.y * 16 + (local & 15), z: packet.chunkCoordinates.z * 16 + ((local >> 4) & 15) }, state)
    return p.block(state).stateId * 4096 + local
  }) }
  if (kind === 'window_items') {
    const old = s.windows.get(packet.windowId)
    const row = { ...old, items: packet.items, stateId: packet.stateId, carriedItem: packet.carriedItem,
      layout: old?.layout || s.backend.menus.layouts.get(packet.windowId), observedAt: new Date().toISOString() }
    s.windows.set(packet.windowId, row)
    let items
    if (packet.windowId === 0) items = packet.items.slice(0, 46).map(slot => p.slot(slot))
    else {
      if (!row.projection || packet.items.length !== row.layout.slotCount) throw new Error('menu_contents_without_actual_layout')
      items = Array.from({ length: row.projection.carrierTotal }, empty)
      packet.items.forEach((slot, index) => { items[row.projection.toCarrierSlot(index)] = p.slot(slot) })
    }
    return { ...packet, items, carriedItem: p.slot(packet.carriedItem) }
  }
  if (kind === 'set_slot') {
    const row = s.windows.get(packet.windowId)
    if (row && packet.slot >= 0) { row.items[packet.slot] = packet.item; row.stateId = packet.stateId; row.observedAt = new Date().toISOString() }
    if (packet.windowId === 0 && packet.slot >= 46) return null
    return { ...packet, slot: row?.projection && packet.slot >= 0 ? row.projection.toCarrierSlot(packet.slot) : packet.slot, item: p.slot(packet.item) }
  }
  if (kind === 'set_player_inventory') return { ...packet, contents: p.slot(packet.contents) }
  if (kind === 'close_window') { s.activeWindow = 0; if (packet.windowId !== 0) s.windows.delete(packet.windowId) }
  if (kind === 'entity_destroy') for (const id of packet.entityIds) s.entities.delete(id)
  if (kind === 'entity_equipment') return { ...packet, equipments: packet.equipments.map(row => ({ ...row, item: p.slot(row.item) })) }
  if (kind === 'entity_update_attributes') {
    if (packet.entityId === s.entityId) s.attributes = packet.properties
    const known = new Set(vanilla.attributesArray.map(row => row.resource))
    return { ...packet, properties: packet.properties.filter(row => known.has(row.key)) }
  }
  if (kind === 'spawn_entity') {
    const carrier = p.entityMap.get(packet.type)
    if (!carrier) throw new Error('unknown_native_entity_type:' + packet.type)
    s.entities.set(packet.entityId, { native: p.entities.get(packet.type), carrier })
    return { ...packet, type: carrier.id, objectData: p.entities.get(packet.type).name === 'minecraft:falling_block' ? p.block(packet.objectData).stateId : packet.objectData }
  }
  if (kind === 'entity_metadata') {
    const entity = s.entities.get(packet.entityId)
    if (entity && !entity.carrier.exact) return { ...packet, metadata: [{ key: 2, type: 'optional_component', value: text(entity.native.name) }, { key: 3, type: 'boolean', value: true }] }
    return { ...packet, metadata: packet.metadata.map(row => ({ ...row, value: row.type === 'item_stack' ? p.slot(row.value) : row.type === 'block_state' ? p.block(row.value).stateId : row.value })) }
  }
  if (kind === 'tags') return { ...packet, tags: packet.tags.filter(row => !['minecraft:block', 'minecraft:item', 'minecraft:entity_type'].includes(row.tagType)) }
  if (['world_particles', 'sound_effect', 'entity_sound_effect', 'tile_entity_data'].includes(kind)) { s.omitted.set(kind, (s.omitted.get(kind) || 0) + 1); return null }
  return packet
}

function fromFront (s, packet, kind) {
  if (kind === 'keep_alive') return
  if (kind === 'chat_command' || kind === 'chat_command_signed') {
    const args = parseQuery(packet.command)
    if (args) {
      const now = Date.now(); s.queryTokens = Math.min(8, s.queryTokens + (now - s.queryAt) * 0.004); s.queryAt = now
      if (s.queryTokens < 1) sendPrivate(s.peer, { schemaVersion: 1, requestId: args.requestId, status: 'rate_limited', reason: 'private_query_budget', retryAfterMs: 250 })
      else {
        s.queryTokens--
        if (args.section === 'status' || args.section === 'block') {
          s.backend.read(args.section, args.position).then(snapshot => {
            if (s.closed) return
            if (args.section === 'status' && snapshot.status !== 'ok') { sendPrivate(s.peer, { ...snapshot, requestId: args.requestId, complete: false }); return }
            if (args.section === 'status') s.snapshot = snapshot
            sendPrivate(s.peer, query(s, { ...args, authoritative: snapshot }))
          }).catch(error => { if (!s.closed) sendPrivate(s.peer, { schemaVersion: 1, requestId: args.requestId, status: 'unknown', reason: error.message, complete: false, retryable: true }) })
        } else sendPrivate(s.peer, query(s, args))
      }
      return
    }
  }
  if (['position', 'position_look', 'teleport_confirm'].includes(kind)) s.position = { x: packet.x, y: packet.y, z: packet.z }
  if (kind === 'window_click') {
    const row = s.windows.get(packet.windowId)
    if (!row || (packet.windowId === 0 && packet.slot >= 46)) throw new Error('click_without_observed_native_window')
    let slot
    try { slot = row.projection ? row.projection.toNativeSlot(packet.slot) : packet.slot } catch {
      sendPrivate(s.peer, { schemaVersion: 1, status: 'denied', reason: 'padding_slot_is_not_a_native_slot', complete: false, retryable: false }); return
    }
    // Never guess native items from many-to-one carrier IDs or trust client NBT.
    // The vanilla server executes the click and resynchronizes its authoritative
    // inventory when an empty client prediction differs from the actual result.
    s.backend.client.write(kind, { ...packet, slot, changedSlots: [], cursorItem: null }); return
  }
  if (['set_creative_slot', 'craft_recipe_request', 'pick_item_from_block', 'pick_item_from_entity'].includes(kind)) {
    sendPrivate(s.peer, { schemaVersion: 1, status: 'unsupported', reason: 'native_reverse_item_or_recipe_identity_requires_separate_acceptance', action: kind, retryable: false }); return
  }
  if (kind === 'close_window') s.activeWindow = 0
  if (kind === 'custom_payload' && !['minecraft:brand', 'minecraft:register'].includes(packet.channel)) return
  s.backend.client.write(kind, packet)
}

if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const gateway = createGateway(config)
  gateway.listen().then(() => process.stdout.write(JSON.stringify({ event: 'stock_carrier_gateway_listening', port: config.bindPort }) + '\n'))
  require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    if (line === '{"kind":"shutdown"}') { gateway.server.once('close', () => process.exit(0)); gateway.close() }
  })
}
module.exports = { createGateway, validateConfig, transform, fromFront }
