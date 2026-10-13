/** Context is a view of retained evidence, never a replacement for the journals. */
export function contractOf(value) {
  if (!value || typeof value.id !== 'string' || !value.parameters) return null
  const { id, description, readOnly, available, parameters, permission, execution } = value
  return { id, description, readOnly, available, parameters, permission, execution }
}

export function recentWithin(values, maxBytes) {
  const selected = []
  let bytes = 2
  for (const value of [...values].reverse()) {
    const size = Buffer.byteLength(JSON.stringify(value)) + 1
    if (bytes + size > maxBytes) continue
    selected.unshift(value); bytes += size
  }
  return selected
}

export function boundedHistory(history, system, maxBytes = 220000) {
  // Count serialized bytes, including escaped SNBT, rather than string lengths.
  let bytes = Buffer.byteLength(JSON.stringify({ role: 'system', content: system })) + 1024
  if (bytes > maxBytes) throw Error('trial_system_context_too_large')
  let start = history.length
  while (start > 0) {
    // Keep complete assistant/result pairs when trimming old conversation.
    const next = Math.max(0, start - (history[start - 1].role === 'user' && history[start - 2]?.role === 'assistant' ? 2 : 1))
    const size = Buffer.byteLength(JSON.stringify(history.slice(next, start)))
    if (bytes + size > maxBytes) break
    bytes += size; start = next
  }
  if (history.length && start === history.length) throw Error('trial_latest_context_too_large')
  return history.slice(start)
}

export function projectHistory(history) {
  // A new evaluated task gets its own working context. Prior complete history
  // and durable memory remain on disk; only verified summaries cross this boundary.
  const boundary = history.findLastIndex(message => message.role === 'user' &&
    (message.content.startsWith('HOST TASK BOUNDARY:') || message.content.startsWith('HOST REPLAN BOUNDARY:')))
  if (boundary >= 0) history = history.slice(boundary)
  const projected = []
  let rejected = 0, latest
  const flush = () => {
    if (rejected) projected.push({ role: 'user', content: `HOST INPUT REJECTION SUMMARY: ${rejected} completed responses were rejected before dispatch; malformed examples are omitted from this context view and retained in the private history. Latest feedback: ${latest}` })
    rejected = 0
  }
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === 'assistant' && history[i + 1]?.role === 'user' && history[i + 1].content.startsWith('HOST INPUT REJECTION:')) {
      rejected++; latest = history[++i].content; continue
    }
    flush(); projected.push(history[i])
  }
  flush(); return projected
}

/** Renew a stagnating working context once per eight unchanged rounds. Keep the
 * immutable task, actual failures and prior receipt references, not repeated
 * executable examples that encourage the model to copy an unsuccessful plan.
 */
export function replanCheckpoint(record, round, previousRound = record?.spec.startedAtRound ?? round, history = []) {
  if (!record || record.metrics.noProgressRounds < 8 || round - previousRound < 8) return null
  const recent = record.events.filter(e => e.kind === 'tool_result').slice(-12).map(e => ({
    round: e.round, operation: e.operation, ok: e.ok, code: e.code,
    actualMovement: e.effectFeedback?.available ? { from: e.effectFeedback.from, to: e.effectFeedback.to,
      distance: e.effectFeedback.distance, noDisplacement: e.effectFeedback.noDisplacement } : null
  }))
  return { taskId: record.id, objective: record.spec.objective, criteria: record.spec.criteria,
    round, noProgressRounds: record.metrics.noProgressRounds, recent, fullHistoryRetained: true,
    recentToolEvidence: history.filter(m => m.role === 'user' && m.content.startsWith('TOOL RESULT ')).slice(-3).map(m => m.content),
    instruction: '当前策略连续多轮没有改变任务进度。先从最新本人状态和历史已验证产物经验重新判断前置条件，选择能改变局面的新动作或查询；不要沿着旧的转头/观察/原地前进循环继续。你仍可使用所有现有工具并自主选择获取、合成或脱困路线。若确实缺少能力，以真实回执说明，不把未尝试的路线判为不可能。' }
}

export function readArtifact(artifacts, args) {
  let value = artifacts.get(args.handle)
  if (value === undefined) return { ok: false, code: 'artifact_not_found' }
  for (const key of args.path || []) {
    if (!(typeof key === 'string' || Number.isSafeInteger(key)) || ['__proto__', 'constructor', 'prototype'].includes(key)) return { ok: false, code: 'artifact_path_invalid' }
    if (!value || !Object.hasOwn(Object(value), key)) return { ok: false, code: 'artifact_field_not_found' }
    value = value[key]
  }
  if (args.offset === undefined && args.limit === undefined) return value
  if (value === null || typeof value !== 'object' && typeof value !== 'string') return { ok: false, code: 'artifact_range_requires_collection', observedType: value === null ? 'null' : typeof value }
  const offset = args.offset ?? 0, limit = args.limit ?? 1000
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) return { ok: false, code: 'artifact_range_invalid' }
  const type = typeof value === 'string' ? 'string' : Array.isArray(value) ? 'array' : 'object'
  const source = type === 'string' ? Array.from(value) : type === 'object' ? Object.entries(value) : value
  return { ok: true, artifact: args.handle, path: args.path || [], type,
    offset, total: source.length, nextOffset: offset + limit < source.length ? offset + limit : null,
    data: type === 'string' ? source.slice(offset, offset + limit).join('') : type === 'object' ? Object.fromEntries(source.slice(offset, offset + limit)) : source.slice(offset, offset + limit) }
}
