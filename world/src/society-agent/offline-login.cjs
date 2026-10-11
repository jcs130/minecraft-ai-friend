'use strict'
const fs = require('node:fs')

// A private credential belongs to this one existing connection. Never register,
// retry a rejected password, print credentials, or exempt a username/IP.
function attachOfflineLogin (bot, { credentialPath, username, query, onState = () => {}, sendLogin = password => bot.chat('/login ' + password) }) {
  const credential = fs.existsSync(credentialPath) ? JSON.parse(fs.readFileSync(credentialPath, 'utf8')) : null
  if (credential && (credential.username !== username ||
      !/^[A-Za-z0-9_-]{20,72}$/.test(credential.password) ||
      !/^[0-9a-f-]{36}$/.test(credential.playerUuid))) throw Error('GAME_LOGIN_CREDENTIAL_INVALID')
  let timer, closed = false, generation = 0, sent = false, ready = !credential
  function state (phase, code) { ready = phase === 'authenticated' || phase === 'not_configured'; onState({ phase, code }) }
  async function check (run, deadline) {
    if (closed || run !== generation) return
    try {
      if (bot.username !== credential.username || bot._client.uuid !== credential.playerUuid) { state('failed', 'identity_mismatch'); return }
      const receipt = await query()
      if (closed || run !== generation) return
      if (receipt?.ok === true && receipt.playerUuid === credential.playerUuid) { state('authenticated', 'native_state_verified'); return }
      if (receipt?.code === 'authentication_required' && !sent) {
        sent = true
        sendLogin(credential.password)
        state('pending', 'password_submitted_once')
      }
      if (Date.now() >= deadline) { state('failed', 'login_not_confirmed'); return }
    } catch { if (Date.now() >= deadline) { state('failed', 'login_not_confirmed'); return } }
    timer = setTimeout(() => check(run, deadline), 1000)
  }
  function spawn () {
    if (!credential || closed) return
    clearTimeout(timer); const run = ++generation
    state('pending', 'checking_server')
    timer = setTimeout(() => check(run, Date.now() + 30000), 250)
  }
  function close () { closed = true; generation++; clearTimeout(timer); ready = false }
  bot.on('spawn', spawn); bot.once('end', close)
  state(credential ? 'pending' : 'not_configured', credential ? 'awaiting_spawn' : 'no_private_credential')
  return { ready: () => ready, close }
}
module.exports = { attachOfflineLogin }
