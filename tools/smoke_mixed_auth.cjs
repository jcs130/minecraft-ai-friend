'use strict'
// Real socket/crypto/registration tests against the finite full-pack QA server.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const mineflayer = require('mineflayer')
const protocol = require('minecraft-protocol')
const { attachNativeWorldQuery } = require('../world/src/society-agent/native-world-query.cjs')
const directory = process.argv[2]
const bridge = JSON.parse(fs.readFileSync(path.join(directory, 'server/config/maw-numen-private/bridge.json'), 'utf8')).secret
const checks = {}, report = { checks, officialAccountLoginTested: false, productionActions: 0 }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let live
async function connect () {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 28979, username: 'MawAuthQA', version: '1.21.1', auth: 'offline', physicsEnabled: false })
  live = bot; const world = attachNativeWorldQuery(bot)
  bot.on('error', () => {}); bot.on('kicked', () => {})
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('offline_spawn_timeout')), 20000)
    bot.once('spawn', () => { clearTimeout(timer); resolve() })
    bot.once('end', () => { clearTimeout(timer); reject(Error('offline_spawn_disconnected')) })
  })
  await delay(250); return { bot, world }
}
async function disconnect (bot) { bot.quit('mixed auth QA done'); await delay(300); if (live === bot) live = null }
async function authenticated (world) {
  for (let i = 0; i < 25; i++) { const state = await world.capabilities(); if (state.ok) return state; await delay(150) }
  throw Error('authentication_not_completed')
}
async function deniedChannels (bot) {
  const channels = [
    ['maw_agent:world_query', 'maw_agent:world_state', 'body_snapshot'],
    ['maw_agent:menu_action', 'maw_agent:menu_state', 'click'],
    ['maw_agent:spell_query', 'maw_agent:spell_state', 'list'],
    ['maw_agent:maid_query', 'maw_agent:maid_state', 'list'],
    ['maw_agent:colony_query', 'maw_agent:colony_state', 'status'],
    ['maw_agent:mod_query', 'maw_agent:mod_state', 'ysm_catalog'],
    ['maw_agent:domum_query', 'maw_agent:domum_state', 'state']
  ]
  for (const [input, output, kind] of channels) {
    const requestId = crypto.randomUUID()
    const receipt = new Promise((resolve, reject) => {
      const handler = packet => {
        if (packet.channel !== output) return
        let result; try { result = JSON.parse(Buffer.from(packet.data).toString('utf8')) } catch { return }
        if (result.requestId === requestId) { clearTimeout(timer); bot._client.off('custom_payload', handler); resolve(result) }
      }
      const timer = setTimeout(() => { bot._client.off('custom_payload', handler); reject(Error('missing_auth_denial_' + input)) }, 4000)
      bot._client.on('custom_payload', handler)
    })
    bot._client.write('custom_payload', { channel: input, data: Buffer.from(JSON.stringify({ schemaVersion: 1, requestId, kind })) })
    const r = await receipt
    assert.equal(r.code, 'authentication_required'); assert.equal(r.ok, false); assert.equal(r.playerUuid, bot._client.uuid)
    assert.equal(r.state, undefined); assert.equal(r.inventory, undefined)
    checks['prelogin_' + kind + '_' + input.split(':')[1]] = true
  }
}
async function premiumForgery () {
  const client = protocol.createClient({ host: '127.0.0.1', port: 28978, username: 'Notch', version: '1.21.1', auth: 'offline' })
  let challenge = false, success = false, disconnect = false
  client.on('error', () => {})
  const original = client.write.bind(client)
  client.write = (name, value) => {
    if (name === 'login_start') value = { ...value, playerUUID: '069a79f4-44e9-4726-a5be-fca90e38aaf5' }
    return original(name, value)
  }
  client.on('encryption_begin', () => { challenge = true })
  client.on('success', () => { success = true })
  client.on('disconnect', () => { disconnect = true })
  await new Promise(resolve => { const timer = setTimeout(() => { client.end(); resolve() }, 28000); client.once('end', () => { clearTimeout(timer); resolve() }) })
  checks.premium_requires_encrypted_session = challenge
  checks.premium_forgery_never_falls_back_offline = !success && disconnect
}
async function main () {
  const password = crypto.randomBytes(24).toString('base64url')
  let { bot, world } = await connect()
  const before = await world.bodySnapshot(); assert.equal(before.code, 'authentication_required')
  await deniedChannels(bot)
  const response = await fetch('http://127.0.0.1:28990/ui', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Maw-Bridge': bridge },
    body: JSON.stringify({ ownerUuid: bot._client.uuid, playerName: 'MawAuthQA', action: 'menu', arguments: {} }) })
  const denied = await response.json(); checks.prelogin_private_management_denied = JSON.stringify(denied).includes('authentication_required')
  bot.chat('/register ' + password + ' ' + password)
  const state = await authenticated(world); checks.offline_register_unlocks_native_sdk = state.ok && state.playerUuid === bot._client.uuid
  const uuid = bot._client.uuid; await disconnect(bot)
  ;({ bot, world } = await connect())
  checks.same_ip_still_requires_password = (await world.bodySnapshot()).code === 'authentication_required'
  bot.chat('/login definitely_wrong_password'); await delay(600)
  checks.wrong_password_remains_locked = (await world.bodySnapshot()).code === 'authentication_required'
  bot.chat('/login ' + password); await authenticated(world)
  await delay(150) // Respect the native query channel's two-tick rate budget.
  const after = await world.bodySnapshot()
  report.loginIdentity = { originalUuid: uuid, currentUuid: bot._client.uuid, snapshotCode: after.code, snapshotOk: after.ok }
  checks.correct_password_original_identity = bot._client.uuid === uuid && after.ok
  await disconnect(bot); await premiumForgery()
  assert(Object.values(checks).every(Boolean), JSON.stringify(checks))
  report.ok = true
}
main().catch(error => { report.ok = false; report.error = error.message; process.exitCode = 1 }).finally(async () => {
  if (live) await disconnect(live)
  fs.writeFileSync(path.join(directory, 'auth-acceptance.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ok: report.ok, checks: Object.keys(checks).length, error: report.error }))
})
