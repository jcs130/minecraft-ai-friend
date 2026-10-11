'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { withNumen, withMineflayer, connect } = require('./index.cjs')
const { TransportError } = require('./numen-client.cjs')
const BODY = '00000000-0000-4000-8000-000000000001', OWNER = '00000000-0000-4000-8000-000000000002'
const OTHER = '00000000-0000-4000-8000-000000000003', LEASE = 'b'.repeat(64)
const empty = { type: 'object', properties: {}, additionalProperties: false }
function temp (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maw-world-adapter-'))
  t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.match(path.basename(dir), /^maw-world-adapter-/); fs.rmSync(dir, { recursive: true, force: true }) })
  return dir
}
function server () {
  const calls = [], records = new Map(), slots = Array(46).fill(null)
  slots[36] = { id: 'ars_nouveau:novice_spell_book', count: 1, snbt: '{id:"ars_nouveau:novice_spell_book",count:1,components:{}}' }
  const state = { ok: true, name: 'UnifiedBody', bodyId: BODY, ownerUuid: OWNER, status: 'alive', online: true,
    permissionMode: 'bypass', position: { x: 1.5, y: 64, z: 1.5 }, health: 19, maxHealth: 22, hunger: 17,
    dimension: 'minecraft:overworld', currentAction: null, programRunning: false, sampledAt: '2026-10-11T12:00:00Z' }
  const menu = { playerUuid: BODY, windowId: 0, stateId: 5, slots, carried: null, selectedHotbarSlot: 0,
    self: { health: 19, maxHealth: 22, food: 17, equipment: {}, mana: { current: 42, max: 80 } } }
  const specs = [{ id: 'curios.open', readOnly: false, parameters: empty }, { id: 'menu.snapshot', readOnly: true, parameters: empty }]
  const flags = { timeoutAfterAccept: false, finish: true, wrongOwner: false, wrongFingerprint: false }
  const client = { rpc: async () => ({ protocolVersion: '2025-06-18' }), async call (name, args = {}) {
    calls.push({ name, args: structuredClone(args) })
    if (name === 'list_companions') return { ok: true, companions: [flags.wrongOwner ? { ...state, ownerUuid: OTHER } : state] }
    if (name === 'mod_operations') return args.operation ? { ok: true, operation: specs.find(row => row.id === args.operation) } : { ok: true, operations: specs.map(({ id, readOnly }) => ({ id, readOnly })) }
    if (name === 'get_state') return structuredClone(state)
    if (name === 'mod_query') return { ok: true, playerUuid: BODY, state: structuredClone(menu) }
    if (name === 'claim_control') return { ok: true, bodyId: BODY, lease: { leaseId: LEASE, controllerId: args.controller_id, expiresAt: Date.now() + 90000 } }
    if (name === 'release_control') return { ok: true }
    if (name === 'restore_companion') return structuredClone(state)
    if (name === 'lua' || name === 'mod_action') {
      const record = { ok: true, bodyId: BODY, action_id: args.action_id, phase: 'accepted', fingerprint: args.code ? crypto.createHash('sha256').update(args.code).digest('hex') : 'mod-fingerprint' }
      if (name === 'mod_action') Object.assign(record, { modOperation: args.operation, arguments: args.arguments })
      records.set(args.action_id, record)
      const position = args.code?.match(/to=\{x=(-?\d+),y=(-?\d+),z=(-?\d+)\}/)
      if (position) record.after = { position: { x: +position[1] + .5, y: +position[2], z: +position[3] + .5 }, dimension: state.dimension }
      if (flags.timeoutAfterAccept) throw new TransportError('numen_request_unconfirmed_query_original_action_id', true)
      return structuredClone(record)
    }
    if (name === 'action_status') {
      const r = records.get(args.action_id)
      if (!r) return { ok: false, code: 'unknown_action_id' }
      if (flags.finish) { r.phase = 'terminal'; r.outcome = { ok: true }; if (r.after) state.position = r.after.position }
      if (flags.wrongFingerprint) r.fingerprint = 'f'.repeat(64)
      return structuredClone(r)
    }
    if (name === 'action_cancel') { const r = records.get(args.action_id); r.phase = 'terminal'; r.ok = false; r.outcome = { ok: false, code: 'cancelled_before_dispatch' }; return structuredClone(r) }
    if (name === 'operations') return { ok: true, totalFunctions: 71, groups: [] }
    throw Error('mock_missing_' + name)
  } }
  return { client, calls, records, state, menu, flags }
}
const options = dir => ({ bodyId: BODY, ownerUuid: OWNER, controllerId: 'test-controller', ledgerDir: dir, viewerUrl: 'http://127.0.0.1:28984/numen/view/' })
async function fixture (t) { const s = server(), dir = temp(t), adapter = await withNumen(s.client, options(dir)); t.after(() => adapter.close()); return { ...s, dir, adapter } }
test('Numen discovery reads real per-operation schemas without creating/restoring/claiming a body', async t => {
  const { adapter, calls } = await fixture(t), catalog = adapter.operations()
  assert.equal((await adapter.operations('body.move')).common, true)
  assert.equal((await adapter.operations('body.observe')).available, false)
  assert.equal(calls.filter(row => row.name === 'mod_operations').length, 1)
  assert.deepEqual((await adapter.operations('curios.open')).parameters, empty)
  assert.equal(catalog.allGameplayVerified, false)
  assert.equal(calls.some(row => ['create_companion', 'restore_companion', 'claim_control'].includes(row.name)), false)
  assert.equal((await adapter.read('body.observe')).code, 'read_requires_available_read_only_operation')
})
test('canonical state retains real mana/full components and labels 46 player-menu slots', async t => {
  const { adapter } = await fixture(t), s = await adapter.snapshot()
  assert.equal(s.provider, 'numen'); assert.equal(s.bodyKind, 'numen_fake_player'); assert.equal(s.ownerUuid, OWNER)
  assert.equal(s.capturedAt, '2026-10-11T12:00:00Z'); assert.deepEqual(s.position, { x: 1.5, y: 64, z: 1.5 })
  assert.deepEqual(s.mana, { current: 42, max: 80 }); assert.equal(s.inventory.slotNamespace, 'player_menu_46')
  assert.equal(s.inventory.items[0].slot, 36); assert.match(s.inventory.items[0].snbt, /components/)
  assert.equal(s.maxHealth, 22); assert.equal(s.sampling, 'separate_body_menu_and_mana_reads')
})
test('owner mismatch rejected before acquiring writer lock', async t => {
  const s = server(); s.flags.wrongOwner = true
  await assert.rejects(withNumen(s.client, options(temp(t))), /not_owned/)
})
test('second local controller is excluded and an existing different body cannot reuse the ledger', async t => {
  const { client, dir, adapter, state } = await fixture(t)
  await assert.rejects(withNumen(client, options(dir)), /EEXIST/)
  await adapter.claimControl(); await adapter.submit({ action_id: 'identity-1', operation: 'curios.open' }); await adapter.wait('identity-1')
  await adapter.close(); state.bodyId = OTHER
  await assert.rejects(withNumen(client, { ...options(dir), bodyId: OTHER }), /ledger_body_mismatch/)
})
test('actions require explicit lease and independent native permission, never elevate automatically', async t => {
  const { adapter, calls, state } = await fixture(t)
  assert.equal((await adapter.submit({ action_id: 'a', operation: 'curios.open' })).code, 'control_lease_required')
  const claimed = await adapter.claimControl(); assert.equal(claimed.ok, true); assert.equal(JSON.stringify(claimed).includes(LEASE), false)
  state.permissionMode = 'ask'
  assert.equal((await adapter.submit({ action_id: 'a', operation: 'curios.open' })).code, 'numen_independent_permission_required')
  assert.equal(calls.some(row => row.name === 'set_permission'), false)
})
test('absolute movement reaches actual target and reconciles duplicate ID without a second submission', async t => {
  const { adapter, calls } = await fixture(t); await adapter.claimControl()
  const action = { action_id: 'move-1', operation: 'body.move', args: { position: { x: 3, y: 64, z: 1 } } }
  assert.equal((await adapter.submit(action)).status, 'accepted')
  const done = await adapter.wait(action.action_id)
  assert.equal(done.status, 'succeeded'); assert.deepEqual(done.actualPosition, { x: 3.5, y: 64, z: 1.5 })
  assert.equal(done.result.reached, true); assert.equal(done.result.inventoryDelta.available, true)
  assert.equal((await adapter.submit(action)).replayed, true)
  assert.equal((await adapter.submit({ ...action, args: { position: { x: 4, y: 64, z: 1 } } })).code, 'action_id_conflict')
  const moves = calls.filter(row => row.name === 'lua'); assert.equal(moves.length, 1)
  assert.match(moves[0].args.code, /dig=false,place=false,consent=false/)
})
test('reconnect settles an uncertain original action from server without replaying it', async t => {
  const { adapter, client, dir, flags, calls } = await fixture(t); await adapter.claimControl(); flags.timeoutAfterAccept = true
  const action = { action_id: 'lost-response', operation: 'curios.open' }
  assert.equal((await adapter.submit(action)).status, 'unknown')
  assert.equal((await adapter.submit({ ...action, action_id: 'new-id' })).code, 'body_action_blocked')
  await adapter.close(); flags.timeoutAfterAccept = false
  const restored = await withNumen(client, options(dir)); t.after(() => restored.close())
  assert.equal((await restored.actionStatus(action.action_id)).status, 'succeeded')
  assert.equal((await restored.submit(action)).replayed, true)
  assert.equal(calls.filter(row => row.name === 'mod_action').length, 1)
})
test('unknown remote ID remains unknown and is never automatically resubmitted', async t => {
  const { adapter, flags, records, calls } = await fixture(t); await adapter.claimControl(); flags.timeoutAfterAccept = true
  await adapter.submit({ action_id: 'uncertain', operation: 'curios.open' }); records.delete('uncertain')
  assert.equal((await adapter.actionStatus('uncertain')).outcomeKnown, false)
  assert.equal((await adapter.submit({ action_id: 'uncertain', operation: 'curios.open' })).status, 'unknown')
  assert.equal((await adapter.health()).mutationBlocked, true)
  assert.equal(calls.filter(row => row.name === 'mod_action').length, 1)
})
test('wait expiry does not cancel; cancel uses only the owned lease; release refuses unresolved actions', async t => {
  const { adapter, flags, calls } = await fixture(t); await adapter.claimControl(); flags.finish = false
  await adapter.submit({ action_id: 'pending', operation: 'curios.open' })
  const wait = await adapter.wait('pending', { timeoutMs: 1, intervalMs: 100 })
  assert.equal(wait.waitExpired, true); assert.equal(calls.some(row => row.name === 'action_cancel'), false)
  assert.equal((await adapter.releaseControl()).code, 'reconcile_action_before_release')
  assert.equal((await adapter.cancel('pending')).status, 'cancelled')
  assert.equal((await adapter.releaseControl()).ok, true)
})
test('foreign query and action data are rejected rather than relabelled as this body', async t => {
  const { adapter, client } = await fixture(t), original = client.call
  client.call = async (name, args) => name === 'mod_query' ? { ok: true, playerUuid: OTHER, privateData: 'foreign' } : original(name, args)
  const result = await adapter.read('menu.snapshot')
  assert.equal(result.code, 'query_receipt_body_mismatch'); assert.equal(result.privateData, undefined)
})
test('changed action fingerprint fences later mutations', async t => {
  const { adapter, flags } = await fixture(t); await adapter.claimControl()
  await adapter.submit({ action_id: 'fingerprint', operation: 'body.move', args: { position: { x: 2, y: 64, z: 1 } } })
  flags.wrongFingerprint = true
  assert.equal((await adapter.actionStatus('fingerprint')).code, 'remote_action_fingerprint_mismatch')
  assert.equal((await adapter.health()).mutationBlocked, true)
})
test('a successful native program outside the requested cell is still a failed movement', async t => {
  const { adapter, records } = await fixture(t); await adapter.claimControl()
  await adapter.submit({ action_id: 'short-walk', operation: 'body.move', args: { position: { x: 3, y: 64, z: 1 } } })
  records.get('short-walk').after.position.x = 2.8
  const value = await adapter.wait('short-walk')
  assert.equal(value.status, 'failed'); assert.equal(value.result.reached, false)
})
test('Numen close leaves body and accepted actions in place, without hidden release/restore/cancel', async t => {
  const { adapter, calls, flags } = await fixture(t); await adapter.claimControl(); flags.finish = false
  await adapter.submit({ action_id: 'close-active', operation: 'curios.open' })
  const count = calls.length, result = await adapter.close()
  assert.equal(result.actionsCancelled, false); assert.equal(result.bodyRemoved, false); assert.equal(calls.length, count)
})
test('invalid coordinates/action IDs never dispatch and a provider is always explicit', async t => {
  const { adapter, calls } = await fixture(t); await adapter.claimControl()
  assert.equal((await adapter.submit({ action_id: 'bad:colon', operation: 'curios.open' })).ok, false)
  assert.equal((await adapter.submit({ action_id: 'bad-coord', operation: 'body.move', args: { position: { x: '1; evil()', y: 64, z: 1 } } })).ok, false)
  assert.equal((await adapter.submit({ action_id: 'far', operation: 'body.move', args: { position: { x: 1000, y: 64, z: 1 } } })).ok, false)
  assert.equal(calls.some(row => row.name === 'lua'), false)
  await assert.rejects(connect({ provider: 'automatic' }), /must_be_explicit/)
})
test('Mineflayer wrapper reuses its actual SDK and preserves the connected-player identity', async () => {
  const s = server(), requests = []
  const sdk = { identity: () => ({ bodyId: BODY, controllerId: 'mf', account: 'MyBot', connected: true }),
    operations: () => require('../native-sdk/catalog.cjs').operationCatalog(),
    capabilities: async () => ({ ok: true, numenRestoreExisting: false }),
    snapshot: async () => ({ ...s.state, ownerUuid: undefined, menu: s.menu, capturedAt: 'now' }),
    submit: async request => { requests.push(request); return { ok: true, status: 'accepted' } },
    health: () => ({ ok: true }), close () {}, actionStatus: () => ({ status: 'succeeded' }) }
  const a = withMineflayer(sdk)
  assert.equal((await a.snapshot()).inventory.items[0].slot, 36)
  assert.equal((await a.snapshot()).provider, 'mineflayer'); assert.equal(a.identity().ownerUuid, null)
  assert.equal(a.operations('body.move').common, true)
  assert.equal((await a.restore()).ok, false)
  const action = { action_id: 'same-api', operation: 'body.move', args: { position: { x: 3, y: 64, z: 1 } } }
  assert.equal((await a.submit(action)).ok, true); assert.deepEqual(requests, [action])
})
