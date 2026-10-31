'use strict'
const { attachTauNativeClient } = require('./native-client.cjs')
const { attachNativeViewerPackets } = require('./native-stream.cjs')
const { readStateCatalog, attachNativeWorld } = require('./native-world.cjs')
const { visitChunk } = require('./native-chunk-remap.cjs')
const attached = new WeakMap()

/** Attach BEFORE connecting/spawning; never create a bot, loop or second body. */
function attachNativeAdventure (bot, { stateFile, expectedRegistrySha256, bindBlockReads = false, maxChunks = 256 } = {}) {
  if (typeof bindBlockReads !== 'boolean' || !Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 1024) throw Error('NATIVE_ADAPTER_OPTIONS_INVALID')
  if (!bot || typeof bot !== 'object' || attached.has(bot)) throw Error('ONE_NATIVE_ADAPTER_PER_BODY_REQUIRED')
  if (bot.entity) throw Error('NATIVE_ATTACH_BEFORE_SPAWN_REQUIRED')
  const catalog = readStateCatalog(stateFile, expectedRegistrySha256)
  const native = attachTauNativeClient(bot)
  const packets = attachNativeViewerPackets(bot, expectedRegistrySha256)
  const world = attachNativeWorld(bot, packets, { catalog, visitChunk, maxChunks })
  const onSpawn = () => { if (bindBlockReads) world.bindBlockReads() }
  let detached = false
  function detach () {
    if (detached) return
    detached = true; bot.off('spawn', onSpawn); bot.off('end', detach)
    native.detach(); world.detach(); packets.detach()
    attached.delete(bot)
  }
  bot.on('spawn', onSpawn); bot.on('end', detach)
  const adapter = { native, world, packets, detach, health: () => ({ native: native.state(), world: world.health(), stream: packets.health() }) }
  attached.set(bot, adapter)
  return adapter
}
module.exports = { attachNativeAdventure, readStateCatalog, attachNativeWorld }
