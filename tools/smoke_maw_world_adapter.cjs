'use strict'
// Finite non-OP real gameplay acceptance; caller supplies a dedicated QA body.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { spawn } = require('node:child_process'), readline = require('node:readline'), crypto = require('node:crypto')
const { connect } = require('../world/src/world-adapter/index.cjs')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function stdio (configFile) {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../world/src/world-adapter/stdio.cjs'), configFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const lines = readline.createInterface({ input: child.stdout }), pending = new Map()
  let readyResolve, readyReject, seq = 0, stderr = ''
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.stderr.on('data', chunk => { stderr += chunk })
  child.once('exit', code => { readyReject(Error('stdio_exit_' + code + ':' + stderr.trim())); for (const p of pending.values()) p.reject(Error('stdio_exited')); pending.clear() })
  lines.on('line', text => {
    const m = JSON.parse(text)
    if (m.event === 'world_adapter_ready') readyResolve(m)
    if (pending.has(m.request_id)) { const p = pending.get(m.request_id); pending.delete(m.request_id); m.ok ? p.resolve(m.result) : p.reject(Error(m.error.code)) }
  })
  const rpc = (method, fields = {}) => new Promise((resolve, reject) => {
    const id = 'probe-' + ++seq
    pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ request_id: id, method, ...fields }) + '\n')
  })
  let timer
  try {
    await Promise.race([ready, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('stdio_ready_timeout')), 40000) })]); clearTimeout(timer)
    const state = await rpc('snapshot'); assert.equal(state.ok, true)
    const viewer = await rpc('viewer'); assert.equal(viewer.readOnly, true)
    await rpc('close') // Keep parent's stdin open: child must still release it.
    await Promise.race([exited, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('stdio_close_timeout')), 10000) })]); clearTimeout(timer)
    assert.equal(child.exitCode, 0); assert.equal(stderr, '')
    return { private_stdio_actual_snapshot: state.ok, private_stdio_close_with_open_parent_pipe: true }
  } finally { clearTimeout(timer); child.stdin.end(); lines.close(); if (child.exitCode === null) child.kill('SIGTERM') }
}
async function run (configFile, output, reconcile = false) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8')), checks = {}, report = { provider: config.provider, checks, modelRequests: 0, op: false, ok: false }
  let adapter
  const savedFile = output + '.actions.json'
  const reportFile = reconcile ? output.replace(/\.json$/, '-reconnect.json') : output
  try {
    adapter = await connect(config)
    const identity = await adapter.identity(), state = await adapter.snapshot()
    const expected = config.bodyId || config.expectedUuid
    assert.equal(identity.bodyId, expected); assert.equal(state.bodyId, expected); assert.equal(state.ok, true)
    assert.equal(state.inventory.slotNamespace, 'player_menu_46'); assert.equal(state.inventory.available, true)
    checks.same_body_actual_snapshot = true
    const catalog = adapter.operations()
    assert.ok((await adapter.operations('curios.open')).parameters); assert.equal((await adapter.operations('body.move')).common, true)
    checks.actual_operation_schemas = true
    checks.actual_inventory_components = state.inventory.items.every(item => typeof item.snbt === 'string' && item.snbt.length > 0)
    let actions
    if (!reconcile) {
      const claimed = await adapter.claimControl(); assert.equal(claimed.ok, true)
      checks.explicit_control = true
      const target = { x: Math.floor(state.position.x) + 1, y: Math.floor(state.position.y), z: Math.floor(state.position.z) }
      actions = [{ action_id: 'unified-walk-' + crypto.randomUUID(), operation: 'body.move', args: { position: target } }]
      const accepted = await adapter.submit(actions[0]); assert.equal(accepted.ok, true, JSON.stringify(accepted))
      const done = await adapter.wait(actions[0].action_id, { timeoutMs: 45000 }); assert.equal(done.status, 'succeeded', JSON.stringify(done))
      const terminalPosition = done.actualPosition || done.result?.actualPosition
      assert.equal(Math.floor(terminalPosition.x), target.x); assert.equal(Math.floor(terminalPosition.y), target.y); assert.equal(Math.floor(terminalPosition.z), target.z)
      const after = await adapter.snapshot()
      // Physics/entity collisions may move the player after the task finishes.
      // Keep both timestamps/positions rather than replacing the terminal proof.
      report.movement={target,terminalPosition,nextObservation:after.position,observedAt:after.capturedAt}
      assert.ok(Math.hypot(after.position.x-terminalPosition.x,after.position.y-terminalPosition.y,after.position.z-terminalPosition.z)<1.5)
      checks.absolute_walk_actual_endpoint = true
      checks.actual_terminal_position = !!done.actualPosition || !!done.result?.actualPosition
      const open = { action_id: 'unified-curios-' + crypto.randomUUID(), operation: 'curios.open', args: {} }
      actions.push(open); assert.equal((await adapter.submit(open)).ok, true)
      const opened = await adapter.wait(open.action_id, { timeoutMs: 30000 }); assert.equal(opened.status, 'succeeded', JSON.stringify(opened))
      const menu = (await adapter.snapshot()).menu; assert.notEqual(menu.windowId, 0)
      checks.native_mod_menu_real_open = true
      const close = { action_id: 'unified-close-' + crypto.randomUUID(), operation: 'menu.close', args: config.provider === 'numen' ? { windowId: menu.windowId, expectedStateId: menu.stateId } : {} }
      actions.push(close); assert.equal((await adapter.submit(close)).ok, true)
      assert.equal((await adapter.wait(close.action_id, { timeoutMs: 30000 })).status, 'succeeded')
      assert.equal((await adapter.snapshot()).menu.windowId, 0); checks.native_menu_real_close = true
      fs.writeFileSync(savedFile, JSON.stringify({ bodyId: expected, actions }))
    } else {
      const prior = JSON.parse(fs.readFileSync(savedFile, 'utf8')); assert.equal(prior.bodyId, expected); actions = prior.actions
      checks.reconnected_original_uuid = true
    }
    const ledgerFile = path.join(config.ledgerDir, ...(config.provider === 'numen' ? ['numen'] : []), identity.account.toLowerCase(), 'native-actions.jsonl')
    const beforeHash = hash(ledgerFile)
    for (const action of actions) {
      const result = await adapter.actionStatus(action.action_id); assert.equal(result.status, 'succeeded', JSON.stringify(result))
      const replay = await adapter.submit(action); assert.equal(replay.replayed, true); assert.equal(replay.dispatched, false)
    }
    checks.original_ids_reconciled_without_redispatch = hash(ledgerFile) === beforeHash
    if (config.provider === 'numen' && !reconcile) assert.equal((await adapter.releaseControl()).ok, true)
    assert.equal((await adapter.close()).ok, true); adapter = null
    checks.clean_connection_close = true
    Object.assign(checks, await stdio(configFile))
    report.ok = Object.values(checks).every(Boolean)
  } catch (error) { report.error = error.message; throw error }
  finally { if (adapter) await adapter.close(); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)) }
  return report
}
if (require.main === module) run(process.argv[2], process.argv[3], process.argv[4] === '--reconcile').then(report => {
  process.stdout.write(JSON.stringify({ ok: report.ok, provider: report.provider, checks: Object.keys(report.checks).length }) + '\n')
}).catch(() => { process.stderr.write('World adapter smoke failed; inspect private report.\n'); process.exitCode = 1 })
module.exports = { run }
