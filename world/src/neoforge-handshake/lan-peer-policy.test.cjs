'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { lanPeerPolicy } = require('./lan-peer-policy.cjs')
test('LAN gate accepts actual home-subnet and loopback peers and refuses other interfaces', () => {
  const accepts = lanPeerPolicy('192.168.3.0/24')
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.3.10', '::ffff:192.168.3.163']) assert.equal(accepts(address), true)
  for (const address of ['192.168.4.10', '192.168.30.1', '172.29.1.10', '8.8.8.8', '2001:db8::1', null, '192.168.3.9.evil']) assert.equal(accepts(address), false)
})
test('LAN policy refuses public, broad, malformed or non-network CIDRs', () => {
  for (const value of ['0.0.0.0/0', '8.8.8.0/24', '192.168.3.0/16', '192.168.3.163/24', '192.168.999.0/24', '', {}]) assert.throws(() => lanPeerPolicy(value), /GATE_LAN_SUBNET_INVALID/)
  assert.equal(lanPeerPolicy()('8.8.8.8'), true)
})
