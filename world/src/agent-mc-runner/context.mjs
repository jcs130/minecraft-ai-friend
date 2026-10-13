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
  const boundary = history.findLastIndex(message => message.role === 'user' && message.content.startsWith('HOST TASK BOUNDARY:'))
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

export function readArtifact(artifacts, args) {
  let value = artifacts.get(args.handle)
  if (value === undefined) return { ok: false, code: 'artifact_not_found' }
  for (const key of args.path || []) {
    if (!(typeof key === 'string' || Number.isSafeInteger(key)) || ['__proto__', 'constructor', 'prototype'].includes(key)) return { ok: false, code: 'artifact_path_invalid' }
    if (!value || !Object.hasOwn(Object(value), key)) return { ok: false, code: 'artifact_field_not_found' }
    value = value[key]
  }
  if (args.offset === undefined && args.limit === undefined) return value
  if (!Array.isArray(value) && typeof value !== 'string') return { ok: false, code: 'artifact_range_requires_array_or_string' }
  const offset = args.offset ?? 0, limit = args.limit ?? 1000
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) return { ok: false, code: 'artifact_range_invalid' }
  const source = typeof value === 'string' ? Array.from(value) : value
  return { ok: true, artifact: args.handle, path: args.path || [], type: typeof value === 'string' ? 'string' : 'array',
    offset, total: source.length, nextOffset: offset + limit < source.length ? offset + limit : null,
    data: typeof value === 'string' ? source.slice(offset, offset + limit).join('') : source.slice(offset, offset + limit) }
}
