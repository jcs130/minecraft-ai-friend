'use strict'
const crypto = require('node:crypto')

// A separate namespace prevents a verified Bedrock gamertag from claiming a
// Java/Agent login name. This is an account-name namespace, not an Xbox-XUID
// identity binding; renames are not silently migrated into another body.
function bedrockAccountName (name, enabled = false) {
  if (!enabled) return name
  if (typeof name !== 'string' || !name || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) throw Error('INVALID_BEDROCK_LOGIN_NAME')
  return /^[A-Za-z0-9_]{1,14}$/.test(name)
    ? 'b_' + name
    : 'bh' + crypto.createHash('sha256').update(name.toLowerCase(), 'utf8').digest('hex').slice(0,14)
}
module.exports = { bedrockAccountName }
