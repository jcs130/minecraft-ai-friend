'use strict'
const fs = require('node:fs'), assert = require('node:assert/strict')
const { createSAOBot } = require('../../sao_bot.cjs')
let bot
;(async () => {
  try {
    bot = createSAOBot({ root: process.env.SAO_ROOT, username: 'SAOAuthProbe', authenticate: body => body.chat('/login ' + process.env.SAO_GAME_PASSWORD) })
    const cap = await bot.nativeReady, state = await bot.native.snapshot()
    const checks = { authenticated: cap.authentication.authenticated === true, nativeStateAllowed: state.ok === true, ordinaryConnectedPlayer: state.bodyKind === 'connected_player', sameUuid: state.bodyId === process.env.SAO_EXPECTED_UUID }
    assert(Object.values(checks).every(Boolean))
    fs.writeFileSync(process.env.SAO_AUTH_EVIDENCE, JSON.stringify({ schemaVersion: 1, observedAt: new Date().toISOString(), checks, bodyId: state.bodyId }, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ checks }))
    bot.quit('authentication migration acceptance complete'); setTimeout(() => process.exit(0), 500).unref()
  } catch (error) { console.error(JSON.stringify({ ok: false, message: String(error.message).split(process.env.SAO_GAME_PASSWORD).join('<redacted>') })); bot?.end('auth test failed'); process.exit(1) }
})()
