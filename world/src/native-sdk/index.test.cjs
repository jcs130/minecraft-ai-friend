'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { attachNativeBody } = require('./index.cjs')
const { operationCatalog } = require('./catalog.cjs')
const { modOperationCatalog } = require('../neoforge-handshake/mod-call-client.cjs')
const UUID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maw-body-sdk-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.match(path.basename(dir), /^maw-body-sdk-/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return dir
}
function body (directory, { call, snapshot, account = 'BodySdkQA', uuid = UUID, controllerId = 'controller-a', beforeSpawn = false } = {}) {
  const bot = new EventEmitter(), client = new EventEmitter(), sent = [], slots = Array(46).fill(null)
  bot.username = account; client.uuid = uuid; bot._client = client; bot.entity = { position: { x: 1, y: 64, z: 2 } }; bot.health = 20
  if (beforeSpawn) { client.username = account; delete bot.username }
  client.write = (name, data) => { sent.push({ name, data }); return true }
  bot.clearControlStates = () => {}; bot.stopDigging = () => {}; bot.deactivateItem = () => {}
  const menu = { schemaVersion: 1, kind: 'menu_state', playerUuid: uuid, windowId: 0, stateId: 1, slots, carried: null,
    self: { playerUuid: uuid, health: 20, food: 17, equipment: {} } }
  const state = () => ({ ok: true, bodyKind: 'connected_player', bodyId: uuid, playerUuid: uuid,
    capturedAt: new Date().toISOString(), status: 'alive', position: { ...bot.entity.position }, dimension: 'minecraft:overworld', menu, self: menu.self })
  const sdk = { call: call || (async () => ({ ok: true, outcomeKnown: true })), callStatus: () => ({ mutationBlocked: false }), detach () {},
    menu: { current: () => menu, click: async slot => {
      if (menu.carried && !menu.slots[slot]) { menu.slots[slot] = menu.carried; menu.carried = null } else {
        menu.carried = menu.slots[slot]; menu.slots[slot] = null
      }
      return { ok: true, outcomeKnown: true }
    } },
    native: { bodySnapshot: snapshot || (async () => structuredClone(state())),
      capabilities: async () => ({ ...state(), nativeOperations: modOperationCatalog().operations.map(row => row.id), remoteBindingsAdvertised: true }),
      bodyObserve: async () => ({ ...state(), blocks: [], entities: [], complete: false }) } }
  const runtime = attachNativeBody(bot, { ledgerDir: directory, controllerId, attach: () => sdk })
  return { bot, runtime, sdk, slots, sent }
}
const message = (action_id, operation = 'curios.open', args = {}) => ({ action_id, operation, args })

test('70 operations include strict params, permissions, async and advertised vs verified distinctions', async t => {
  const dir = fixture(t), { runtime } = body(dir); t.after(runtime.close)
  const catalog = runtime.operations()
  assert.equal(catalog.operationCount, 70); assert.equal(catalog.remoteSupportVerified, false)
  assert.equal(catalog.operations.every(row => row.parameters && row.permission && row.returns && row.execution), true)
  assert.equal(runtime.operations('body.move').execution, 'asynchronous_action')
  assert.equal(runtime.operations('action.cancel').execution, 'immediate_control')
  await runtime.capabilities()
  assert.equal(runtime.operations().remoteSupportVerified, true)
  assert.equal(runtime.operations('colony.found').serverBindingAdvertised, true)
  assert.equal(runtime.operations().allGameplayVerified, false)
  assert.equal(runtime.operations().numenRestoreExisting, false)
  const java = fs.readFileSync(path.resolve(__dirname, '../../society-bridge-src/src/main/java/dev/qiandeng/maw/PlayerBodyState.java'), 'utf8')
  assert.deepEqual(java.match(/NATIVE_OPERATIONS = "([^"]+)"/)[1].split(' '), modOperationCatalog().operations.map(row => row.id))
})
test('body and filesystem ownership reject a second controller', t => {
  const dir = fixture(t), { bot, runtime } = body(dir); t.after(runtime.close)
  assert.throws(() => attachNativeBody(bot, { ledgerDir: dir, controllerId: 'other' }), /ALREADY_CONTROLLED/)
  assert.throws(() => body(dir), /EEXIST/)
})
test('attach before spawn uses the login connection name and restores its finite listener budget', t => {
  const dir = fixture(t), { bot, runtime } = body(dir, { beforeSpawn: true })
  assert.equal(runtime.identity().account, 'BodySdkQA')
  assert.equal(bot.getMaxListeners(), 26)
  bot.username = 'BodySdkQA'; bot.emit('spawn')
  assert.equal(runtime.identity().bodyId, UUID)
  runtime.close(); assert.equal(bot.getMaxListeners(), 10)
  assert.equal(bot.listenerCount('end'), 0); assert.equal(bot.listenerCount('spawn'), 0)
})
test('snapshot distinguishes alive, dead, offline and unavailable; includes native components', async t => {
  const dir = fixture(t), { bot, runtime, slots } = body(dir); t.after(runtime.close)
  slots[36] = { id: 'ars_nouveau:novice_spell_book', count: 1, snbt: '{id:"ars_nouveau:novice_spell_book",count:1}' }
  const value = await runtime.snapshot()
  assert.equal(value.bodyId, UUID); assert.equal(value.health, 20); assert.equal(value.hunger, 17)
  assert.equal(value.inventory.items[0].snbt, slots[36].snbt); assert.ok(value.capturedAt)
  bot.emit('end'); assert.equal((await runtime.snapshot()).status, 'offline')
  const other = body(path.join(dir, 'other'), { snapshot: async () => ({ ok: false, code: 'read_failed' }) }); t.after(other.runtime.close)
  assert.equal((await other.runtime.snapshot()).status, 'unavailable')
  const dead = body(path.join(dir, 'dead'), { snapshot: async () => ({ ok: true, bodyId: UUID, menu: { playerUuid: UUID }, self: {}, status: 'dead' }) }); t.after(dead.runtime.close)
  assert.equal((await dead.runtime.snapshot()).status, 'dead')
  assert.equal((await dead.runtime.wait('not-found')).status, 'unknown')
})
test('submit is nonblocking and terminal receipt contains actual position, inventory delta and stable ID', async t => {
  const dir = fixture(t); let applied = 0, release
  const { runtime, slots } = body(dir, { call: async () => {
    applied++; await new Promise(resolve => { release = resolve })
    slots[9] = { id: 'minecraft:bread', count: 2, snbt: '{id:"minecraft:bread",count:2}' }
    return { ok: true, outcomeKnown: true }
  } }); t.after(runtime.close)
  const accepted = runtime.submit(message('once-1'))
  assert.equal(accepted.accepted, true); assert.equal(accepted.terminal, false)
  assert.equal(runtime.actionStatus('once-1').status, 'running')
  while (!release) await pause(10)
  assert.equal(runtime.submit(message('another')).code, 'body_action_blocked')
  assert.equal(runtime.submit(message('once-1')).replayed, true); assert.equal(applied, 1)
  release(); const result = await runtime.wait('once-1')
  assert.equal(result.status, 'succeeded'); assert.deepEqual(result.result.actualPosition, { x: 1, y: 64, z: 2 })
  assert.equal(result.result.inventoryDelta.added[0].count, 2)
})
test('reconnect keeps real UUID and cached results; changing same ID payload cannot execute', async t => {
  const dir = fixture(t); let applied = 0
  let { runtime } = body(dir, { call: async () => { applied++; return { ok: true, outcomeKnown: true } } })
  runtime.submit(message('durable-1')); await runtime.wait('durable-1'); runtime.close()
  ;({ runtime } = body(dir, { call: async () => { applied++; throw Error('replayed') } })); t.after(runtime.close)
  assert.equal(runtime.submit(message('durable-1')).replayed, true)
  assert.equal(runtime.submit(message('durable-1', 'curios.open', { requestId: 'changed' })).code, 'action_id_conflict')
  assert.equal(runtime.actionStatus('durable-1').status, 'succeeded'); assert.equal(applied, 1)
})
test('cancel before dispatch is known, durable and never causes a later write', async t => {
  const dir = fixture(t); let count = 0
  const { runtime } = body(dir, { call: async () => { count++; return { ok: true } } }); t.after(runtime.close)
  runtime.submit(message('cancel-before')); runtime.cancel('cancel-before')
  const result = await runtime.wait('cancel-before')
  assert.equal(result.status, 'cancelled'); assert.equal(result.outcomeKnown, true); assert.equal(count, 0)
})
test('cancel after dispatch fences late writes and persists unknown across reconnect', async t => {
  const dir = fixture(t); let bot, release, late
  let own = body(dir, { call: async () => {
    assert.equal(bot._client.write('held_item_slot', { slotId: 1 }), true)
    await new Promise(resolve => { release = resolve })
    late = bot._client.write('held_item_slot', { slotId: 2 })
    return { ok: true }
  } }); bot = own.bot; let runtime = own.runtime
  runtime.submit(message('cancel-after'))
  while (!release) await pause(10)
  assert.equal(runtime.cancel('cancel-after').cancelRequested, true)
  assert.equal((await runtime.wait('cancel-after')).status, 'unknown')
  release(); await pause(10); assert.equal(late, false)
  assert.equal(runtime.submit(message('new-write')).code, 'body_action_blocked')
  runtime.close(); own = body(dir); runtime = own.runtime; t.after(runtime.close)
  assert.equal(runtime.health().mutationBlocked, true)
  assert.equal(runtime.submit(message('cancel-after')).replayed, true)
  assert.equal(runtime.actionStatus('cancel-after').outcomeUnknown, true)
})
test('a prior unresolved intent is unknown and blocks new mutations after restart', t => {
  const dir = fixture(t), { runtime } = body(dir); runtime.close()
  fs.writeFileSync(path.join(dir, 'bodysdkqa/native-actions.jsonl'), JSON.stringify({ kind: 'intent', callId: 'crash',
    id: 'curios.open', args: {}, fingerprint: 'test', playerUuid: UUID }) + '\n')
  const current = body(dir).runtime; t.after(current.close)
  assert.equal(current.actionStatus('crash').status, 'unknown')
  assert.equal(current.submit(message('next')).code, 'body_action_blocked')
})
test('identity mismatch cannot read another body or append new actions', async t => {
  const dir = fixture(t), first = body(dir)
  first.runtime.submit(message('bind')); await first.runtime.wait('bind'); first.runtime.close()
  const current = body(dir, { uuid: OTHER }).runtime; t.after(current.close)
  assert.equal((await current.snapshot()).status, 'unavailable')
  assert.equal(current.actionStatus('bind').code, 'body_identity_mismatch')
  assert.equal(current.submit(message('foreign')).accepted, undefined)
})
test('invalid move, unsupported params and missing action ID are rejected before any intent', t => {
  const dir = fixture(t), { runtime } = body(dir); t.after(runtime.close)
  assert.equal(runtime.submit(message('move', 'body.move', { position: { x: 1.5, y: 64, z: 2 } })).ok, false)
  assert.equal(runtime.submit(message('mod', 'curios.open', { unknown: true })).ok, false)
  assert.equal(runtime.submit(message(undefined)).code, 'action_id_required')
  assert.equal(fs.existsSync(path.join(dir, 'bodysdkqa/native-actions.jsonl')), false)
})
test('equip uses real empty armor slot and full stack CAS without overwriting equipped gear', async t => {
  const dir = fixture(t), { runtime, slots } = body(dir); t.after(runtime.close)
  const helmet = { id: 'minecraft:iron_helmet', count: 1, snbt: '{id:"minecraft:iron_helmet",count:1}' }; slots[9] = helmet
  runtime.submit(message('equip', 'inventory.equipSlot', { sourceSlot: 9, destination: 'head', expectedSnbt: helmet.snbt }))
  assert.equal((await runtime.wait('equip')).status, 'succeeded'); assert.deepEqual(slots[5], helmet); assert.equal(slots[9], null)
  slots[10] = helmet
  runtime.submit(message('no-overwrite', 'inventory.equipSlot', { sourceSlot: 10, destination: 'head', expectedSnbt: helmet.snbt }))
  assert.equal((await runtime.wait('no-overwrite')).status, 'failed'); assert.deepEqual(slots[10], helmet)
})
test('raw client mutations outside the SDK are fenced while keepalive and reads remain live', t => {
  const dir = fixture(t), { runtime, bot } = body(dir); t.after(runtime.close)
  assert.equal(bot._client.write('held_item_slot', { slotId: 1 }), false)
  assert.equal(bot._client.write('custom_payload', { channel: 'maw_agent:spell_action' }), false)
  assert.equal(bot._client.write('keep_alive', {}), true)
  assert.equal(bot._client.write('custom_payload', { channel: 'maw_agent:world_query' }), true)
  runtime.close()
  assert.equal(bot._client.write('held_item_slot', { slotId: 2 }), false)
  assert.throws(() => attachNativeBody(bot, { ledgerDir: dir, controllerId: 'new' }), /ALREADY_CONTROLLED/)
})
