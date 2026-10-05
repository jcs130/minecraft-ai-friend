'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachModAgentClient } = require('./mod-agent-client.cjs')
const uuidA = '11111111-2222-3333-8444-555555555555'
const uuidB = 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee'
function bot (uuid) {
  const bot = new EventEmitter(); bot._client = new EventEmitter()
  bot._client.uuid = uuid; bot.writes = []
  bot._client.write = (name, body) => bot.writes.push({ name, body })
  return bot
}
test('external frameworks attach ordinary distinct accounts without a model provider or operator connection', async () => {
  const a = bot(uuidA), b = bot(uuidB), one = attachModAgentClient(a), two = attachModAgentClient(b)
  try {
    assert.equal(one.contract().playerUuid, uuidA); assert.equal(two.contract().playerUuid, uuidB)
    assert.equal(one.contract().allModsVerified, false); assert.equal(one.contract().publicAccessReady, false)
    assert.equal(a.writes.length, 0); assert.equal(b.writes.length, 0)
    const query = one.native.recipes({ recipeType: 'create:milling', limit: 1 })
    const id = JSON.parse(a.writes[0].body.data).requestId
    a._client.emit('custom_payload', { channel: 'maw_agent:world_state', data: Buffer.from(JSON.stringify({
      schemaVersion: 1, kind: 'world_receipt', requestId: id, playerUuid: uuidB, query: 'recipes', ok: true, recipes: ['foreign'] })) })
    let settled = false; query.then(() => { settled = true })
    await Promise.resolve(); assert.equal(settled, false); assert.equal(b.writes.length, 0)
    a._client.emit('custom_payload', { channel: 'maw_agent:world_state', data: Buffer.from(JSON.stringify({
      schemaVersion: 1, kind: 'world_receipt', requestId: id, playerUuid: uuidA, query: 'recipes', ok: true, recipes: [] })) })
    assert.equal((await query).playerUuid, uuidA)
    const tools = one.tools('colony'); assert.match(tools.tool.parameters.operation, /resources/)
    const contract = one.contract(); contract.channels.length = 0; assert.equal(one.contract().channels.length, 13)
  } finally { one.detach(); two.detach() }
  assert.equal(a._client.listenerCount('custom_payload'), 0)
  assert.equal(a.listenerCount('end'), 0); assert.equal(one.contract().closed, true)
  one.detach(); assert.equal(a._client.listenerCount('custom_payload'), 0)
})
test('detaching settles read-only pending requests without dispatching a new game operation', async () => {
  const body = bot(uuidA), client = attachModAgentClient(body)
  const query = client.native.recipes()
  client.detach()
  const receipt = await query
  assert.equal(receipt.ok, false); assert.equal(receipt.outcomeKnown, true)
  assert.equal(receipt.retryAutomatically, false); assert.equal(body.writes.length, 1)
})

test('actual connection end closes the aggregate contract and blocks fresh dispatch', async () => {
  const body = bot(uuidA), client = attachModAgentClient(body)
  body.emit('end')
  assert.equal(client.contract().closed, true)
  assert.equal(client.contract().playerUuid, null)
  assert.equal(client.contract().planExecutionAvailable, false)
  await assert.rejects(client.world.look(), /UNAVAILABLE/)
  assert.equal((await client.native.recipes()).ok, false)
  assert.equal(body.writes.length, 0)
  client.detach()
  assert.equal(body.listenerCount('end'), 0)
})
