'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { projectNativeModelError } = require('../society-agent/model-failure-policy.cjs')

const ENDPOINT = 'https://coding.dashscope.aliyuncs.com/v1/chat/completions'
function append (file, value) {
  const fd = fs.openSync(file, 'a', 0o600)
  try { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); fs.fsyncSync(fd) }
  finally { fs.closeSync(fd) }
}
function reviewedDiscardedResponses (lines) {
  const released = new Set()
  for (const audit of lines.filter(row => row.kind === 'operator_audit')) {
    const intents = lines.filter(row => row.kind === 'intent' && row.requestId === audit.requestId)
    const halts = lines.filter(row => row.kind === 'halt' && row.requestId === audit.requestId)
    if (intents.length !== 1 || released.has(audit.requestId) ||
        lines.some(row => row.kind === 'result' && row.requestId === audit.requestId) ||
        halts.length > 1 || halts.length === 1 && (halts[0].code !== 'MODEL_TRANSPORT_UNKNOWN' ||
          audit.originalHaltSha256 !== createHash('sha256').update(JSON.stringify(halts[0])).digest('hex')) ||
        audit.disposition !== 'discard_unreturned_response_allow_new_requests' ||
        audit.originalRecordSha256 !== createHash('sha256').update(JSON.stringify(intents[0])).digest('hex') ||
        !path.isAbsolute(audit.evidencePath ?? '')) throw Error('NEKO_MODEL_AUDIT_INVALID')
    const bytes = fs.readFileSync(audit.evidencePath)
    if (bytes.length > 1048576 || createHash('sha256').update(bytes).digest('hex') !== audit.evidenceSha256) throw Error('NEKO_MODEL_AUDIT_EVIDENCE_INVALID')
    const evidence = JSON.parse(bytes)
    if (evidence.requestId !== audit.requestId || evidence.processExited !== true ||
        evidence.gameCommandsAfterIntent !== 0 || evidence.scope !== 'model_text_discarded_never_executed') throw Error('NEKO_MODEL_AUDIT_EVIDENCE_INVALID')
    released.add(audit.requestId)
  }
  return released
}
class CodingPlanBridge {
  constructor ({ journalPath, maxCalls = 24, minIntervalMs = 4000, apiKey, fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    if (!path.isAbsolute(journalPath || '') || !apiKey || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 1280 || minIntervalMs < 0) throw Error('NEKO_TRIAL_CONFIG_INVALID')
    this.file = journalPath; this.maxCalls = maxCalls; this.interval = minIntervalMs
    this.key = apiKey; this.fetch = fetchImpl; this.sleep = sleep; this.busy = false; this.last = 0
    this.tail = Promise.resolve(); this.pending = 0; this.closed = false
    fs.mkdirSync(path.dirname(journalPath), { recursive: true })
    if (fs.existsSync(journalPath) && fs.statSync(journalPath).size > 16 * 1024 * 1024) throw Error('NEKO_MODEL_JOURNAL_TOO_LARGE')
    const lines = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []
    this.count = lines.filter(row => row.kind === 'intent').length
    const finished = new Set(lines.filter(row => row.kind === 'result').map(row => row.requestId))
    const discarded = reviewedDiscardedResponses(lines)
    this.blocked = lines.some(row => row.kind === 'intent' && !finished.has(row.requestId) && !discarded.has(row.requestId)) ||
      lines.some(row => row.kind === 'halt' && !discarded.has(row.requestId))
  }
  status () { return { provider: 'aliyun-codingplan-direct', model: 'qwen3.7-plus', calls: this.count, maxCalls: this.maxCalls,
    inFlight: this.busy || this.pending > 0, queuedCalls: Math.max(0, this.pending - (this.busy ? 1 : 0)), blocked: this.blocked, closed: this.closed } }
  close () { this.closed = true }
  async request (turns, systemMessage) {
    if (this.closed) throw Error('NEKO_MODEL_CONNECTION_CLOSED')
    if (this.pending >= 8) throw Error('NEKO_MODEL_QUEUE_FULL')
    const input = structuredClone(turns), previous = this.tail
    let release
    this.tail = new Promise(resolve => { release = resolve }); this.pending++
    try {
      await previous
      if (this.closed) throw Error('NEKO_MODEL_CONNECTION_CLOSED')
      return await this.requestNow(input, systemMessage)
    } finally { this.pending--; release() }
  }
  async requestNow (turns, systemMessage) {
    if (this.blocked) throw Error('NEKO_MODEL_RECONCILIATION_REQUIRED')
    if (this.busy) throw Error('NEKO_MODEL_BUSY')
    if (this.count >= this.maxCalls) throw Error('NEKO_TRIAL_MODEL_BUDGET_REACHED')
    if (!Array.isArray(turns) || typeof systemMessage !== 'string') throw Error('NEKO_MODEL_MESSAGES_INVALID')
    const messages = [{ role: 'system', content: systemMessage }, ...turns].map((row, index) => {
      if (!['system', 'user', 'assistant'].includes(row.role) || typeof row.content !== 'string') throw Error('NEKO_MODEL_MESSAGES_INVALID')
      return index === 0 ? { role: 'system', content: row.content } :
        { role: row.role === 'system' ? 'user' : row.role, content: row.role === 'system' ? 'GAME/TOOL CONTEXT: ' + row.content : row.content }
    })
    const pack = { model: 'qwen3.7-plus', messages, stream: false, enable_thinking: false, max_tokens: 1400 }
    const payload = JSON.stringify(pack)
    if (Buffer.byteLength(payload) > 262144) throw Error('NEKO_MODEL_PROMPT_TOO_LARGE')
    this.busy = true
    const requestId = randomUUID()
    try {
      await this.sleep(Math.max(0, this.interval - (Date.now() - this.last)))
      append(this.file, { kind: 'intent', requestId, model: pack.model, promptBytes: Buffer.byteLength(payload), promptSha256: createHash('sha256').update(payload).digest('hex') })
      this.count++; this.last = Date.now()
      let response
      try {
        response = await this.fetch(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.key }, body: payload })
      } catch {
        this.blocked = true; append(this.file, { kind: 'halt', requestId, code: 'MODEL_TRANSPORT_UNKNOWN', retryAutomatically: false })
        throw Error('NEKO_MODEL_TRANSPORT_UNKNOWN')
      }
      const parts = []; let size = 0
      try {
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > 512 * 1024) throw Error('response too large')
          parts.push(chunk)
        }
        const data = JSON.parse(Buffer.concat(parts).toString('utf8'))
        const text = data.choices?.[0]?.message?.content
        if (!response.ok || typeof text !== 'string' || !text.trim() || data.choices[0].finish_reason === 'length') {
          const detail = projectNativeModelError({ errorDetails: { httpStatus: response.status, body: data } })
          append(this.file, { kind: 'result', requestId, ok: false, httpStatus: response.status, error: detail, retryAutomatically: false })
          this.blocked = true; append(this.file, { kind: 'halt', requestId, code: 'MODEL_RESPONSE_REJECTED', retryAutomatically: false })
          throw Error('NEKO_MODEL_RESPONSE_REJECTED')
        }
        append(this.file, { kind: 'result', requestId, ok: true, httpStatus: response.status, model: data.model, responseId: data.id,
          usage: data.usage, finishReason: data.choices[0].finish_reason, text })
        console.log('NEKO_MODEL ' + JSON.stringify({ requestId, model: data.model, usage: data.usage, calls: this.count }))
        return text
      } catch (error) {
        if (!this.blocked) { this.blocked = true; append(this.file, { kind: 'halt', requestId, code: 'MODEL_RESPONSE_UNKNOWN', retryAutomatically: false }) }
        throw Error(error.message === 'NEKO_MODEL_RESPONSE_REJECTED' ? error.message : 'NEKO_MODEL_RESPONSE_UNKNOWN')
      }
    } finally { this.busy = false }
  }
}
let shared
function fromEnvironment () {
  if (!shared) {
    const file = process.env.MAW_NEKO_CODINGPLAN_CONFIG
    if (!file || !path.isAbsolute(file)) throw Error('NEKO_MODEL_CONFIG_MISSING')
    const config = JSON.parse(fs.readFileSync(file, 'utf8'))
    shared = new CodingPlanBridge({ ...config, apiKey: process.env.MAW_NEKO_CODINGPLAN_API_KEY })
  }
  return shared
}
module.exports = { CodingPlanBridge, fromEnvironment, reviewedDiscardedResponses }
