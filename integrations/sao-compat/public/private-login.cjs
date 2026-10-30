'use strict'
const fs = require('node:fs'), crypto = require('node:crypto'), { execFile } = require('node:child_process'), { promisify } = require('node:util')
const execute = promisify(execFile)
function createPrivateAuthenticator ({ python, broker, brokerSha256, root, username }) {
  if (username !== 'ag_Kirito' || !/^[a-f0-9]{64}$/.test(brokerSha256) || !python || !broker || !root) throw Error('explicit_private_authenticator_required')
  return async body => {
    if (body.username !== username || crypto.createHash('sha256').update(fs.readFileSync(broker)).digest('hex') !== brokerSha256) throw Error('private_authenticator_identity_or_code_changed')
    let password
    try {
      const reply = await execute(python, ['-X', 'utf8', broker, '--root', root, '--username', username], { windowsHide: true, timeout: 10000, maxBuffer: 4096, encoding: 'utf8' })
      password = reply.stdout
      if (typeof password !== 'string' || password.length < 8 || password.length > 72 || /\s/.test(password)) throw Error('invalid_private_game_credential')
    } catch { throw Error('private_game_credential_unavailable_no_auto_retry') }
    try { body.chat('/login ' + password) } finally { password = undefined }
  }
}
module.exports = { createPrivateAuthenticator }
