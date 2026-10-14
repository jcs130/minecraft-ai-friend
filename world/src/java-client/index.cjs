'use strict'
// Controls the already signed-in Java client. Never logs in or creates a second body.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto')
const { NativeLedger } = require('../neko-adapter/native-runtime.cjs')
const { validateJsonArguments } = require('../neoforge-handshake/mod-call-client.cjs')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ID = /^[A-Za-z0-9_.-]{1,64}$/
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
const fingerprint = (operation, args) => crypto.createHash('sha256').update(JSON.stringify([operation, canonical(args)])).digest('hex')
const fail = (code, extra = {}) => ({ ok: false, code, retryAutomatically: false, ...extra })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

function credentials (file) {
  if (!path.isAbsolute(file || '')) throw Error('java_client_credentials_path_invalid')
  const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')), url = new URL(value.endpoint)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/rpc' || url.search || url.hash || url.username || url.password ||
      typeof value.token !== 'string' || !/^[A-Za-z0-9-]{64,128}$/.test(value.token) || !UUID.test(value.instanceId || '')) throw Error('java_client_private_loopback_endpoint_required')
  return { ...value, url }
}
function transport (auth, timeoutMs = 7000) {
  async function request (pathname, data) {
    const bytes = data === undefined ? null : Buffer.from(JSON.stringify({ ...data, instanceId: auth.instanceId }))
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: auth.url.port, path: pathname, method: bytes ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${auth.token}`, ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) } }, res => {
        const chunks = []; let length = 0
        res.on('data', part => { length += part.length; if (length > 32 * 1024 * 1024) req.destroy(Error('java_client_response_over_budget')); else chunks.push(part) })
        res.on('aborted', () => reject(Error('java_client_response_incomplete')))
        res.on('error', () => reject(Error('java_client_response_incomplete')))
        res.on('end', () => {
          if (res.statusCode !== 200) { reject(Error('java_client_http_rejected')); return }
          const raw = Buffer.concat(chunks)
          if (!bytes) { if (!raw.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) reject(Error('java_client_frame_invalid')); else resolve(raw); return }
          try { const result = JSON.parse(raw); if (result.instanceId !== auth.instanceId) throw Error(); resolve(result) } catch { reject(Error('java_client_response_invalid')) }
        })
      })
      req.setTimeout(timeoutMs, () => req.destroy(Error('java_client_rpc_timeout')))
      req.on('error', error => reject(Error(error.message === 'java_client_rpc_timeout' ? error.message : 'java_client_transport_unconfirmed')))
      req.end(bytes)
    })
  }
  return { rpc: (method, params) => request('/rpc', { method, params }), frame: pathname => {
    if (!/^\/frames\/[a-f0-9]{24}-[A-Za-z0-9_.-]{1,64}\.png$/.test(pathname || '')) throw Error('java_client_frame_path_invalid')
    return request(pathname)
  } }
}

async function connectJavaClient (config, { remote: injected } = {}) {
  if (config.provider !== 'java-client' || !UUID.test(config.expectedUuid || '') || !ID.test(config.controllerId || '') ||
      typeof config.expectedServer !== 'string' || !config.expectedServer || !path.isAbsolute(config.ledgerDir || '')) throw Error('java_client_body_binding_invalid')
  const auth = injected ? null : credentials(config.credentialsFile), remote = injected || transport(auth, config.timeoutMs)
  const binding = { expectedUuid: config.expectedUuid, expectedServer: config.expectedServer, controllerId: config.controllerId }
  const base = { schemaVersion: 1, provider: 'java-client', bodyKind: 'connected_java_client', bodyId: config.expectedUuid,
    playerUuid: config.expectedUuid, controllerId: config.controllerId, retryAutomatically: false }
  let lease = null, closed = false, closing = null
  const reads = new Map()
  const decorate = value => ({ ...structuredClone(value), ...base, outcomeUnknown: value.outcomeKnown === false,
    ...(value.after?.bodyId === base.bodyId && value.after.position ? { actualPosition: structuredClone(value.after.position), dimension: value.after.dimension } : {}) })
  const rpc = (method, params = {}) => remote.rpc(method, { ...params, ...binding, ...(lease ? { leaseId: lease.leaseId } : {}) })
  const initial = await rpc('snapshot')
  if (!initial.ok || initial.bodyId !== base.bodyId || initial.server !== config.expectedServer ||
      (config.username && initial.username !== config.username)) throw Error('java_client_signed_in_body_mismatch')
  const discovery = await rpc('operations')
  if (!discovery.ok || !Array.isArray(discovery.operations) || discovery.operations.length > 256) throw Error('java_client_catalog_invalid')
  const specs = new Map(discovery.operations.map(row => [row.id, row]))
  const ledger = new NativeLedger(config.ledgerDir, initial.username)
  if (ledger.playerUuid && ledger.playerUuid !== base.bodyId) { ledger.close(); throw Error('java_client_ledger_identity_changed') }
  try {
    const file = path.join(ledger.directory, 'java-client-binding.json')
    const expected = { provider: 'java-client', bodyId: base.bodyId, server: config.expectedServer }
    if (fs.existsSync(file)) {
      if (JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) !== JSON.stringify(expected)) throw Error('java_client_ledger_server_binding_changed')
    } else {
      if (ledger.records.size) throw Error('java_client_ledger_provider_mismatch')
      const fd = fs.openSync(file, 'wx'); try { fs.writeFileSync(fd, JSON.stringify(expected)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    }
  } catch (error) { ledger.close(); throw error }
  const own = value => {
    if (value.provider && value.provider !== 'java-client') throw Error('java_client_body_provider_changed')
    if (value.bodyId && value.bodyId !== base.bodyId) throw Error('java_client_body_identity_changed')
    if (value.server && value.server !== config.expectedServer) throw Error('java_client_server_changed')
    return value
  }
  async function status (id) {
    if (closed) return decorate(fail('java_client_adapter_closed'))
    if (!ID.test(id || '')) return decorate(fail('action_id_invalid'))
    const original = ledger.records.get(id)
    if (original?.kind === 'result') return decorate({ ...original.result, cached: true })
    if (reads.has(id)) return reads.get(id)
    const read = (async () => {
      let value
      try { value = own(await rpc('result', { action_id: id })) } catch { return decorate(fail('java_client_result_unavailable', { action_id: id, status: 'unknown', outcomeKnown: false, terminal: false })) }
      if (original && value.terminal) {
        if (value.operation !== original.id || fingerprint(value.operation, value.args || {}) !== original.fingerprint) throw Error('java_client_action_receipt_mismatch')
        ledger.append({ kind: 'result', callId: id, id: original.id, args: original.args, fingerprint: original.fingerprint, playerUuid: base.bodyId, result: value })
      }
      return decorate(value)
    })().finally(() => reads.delete(id))
    reads.set(id, read); return read
  }
  const adapter = {
    identity: () => decorate({ ok: true, account: initial.username, username: initial.username, server: initial.server, connected: !closed, authority: 'client_observed' }),
    operations: id => id ? structuredClone(specs.get(id) || null) : decorate(discovery),
    capabilities: () => decorate({ ok: true, operations: [...specs.values()], serverRequired: false, nativeClient: true, allGameplayVerified: false, modelRequests: 0 }),
    snapshot: async () => { if (closed) return decorate(fail('java_client_adapter_closed')); return decorate(own(await rpc('snapshot'))) },
    read: async (operation, args = {}) => {
      const spec = specs.get(operation)
      if (closed || !spec?.readOnly || spec.available === false) return decorate(fail('read_requires_available_read_only_operation'))
      try { validateJsonArguments(args, spec.parameters) } catch { return decorate(fail('java_client_arguments_invalid')) }
      return decorate(own(await rpc('read', { operation, args })))
    },
    async claimControl () {
      if (closed) return decorate(fail('java_client_adapter_closed'))
      const result = own(await rpc('claim')); if (result.ok) lease = result
      const { leaseId, ...visible } = result
      return decorate(visible)
    },
    async submit ({ action_id: id, operation, args = {} }) {
      if (!ID.test(id || '')) return decorate(fail('action_id_invalid'))
      const hash = fingerprint(operation, args), previous = ledger.records.get(id)
      if (previous) return previous.fingerprint !== hash ? decorate(fail('action_id_parameters_changed')) : status(id)
      const spec = specs.get(operation)
      if (closed || !spec || spec.readOnly || spec.available === false) return decorate(fail('submit_requires_available_mutation_operation'))
      if (!lease || lease.expiresAt < Date.now()) return decorate(fail('control_lease_required'))
      if (ledger.broken || ledger.unresolvedById.size) return decorate(fail('reconcile_action_before_submit', { unresolved: ledger.unresolved() }))
      try { validateJsonArguments(args, spec.parameters) } catch { return decorate(fail('java_client_arguments_invalid')) }
      ledger.append({ kind: 'intent', callId: id, id: operation, args, fingerprint: hash, playerUuid: base.bodyId })
      let value
      try { value = own(await rpc('submit', { action_id: id, operation, args })) } catch {
        return decorate(fail('java_client_submit_unconfirmed_query_original_action_id', { action_id: id, status: 'unknown', terminal: false, outcomeKnown: false }))
      }
      if (!value.accepted && !value.terminal) value = { ...value, action_id: id, operation, args, terminal: true, status: 'failed', outcomeKnown: true }
      if (value.terminal) ledger.append({ kind: 'result', callId: id, id: operation, args, fingerprint: hash, playerUuid: base.bodyId, result: value })
      return decorate(value)
    },
    actionStatus: status,
    async wait (id, { timeoutMs = 30000 } = {}) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return decorate(fail('wait_timeout_invalid'))
      const deadline = Date.now() + timeoutMs
      do { const value = await status(id); if (value.terminal) return value; if (Date.now() >= deadline) return decorate({ ...value, waitTimedOut: true }); await pause(100) } while (!closed)
      return decorate(fail('java_client_adapter_closed'))
    },
    cancel: async id => decorate(await rpc('cancel', { action_id: id })),
    stop: async () => decorate(await rpc('stop')),
    async releaseControl () {
      if (ledger.unresolvedById.size) return decorate(fail('reconcile_action_before_release'))
      const result = await rpc('release'); if (result.ok) lease = null; return decorate(result)
    },
    restore: async () => decorate(fail('client_login_owned_by_real_client_no_body_replacement')),
    health: async () => decorate({ ...await rpc('health'), localUnresolved: ledger.unresolved(), localJournalBroken: ledger.broken }),
    viewer: () => decorate({ ok: true, mode: 'original_framebuffer', captureOperation: 'screen.capture', frameMethod: 'frame(action_id)', url: null, secondAccount: false }),
    async frame (id) {
      if (!ID.test(id || '')) throw Error('frame_id_invalid')
      const value = await status(id)
      if (!value.ok || value.operation !== 'screen.capture' || !value.terminal) throw Error('frame_not_confirmed')
      const scope = crypto.createHash('sha256').update(config.expectedServer + '\n' + base.bodyId).digest('hex').slice(0, 24)
      if (value.frame !== `/frames/${scope}-${id}.png`) throw Error('java_client_frame_body_scope_mismatch')
      return remote.frame(value.frame)
    },
    close () {
      if (!closing) closing = (async () => {
        if (lease) {
          try {
            await rpc('stop')
            const deadline = Date.now() + 2000
            do {
              for (const entry of ledger.unresolved()) { try { await status(entry.callId) } catch {} }
              if (!ledger.unresolvedById.size || Date.now() >= deadline) break
              await pause(50)
            } while (true)
            await rpc('release')
          } catch {}
        }
        await Promise.allSettled([...reads.values()]); closed = true; ledger.close(); lease = null
        return decorate({ ok: true, closed: true, clientDisconnected: false, bodyRemoved: false })
      })()
      return closing
    }
  }
  return adapter
}
module.exports = { connectJavaClient, credentials, transport }
