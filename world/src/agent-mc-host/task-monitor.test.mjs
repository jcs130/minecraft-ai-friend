import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TaskMonitor, evaluateTask } from './task-monitor.mjs'
const now = Date.now(), bodyId = 'own-body'
const criteria = { type: 'owned_item', itemId: 'minecraft:wooden_pickaxe', countAtLeast: 1, requireEquipped: true }
const body = (equipped = false) => ({ ok: true, bodyId, capturedAt: new Date(now).toISOString(), status: 'alive',
  inventory: { available: true, items: [{ id: criteria.itemId, count: 1 }] }, equipment: { mainhand: equipped ? { id: criteria.itemId } : null },
  position: { x: 1, y: 64, z: 2 }, dimension: 'minecraft:overworld' })
const spec = (id = 'wood-pick-1') => ({ id, bodyId, criteria, scenarioId: 'make-pick', scenarioVersion: '1', harnessVersion: 'hash1', initialStateFingerprint: 'world1', startedAtCall: 206, startedAtRound: 206 })
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maw-task-test-'))
  const monitor = new TaskMonitor({ directory, clock: () => now })
  t.after(() => { monitor.close(); assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'maw-task-test-')); fs.rmSync(directory, { recursive: true, force: true }) })
  return { directory, monitor }
}
test('independent verifier rejects model claims, stale/foreign bodies and unavailable inventory', () => {
  assert.equal(evaluateTask(criteria, { body: body() }, { bodyId, now }).verified, false)
  assert.equal(evaluateTask(criteria, { body: body(true) }, { bodyId, now }).verified, true)
  assert.equal(evaluateTask(criteria, { body: body(true) }, { bodyId: 'other', now }).conclusive, false)
  assert.equal(evaluateTask(criteria, { body: body(true) }, { bodyId, now: now + 60000 }).conclusive, false)
  assert.equal(evaluateTask(criteria, { body: { ...body(true), inventory: { available: false } } }, { bodyId, now }).conclusive, false)
})
test('position and quest combinations require matching authoritative evidence', () => {
  const c = { type: 'all', criteria: [{ type: 'reach_position', position: { x: 1, y: 64, z: 2 }, radius: 1, dimension: 'minecraft:overworld' }, { type: 'quest_completed', questId: 'maw:workbench', countAtLeast: 1 }] }
  const observations = { body: body(), society: { ok: true, bodyId, capturedAt: new Date(now).toISOString(), state: { quests: [{ id: 'maw:workbench', completed: 1 }] } } }
  assert.equal(evaluateTask(c, observations, { bodyId, now }).verified, true)
  observations.society.bodyId = 'another-player'
  assert.equal(evaluateTask(c, observations, { bodyId, now }).conclusive, false)
})
test('restart retains attempts, immutable criteria, cumulative costs, error recovery and duplicate terminal protection', t => {
  const { directory, monitor } = fixture(t)
  monitor.start(spec()); monitor.record(spec().id, { kind: 'tool_result', round: 207, operation: 'world.place', mutation: true, ok: false, code: 'mismatch' })
  monitor.record(spec().id, { kind: 'backend_call', round: 208, name: 'mc_do', ok: true })
  monitor.observe(spec().id, { body: body() }, { calls: 208, round: 208 })
  assert.throws(() => monitor.observe(spec().id, { body: body() }, { calls: 207, round: 207 }), /counter_regressed/)
  assert.throws(() => monitor.start({ ...spec(), criteria: { ...criteria, requireEquipped: false } }), /spec_changed/)
  assert.throws(() => new TaskMonitor({ directory }), /EEXIST/)
  monitor.close()
  const resumed = new TaskMonitor({ directory, clock: () => now }); t.after(() => resumed.close())
  resumed.start(spec()); resumed.record(spec().id, { kind: 'tool_result', round: 209, operation: 'world.place', mutation: true, ok: true })
  const final = resumed.finish(spec().id, { observations: { body: body(true) }, counters: { calls: 211, round: 211 }, reason: 'verified' })
  assert.equal(final.status, 'succeeded'); assert.equal(final.metrics.modelCalls, 5); assert.equal(final.metrics.backendCalls, 1)
  assert.equal(final.metrics.recovery[0].roundsUntilSameOperationSucceeded, 2)
  assert.throws(() => resumed.start(spec()), /already_closed/)
  const read = new TaskMonitor({ directory, readOnly: true, clock: () => now })
  assert.equal(read.report().successRate, 1); assert.equal(read.report().totalModelCalls, 5)
  resumed.close()
})
test('unknown/cancelled attempts remain in the rate and different versions remain separate', t => {
  const { monitor } = fixture(t)
  for (const [id, options] of [['a', {}], ['b', { outcomeUnknown: true }], ['c', { cancelled: true }], ['d', {}]]) {
    monitor.start({ ...spec(id), harnessVersion: id === 'd' ? 'hash2' : 'hash1' })
    monitor.finish(id, { observations: { body: id === 'a' ? body(true) : body() }, counters: { calls: 208, round: 208 }, reason: 'test', ...options })
  }
  const report = monitor.report()
  assert.equal(report.successRate, 0.25); assert.equal(report.evaluableSuccessRate, 0.5)
  assert.equal(report.inconclusive, 1); assert.equal(report.cancelled, 1); assert.equal(report.groups.length, 2)
})
test('running attempts can be inspected for stalls without write access or hidden network calls', t => {
  const { directory, monitor } = fixture(t); monitor.start(spec())
  const read = new TaskMonitor({ directory, readOnly: true, clock: () => now + 181000 })
  assert.equal(read.report().health.ok, false); assert.equal(read.report().running, 1); assert.equal(read.report().successRate, null)
  assert.throws(() => read.record(spec().id, { kind: 'fake' }), /read_only/)
})

test('successful observation loops trigger progress feedback and real inventory changes clear it', t => {
  const { monitor } = fixture(t); monitor.start(spec())
  monitor.observe(spec().id, { body: body() }, { calls: 206, round: 206 })
  for (let n = 207; n <= 215; n++) {
    monitor.record(spec().id, { kind: 'tool_result', round: n, operation: 'body.look', ok: true, mutation: true })
    monitor.observe(spec().id, { body: { ...body(), yaw: n } }, { calls: n, round: n })
  }
  assert.equal(monitor.get(spec().id).metrics.noProgressRounds, 9)
  assert.match(monitor.get(spec().id).metrics.progressAlert, /Review the plan/)
  monitor.observe(spec().id, { body: body(true) }, { calls: 216, round: 216 })
  assert.equal(monitor.get(spec().id).metrics.noProgressRounds, 0)
  assert.equal(monitor.get(spec().id).metrics.progressAlert, null)
})
