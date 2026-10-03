'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachWorldClient } = require('./world-client.cjs')

test('look query correlates only its own private native reply', async () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  let sent
  bot._client.write = (name, body) => { sent = { name, body } }
  const world = attachWorldClient(bot)
  const waiting = world.look()
  assert.equal(sent.name, 'custom_payload')
  assert.equal(sent.body.channel, 'maw_agent:world_query')
  const query = JSON.parse(sent.body.data.toString('utf8'))
  assert.equal(query.kind, 'look')
  bot._client.emit('custom_payload', { channel: 'maw_agent:world_state',
    data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'world_receipt', requestId: 'someone_else', ok: true })) })
  bot._client.emit('custom_payload', { channel: 'maw_agent:world_state',
    data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'world_receipt', requestId: query.requestId,
      ok: true, position: { x: 3, y: 64, z: -2 }, block: { id: 'create:shaft' } })) })
  assert.equal((await waiting).block.id, 'create:shaft')
  world.detach()
})
