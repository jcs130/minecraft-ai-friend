'use strict'
const fs = require('node:fs')
const path = require('node:path')
const mineflayer = require('mineflayer')
const { attachForge } = require('./forge_client.cjs')
const { applyNativeRegistry } = require('./native_registry.cjs')
const { attachTauNativeClient } = require('../tau-ceti/native-bridge/native-client.cjs')

function createSAOBot ({ root, username = 'SAOBridgeProbe', botOptions = {}, authenticate }) {
  root = path.resolve(root)
  const scope = JSON.parse(fs.readFileSync(path.join(root, 'pack-source.json'))).scope
  if (!['isolated_testing', 'managed_server', 'remote_client_cache'].includes(scope)) throw new Error('marked_sao_deployment_required')
  const connection = scope === 'isolated_testing'
    ? { host: '127.0.0.1', port: 39676 }
    : JSON.parse(fs.readFileSync(path.join(root, 'agent-connection.json')))
  if (typeof connection.host !== 'string' || !connection.host || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) throw new Error('explicit_sao_connection_required')
  // Validate and prepare before opening a socket, so a stale cache cannot leave
  // an accidental half-connected body behind when construction throws.
  const prepared = require('prismarine-registry')('1.20.1')
  const metadata = applyNativeRegistry(prepared, root)
  for (const [key,expected] of Object.entries({host:connection.host,port:connection.port,version:'1.20.1',auth:'offline'})) {
    if (botOptions[key] !== undefined && botOptions[key] !== expected) throw new Error(`SAO_LAB_CONNECTION_MISMATCH:${key}`)
  }
  const bot = mineflayer.createBot({ ...botOptions, host: connection.host, port: connection.port, username, version: '1.20.1', auth: 'offline',
    hideErrors: true, physicsEnabled: false,
    customPackets: { '1.20': { play: { toClient: { types: {
      packet_declare_recipes: ['container',[{name:'nativeRecipeBytes',type:'restBuffer'}]]
    } } } } } })
  // A Forge recipe stream contains custom ingredient/serializer codecs. Preserve
  // the bytes and use the advertised native catalog; never call it an empty list.
  bot._client.on('declare_recipes', packet => {
    bot.nativeRecipeStream = { status:'opaque_native_codecs', bytes:packet.nativeRecipeBytes,
      observedAt:new Date().toISOString(), nextSafeRead:'native.recipes' }
    bot.emit('nativeRecipeStream', {status:'opaque_native_codecs',bytes:packet.nativeRecipeBytes.length})
  })
  bot.physicsEnabled = false
  // This runs synchronously before inject_allowed: every internal Mineflayer
  // plugin receives the native registry, not a later relabelled vanilla cache.
  for (const key of ['blocks','blocksByName','blocksByStateId','blocksArray','items','itemsByName','itemsArray',
    'entities','entitiesByName','entitiesArray','foods','foodsByName','foodsArray','blockCollisionShapes','mawNativeRegistry']) bot.registry[key] = prepared[key]
  attachForge(bot._client, root, state => bot.emit('forgeState', state))
  const native = attachTauNativeClient(bot, { timeoutMs: 10000 })
  bot.native = native
  bot.nativeRegistry = metadata
  bot.once('inject_allowed', () => {
    bot.recipesFor = bot.recipesAll = () => { throw new Error('USE_NATIVE_SERVER_RECIPE_CATALOG') }
    bot.craft = async () => { throw new Error('NATIVE_RECIPE_EXECUTION_REQUIRES_ACTUAL_MENU_AND_NATIVE_CATALOG') }
    const windows = require('prismarine-windows')(bot.registry)
    const handlers = bot._client.listeners('open_window')
    for (const handler of handlers) bot._client.removeListener('open_window', handler)
    bot._client.on('open_window', packet => {
      // Unknown mod menus have no trustworthy vanilla layout. Keep the real
      // window ID and query its native slots, instead of guessing a chest size.
      if (!windows.createWindow(packet.windowId, packet.inventoryType, packet.windowTitle, packet.slotCount)) {
        bot.currentWindow = null
        bot.emit('nativeWindowOpen', { id: packet.windowId, nativeTypeId: packet.inventoryType, title: packet.windowTitle })
        return
      }
      for (const handler of handlers) handler(packet)
    })
  })
  let resolveReady, rejectReady
  bot.nativeReady = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  bot.nativeReady.catch(() => {})
  bot.once('spawn', async () => {
    try {
      let capabilities = await native.operations()
      if (!capabilities.ok || capabilities.serverEpoch !== metadata.serverEpoch) throw new Error(`native_readiness_failed:${JSON.stringify({code:capabilities.code,epoch:capabilities.serverEpoch,expected:metadata.serverEpoch,diagnostics:native.diagnostics()})}`)
      if (capabilities.authentication?.required && !capabilities.authentication.authenticated) {
        let login = authenticate
        if (!login && scope === 'managed_server' && connection.loginPasswordEnv) {
          if (connection.loginUsername !== username || !/^[A-Z][A-Z0-9_]{1,79}$/.test(connection.loginPasswordEnv)) throw new Error('explicit_login_identity_required')
          const password = process.env[connection.loginPasswordEnv]
          if (typeof password !== 'string' || password.length < 8 || password.length > 72 || /\s/.test(password)) throw new Error('private_login_credential_unavailable')
          login = body => body.chat('/login ' + password)
        }
        if (typeof login !== 'function') throw new Error('authentication_required_supply_explicit_callback')
        await login(bot, capabilities) // Authentication only; never a game action loop.
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 250))
          capabilities = await native.operations({ refresh: true })
          if (capabilities.serverEpoch !== metadata.serverEpoch) throw new Error('native_epoch_changed_during_authentication')
          if (capabilities.authentication?.authenticated === true) break
        }
        if (capabilities.authentication?.authenticated !== true) throw new Error('native_authentication_not_confirmed_no_auto_replay')
      }
      bot.physicsEnabled = true
      resolveReady(capabilities)
    } catch (error) { bot.physicsEnabled = false; rejectReady(error); bot.end('native_registry_not_verified') }
  })
  bot.once('end', reason => rejectReady(new Error(`connection_ended:${reason}`)))
  return bot
}
module.exports = { createSAOBot }
