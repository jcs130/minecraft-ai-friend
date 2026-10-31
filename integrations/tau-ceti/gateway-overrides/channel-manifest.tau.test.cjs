const { test } = require('node:test')
const assert = require('node:assert/strict')
const { channelKnowledge } = require('./channel-manifest.cjs')
const fixture = () => ({ schemaVersion: 1, minecraft: '1.21.1', neoforge: '21.1.234',
  protocols: { '1': [{ id: 'ae2:', version: 'ae2', optional: false, flow: 1 }] } })
test('real AE2 empty resource path and pinned Tau NeoForge are accepted', () => {
  assert.equal(channelKnowledge(fixture()).get('1/ae2:').id, 'ae2:')
})

test('actual isolated Youer 21.1.252 export is accepted without rewriting its version', () => {
  const data = fixture(); data.neoforge = '21.1.252'
  data.protocols['4'] = [{ id: 'bettercombat:config_sync', version: '1', optional: false, flow: 1 }]
  assert.equal(channelKnowledge(data).get('4/bettercombat:config_sync').version, '1')
  assert.equal(channelKnowledge(data).size, 2)
})
test('invalid identities and unreviewed loader versions remain errors', () => {
  const data = fixture(); data.protocols['1'][0].id = 'ae2:INVALID'
  assert.throws(() => channelKnowledge(data), /ENTRY/)
  const other = fixture(); other.neoforge = '21.1.999'
  assert.throws(() => channelKnowledge(other), /VERSION/)
})
test('duplicate registrations remain errors', () => {
  const data = fixture(); data.protocols['1'].push(data.protocols['1'][0])
  assert.throws(() => channelKnowledge(data), /DUPLICATE/)
})
