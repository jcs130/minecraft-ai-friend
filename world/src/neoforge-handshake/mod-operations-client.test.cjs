'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachModOperationsClient } = require('./mod-operations-client.cjs')
const owner = '11111111-2222-3333-8444-555555555555'
const other = 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee'
function fixture (timeoutMs = 1000) {
  const bot = new EventEmitter(); bot._client = new EventEmitter(); bot._client.uuid = owner
  const writes = []; bot._client.write = (name, packet) => writes.push({ name, ...packet, body: JSON.parse(packet.data) })
  const client = attachModOperationsClient(bot, { timeoutMs })
  const emit = body => bot._client.emit('custom_payload', { channel: 'maw_agent:mod_state', data: Buffer.from(JSON.stringify(body)) })
  const reply = (body = {}) => {
    const request = writes.at(-1).body
    emit({ schemaVersion: 1, kind: 'mod_receipt', playerUuid: owner, requestId: request.requestId, action: request.kind, ok: true, ...body })
  }
  return { bot, writes, client, emit, reply }
}
test('native Create/Curios requests use only this connection and raw UTF-8 payloads', async () => {
  const f = fixture()
  try {
    for (const [group, name, args, action, mutation] of [
      ['create', 'settings', { position: { x: 1, y: 64, z: 2 } }, 'create_settings', false],
      ['create', 'fluids', { position: { x: 1, y: 64, z: 2 } }, 'create_fluids', false],
      ['create', 'setValue', { value: 4 }, 'create_value', true],
      ['create', 'setFilter', { expectedFilterSnbt: '' }, 'create_filter', true],
      ['curios', 'state', undefined, 'curios_state', false],
      ['curios', 'open', {}, 'curios_open', true],
      ['curios', 'page', { page: 0 }, 'curios_page', true],
      ['ysm', 'catalog', { offset: 2, limit: 3 }, 'ysm_catalog', false],
      ['ysm', 'select', { modelId: 'misc/2_steve', texture: 'tartaric_acid', expectedModelId: 'default', expectedTexture: 'default', expectedEnabled: true, expectedMandatory: false }, 'ysm_select', true]
    ]) {
      const pending = f.client[group][name](args); const wire = f.writes.at(-1)
      assert.equal(wire.name, 'custom_payload'); assert.equal(wire.body.kind, action)
      assert.equal(wire.channel, `maw_agent:mod_${mutation ? 'action' : 'query'}`)
      assert.equal(wire.data[0], 123); assert.equal(wire.body.playerUuid, undefined)
      f.reply({ state: { value: 4 } }); assert.equal((await pending).ok, true)
    }
  } finally { f.client.detach() }
})
test('foreign UUID, wrong action, malformed UTF-8 and unsolicited replies cannot settle a read', async () => {
  const f = fixture(); let settled = false
  try {
    const pending = f.client.curios.state().then(r => { settled = true; return r })
    f.reply({ playerUuid: other }); f.reply({ action: 'curios_open' })
    f.client.events.on('protocolError', () => {})
    f.bot._client.emit('custom_payload', { channel: 'maw_agent:mod_state', data: Buffer.from([0xc3, 0x28]) })
    f.reply({ requestId: 'not-requested' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false)
    f.reply(); assert.equal((await pending).playerUuid, owner)
  } finally { f.client.detach() }
})
test('respawn makes a pending write unknown and never reuses its request ID', async () => {
  const f = fixture()
  try {
    const write = f.client.curios.open({ requestId: 'open-1' })
    const rejected = assert.rejects(write, e => e.outcomeUnknown && !e.retryAutomatically)
    f.bot.emit('respawn'); await rejected
    assert.throws(() => f.client.curios.open({ requestId: 'open-1' }), /MOD_REQUEST_ALREADY_ISSUED/)
    const read = f.client.curios.state(); f.reply(); assert.equal((await read).ok, true)
  } finally { f.client.detach() }
})
test('timeouts preserve read/write outcome distinction and transport exceptions are conservative', async () => {
  const f = fixture(10)
  try {
    await assert.rejects(f.client.curios.state(), e => e.outcomeKnown && !e.outcomeUnknown)
    await assert.rejects(f.client.curios.open(), e => e.outcomeUnknown)
    f.bot._client.write = () => { throw Error('socket failed after write') }
    await assert.rejects(f.client.curios.open(), e => e.outcomeUnknown && e.dispatched)
    f.bot.emit('end'); await assert.rejects(f.client.curios.open(), e => e.knownNotApplied)
  } finally { f.client.detach() }
})
