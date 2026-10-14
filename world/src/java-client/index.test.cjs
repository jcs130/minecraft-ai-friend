'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { connectJavaClient, credentials } = require('./index.cjs')
const BODY = '7dbeb982-9bcb-3be9-a0fb-36ca776177cf'
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../java-client-bridge-src/resources/client-operations.json')))
function setup (t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maw-java-client-'))
  t.after(() => { assert.equal(path.dirname(directory), os.tmpdir()); fs.rmSync(directory, { recursive: true, force: true }) })
  const calls = [], actions = new Map(), flags = { loseSubmit: false, complete: true, wrongBody: false, wrongReceipt: false }
  const state = { ok: true, provider: 'java-client', bodyId: BODY, username: 'MawClientQA', server: '127.0.0.1:28978', status: 'alive',
    position: { x: 3.5, y: 64, z: -2.5 }, health: 19, inventory: { slotNamespace: 'player_menu_46', slots: Array(46).fill(null) } }
  state.inventory.slots[36] = { id: 'minecraft:player_head', name: '大背包', count: 1, snbt: '{id:"minecraft:player_head",count:1,components:{"minecraft:custom_name":\'{"text":"大背包"}\'}}' }
  const remote = { async rpc (method, p) {
    calls.push({ method, params: structuredClone(p) })
    if (method === 'snapshot') return { ...structuredClone(state), ...(flags.wrongBody ? { bodyId: '00000000-0000-4000-8000-000000000001' } : {}) }
    if (method === 'operations') return structuredClone(catalog)
    if (method === 'claim') return { ok: true, bodyId: BODY, leaseId: 'lease', expiresAt: Date.now() + 90000 }
    if (['stop', 'release', 'cancel'].includes(method)) return { ok: true }
    if (method === 'submit') {
      const value = { ok: true, accepted: true, bodyId: BODY, server: state.server, action_id: p.action_id, operation: p.operation, args: structuredClone(p.args), terminal: false, status: 'accepted' }
      if (p.operation === 'screen.capture') value.frame = `/frames/${crypto.createHash('sha256').update(state.server + '\n' + BODY).digest('hex').slice(0,24)}-${p.action_id}.png`
      actions.set(p.action_id, value)
      if (flags.loseSubmit) throw Error('timeout_after_real_accept')
      return structuredClone(value)
    }
    if (method === 'result') {
      const value = actions.get(p.action_id); if (!value) return { ok: false, code: 'unknown_action_id', status: 'unknown', outcomeKnown: false }
      return { ...structuredClone(value), ...(flags.complete ? { terminal: true, status: 'succeeded', outcomeKnown: true } : {}), ...(flags.wrongReceipt ? { args: { yaw: 90, pitch: 0 } } : {}) }
    }
    if (method === 'health') return { ok: true }
    throw Error('mock_method_unavailable')
  }, async frame () { return Buffer.from([137,80,78,71,13,10,26,10]) } }
  const config = { provider: 'java-client', expectedUuid: BODY, expectedServer: state.server, controllerId: 'qa', username: state.username, ledgerDir: directory }
  const open = async (c = config) => { const adapter = await connectJavaClient(c, { remote }); t.after(() => adapter.close()); return adapter }
  return { open, config, calls, actions, flags, remote, state, directory }
}
test('client provider reads actual identity/components without starting a connection or claiming control', async t => {
  const { open, calls } = setup(t), adapter = await open(), s = await adapter.snapshot()
  assert.equal(adapter.identity().bodyKind, 'connected_java_client'); assert.equal(s.inventory.slots[36].name, '大背包')
  assert.match(s.inventory.slots[36].snbt, /minecraft:custom_name/); assert.equal(adapter.operations().operationCount, 30)
  assert.equal(calls.some(c => c.method === 'claim'), false); assert.equal(adapter.viewer().secondAccount, false)
})
test('lease and argument validation happen before accepting any new action', async t => {
  const { open, calls } = setup(t), adapter = await open()
  assert.equal((await adapter.submit({ action_id: 'a', operation: 'control.look', args: { yaw: 0, pitch: 0 } })).code, 'control_lease_required')
  await adapter.claimControl()
  assert.equal((await adapter.submit({ action_id: 'bad', operation: 'control.look', args: { yaw: 0, pitch: 100 } })).code, 'java_client_arguments_invalid')
  assert.equal(calls.some(c => c.method === 'submit'), false)
})
test('same action id and complete canonical arguments execute once; changed parameters reject', async t => {
  const { open, calls } = setup(t), adapter = await open(); await adapter.claimControl()
  await adapter.submit({ action_id: 'look-1', operation: 'control.look', args: { yaw: 0, pitch: 15 } })
  assert.equal((await adapter.wait('look-1')).status, 'succeeded')
  assert.equal((await adapter.submit({ action_id: 'look-1', operation: 'control.look', args: { pitch: 15, yaw: 0 } })).cached, true)
  assert.equal((await adapter.submit({ action_id: 'look-1', operation: 'control.look', args: { pitch: 0, yaw: 0 } })).code, 'action_id_parameters_changed')
  assert.equal(calls.filter(c => c.method === 'submit').length, 1)
})
test('lost submit reply remains unresolved and blocks new ids; original result reconciles without resubmission', async t => {
  const { open, calls, flags } = setup(t), adapter = await open(); await adapter.claimControl(); flags.loseSubmit = true
  const value = await adapter.submit({ action_id: 'lost-1', operation: 'control.look', args: { yaw: 0, pitch: 15 } })
  assert.equal(value.outcomeKnown, false)
  assert.equal((await adapter.submit({ action_id: 'lost-2', operation: 'control.look', args: { yaw: 0, pitch: 15 } })).code, 'reconcile_action_before_submit')
  assert.equal((await adapter.actionStatus('lost-1')).status, 'succeeded')
  assert.equal(calls.filter(c => c.method === 'submit').length, 1)
})
test('reopening the original journal preserves original result and does not issue another mutation', async t => {
  const { open, calls } = setup(t), a = await open(); await a.claimControl()
  await a.submit({ action_id: 'persist-1', operation: 'control.look', args: { yaw: 0, pitch: 15 } }); await a.wait('persist-1'); await a.close()
  const b = await open(); assert.equal((await b.actionStatus('persist-1')).cached, true)
  assert.equal(calls.filter(c => c.method === 'submit').length, 1)
})
test('a pending intent survives reconnect and is queried by its original id', async t => {
  const { open, flags, calls } = setup(t), a = await open(); await a.claimControl(); flags.complete = false
  await a.submit({ action_id: 'pending-1', operation: 'control.look', args: { yaw: 0, pitch: 15 } }); await a.close()
  const b = await open(); flags.complete = true
  assert.equal((await b.actionStatus('pending-1')).status, 'succeeded')
  assert.equal(calls.filter(c => c.method === 'submit').length, 1)
})
test('a modified full receipt cannot resolve a previous intent', async t => {
  const { open, flags } = setup(t), a = await open(); await a.claimControl()
  await a.submit({ action_id: 'receipt-1', operation: 'control.look', args: { yaw: 0, pitch: 15 } }); flags.wrongReceipt = true
  await assert.rejects(a.actionStatus('receipt-1'), /receipt_mismatch/)
})
test('wrong logged in UUID rejects before creating a local journal', async t => {
  const { open, flags, directory } = setup(t); flags.wrongBody = true
  await assert.rejects(open(), /signed_in_body_mismatch/); assert.deepEqual(fs.readdirSync(directory), [])
})
test('journal binds server as well as UUID and rejects reuse in a different world', async t => {
  const { open, state, config } = setup(t), a = await open(); await a.close(); state.server = '127.0.0.1:28979'
  await assert.rejects(open({ ...config, expectedServer: state.server }), /ledger_server_binding_changed/)
})
test('one local writer owns the journal; close leaves the real client running', async t => {
  const { open } = setup(t), a = await open(); await assert.rejects(open(), /EEXIST/)
  const value = await a.close(); assert.equal(value.clientDisconnected, false); assert.equal(value.bodyRemoved, false)
})
test('frame access requires a successful capture action, not an arbitrary filename', async t => {
  const { open } = setup(t), a = await open(); await a.claimControl()
  await assert.rejects(a.frame('../secret'), /frame_id_invalid/)
  await a.submit({ action_id: 'frame-1', operation: 'screen.capture', args: {} }); await a.wait('frame-1')
  assert.equal((await a.frame('frame-1')).length, 8)
})
test('frame result is bound to both server and body, even when action ids collide', async t => {
  const { open, actions } = setup(t), a = await open(); await a.claimControl()
  await a.submit({ action_id: 'foreign-frame', operation: 'screen.capture', args: {} })
  actions.get('foreign-frame').frame = '/frames/' + 'b'.repeat(24) + '-foreign-frame.png'
  await a.wait('foreign-frame')
  await assert.rejects(a.frame('foreign-frame'), /frame_body_scope_mismatch/)
})
test('credentials accept only explicit loopback RPC and never embedded URL secrets', t => {
  const { directory } = setup(t), file = path.join(directory, 'credentials.json')
  for (const endpoint of ['http://192.168.3.163:1/rpc', 'http://127.0.0.1:1/rpc?token=secret', 'http://u:p@127.0.0.1:1/rpc', 'https://127.0.0.1:1/rpc']) {
    fs.writeFileSync(file, JSON.stringify({ endpoint, token: 'a'.repeat(64), instanceId: BODY })); assert.throws(() => credentials(file))
  }
})

test('finite Minescript preserves nested JSON input and the original intent across replay', async t => {
  const { open, calls } = setup(t), body = await open(); await body.claimControl()
  const args = { code: "result = input_data", input: { items: [{ id: 'farmersdelight:tomato', count: 12 }], exact: true }, timeoutMs: 5000 }
  await body.submit({ action_id: 'finite-python', operation: 'minescript.run', args })
  await body.wait('finite-python')
  await body.submit({ action_id: 'finite-python', operation: 'minescript.run', args })
  const submissions = calls.filter(call => call.method === 'submit')
  assert.equal(submissions.length, 1)
  assert.deepEqual(submissions[0].params.args, args)
  const changed = await body.submit({ action_id: 'finite-python', operation: 'minescript.run', args: { ...args, code: 'result = 2' } })
  assert.equal(changed.code, 'action_id_parameters_changed')
})
