'use strict'

// Installed on mc-agent-neko's existing Mineflayer bot, before login/spawn.
// This module does not create a connection or invoke a model.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const { attachModAgentClient } = require('../neoforge-handshake/mod-agent-client.cjs')
const { validateModArguments } = require('../neoforge-handshake/mod-call-client.cjs')
const { outboundGameMutation } = require('../society-agent/action-deadline.cjs')

const ID = /^[A-Za-z0-9_.:-]{1,96}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const scopes = new AsyncLocalStorage()
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value
const fingerprint = (id, args) => crypto.createHash('sha256').update(JSON.stringify([id, canonical(args)])).digest('hex')
const clone = value => value === undefined ? null : structuredClone(value)
const failure = (code, extra = {}) => ({ ok: false, code, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false, ...extra })
const unknown = result => result?.outcomeUnknown === true || result?.outcomeKnown === false || result?.outcome === 'unknown'

class NativeLedger {
  constructor (directory, account) {
    if (!directory || !path.isAbsolute(directory) || !/^[A-Za-z0-9_]{1,16}$/.test(account || '')) throw Error('NEKO_NATIVE_LEDGER_CONFIG_INVALID')
    this.directory = path.join(directory, account.toLowerCase())
    fs.mkdirSync(this.directory, { recursive: true })
    this.lockPath = path.join(this.directory, 'writer.lock')
    this.nonce = crypto.randomUUID()
    const lock = fs.openSync(this.lockPath, 'wx') // A crash requires an operator to reconcile, never silent unlock/replay.
    try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce: this.nonce, account })); fs.fsyncSync(lock) } finally { fs.closeSync(lock) }
    this.file = path.join(this.directory, 'native-actions.jsonl')
    this.records = new Map()
    this.audits = new Map()
    this.unresolvedById = new Map()
    this.broken = false
    this.playerUuid = null
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 16 * 1024 * 1024) throw Error('NEKO_NATIVE_LEDGER_REVIEW_REQUIRED')
        const text = fs.readFileSync(this.file, 'utf8')
        if (text && !text.endsWith('\n')) throw Error('NEKO_NATIVE_LEDGER_INCOMPLETE')
        for (const line of text.split('\n').filter(Boolean)) {
          const record = JSON.parse(line)
          if (!ID.test(record.callId || '') || !UUID.test(record.playerUuid || '') || !['intent', 'result', 'operator_audit'].includes(record.kind)) throw Error('NEKO_NATIVE_LEDGER_INVALID')
          if (this.playerUuid && this.playerUuid !== record.playerUuid) throw Error('NEKO_NATIVE_LEDGER_IDENTITY_CHANGED')
          this.playerUuid = record.playerUuid
          const prev = this.records.get(record.callId)
          if (record.kind === 'operator_audit') {
            this.validateAudit(record)
            this.audits.set(record.callId, record)
          } else if (record.kind === 'intent') {
            if (prev) throw Error('NEKO_NATIVE_LEDGER_DUPLICATE_INTENT')
            this.records.set(record.callId, record)
          } else {
            if (!prev || prev.kind !== 'intent' || prev.fingerprint !== record.fingerprint) throw Error('NEKO_NATIVE_LEDGER_RESULT_INVALID')
            this.records.set(record.callId, record)
          }
        }
      }
      for (const record of this.records.values()) this.updateUnresolved(record)
    } catch (error) { this.close(); throw error }
  }

  append (record) {
    try {
      const persisted = { schemaVersion: 1, at: new Date().toISOString(), ...record }
      const fd = fs.openSync(this.file, 'a')
      try { fs.writeFileSync(fd, JSON.stringify(persisted) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      this.records.set(record.callId, clone(persisted))
      this.updateUnresolved(persisted)
      this.playerUuid = record.playerUuid
    } catch (error) { this.broken = true; throw error }
  }

  updateUnresolved (record) {
    if (!this.audits.has(record.callId) && (record.kind === 'intent' || unknown(record.result))) this.unresolvedById.set(record.callId, { callId: record.callId, id: record.id, playerUuid: record.playerUuid })
    else this.unresolvedById.delete(record.callId)
  }
  validateAudit (audit) {
    const original = this.records.get(audit.callId)
    if (this.audits.has(audit.callId) || original?.kind !== 'result' || !unknown(original.result) ||
        audit.playerUuid !== original.playerUuid || audit.fingerprint !== original.fingerprint || audit.id !== original.id ||
        audit.originalRecordSha256 !== crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex') ||
        audit.disposition !== 'release_new_actions_keep_unknown' || audit.retryAutomatically !== false ||
        !path.isAbsolute(audit.evidencePath || '') || !/^[a-f0-9]{64}$/.test(audit.evidenceSha256 || '') ||
        typeof audit.summary !== 'string' || !audit.summary.trim() || audit.summary.length > 2000) throw Error('NEKO_NATIVE_AUDIT_INVALID')
  }
  // Operator-only, offline entry point. Not exposed through Agent tools or WS.
  // The original result remains unknown and every old callId remains cached.
  auditRelease ({ callId, fingerprint, evidencePath, summary }) {
    const original = this.records.get(callId), bytes = fs.readFileSync(evidencePath)
    const evidence = JSON.parse(bytes.toString('utf8'))
    if (evidence.playerUuid !== original?.playerUuid || evidence.callId !== callId || evidence.fingerprint !== fingerprint) throw Error('NEKO_NATIVE_AUDIT_EVIDENCE_MISMATCH')
    const record = { schemaVersion: 1, at: new Date().toISOString(), kind: 'operator_audit', callId,
      playerUuid: original.playerUuid, id: original.id, fingerprint, disposition: 'release_new_actions_keep_unknown',
      originalRecordSha256: crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex'),
      evidencePath, evidenceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), summary, retryAutomatically: false }
    this.validateAudit(record)
    const fd = fs.openSync(this.file, 'a')
    try { fs.writeFileSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    this.audits.set(callId, record); this.updateUnresolved(original)
    return clone(record)
  }
  unresolved () { return clone([...this.unresolvedById.values()]) }
  close () {
    if (this.closed) return
    this.closed = true
    // Only remove our own precise lock; never remove another process's marker.
    try { if (JSON.parse(fs.readFileSync(this.lockPath, 'utf8')).nonce === this.nonce) fs.unlinkSync(this.lockPath) } catch {}
  }
}

function attachNekoNative (bot, { ledgerDir, account = bot.username, attach = attachModAgentClient } = {}) {
  if (bot.mawNative) return bot.mawNative
  const ledger = new NativeLedger(ledgerDir, account)
  let sdk
  try { sdk = attach(bot) } catch (error) { ledger.close(); throw error }
  let ended = false, epoch = 0, active = null, agent = null, blockedPackets = 0
  const originalWrite = bot._client.write
  const identity = () => UUID.test(bot._client.uuid || '') ? bot._client.uuid.toLowerCase() : null
  const blocked = () => ledger.broken || ledger.unresolvedById.size > (active ? 1 : 0) || sdk.callStatus().mutationBlocked
  const actionChannel = data => typeof data?.channel === 'string' && /(?:^maw_agent:.*_action$|^mcagent:)/.test(data.channel)
  bot._client.write = function (name, data) {
    const scope = scopes.getStore()
    const gameWrite = outboundGameMutation(name, data) || (name === 'custom_payload' && actionChannel(data))
    if (gameWrite && ((active && scope !== active) || blocked() || (scope && (scope !== active || scope.closed)))) {
      blockedPackets++
      return false // Keepalive, position and read queries remain live; no noisy game chat.
    }
    return originalWrite.call(this, name, data)
  }
  const contextChanged = () => { epoch++ }
  bot.on('spawn', contextChanged); bot.on('respawn', contextChanged)
  const bodyBusy = () => !!(agent?.actions?.executing || agent?.supervised_skill || bot._bodyOwner || bot._newActionActive ||
    bot.targetDigBlock || bot.pvp?.target || bot.pathfinder?.isMoving?.() || bot.pathfinder?.isMining?.() || bot.pathfinder?.isBuilding?.() ||
    bot._eatingUntil > Date.now() || bot.usingHeldItem || Object.values(bot.controlStates || {}).some(Boolean))
  const metadata = () => ({ schemaVersion: 1, playerUuid: identity(), account: bot.username, epoch,
    connected: !ended && !!identity(), inFlight: active?.callId ?? null, mutationBlocked: blocked(),
    unresolved: ledger.unresolved(), blockedPackets, retryAutomatically: false, sdk: sdk.callStatus() })

  async function request (message) {
    const action = message?.action
    if (action === 'status') return { ok: true, ...metadata(), contract: sdk.contract() }
    if (action === 'list') {
      const catalog = sdk.operations()
      return { ...metadata(), ok: catalog.ok, operationCount: catalog.operationCount,
        operations: catalog.operations.map(({ id, readOnly, description }) => ({ id, readOnly, description })) }
    }
    if (action === 'explain') return typeof message.id === 'string' && ID.test(message.id) ?
      { ...metadata(), ...sdk.operations(message.id) } : failure('native_id_required')
    if (action === 'result') {
      const record = ledger.records.get(message.callId)
      if (!record) return failure('native_call_not_found', metadata())
      return { ...metadata(), ok: record.kind === 'result', id: record.id, callId: record.callId,
        fingerprint: record.fingerprint, result: clone(record.result), operatorAudit: clone(ledger.audits.get(message.callId)), outcomeUnknown: record.kind === 'intent' || unknown(record.result) }
    }
    if (action !== 'call') return failure('native_action_invalid')
    const { id, args = {} } = message
    try { validateModArguments(id, args) } catch (error) { return failure(error.code || error.message, { field: error.field ?? null }) }
    const definition = sdk.operations(id).operation
    const playerUuid = identity(), observedEpoch = epoch
    if (ended || !playerUuid) return failure('native_player_not_ready')
    if (ledger.playerUuid && ledger.playerUuid !== playerUuid) return failure('native_ledger_identity_mismatch')
    // Classification is always taken from the installed catalog, never from the caller.
    if (definition.readOnly) {
      try {
        const result = await sdk.call(id, args)
        return { ok: result?.ok !== false, readOnly: true, id, playerUuid, epoch: observedEpoch, result: clone(result), retryAutomatically: false }
      } catch (error) { return failure(error.code || error.message, { id, readOnly: true, playerUuid }) }
    }
    const callId = message.callId
    if (!ID.test(callId || '')) return failure('native_mutation_call_id_required')
    const hash = fingerprint(id, args), previous = ledger.records.get(callId)
    if (previous) {
      if (previous.fingerprint !== hash) return failure('native_call_id_conflict', { callId, id })
      return { ...metadata(), callId, id, replayed: true, ok: previous.kind === 'result' && previous.result?.ok === true,
        outcomeUnknown: previous.kind === 'intent' || unknown(previous.result), result: clone(previous.result), fingerprint: hash }
    }
    if (active || blocked()) return failure('native_mutation_blocked', { ...metadata(), callId, id })
    if (bodyBusy()) return failure('native_body_busy', { ...metadata(), callId, id })
    const frame = { callId, id, closed: false }
    active = frame // Synchronous reservation, before durable intent and before any native dispatch.
    const record = { callId, id, args: clone(args), fingerprint: hash, playerUuid, epoch: observedEpoch }
    let result
    try {
      ledger.append({ ...record, kind: 'intent' })
      try {
        result = await scopes.run(frame, () => sdk.call(id, args))
        if (ended || identity() !== playerUuid || epoch !== observedEpoch) result = failure('native_context_changed', { outcomeKnown: false, outcomeUnknown: true, receipt: clone(result) })
      } catch (error) {
        result = failure(error.code || error.message, { outcomeKnown: error.outcomeKnown === true,
          outcomeUnknown: error.outcomeKnown !== true || error.outcomeUnknown === true, receipt: clone(error.receipt) })
      }
      ledger.append({ ...record, kind: 'result', result: clone(result) })
      return { ok: result?.ok === true, id, callId, playerUuid, epoch: observedEpoch, fingerprint: hash,
        readOnly: false, outcomeUnknown: unknown(result), result: clone(result), retryAutomatically: false }
    } catch {
      return failure('native_ledger_io_failure', { callId, id, playerUuid, outcomeKnown: false, outcomeUnknown: true })
    } finally {
      frame.closed = true; active = null
      if (ended) ledger.close()
    }
  }
  const runtime = { sdk, request, status: metadata, bindAgent (value) { agent = value },
    bodyBlocked: () => active !== null || blocked(),
    close () {
      if (ended) return
      ended = true; epoch++
      bot.off('spawn', contextChanged); bot.off('respawn', contextChanged)
      sdk.detach()
      if (!active) ledger.close()
    } }
  bot.mawNative = runtime
  bot.on('end', runtime.close)
  return runtime
}

// Only the requesting WebSocket receives a result. Never broadcast or mirror to game chat.
async function handleNativeMessage (agent, socket, message) {
  if (message?.type !== 'native_mod') return false
  const requestId = message.requestId
  if (!ID.test(requestId || '')) return true
  let result
  const bot = agent?.bot, actor = bot?._client?.uuid?.toLowerCase() ?? null
  const runtime = bot?.mawNative
  try {
    if (message.schemaVersion !== 1) result = failure('native_schema_version_invalid')
    else if (!runtime) result = failure('native_adapter_not_enabled')
    else { runtime.bindAgent(agent); result = await runtime.request(message) }
  } catch (error) { result = failure(error.code || 'native_adapter_error', { outcomeKnown: false, outcomeUnknown: true }) }
  if (socket?.readyState === 1) socket.send(JSON.stringify({ ...result, type: 'native_mod_result', schemaVersion: 1,
    requestId, action: message.action, id: message.id ?? null, callId: message.callId ?? null,
    playerUuid: result.playerUuid ?? actor }))
  return true
}

module.exports = { attachNekoNative, handleNativeMessage, NativeLedger, fingerprint }
