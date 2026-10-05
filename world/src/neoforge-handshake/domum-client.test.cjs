'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachDomumClient } = require('./domum-client.cjs')
const OWNER = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222'
const GROUP = 'domum_ornamentum:panel'
const oak = '{count:3,id:"minecraft:oak_planks",components:{"minecraft:custom_name":"木板"}}'
const panel = '{components:{"domum_ornamentum:texture_data":{"minecraft:block/oak_planks":"minecraft:oak_planks"},"minecraft:block_state":{type:"full"}},count:1,id:"domum_ornamentum:panel"}'
const empty = () => ({ id: 'minecraft:air', count: 0, snbt: '' })
const item = (id, count, snbt) => ({ id, count, snbt })
function nativeState () {
  return { schemaVersion: 1, playerUuid: OWNER, source: 'same_player_native_architects_cutter', windowId: 2, stateId: 7,
    position: { x: 610, y: 63, z: 612 }, creative: false, currentGroup: GROUP, currentVariant: item(GROUP, 1, panel),
    inputs: [{ slot: 0, item: item('minecraft:oak_planks', 3, oak) }, { slot: 1, item: empty() }],
    carried: empty(), output: item(GROUP, 1, panel), outputSlot: 2,
    groups: [{ groupId: GROUP, buttonId: 0, variantCount: 2 }], matchingRecipeIds: ['domum_ornamentum:panel'],
    matchingRecipeCount: 1, matchingRecipesTruncated: false }
}
function harness (options) {
  const bot = new EventEmitter(); bot._client = new EventEmitter(); bot._client.uuid = OWNER
  const writes = []; bot._client.write = (name, packet) => writes.push({ name, packet, body: JSON.parse(packet.data.toString('utf8')) })
  return { bot, writes, domum: attachDomumClient(bot, options) }
}
function reply (bot, request, extra = {}) {
  const body = { schemaVersion: 1, kind: 'domum_receipt', playerUuid: OWNER, requestId: request.requestId, ok: true,
    ...(request.kind === 'select' ? { action: 'select', changed: true, outcomeKnown: true, outcomeUnknown: false } : { query: request.kind, readOnly: true }),
    ...extra }
  bot._client.emit('custom_payload', { channel: 'maw_agent:domum_state', data: Buffer.from(JSON.stringify(body)) })
  return body
}
async function seed (h) {
  const pending = h.domum.state(); reply(h.bot, h.writes.at(-1).body, { state: nativeState() }); await pending
}
const variant = requestId => ({ selection: 'variant', groupId: GROUP, variantIndex: 0, choiceSnbt: panel, requestId })

test('native state is private, ownership checked, matched to pending and cloned', async () => {
  const h = harness(), errors = []; h.domum.events.on('protocolError', e => errors.push(e.message))
  const pending = h.domum.state({ requestId: 'owner-state' }), request = h.writes[0].body
  reply(h.bot, request, { playerUuid: OTHER, state: { ...nativeState(), playerUuid: OTHER } })
  assert.equal(h.domum.current(), null); assert.deepEqual(errors, ['DOMUM_PLAYER_MISMATCH'])
  reply(h.bot, request, { state: nativeState() }); assert.equal((await pending).state.output.snbt, panel)
  const copy = h.domum.current(); copy.inputs[0].item.snbt = 'changed'
  assert.equal(h.domum.current().inputs[0].item.snbt, oak); h.domum.detach()
})
test('choices preserve real templates and complete components with pagination', async () => {
  const h = harness(), pending = h.domum.choices({ groupId: GROUP, offset: 1, limit: 1 })
  assert.equal(h.writes[0].packet.channel, 'maw_agent:domum_query'); assert.equal(h.writes[0].body.offset, 1)
  const rows = [{ variantIndex: 1, buttonId: 2, variant: item(GROUP, 1, panel),
    components: [{ inputSlot: 0, componentId: 'minecraft:block/oak_planks', validSkinsTag: 'domum_ornamentum:all_planks', consumedPerCraft: 1 }] }]
  reply(h.bot, h.writes[0].body, { state: nativeState(), choices: rows, total: 2, offset: 1, returned: 1, truncated: false, nextOffset: null })
  assert.deepEqual((await pending).choices, rows); h.domum.detach()
})
test('select carries complete actual owner, position, native inputs cursor output and choice SNBT CAS', async () => {
  const h = harness(); await seed(h)
  const pending = h.domum.select(variant('choice-once')), request = h.writes.at(-1).body
  assert.equal(h.writes.at(-1).packet.channel, 'maw_agent:domum_action')
  assert.equal(request.playerUuid, OWNER); assert.equal(request.windowId, 2); assert.equal(request.expectedStateId, 7)
  assert.deepEqual(request.expectedPosition, { x: 610, y: 63, z: 612 }); assert.equal(request.expectedGroup, GROUP)
  assert.equal(request.expectedVariantSnbt, panel); assert.deepEqual(request.expectedInputsSnbt, [oak, ''])
  assert.equal(request.expectedCarriedSnbt, ''); assert.equal(request.expectedOutputSnbt, panel); assert.equal(request.choiceSnbt, panel)
  assert.equal(request.kind, 'select'); assert.equal(request.selection, 'variant')
  reply(h.bot, request, { state: { ...nativeState(), stateId: 8 } }); assert.equal((await pending).outcomeKnown, true)
  assert.equal(h.domum.current().stateId, 8); h.domum.detach()
})
test('group selection is a separate operation without invented output or choice', async () => {
  const h = harness(); await seed(h)
  const pending = h.domum.select({ selection: 'group', groupId: GROUP }), request = h.writes.at(-1).body
  assert.equal(request.variantIndex, undefined); assert.equal(request.choiceSnbt, undefined)
  reply(h.bot, request, { state: { ...nativeState(), output: empty() } }); await pending
  assert.equal(h.domum.current().output.snbt, ''); h.domum.detach()
})
test('invalid group variant or missing snapshot fail known before any write', async () => {
  const h = harness()
  assert.throws(() => h.domum.select(variant()), e => e.outcomeKnown && e.changed === false)
  await seed(h); const count = h.writes.length
  for (const values of [{ groupId: 'PANEL' }, { groupId: 'a:b '.repeat(100) }, { groupId: 'other:panel' },
    { variantIndex: -1 }, { variantIndex: 2 }, { variantIndex: 1.5 }, { variantIndex: 4096 }, { choiceSnbt: '' }, { selection: 'craft' }]) {
    assert.throws(() => h.domum.select({ ...variant(), ...values }), e => e.outcomeKnown && !e.outcomeUnknown && e.changed === false)
  }
  assert.equal(h.writes.length, count); h.domum.detach()
})
test('foreign or structurally invalid state override cannot write', async () => {
  const h = harness(); await seed(h); const count = h.writes.length
  for (const state of [{ ...nativeState(), playerUuid: OTHER }, { ...nativeState(), position: { x: 1.1, y: 64, z: 1 } },
    { ...nativeState(), inputs: [{ slot: 1, item: empty() }] }]) assert.throws(() => h.domum.select({ ...variant(), state }), /DOMUM_STATE_UNAVAILABLE/)
  assert.equal(h.writes.length, count); h.domum.detach()
})
test('oversized UTF-8 request does not dispatch selection or truncate components', async () => {
  const h = harness(); await seed(h); const count = h.writes.length
  assert.throws(() => h.domum.select({ ...variant(), choiceSnbt: '材料'.repeat(9000) }), e => e.code === 'DOMUM_REQUEST_BUDGET_EXCEEDED' && e.outcomeKnown)
  assert.equal(h.writes.length, count); h.domum.detach()
})
test('read timeout is known unavailable; sent mutation timeout is unknown and is not retried', async () => {
  const h = harness({ timeoutMs: 4 })
  const read = await h.domum.state(); assert.equal(read.outcomeKnown, true); assert.equal(read.changed, false)
  await seed(h); const pending = h.domum.select(variant('timeout-once'))
  await assert.rejects(pending, e => e.outcomeUnknown && e.changed === null && !e.retryAutomatically)
  const count = h.writes.length
  assert.throws(() => h.domum.select({ ...variant('timeout-once'), state: nativeState() }), /DOMUM_STATE_UNAVAILABLE/)
  assert.equal(h.writes.length, count); assert.equal(h.domum.current(), null)
  await seed(h)
  assert.throws(() => h.domum.select(variant('timeout-once')), /DOMUM_REQUEST_ID_ALREADY_USED/)
  assert.equal(h.writes.length, count + 1); h.domum.detach()
})
test('end and detach close new readonly and mutation calls with zero writes', async () => {
  for (const action of ['end', 'detach']) {
    const h = harness(); await seed(h); const count = h.writes.length
    if (action === 'end') h.bot.emit('end'); else h.domum.detach()
    const state = await h.domum.state(); assert.equal(state.outcomeKnown, true); assert.equal(state.dispatched, false)
    const choices = await h.domum.choices({ groupId: GROUP }); assert.equal(choices.code, 'domum_connection_closed')
    await assert.rejects(h.domum.select(variant()), e => e.outcomeKnown && !e.dispatched && e.changed === false)
    assert.equal(h.writes.length, count); assert.equal(h.domum.current(), null); h.domum.detach()
  }
})
test('pending selection disconnected or respawned is unknown, late receipts cannot revive cache', async () => {
  for (const event of ['end', 'spawn', 'respawn']) {
    const h = harness(); await seed(h); const pending = h.domum.select(variant('retired-choice')), request = h.writes.at(-1).body
    h.bot.emit(event); await assert.rejects(pending, e => e.outcomeUnknown && e.changed === null)
    reply(h.bot, request, { state: nativeState() }); assert.equal(h.domum.current(), null)
    if (event !== 'end') {
      const read = h.domum.state(); h.bot.emit(event)
      assert.equal((await read).outcomeKnown, true)
    }
    h.domum.detach()
  }
})
test('write exception after write is called remains unknown and never retries', async () => {
  const h = harness(); await seed(h); let calls = 0
  h.bot._client.write = () => { calls++; throw Error('socket failed') }
  await assert.rejects(h.domum.select(variant()), e => e.code === 'DOMUM_WRITE_OUTCOME_UNKNOWN' && e.outcomeUnknown && e.cause.message === 'socket failed')
  assert.equal(calls, 1); assert.equal(h.domum.current(), null); h.domum.detach()
})
test('known denied selection is returned unchanged and retires its request ID', async () => {
  const h = harness(); await seed(h)
  const pending = h.domum.select(variant('stale-once')), request = h.writes.at(-1).body
  reply(h.bot, request, { ok: false, code: 'input_components_changed', changed: false, outcomeKnown: true, stateUnavailable: true })
  const result = await pending; assert.equal(result.code, 'input_components_changed'); assert.equal(result.changed, false)
  assert.equal(h.domum.current(), null)
  assert.throws(() => h.domum.select({ ...variant('stale-once'), state: nativeState() }), /DOMUM_STATE_UNAVAILABLE/)
  await seed(h)
  assert.throws(() => h.domum.select(variant('stale-once')), /DOMUM_REQUEST_ID_ALREADY_USED/)
  h.domum.detach()
})

test('valid caller snapshot cannot seed an empty native cache or an invalidated same-player epoch', async () => {
  const h = harness(), saved = nativeState()
  const notSent = e => e.code === 'DOMUM_STATE_UNAVAILABLE' && e.outcomeKnown && e.changed === false && !e.dispatched
  assert.throws(() => h.domum.select({ ...variant(), state: saved }), notSent)
  assert.equal(h.writes.length, 0)
  for (const event of ['spawn', 'respawn']) {
    await seed(h); const previous = h.domum.current(), count = h.writes.length
    h.bot.emit(event)
    assert.equal(h.bot._client.uuid, OWNER); assert.equal(h.domum.current(), null)
    assert.throws(() => h.domum.select({ ...variant(), state: previous }), notSent)
    assert.equal(h.writes.length, count)
    // The real new epoch can reuse UUID/window/stateId, but must arrive from a fresh request.
    await seed(h)
    const selected = h.domum.select(variant()), request = h.writes.at(-1).body
    reply(h.bot, request, { state: nativeState() }); await selected
  }
  h.domum.detach()
})

test('latest native cache is mandatory and stale component snapshot is a known zero-write rejection', async () => {
  const h = harness(); await seed(h); const stale = h.domum.current()
  const read = h.domum.state(), fresh = { ...nativeState(), stateId: 8, carried: item('minecraft:birch_planks', 4, '{count:4,id:"minecraft:birch_planks"}') }
  reply(h.bot, h.writes.at(-1).body, { state: fresh }); await read
  const count = h.writes.length
  assert.throws(() => h.domum.select({ ...variant(), state: stale }), e => e.code === 'DOMUM_STATE_CHANGED_NOT_SENT' &&
    e.outcomeKnown && !e.outcomeUnknown && e.changed === false && !e.dispatched)
  const forged = h.domum.current(); forged.inputs[0].item.snbt = '{count:3,id:"minecraft:oak_planks"}'
  assert.throws(() => h.domum.select({ ...variant(), state: forged }), /DOMUM_STATE_CHANGED_NOT_SENT/)
  assert.equal(h.writes.length, count); h.domum.detach()
})

test('an equivalent cloned snapshot with different object key order compares equal to the latest cache', async () => {
  const h = harness(); await seed(h)
  const current = h.domum.current(), reordered = Object.fromEntries(Object.entries(current).reverse())
  reordered.position = { z: current.position.z, y: current.position.y, x: current.position.x }
  const selected = h.domum.select({ ...variant(), state: reordered }), request = h.writes.at(-1).body
  assert.equal(request.expectedStateId, current.stateId); assert.equal(request.expectedInputsSnbt[0], oak)
  reply(h.bot, request, { state: nativeState() }); await selected; h.domum.detach()
})

test('invalid UTF-8 inside otherwise valid receipt JSON is rejected without replacement or cache population', async () => {
  const h = harness({ timeoutMs: 8 }), errors = []
  h.domum.events.on('protocolError', error => errors.push(error))
  const read = h.domum.state(), request = h.writes.at(-1).body
  const body = { schemaVersion: 1, kind: 'domum_receipt', playerUuid: OWNER, requestId: request.requestId,
    query: 'state', readOnly: true, ok: true, state: nativeState(), note: '@' }
  const bytes = Buffer.from(JSON.stringify(body)), marker = bytes.lastIndexOf(Buffer.from('"@"'))
  assert.ok(marker > 0); bytes[marker + 1] = 0xff
  h.bot._client.emit('custom_payload', { channel: 'maw_agent:domum_state', data: bytes })
  assert.equal(errors.length, 1); assert.match(errors[0].message, /encoded data was not valid/)
  assert.equal(h.domum.current(), null)
  const result = await read; assert.equal(result.ok, false); assert.equal(result.code, 'domum_query_not_observed')
  assert.equal(result.outcomeKnown, true); assert.equal(h.domum.current(), null); h.domum.detach()
})
test('invalid paging fails locally and oversized replies cannot populate state', async () => {
  const h = harness({ timeoutMs: 5 }), errors = []; h.domum.events.on('protocolError', error => errors.push(error.message))
  for (const values of [{ limit: 25 }, { offset: -1 }, { offset: 2147483648 }, { limit: 0 }, { groupId: 'panel' }]) {
    assert.throws(() => h.domum.choices({ groupId: GROUP, ...values }), /INVALID_DOMUM_CHOICES/)
  }
  assert.equal(h.writes.length, 0)
  const read = h.domum.state(); h.bot._client.emit('custom_payload', { channel: 'maw_agent:domum_state', data: Buffer.alloc(16385) })
  assert.deepEqual(errors, ['DOMUM_RECEIPT_BUDGET_EXCEEDED']); assert.equal((await read).ok, false); assert.equal(h.domum.current(), null)
  h.domum.detach()
})
