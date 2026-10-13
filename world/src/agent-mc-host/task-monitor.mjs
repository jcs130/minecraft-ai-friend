/** Durable, model-independent task evaluation. Host-only API: never a game or LLM tool. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const clone = value => structuredClone(value)
const idPattern = /^[a-z0-9][a-z0-9_.-]{0,79}$/
function progressFingerprint(observations) {
  const body = observations?.body
  if (!body?.ok) return null
  return hash({ status: body.status, dimension: body.dimension, health: body.health, hunger: body.hunger,
    position: body.position && Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(body.position[k])])),
    inventory: body.inventory?.items, equipment: body.equipment,
    quests: observations.society?.state?.quests?.map(q => ({ id: q.id, completed: q.completed, progress: q.progress })) })
}
function improvement(signature) {
  if (/ARGUMENT|plan_|schema/i.test(signature)) return { category: 'interface', recommendation: 'Discover and validate the real schema; return missing fields and accepted shape in the same response.' }
  if (/changed|mismatch|Snbt|CAS/i.test(signature)) return { category: 'state_comparison', recommendation: 'Refresh the owned native state; fill opaque compare values mechanically and preserve explicit intent.' }
  if (/navigation|visible|movement|reach/i.test(signature)) return { category: 'navigation_observation', recommendation: 'Inspect actual stopping coordinates, visibility and reachable space; do not replay a known unsuccessful route unchanged.' }
  if (/ingredients|recipe|grid|material/i.test(signature)) return { category: 'game_preconditions', recommendation: 'Expose actual missing materials and required workstation before another consuming action.' }
  if (/unknown|reconciliation/i.test(signature)) return { category: 'uncertain_outcome', recommendation: 'Reconcile the original action ID and body; never automatically replay an unknown mutation.' }
  return { category: 'review_evidence', recommendation: 'Inspect the native receipt and reproduce the cause before changing the harness.' }
}

function validateCriterion(c) {
  if (c?.type === 'owned_item' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(c.itemId || '') && Number.isSafeInteger(c.countAtLeast) && c.countAtLeast > 0) return
  if (c?.type === 'reach_position' && ['x', 'y', 'z'].every(k => Number.isFinite(c.position?.[k])) && typeof c.dimension === 'string' && c.radius > 0 && c.radius <= 64) return
  if (c?.type === 'quest_completed' && typeof c.questId === 'string' && Number.isSafeInteger(c.countAtLeast) && c.countAtLeast > 0) return
  if (c?.type === 'all' && Array.isArray(c.criteria) && c.criteria.length > 0 && c.criteria.length <= 16) { c.criteria.forEach(validateCriterion); return }
  throw Error('task_criterion_invalid')
}

export function evaluateTask(criteria, observations, { bodyId, now = Date.now(), maxAgeMs = 15000 } = {}) {
  validateCriterion(criteria)
  const s = observations?.body
  const fresh = value => value?.ok === true && value.bodyId === bodyId && Number.isFinite(Date.parse(value.capturedAt)) && now - Date.parse(value.capturedAt) >= -5000 && now - Date.parse(value.capturedAt) <= maxAgeMs
  if (!fresh(s)) return { verified: false, conclusive: false, code: 'task_body_evidence_unavailable_or_stale' }
  if (s.status !== 'alive') return { verified: false, conclusive: s.status === 'dead', code: 'task_body_' + s.status }
  const evaluate = c => {
    if (c.type === 'all') {
      const checks = c.criteria.map(evaluate)
      return { verified: checks.every(r => r.verified), conclusive: checks.every(r => r.conclusive), checks }
    }
    if (c.type === 'owned_item') {
      if (!s.inventory?.available || !Array.isArray(s.inventory.items)) return { verified: false, conclusive: false, code: 'task_inventory_unavailable' }
      const count = s.inventory.items.filter(i => i.id === c.itemId).reduce((n, i) => n + i.count, 0)
      const equipped = s.equipment?.mainhand?.id === c.itemId
      return { verified: count >= c.countAtLeast && (!c.requireEquipped || equipped), conclusive: true, itemId: c.itemId, count, equipped }
    }
    if (c.type === 'reach_position') {
      if (!['x', 'y', 'z'].every(k => Number.isFinite(s.position?.[k]))) return { verified: false, conclusive: false, code: 'task_position_unavailable' }
      const distance = Math.hypot(...['x', 'y', 'z'].map(k => s.position[k] - c.position[k]))
      return { verified: s.dimension === c.dimension && distance <= c.radius, conclusive: true, position: s.position, dimension: s.dimension, distance }
    }
    const society = observations.society
    if (!fresh(society) || !Array.isArray(society.state?.quests)) return { verified: false, conclusive: false, code: 'task_quest_evidence_unavailable_or_stale' }
    const quest = society.state.quests.find(q => q.id === c.questId)
    return { verified: (quest?.completed ?? 0) >= c.countAtLeast, conclusive: true, questId: c.questId, completed: quest?.completed ?? 0 }
  }
  return { ...evaluate(criteria), bodyId, capturedAt: s.capturedAt, evidenceSha256: hash(observations), verifierVersion: 1 }
}

function summarize(records) {
  const groups = new Map(), failureCounts = new Map(), ineffectiveCounts = new Map()
  for (const record of records) {
    const revisions = [...new Set(record.events.filter(e => e.kind === 'harness_revision').map(e => e.harnessVersion))]
    const version = revisions.length ? 'mixed:' + hash([record.spec.harnessVersion, ...revisions]) : record.spec.harnessVersion
    const key = [record.spec.scenarioId, record.spec.scenarioVersion, version, record.criteriaSha256].join('|')
    if (!groups.has(key)) groups.set(key, { scenarioId: record.spec.scenarioId, scenarioVersion: record.spec.scenarioVersion, harnessVersion: version, criteriaSha256: record.criteriaSha256, records: [] })
    groups.get(key).records.push(record)
    for (const event of record.events) if (event.ok === false && event.kind !== 'backend_call') {
      const key = (event.operation || event.kind) + ':' + (event.code || 'unspecified')
      failureCounts.set(key, (failureCounts.get(key) || 0) + 1)
    }
    for (const event of record.events) if (event.kind === 'tool_result' && event.effectFeedback?.noDisplacement === true) {
      const key = event.operation + ':no_displacement_observed'
      ineffectiveCounts.set(key, (ineffectiveCounts.get(key) || 0) + 1)
    }
  }
  const aggregate = rows => {
    const count = status => rows.filter(r => r.status === status).length
    const succeeded = count('succeeded'), failed = count('failed'), inconclusive = count('inconclusive'), cancelled = count('cancelled')
    const completed = succeeded + failed + inconclusive + cancelled
    const rounds = rows.filter(r => r.status === 'succeeded').map(r => r.metrics.modelCalls).sort((a, b) => a - b)
    return { attempts: rows.length, running: count('running'), succeeded, failed, inconclusive, cancelled, closedAttempts: completed,
      successRate: completed ? succeeded / completed : null, evaluableSuccessRate: succeeded + failed ? succeeded / (succeeded + failed) : null,
      successfulModelCallsMedian: rounds.length ? rounds[Math.floor((rounds.length - 1) / 2)] : null,
      successfulModelCallsP95: rounds.length ? rounds[Math.ceil(rounds.length * 0.95) - 1] : null,
      totalModelCalls: rows.reduce((n, r) => n + r.metrics.modelCalls, 0), backendCalls: rows.reduce((n, r) => n + r.metrics.backendCalls, 0),
      noDisplacementRounds: rows.reduce((n, r) => n + (r.metrics.noDisplacementRounds || 0), 0),
      effectObservedRounds: rows.reduce((n, r) => n + (r.metrics.effectObservedRounds || 0), 0) }
  }
  return { schemaVersion: 1, ...aggregate(records), denominator: 'all closed attempts, including inconclusive and cancelled; running shown separately',
    groups: [...groups.values()].map(({ records: rows, ...group }) => ({ ...group, ...aggregate(rows), initialStateFingerprints: [...new Set(rows.map(r => r.spec.initialStateFingerprint))] })),
    failureHotspots: [...failureCounts].sort((a, b) => b[1] - a[1]).map(([signature, count]) => ({ signature, count })),
    ineffectiveHotspots: [...ineffectiveCounts].sort((a, b) => b[1] - a[1]).map(([signature, count]) => ({ signature, count })),
    iterationCandidates: [...failureCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([signature, count]) => ({ signature, count, ...improvement(signature), applied: false })),
    comparisonNote: 'Different criteria, scenario versions or initial conditions are not a controlled before/after comparison. Never loosen a verifier to improve the rate.' }
}

function applyEvent(records, event) {
    if (event.kind === 'start') {
      if (records.has(event.id)) throw Error('task_duplicate_start')
      records.set(event.id, { id: event.id, spec: event.spec, criteriaSha256: hash(event.spec.criteria), startedAt: event.at, status: 'running', events: [], metrics: { modelCalls: 0, backendCalls: 0 } })
    } else {
      const record = records.get(event.id)
      if (!record) throw Error('task_event_without_start')
      if (event.kind === 'progress') { record.metrics = event.metrics; record.lastVerification = event.verification; record.updatedAt = event.at; record.progressFingerprint = event.progressFingerprint; record.lastProgressRound = event.lastProgressRound }
      else if (event.kind === 'finish') { record.status = event.status; record.reason = event.reason; record.endedAt = event.at; record.lastVerification = event.verification }
      else record.events.push(event)
    }
}
function rebuild(events) {
  const records = new Map()
  for (const event of events) applyEvent(records, event)
  return records
}

export class TaskMonitor {
  constructor({ directory, clock = Date.now, readOnly = false }) {
    if (!path.isAbsolute(directory)) throw Error('task_monitor_absolute_directory_required')
    this.directory = directory; this.clock = clock; this.readOnly = readOnly
    this.file = path.join(directory, 'events.jsonl')
    if (!readOnly) fs.mkdirSync(directory, { recursive: true })
    this.events = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []
    this.records = rebuild(this.events)
    if (!readOnly) {
      this.lock = path.join(directory, 'writer.lock')
      const fd = fs.openSync(this.lock, 'wx', 0o600)
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    }
  }
  append(event) {
    if (this.readOnly || this.closed) throw Error('task_monitor_read_only_or_closed')
    const row = { schemaVersion: 1, at: new Date(this.clock()).toISOString(), ...clone(event) }
    const fd = fs.openSync(this.file, 'a', 0o600)
    try { fs.writeSync(fd, JSON.stringify(row) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    this.events.push(row); applyEvent(this.records, row)
  }
  start(spec) {
    if (!idPattern.test(spec.id || '') || !spec.bodyId || !spec.scenarioId || !spec.scenarioVersion || !spec.harnessVersion || !spec.initialStateFingerprint || !Number.isSafeInteger(spec.startedAtCall) || !Number.isSafeInteger(spec.startedAtRound)) throw Error('task_spec_invalid')
    validateCriterion(spec.criteria)
    const prior = this.records.get(spec.id)
    if (prior) {
      if (hash(prior.spec) !== hash(spec)) throw Error('task_spec_changed')
      if (prior.status !== 'running') throw Error('task_attempt_already_closed')
      return clone(prior)
    }
    this.append({ kind: 'start', id: spec.id, spec }); return this.get(spec.id)
  }
  record(id, event) {
    if (!this.records.has(id) || this.records.get(id).status !== 'running' || ['start', 'finish', 'progress'].includes(event.kind)) throw Error('task_event_invalid')
    this.append({ ...event, id })
  }
  observe(id, observations, counters) {
    const record = this.records.get(id)
    if (!record || record.status !== 'running') throw Error('task_not_running')
    if (!Number.isSafeInteger(counters.calls) || !Number.isSafeInteger(counters.round) || counters.calls < record.spec.startedAtCall + record.metrics.modelCalls || counters.round < record.spec.startedAtRound + (record.metrics.decisionRounds || 0)) throw Error('task_counter_regressed')
    const verification = evaluateTask(record.spec.criteria, observations, { bodyId: record.spec.bodyId, now: this.clock() })
    const failures = record.events.filter(e => e.ok === false && e.kind !== 'backend_call')
    const recovery = failures.map(f => {
      const corrected = record.events.find(e => e.kind === 'tool_result' && e.round > f.round && e.ok === true && (f.kind === 'plan_error' || e.operation === f.operation))
      return { failedRound: f.round, operation: f.operation ?? null, code: f.code ?? null, roundsUntilSameOperationSucceeded: corrected ? corrected.round - f.round : null }
    })
    const fingerprint = progressFingerprint(observations)
    const lastProgressRound = fingerprint && fingerprint !== record.progressFingerprint ? counters.round : record.lastProgressRound ?? record.spec.startedAtRound
    const metrics = { modelCalls: counters.calls - record.spec.startedAtCall, decisionRounds: counters.round - record.spec.startedAtRound,
      failedResponseRounds: new Set(failures.map(f => f.round)).size, backendCalls: record.events.filter(e => e.kind === 'backend_call').length,
      nativeSubmissions: record.events.filter(e => e.kind === 'backend_call' && e.name === 'mc_do').length,
      elapsedMs: this.clock() - Date.parse(record.startedAt), noProgressRounds: counters.round - lastProgressRound,
      progressAlert: counters.round - lastProgressRound >= 8 ? 'Review the plan: successful reads/turning do not imply task progress. Inspect actual preconditions, failures and alternative available operations.' : null,
      noDisplacementRounds: new Set(record.events.filter(e => e.kind === 'tool_result' && e.effectFeedback?.noDisplacement === true).map(e => e.round)).size,
      effectObservedRounds: new Set(record.events.filter(e => e.kind === 'tool_result' && e.effectFeedback?.available === true).map(e => e.round)).size, recovery }
    this.append({ id, kind: 'progress', verification, metrics, progressFingerprint: fingerprint, lastProgressRound }); return this.get(id)
  }
  finish(id, { observations, counters, reason, cancelled = false, outcomeUnknown = false }) {
    const current = this.observe(id, observations, counters)
    const verification = current.lastVerification
    const status = outcomeUnknown ? 'inconclusive' : verification.verified ? 'succeeded' : cancelled ? 'cancelled' : verification.conclusive ? 'failed' : 'inconclusive'
    this.append({ id, kind: 'finish', reason, status, verification })
    return this.get(id)
  }
  get(id) { const r = this.records.get(id); return r ? clone(r) : null }
  report() {
    const records = [...this.records.values()]
    const stalled = records.filter(r => r.status === 'running' && this.clock() - Date.parse(r.updatedAt || r.startedAt) > 180000).map(r => r.id)
    return { ...summarize(records), generatedAt: new Date(this.clock()).toISOString(), health: { ok: stalled.length === 0, stalledTaskIds: stalled, idleThresholdMs: 180000 } }
  }
  close() { if (!this.closed && this.lock) fs.unlinkSync(this.lock); this.closed = true }
}
