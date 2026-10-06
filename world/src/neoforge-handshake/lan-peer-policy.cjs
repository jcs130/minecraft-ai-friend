'use strict'
const { isIP } = require('node:net')

function lanPeerPolicy (subnet = null) {
  if (subnet === null) return () => true // Existing gate users retain their configured policy.
  const match = typeof subnet === 'string' && subnet.match(/^(\d+\.\d+\.\d+\.0)\/24$/)
  if (!match || isIP(match[1]) !== 4) throw Error('GATE_LAN_SUBNET_INVALID')
  const bytes = match[1].split('.').map(Number)
  if (!(bytes[0] === 10 || (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) || (bytes[0] === 192 && bytes[1] === 168))) throw Error('GATE_LAN_SUBNET_INVALID')
  const prefix = bytes.slice(0, 3).join('.') + '.'
  return address => {
    const peer = typeof address === 'string' ? address.replace(/^::ffff:/i, '') : ''
    return peer === '127.0.0.1' || peer === '::1' || (isIP(peer) === 4 && peer.startsWith(prefix))
  }
}
module.exports = { lanPeerPolicy }
