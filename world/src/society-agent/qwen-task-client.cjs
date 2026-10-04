'use strict'

// Native QwenPaw console tasks, not direct provider calls. An uncertain POST is
// never replayed. The journal belongs to one role + one persistent life session.
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024
const MAX_TEXT_BYTES = 32768
const TERMINAL = new Set(['completed', 'failed'])

function codedError (code, message) {
  return Object.assign(new Error(message), { code })
}

/** Last completed native assistant message; never fall back to narration. */
function extractFinalText (result) {
  if (!result || result.status !== 'completed' || !Array.isArray(result.output)) {
    throw codedError('INVALID_NATIVE_OUTPUT', 'Missing completed native output')
  }
  let answer = null
  for (const item of result.output) {
    if (item?.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed') continue
    if (!Array.isArray(item.content)) throw codedError('INVALID_NATIVE_OUTPUT', 'Invalid assistant content')
    answer = item.content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n').trim()
  }
  if (!answer) throw codedError('EMPTY_FINAL_TEXT', 'No completed final assistant text')
  if (/^Max iterations \([0-9]+\) reached$/.test(answer) || /^Doom loop: agent stuck after [0-9]+ consecutive repetitions$/.test(answer)) {
    throw codedError('NATIVE_FRAMEWORK_FAILURE', 'Native framework ended without a final answer')
  }
  if (Buffer.byteLength(answer, 'utf8') > MAX_TEXT_BYTES) throw codedError('FINAL_TEXT_TOO_LARGE', 'Final answer exceeds the text limit')
  return answer
}

function positive (value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw codedError('INVALID_CONFIG', `${name} must be a positive integer`)
  return value
}

function normalizeBaseURL (value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw codedError('INVALID_CONFIG', 'baseURL must be an HTTP(S) API URL without credentials or query')
  }
  url.pathname = url.pathname === '/' ? '/api' : url.pathname.replace(/\/+$/, '')
  return url.href.replace(/\/$/, '')
}

/**
 * run(prompt) returns {status,text,taskId,intentId,agentId,sessionId,resumed,error?}.
 * Nonterminal persisted records take precedence over a new prompt: reconnects
 * resume the old task; missing task IDs remain unknown for operator reconciliation.
 * Options beyond the four identity fields configure bounded polling/test transport.
 */
class QwenTaskClient {
  constructor ({ baseURL, agentId, sessionId, journalPath, userId = 'maw-controller', taskTimeoutSeconds = 180, pollIntervalMs = 1000, requestTimeoutMs = 15000, pollGraceMs = 5000, fetchImpl = globalThis.fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(agentId || '')) throw codedError('INVALID_CONFIG', 'Invalid agentId')
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 256) throw codedError('INVALID_CONFIG', 'Invalid sessionId')
    if (typeof userId !== 'string' || !userId.trim() || userId.length > 256) throw codedError('INVALID_CONFIG', 'Invalid userId')
    if (typeof journalPath !== 'string' || !journalPath.trim()) throw codedError('INVALID_CONFIG', 'journalPath is required')
    if (typeof fetchImpl !== 'function') throw codedError('INVALID_CONFIG', 'A fetch implementation is required')
    this.baseURL = normalizeBaseURL(baseURL)
    this.agentId = agentId
    this.sessionId = sessionId
    this.userId = userId
    this.journalPath = path.resolve(journalPath)
    this.lockPath = this.journalPath + '.lock'
    this.taskTimeoutSeconds = positive(taskTimeoutSeconds, 'taskTimeoutSeconds')
    this.pollIntervalMs = positive(pollIntervalMs, 'pollIntervalMs')
    this.requestTimeoutMs = positive(requestTimeoutMs, 'requestTimeoutMs')
    this.pollGraceMs = positive(pollGraceMs, 'pollGraceMs')
    this.fetch = fetchImpl
    this.now = now
    this.sleep = sleep
    this.inFlight = false
  }

  _identity () {
    return { baseURL: this.baseURL, agentId: this.agentId, sessionId: this.sessionId, userId: this.userId }
  }

  _load () {
    if (!fs.existsSync(this.journalPath)) return { schemaVersion: 1, identity: this._identity(), runs: [] }
    if (fs.statSync(this.journalPath).size > MAX_JOURNAL_BYTES) throw codedError('JOURNAL_TOO_LARGE', 'Journal limit reached; archive it explicitly')
    const journal = JSON.parse(fs.readFileSync(this.journalPath, 'utf8'))
    if (journal.schemaVersion !== 1 || !Array.isArray(journal.runs) || Object.entries(this._identity()).some(([key, value]) => journal.identity?.[key] !== value)) {
      throw codedError('JOURNAL_IDENTITY_MISMATCH', 'Journal belongs to a different API, role, user or session')
    }
    for (const record of journal.runs) {
      if (!record || !['intent', 'submitted', 'completed', 'failed'].includes(record.phase) || typeof record.intentId !== 'string' || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) {
        throw codedError('INVALID_JOURNAL', 'Malformed intent record requires reconciliation')
      }
      if (record.phase === 'submitted' && (!/^task-[A-Za-z0-9_-]{1,128}$/.test(record.taskId || '') || !Number.isFinite(record.pollDeadlineAt))) {
        throw codedError('INVALID_JOURNAL', 'Submitted task lacks a valid ID or polling deadline')
      }
    }
    if (journal.runs.filter(r => !TERMINAL.has(r.phase)).length > 1) throw codedError('INVALID_JOURNAL', 'Multiple unfinished intents require reconciliation')
    return journal
  }

  _save (journal) {
    const bytes = Buffer.from(JSON.stringify(journal, null, 2) + '\n')
    if (bytes.length > MAX_JOURNAL_BYTES) throw codedError('JOURNAL_TOO_LARGE', 'Journal limit reached; archive it explicitly')
    const tmp = this.journalPath + '.' + randomUUID() + '.tmp'
    let fd
    try {
      fd = fs.openSync(tmp, 'wx', 0o600)
      fs.writeFileSync(fd, bytes)
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = undefined
      fs.renameSync(tmp, this.journalPath)
      // Windows does not support opening every directory as an fsync-able fd.
      let dir
      try { dir = fs.openSync(path.dirname(this.journalPath), 'r'); fs.fsyncSync(dir) } catch (err) {
        if (!['EPERM', 'EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EBADF'].includes(err.code)) throw err
      } finally { if (dir !== undefined) fs.closeSync(dir) }
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    }
  }

  _lock () {
    fs.mkdirSync(path.dirname(this.journalPath), { recursive: true })
    const token = JSON.stringify({ pid: process.pid, nonce: randomUUID() })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx', 0o600)
        try { fs.writeFileSync(fd, token); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
        return () => {
          if (fs.readFileSync(this.lockPath, 'utf8') !== token) throw codedError('JOURNAL_LOCK_CHANGED', 'Journal lock ownership changed')
          fs.unlinkSync(this.lockPath)
        }
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
        const oldToken = fs.readFileSync(this.lockPath, 'utf8')
        let owner
        try { owner = JSON.parse(oldToken) } catch { throw codedError('JOURNAL_LOCKED', 'Unrecognized lock requires reconciliation') }
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw codedError('JOURNAL_LOCKED', 'Invalid lock owner')
        try { process.kill(owner.pid, 0); throw codedError('JOURNAL_LOCKED', 'Another controller owns this session journal') } catch (check) {
          if (check.code !== 'ESRCH') throw check
        }
        // Reclaim only a demonstrably dead local PID, while the token is intact.
        if (fs.readFileSync(this.lockPath, 'utf8') !== oldToken) throw codedError('JOURNAL_LOCKED', 'Lock owner changed')
        fs.unlinkSync(this.lockPath)
      }
    }
    throw codedError('JOURNAL_LOCKED', 'Could not acquire the session journal')
  }

  async _request (method, route, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    timer.unref?.()
    try {
      const response = await this.fetch(this.baseURL + '/agents/' + encodeURIComponent(this.agentId) + route, {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      const chunks = []
      let length = 0
      if (response.body) {
        for await (const chunk of response.body) {
          const bytes = Buffer.from(chunk)
          length += bytes.length
          if (length > MAX_RESPONSE_BYTES) { controller.abort(); throw codedError('RESPONSE_TOO_LARGE', 'Native API response exceeds the byte limit') }
          chunks.push(bytes)
        }
      }
      let data
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
        throw codedError('INVALID_RESPONSE_JSON', `Native API returned invalid JSON (HTTP ${response.status})`)
      }
      return { status: response.status, data }
    } finally { clearTimeout(timer) }
  }

  _outcome (record, status, resumed, text = '', error) {
    return { status, text, taskId: record.taskId || null, intentId: record.intentId, agentId: this.agentId, sessionId: this.sessionId, resumed, ...(error ? { error } : {}) }
  }

  /** Read-only local health projection. No prompt, answer, or provider secrets. */
  status () {
    const journal = this._load()
    const record = journal.runs.find(r => !TERMINAL.has(r.phase)) || journal.runs.at(-1)
    if (!record) return { agentId: this.agentId, sessionId: this.sessionId, status: 'idle', taskId: null, intentId: null, runCount: 0 }
    const status = TERMINAL.has(record.phase)
      ? record.phase
      : record.phase === 'intent' ? 'unknown' : record.error?.code === 'POLL_TIMEOUT' ? 'timeout' : record.error ? 'unknown' : 'running'
    return {
      agentId: this.agentId, sessionId: this.sessionId, status, taskId: record.taskId || null, intentId: record.intentId,
      createdAt: record.createdAt, updatedAt: record.updatedAt, pollDeadlineAt: record.pollDeadlineAt ?? null,
      runCount: journal.runs.length,
      ...(record.error ? { error: { code: record.error.code, message: record.error.message, ...(record.error.httpStatus ? { httpStatus: record.error.httpStatus } : {}) } } : {})
    }
  }

  _mark (journal, record, phase, error, text) {
    record.phase = phase
    record.updatedAt = this.now()
    if (error) record.error = error
    else delete record.error
    if (text !== undefined) record.text = text
    this._save(journal)
  }

  async _poll (journal, record, resumed) {
    while (true) {
      let response
      try { response = await this._request('GET', '/console/chat/task/' + encodeURIComponent(record.taskId)) } catch {
        const error = { code: 'POLL_UNKNOWN', message: 'Could not read the existing native task; it has not been resubmitted' }
        this._mark(journal, record, 'submitted', error)
        return this._outcome(record, 'unknown', resumed, '', error)
      }
      if (response.status !== 200) {
        const error = { code: response.status === 404 ? 'NATIVE_TASK_NOT_FOUND' : 'POLL_HTTP_ERROR', message: `Existing native task query returned HTTP ${response.status}; no resubmission`, httpStatus: response.status }
        this._mark(journal, record, 'submitted', error)
        return this._outcome(record, 'unknown', resumed, '', error)
      }
      const data = response.data
      if (data?.status === 'finished') {
        const result = data.result
        if (result?.status === 'failed' || result?.status === 'cancelled') {
          const timeout = result.error?.code === 'timeout'
          const cancelled = result.status === 'cancelled' || result.error?.message === 'Task cancelled'
          const error = { code: timeout ? 'NATIVE_TASK_TIMEOUT' : cancelled ? 'NATIVE_TASK_CANCELLED' : 'NATIVE_TASK_FAILED', message: timeout ? 'Native task timed out' : cancelled ? 'Native task was cancelled' : 'Native task failed; inspect the private QwenPaw task log' }
          // A bounded code can drive backoff without leaking provider messages,
          // credentials, temporary dump paths, or prompt text to public status.
          if (/^[A-Za-z0-9_-]{1,64}$/.test(result.error?.code || '')) error.nativeCode = result.error.code
          this._mark(journal, record, 'failed', error)
          return this._outcome(record, 'failed', resumed, '', error)
        }
        if (result?.status !== 'completed' || result.session_id !== this.sessionId) {
          const error = { code: 'NATIVE_RESULT_MISMATCH', message: 'Terminal native result is incomplete or belongs to a different session' }
          this._mark(journal, record, 'submitted', error)
          return this._outcome(record, 'unknown', resumed, '', error)
        }
        let text
        try { text = extractFinalText(result) } catch (err) {
          const error = { code: err.code, message: err.message }
          this._mark(journal, record, 'failed', error)
          return this._outcome(record, 'failed', resumed, '', error)
        }
        this._mark(journal, record, 'completed', null, text)
        return this._outcome(record, 'completed', resumed, text)
      }
      if (data?.status !== 'running') {
        const error = { code: 'UNKNOWN_NATIVE_STATUS', message: 'Native task did not report running or finished' }
        this._mark(journal, record, 'submitted', error)
        return this._outcome(record, 'unknown', resumed, '', error)
      }
      if (this.now() >= record.pollDeadlineAt) {
        const error = { code: 'POLL_TIMEOUT', message: 'Polling deadline elapsed; existing task ID retained without cancelling or resubmitting' }
        this._mark(journal, record, 'submitted', error)
        return this._outcome(record, 'timeout', resumed, '', error)
      }
      await this.sleep(Math.min(this.pollIntervalMs, Math.max(1, record.pollDeadlineAt - this.now())))
    }
  }

  async run (prompt) {
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 262144) throw codedError('INVALID_PROMPT', 'A nonempty prompt within 256 KiB is required')
    if (this.inFlight) throw codedError('CLIENT_BUSY', 'This client already has an in-flight run')
    this.inFlight = true
    let unlock
    try {
      unlock = this._lock()
      const journal = this._load()
      const pending = journal.runs.find(r => !TERMINAL.has(r.phase))
      if (pending) {
        if (pending.taskId) return await this._poll(journal, pending, true)
        return this._outcome(pending, 'unknown', true, '', { code: 'SUBMISSION_UNKNOWN', message: 'A prior persisted intent has no task ID; reconcile it before any new submission' })
      }
      const record = {
        intentId: randomUUID(), phase: 'intent', createdAt: this.now(), updatedAt: this.now(),
        promptSha256: createHash('sha256').update(prompt, 'utf8').digest('hex'), promptBytes: Buffer.byteLength(prompt),
        requestedTimeoutSeconds: this.taskTimeoutSeconds, taskId: null
      }
      journal.runs.push(record)
      // Persist before the only POST. Even a crash between this write and the
      // transport call is treated as uncertain rather than risking duplication.
      this._save(journal)
      let response
      try {
        response = await this._request('POST', '/console/chat/task', {
          session_id: this.sessionId, user_id: this.userId, channel: 'console', timeout: this.taskTimeoutSeconds,
          input: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          request_context: { subagent_allowed_tools: [], maw_intent_id: record.intentId }
        })
      } catch {
        const error = { code: 'SUBMISSION_UNKNOWN', message: 'Native task submission outcome is unknown; no automatic retry' }
        this._mark(journal, record, 'intent', error)
        return this._outcome(record, 'unknown', false, '', error)
      }
      if ([400, 401, 403, 404, 503].includes(response.status)) {
        const error = { code: 'SUBMISSION_REJECTED', message: `Native API rejected submission (HTTP ${response.status})`, httpStatus: response.status }
        this._mark(journal, record, 'failed', error)
        return this._outcome(record, 'failed', false, '', error)
      }
      if (response.status !== 200 || !/^task-[A-Za-z0-9_-]{1,128}$/.test(response.data?.task_id || '')) {
        const error = { code: response.status === 409 ? 'SESSION_BUSY' : 'SUBMISSION_UNKNOWN', message: `No trustworthy native task receipt (HTTP ${response.status}); no retry`, httpStatus: response.status }
        this._mark(journal, record, 'intent', error)
        return this._outcome(record, 'unknown', false, '', error)
      }
      record.taskId = response.data.task_id
      const echoed = response.data.timeout
      const timeout = Number.isSafeInteger(echoed) && echoed > 0 ? Math.min(echoed, this.taskTimeoutSeconds) : this.taskTimeoutSeconds
      record.pollDeadlineAt = this.now() + timeout * 1000 + this.pollGraceMs
      try { this._mark(journal, record, 'submitted') } catch {
        // The caller receives the ID but must not dispatch another decision if
        // durable handoff failed. The prior on-disk intent still blocks replay.
        return this._outcome(record, 'unknown', false, '', { code: 'TASK_RECEIPT_NOT_DURABLE', message: 'Native task was accepted but its ID could not be persisted' })
      }
      return await this._poll(journal, record, false)
    } finally {
      try { unlock?.() } finally { this.inFlight = false }
    }
  }
}

module.exports = { QwenTaskClient, extractFinalText }
