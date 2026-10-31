'use strict'
const { attachTauNativeClient } = require('./native-client.cjs')
const { attachNativeViewerPackets } = require('./native-stream.cjs')
const { attachNativeWorld } = require('./native-world.cjs')
const { visitChunk } = require('./native-chunk-remap.cjs')
const P = require('./registry-protocol.cjs')

/** Standard bot.loadPlugin(plugin). No files, HTTP endpoint, model or new bot. */
function mineflayerPlugin (bot) {
  if (!bot?._client?.on || bot.entity || bot.nativeAdventure) throw Error('ONE_NATIVE_PLUGIN_BEFORE_SPAWN_REQUIRED')
  const native = attachTauNativeClient(bot), catalog = new Map()
  let packets, world, hash = null, stateCount = 0, sequence = 0, closed = false, sent = false, failure = null, resolveReady, rejectReady, unknownOriginal, timer
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const bindings = []
  // Hosts may await ready later; an unavailable native bridge must not produce
  // an unhandled Promise rejection in an otherwise valid vanilla connection.
  ready.catch(() => {})
  function hello () {
    if (closed || sent || !['configuration', 'play'].includes(bot._client.state)) return
    sent = true; bot._client.write('custom_payload', { channel: P.CHANNEL, data: P.encode(P.hello('stream_catalog')) })
    timer = setTimeout(() => fail(Error('NATIVE_REGISTRY_MANIFEST_TIMEOUT')), 15000)
    timer.unref?.()
  }
  function fail (error) {
    if (failure || closed) return
    failure = error.message; clearTimeout(timer); world?.detach(); packets?.detach()
    // Never fall back to carrier geometry after native data has been lost.
    unknownOriginal = bot.blockAt; bot.blockAt = unavailableBlockRead
    rejectReady(error); bot.emit('native_world_unavailable', error.message)
  }
  const unavailableBlockRead = () => null
  function payload (packet) {
    if (packet.channel !== P.CHANNEL || closed || failure) return
    try {
      const body = P.decode(Buffer.from(packet.data))
      if (body.kind === 'manifest') {
        if (hash || body.sequence !== 0 || body.mode !== 'stream_catalog' || body.minecraftVersion !== '1.21.1' ||
            !P.HASH.test(body.registrySha256 || '') || !Number.isSafeInteger(body.stateCount) || body.stateCount < 1 || body.stateCount > P.MAX_ROWS ||
            body.source !== 'same_connection_received_states' || body.complete !== false) throw Error('NATIVE_REGISTRY_MANIFEST_INVALID')
        hash = body.registrySha256
        stateCount = body.stateCount
        clearTimeout(timer)
        packets = attachNativeViewerPackets(bot, hash)
        world = attachNativeWorld(bot, packets, { catalog, visitChunk })
        if (bot.entity) world.bindBlockReads()
        resolveReady(api)
      } else if (body.kind === 'states') {
        if (!hash || body.registrySha256 !== hash || body.sequence !== sequence + 1 || !Array.isArray(body.rows) ||
            body.rows.length < 1 || body.rows.length > P.MAX_PAGE_ROWS || catalog.size + body.rows.length > stateCount) throw Error('NATIVE_REGISTRY_PAGE_INVALID')
        const rows = body.rows.map(P.stateRow), ids = new Set()
        for (const row of rows) { if (catalog.has(row.stateId) || ids.has(row.stateId)) throw Error('NATIVE_REGISTRY_DUPLICATE_STATE'); ids.add(row.stateId) }
        for (const row of rows) catalog.set(row.stateId, row)
        sequence = body.sequence
      } else throw Error('NATIVE_REGISTRY_MESSAGE_INVALID')
    } catch (error) { fail(error) }
  }
  function bindContainers () {
    if (bindings.length) return
    for (const name of ['openContainer', 'openChest']) {
      const original = bot[name]; if (typeof original !== 'function') continue
      const ours = function (block, ...args) {
        const carriers = { 'lootr:lootr_chest': 'chest', 'lootr:lootr_trapped_chest': 'trapped_chest', 'lootr:lootr_barrel': 'barrel' }
        const native = block?.nativeObservation?.name, carrier = carriers[native]
        if (carrier && block.compatibilityCarrier?.name === carrier) {
          // The original Mineflayer helper only accepts vanilla names. Keep
          // its verified menu logic and actual right-click, using a local copy
          // for that name check; native observation and server item stay intact.
          block = Object.assign(Object.create(Object.getPrototypeOf(block)), block, { name: carrier })
        }
        return original.call(bot, block, ...args)
      }
      bot[name] = ours; bindings.push({ name, original, ours })
    }
  }
  function spawn () { if (world && !failure) { world.bindBlockReads(); bindContainers() }; hello() }
  function end () { if (!closed) { rejectReady(Error('NATIVE_CONNECTION_CLOSED')); detach() } }
  function detach () {
    if (closed) return
    closed = true; clearTimeout(timer); rejectReady(Error('NATIVE_ADAPTER_DETACHED'))
    bot._client.off('state', hello); bot._client.off('custom_payload', payload)
    bot.off('spawn', spawn); bot.off('end', end); native.detach(); world?.detach(); packets?.detach(); catalog.clear()
    for (const b of bindings) if (bot[b.name] === b.ours) bot[b.name] = b.original
    // A failed adapter owns a deliberate unknown reader; don't overwrite a
    // reader installed later by another plugin.
    if (bot.blockAt === unavailableBlockRead) bot.blockAt = unknownOriginal
    if (bot.nativeAdventure === api) delete bot.nativeAdventure
  }
  const api = { ready, native, get world () { return world ?? null }, get packets () { return packets ?? null }, detach,
    health: () => ({ failure, registrySha256: hash, definitions: catalog.size, native: native.state(), world: world?.health() ?? null, stream: packets?.health() ?? null }) }
  bot.nativeAdventure = api
  bot._client.on('state', hello); bot._client.on('custom_payload', payload)
  bot.on('spawn', spawn); bot.on('end', end); hello()
  return api
}
module.exports = { mineflayerPlugin }
