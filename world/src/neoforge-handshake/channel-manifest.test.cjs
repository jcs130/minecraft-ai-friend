'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { channelKnowledge, readChannelManifest } = require('./channel-manifest.cjs')
const raw = () => ({ schemaVersion: 1, minecraft: '1.21.1', neoforge: '21.1.248',
  protocols: { 1: [{ id: 'create:action', version: '6.0.10', flow: 0, optional: false }],
    4: [{ id: 'create:config', version: '1', optional: true }] } })
test('explicit export preserves exact version, flow, optional flag and protocol', () => {
  const result = channelKnowledge(raw())
  assert.equal(result.get('1/create:action').version, '6.0.10')
  assert.equal(result.get('1/create:action').flow, 0)
  assert.equal(result.get('1/create:action').optional, false)
  assert.equal(result.get('4/create:config').flow, null)
})
test('one payload may legitimately exist in both configuration and play', () => {
  const input = raw(); input.protocols[4][0].id = 'create:action'
  assert.equal(channelKnowledge(input).size, 2)
})
test('legacy deployment without explicit channel export is unchanged', () => assert.equal(readChannelManifest(), null))
test('wire round-trip preserves a common channel in two protocols', () => {
  const { buildChannelList } = require('./probe.cjs')
  const { encodeNetworkQuery, decodeNetworkQuery } = require('./payloads.cjs')
  const input = raw(); input.protocols[4][0].id = 'create:action'
  const wire = decodeNetworkQuery(encodeNetworkQuery(buildChannelList(channelKnowledge(input))))
  assert.equal(wire[1][0].id, 'create:action')
  assert.equal(wire[4][0].id, 'create:action')
  assert.equal(wire[1][0].flow, 0)
  assert.equal(wire[1][0].optional, false)
  assert.equal(wire[1][0].version, '6.0.10')
})
for (const [name, change] of [
  ['wrong Minecraft', r => { r.minecraft = '1.20.6' }],
  ['wrong NeoForge', r => { r.neoforge = '21.1.247' }],
  ['wrong schema', r => { r.schemaVersion = 2 }],
  ['unknown protocol', r => { r.protocols[3] = r.protocols[1] }],
  ['invalid flow', r => { r.protocols[1][0].flow = 2 }],
  ['missing optional flag', r => { delete r.protocols[1][0].optional }],
  ['invalid ID', r => { r.protocols[1][0].id = '../mod' }],
  ['invalid version', r => { r.protocols[1][0].version = 1 }],
  ['duplicate within protocol', r => { r.protocols[1].push(r.protocols[1][0]) }],
  ['empty manifest', r => { r.protocols = {} }],
  ['null registration', r => { r.protocols[1] = [null] }]
]) test(name + ' fails instead of learning by reconnecting', () => {
  const input = raw(); change(input); assert.throws(() => channelKnowledge(input), /CHANNEL_MANIFEST_/)
})
