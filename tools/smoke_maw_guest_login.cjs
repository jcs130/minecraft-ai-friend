'use strict'
// Finite isolated real-server test. No production credentials, accounts or LLM.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
if (!process.argv[2] || process.argv[2] === '--help') {
  console.log('Usage: node tools/smoke_maw_guest_login.cjs <isolated-QA-directory>')
  process.exit(process.argv[2] === '--help' ? 0 : 2)
}
const mineflayer = require('mineflayer')
const protocol = require('minecraft-protocol')
const { attachNativeWorldQuery } = require('../world/src/society-agent/native-world-query.cjs')
const directory = path.resolve(process.argv[2])
assert.match(fs.readFileSync(path.join(directory, 'server/server.properties'), 'utf8'), /^server-port=28978\r?$/m, 'isolated_QA_server_required')
assert.match(fs.readFileSync(path.join(directory, 'server/server.properties'), 'utf8'), /^server-ip=127\.0\.0\.1\r?$/m, 'loopback_QA_server_required')
const checks = {}, report = { checks, officialJavaAccountTested: false, actualPhoneTested: false, paidModelRequests: 0, productionActions: 0 }
const delay = ms => new Promise(r => setTimeout(r, ms))
const clients = new Set()
const suffix = Date.now().toString(36).slice(-4), guestName = 'MawGuest' + suffix, xboxName = 'MawXbox' + suffix
async function connect (username, port = 28979) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '1.21.1', auth: 'offline', physicsEnabled: false })
  clients.add(bot); const world = attachNativeWorldQuery(bot), messages = []; let challenge
  bot.on('error', () => {}); bot.on('kicked', () => {})
  bot.on('messagestr', m => messages.push(m))
  bot._client.on('custom_payload', p => { if (p.channel === 'maw_agent:auth_state') challenge = JSON.parse(p.data.toString('utf8')) })
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('spawn_timeout')), 30000); bot.once('spawn', () => { clearTimeout(t); resolve() }); bot.once('end', () => { clearTimeout(t); reject(Error('spawn_disconnected')) }) })
  await delay(700)
  return { bot, world, messages, challenge: () => challenge }
}
async function close (s) { s.bot.quit('Guest policy QA'); clients.delete(s.bot); await delay(350) }
async function unlocked (s) { for (let n = 0; n < 30; n++) { if ((await s.world.capabilities()).ok) return; await delay(150) } throw Error('authentication_timeout') }
async function snapshot (s) { await delay(200); for (let n = 0; n < 5; n++) { const r = await s.world.bodySnapshot(); if (r.code !== 'rate_limited') return r; await delay(200) } throw Error('snapshot_rate_limited') }
async function ui (s, action, args, secret) {
  const headers = { 'Content-Type': 'application/json' }; if (secret) headers['X-Maw-Bridge'] = secret
  const r = await fetch('http://127.0.0.1:28990/ui', { method: 'POST', headers, body: JSON.stringify({ ownerUuid: s.bot._client.uuid, playerName: s.bot.username, action, arguments: args }) })
  return { status: r.status, data: await r.json() }
}
async function premiumForgery () {
  const client = protocol.createClient({ host: '127.0.0.1', port: 28978, username: 'Notch', version: '1.21.1', auth: 'offline' })
  let challenge = false, success = false, disconnected = false
  client.on('error', () => {})
  const original = client.write.bind(client)
  client.write = (name, value) => original(name, name === 'login_start' ? { ...value, playerUUID: '069a79f4-44e9-4726-a5be-fca90e38aaf5' } : value)
  client.on('encryption_begin', () => { challenge = true })
  client.on('success', () => { success = true })
  client.on('disconnect', () => { disconnected = true })
  await new Promise(resolve => { const t = setTimeout(() => { client.end(); resolve() }, 28000); client.once('end', () => { clearTimeout(t); resolve() }) })
  checks.premium_requires_encrypted_session = challenge
  checks.premium_forgery_never_falls_back_offline = !success && disconnected
}
async function main () {
  const password = crypto.randomBytes(24).toString('base64url')
  const secret = JSON.parse(fs.readFileSync(path.join(directory, 'server/config/maw-numen-private/bridge.json'))).secret
  let s = await connect(guestName); const uuid = s.bot._client.uuid
  await unlocked(s); checks.unregistered_enters_without_password = (await snapshot(s)).ok
  checks.unregistered_reminder = s.messages.some(m => m.includes('尚未设置登录密码'))
  await close(s); s = await connect(guestName); await unlocked(s)
  checks.reminder_each_unregistered_login = s.messages.some(m => m.includes('尚未设置登录密码')) && s.bot._client.uuid === uuid
  s.bot.chat('/password ' + password + ' ' + password)
  for (let i = 0; i < 60 && !s.messages.some(m => m.includes('登录密码已保存')); i++) await delay(100)
  checks.in_world_password_saved = s.messages.some(m => m.includes('登录密码已保存'))
  await close(s); s = await connect(guestName)
  checks.existing_password_keeps_inventory_locked = (await s.world.bodySnapshot()).code === 'authentication_required'
  s.bot.chat('/password attacker_password attacker_password'); await delay(300)
  checks.cannot_reset_before_authentication = (await s.world.bodySnapshot()).code === 'authentication_required'
  s.bot.chat('/login incorrect_password'); await delay(500)
  checks.wrong_password_stays_locked = (await s.world.bodySnapshot()).code === 'authentication_required'
  s.bot.chat('/login ' + password); await unlocked(s)
  checks.original_password_identity_restored = s.bot._client.uuid === uuid && (await snapshot(s)).ok
  await close(s)

  s = await connect(guestName, 28991)
  for (let i = 0; i < 40 && !s.challenge(); i++) await delay(100)
  assert(s.challenge(), 'registered_connection_challenge_missing')
  const link = { nonce: s.challenge().nonce, xuid: '8' + Date.now() }
  checks.registered_name_not_claimable_without_password = (await ui(s, 'bedrock.authenticate', link, secret)).status === 400
  s.bot.chat('/login ' + password); await unlocked(s)
  checks.existing_password_can_link_verified_xbox_once = (await ui(s, 'bedrock.authenticate', link, secret)).data.mode === 'verified_bedrock'
  await close(s); s = await connect(guestName, 28991)
  for (let i = 0; i < 40 && !s.challenge(); i++) await delay(100)
  checks.linked_previous_password_account_rejoins_without_password = (await ui(s, 'bedrock.authenticate', { ...link, nonce: s.challenge().nonce }, secret)).data.ok === true
  await close(s)

  // The test acts as the trusted Geyser side of the existing private endpoint.
  // This is deliberately not a forged Xbox login or a real phone verification.
  s = await connect(xboxName, 28991)
  for (let i = 0; i < 40 && !s.challenge(); i++) await delay(100)
  assert(s.challenge(), 'connection_challenge_missing')
  const args = { nonce: s.challenge().nonce, xuid: '9' + Date.now() }
  checks.public_http_cannot_assert_identity = (await ui(s, 'bedrock.authenticate', args)).status === 403
  checks.invalid_nonce_rejected = (await ui(s, 'bedrock.authenticate', { ...args, nonce: '0'.repeat(64) }, secret)).status === 400
  checks.trusted_connection_proof_accepted = (await ui(s, 'bedrock.authenticate', args, secret)).data.mode === 'verified_bedrock'
  const old = { ...args }; await close(s); s = await connect(xboxName, 28991)
  checks.reserved_xbox_identity_requires_proof = (await s.world.bodySnapshot()).code === 'authentication_required'
  s.bot.chat('/register takeover_password takeover_password'); await delay(400)
  checks.offline_connection_cannot_register_reserved_xbox = (await s.world.bodySnapshot()).code === 'authentication_required'
  checks.old_connection_nonce_not_reusable = (await ui(s, 'bedrock.authenticate', old, secret)).status === 400
  for (let i = 0; i < 40 && !s.challenge(); i++) await delay(100)
  checks.wrong_xuid_cannot_take_over = (await ui(s, 'bedrock.authenticate', { nonce: s.challenge().nonce, xuid: '2234567890123456' }, secret)).status === 400
  checks.verified_xbox_rejoin_passwordless = (await ui(s, 'bedrock.authenticate', { ...args, nonce: s.challenge().nonce }, secret)).data.ok === true
  await unlocked(s); checks.verified_connection_native_operations = (await snapshot(s)).ok
  await close(s)
  await premiumForgery()
  assert(Object.values(checks).every(Boolean), JSON.stringify(checks)); report.ok = true
}
main().catch(e => { report.ok = false; report.error = e.message; process.exitCode = 1 }).finally(async () => {
  for (const bot of clients) bot.quit('QA complete')
  await delay(300)
  fs.writeFileSync(path.join(directory, 'guest-login-acceptance.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
})
