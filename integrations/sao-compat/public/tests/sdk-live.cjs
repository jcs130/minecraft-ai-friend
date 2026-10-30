'use strict'
const fs = require('node:fs'), assert = require('node:assert/strict'), { createRequire } = require('node:module')
const sdk = createRequire(process.env.SAO_SDK_PACKAGE)('myagentworld-sao-client')
let bot
;(async () => {
  try {
    const checks = {}, options = { host: process.env.SAO_HOST || '192.168.3.163', port: Number(process.env.SAO_PORT || 28977), username: 'ag_Kirito', cacheDirectory: process.env.SAO_SDK_CACHE,
      authenticate: async (body, cap) => { bot = body; checks.authenticationRequired = cap.authentication?.required === true; checks.notAlreadyAuthenticated = cap.authentication?.authenticated === false; const denied = await body.native.snapshot(); checks.privateStateBlockedBeforeLogin = denied.ok === false && denied.code === 'authentication_required'; body.chat('/login ' + process.env.SAO_GAME_PASSWORD) } }
    bot = await sdk.connect(options)
    const cap = await bot.native.operations(), state = await bot.native.snapshot(), rpg = await bot.sao.read('sao.status', {})
    checks.authenticated = cap.authentication.authenticated === true
    checks.realBody = state.bodyKind === 'connected_player' && state.bodyId === '8e7b99e0-595d-3402-935c-7139ac6814e3'
    checks.currentRegistry = cap.serverEpoch === bot.nativeRegistry.serverEpoch
    checks.nativeInventory = state.ok === true && state.menu.slots.some(x => x?.id === 'farmersdelight:egg_sandwich')
    checks.nativeProfession = rpg.ok === true && rpg.data.professionName === '觉醒战士'
    checks.nativeFood = !!bot.registry.foodsByName['farmersdelight:egg_sandwich']
    assert(Object.values(checks).every(Boolean), 'actual installed SDK checks')
    fs.writeFileSync(process.env.SAO_SDK_EVIDENCE, JSON.stringify({ schemaVersion: 1, observedAt: new Date().toISOString(), host: options.host, port: options.port, checks, serverEpoch: cap.serverEpoch, bodyId: state.bodyId, position: state.position }, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ checks, bodyId: state.bodyId, position: state.position })); bot.quit('published SDK acceptance complete'); setTimeout(() => process.exit(0), 500).unref()
  } catch (error) { console.error(JSON.stringify({ ok: false, message: String(error.message).split(process.env.SAO_GAME_PASSWORD).join('<redacted>') })); bot?.end('SDK test failed'); process.exit(1) }
})()
