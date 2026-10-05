'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events')
const { attachNativeWorldQuery } = require('./native-world-query.cjs')
const uuid = '11111111-2222-3333-8444-555555555555', other = 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee'
function fixture (timeoutMs = 50) {
  const sent = [], bot = new EventEmitter(); bot._client = Object.assign(new EventEmitter(), { uuid,
    write: (name, packet) => sent.push({ name, channel: packet.channel, body: JSON.parse(packet.data.toString()) }) })
  const client = attachNativeWorldQuery(bot, { timeoutMs })
  const reply = fields => bot._client.emit('custom_payload', { channel: 'maw_agent:world_state', data: Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'world_receipt', query: sent.at(-1).body.kind, playerUuid: uuid, requestId: sent.at(-1).body.requestId, ok: true, ...fields })) })
  return { bot, client, sent, reply }
}
test('entity query uses existing connection and binds actual player/request UUID', async () => {
  const f = fixture(); const pending = f.client.entity({ entityId: 7, expectedUuid: other })
  assert.equal(f.sent[0].body.kind, 'entity'); assert.equal(f.sent[0].body.expectedUuid, other)
  assert.equal(f.sent[0].channel, 'maw_agent:world_query'); assert.equal(f.sent[0].body.playerUuid, undefined)
  f.reply({ entity: { id: 'minecraft:cow', uuid: other } })
  assert.equal((await pending).entity.id, 'minecraft:cow'); f.client.detach()
})
test('foreign actor/wrong query kind/malformed identity do not complete a query; timeout remains read-only without automatic replay', async () => {
  const f = fixture(5); const pending = f.client.entity({ entityId: 7, expectedUuid: other })
  f.reply({ playerUuid: other }); f.reply({ query: 'recipes' }); f.reply({ playerUuid: 4 }); const result = await pending
  assert.equal(result.ok, false); assert.equal(result.code, 'native_query_not_observed')
  assert.equal(result.outcomeUnknown, false); assert.equal(result.retryAutomatically, false); assert.equal(f.sent.length, 1); f.client.detach()
})
test('recipes retain full native components and pagination; only exact bounded supported parameters are sent', async () => {
  const f = fixture(); const pending = f.client.recipes({ recipeType: 'create:milling', outputId: 'create:wheat_flour', limit: 1 })
  const recipe = { recipeId: 'create:milling/wheat', type: 'create:milling', definitionAvailable: true,
    ingredients: [{ alternatives: [{ id: 'minecraft:wheat', count: 1, snbt: '{id:"minecraft:wheat",count:1}' }] }],
    output: { id: 'create:wheat_flour', count: 1, snbt: '{id:"create:wheat_flour",count:1,components:{}}' } }
  f.reply({ recipes: [recipe], matchedCount: 2, nextOffset: 1 }); const result = await pending
  assert.deepEqual(result.recipes[0], recipe); assert.equal(result.nextOffset, 1)
  for (const args of [{ query: 'flour' }, { recipeType: 'milling' }, { limit: 13 }, { offset: -1 }, { outputId: 'minecraft:../x?' }]) assert.throws(() => f.client.recipes(args), /INVALID/)
  f.client.detach()
})
test('disconnect settles pending read-only requests and detaches without sending or replaying', async () => {
  const f = fixture(); const pending = f.client.recipes(); f.bot.emit('end')
  assert.equal((await pending).code, 'native_query_connection_closed'); assert.equal(f.sent.length, 1)
  f.client.detach(); assert.equal(f.bot._client.listenerCount('custom_payload'), 0)
  assert.equal((await f.client.recipes()).ok, false); assert.equal(f.sent.length, 1)
})
