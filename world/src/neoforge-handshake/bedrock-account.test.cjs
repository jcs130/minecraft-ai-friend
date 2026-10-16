'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { bedrockAccountName } = require('./bedrock-account.cjs')
test('Bedrock namespace cannot claim Java/Agent names and leaves ordinary gateways unchanged', () => {
  for (const name of ['Goddess', 'ag_CorMy', 'MicroKQ', 'FomBedrockQA']) {
    assert.equal(bedrockAccountName(name), name)
    assert.equal(bedrockAccountName(name, true), 'b_' + name)
  }
  for (const name of ['LongGamertagBeyondFourteen', '玩家 #1234', 'John Smith']) {
    const result = bedrockAccountName(name, true)
    assert.match(result, /^bh[0-9a-f]{14}$/)
    assert.equal(result, bedrockAccountName(name, true))
  }
  assert.notEqual(bedrockAccountName('John Smith', true), bedrockAccountName('John_Smith', true))
  assert.throws(() => bedrockAccountName('bad\nname', true))
})
