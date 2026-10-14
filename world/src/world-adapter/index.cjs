'use strict'
// One model-neutral interface, one explicit provider and one immutable body.
// This adapter never spawns a replacement, transfers an identity or calls an LLM.
const crypto = require('node:crypto'), path = require('node:path')
const { attachNativeBody, attachOfflineLogin } = require('../native-sdk/index.cjs')
const { validateJsonArguments } = require('../neoforge-handshake/mod-call-client.cjs')
const { NativeLedger } = require('../neko-adapter/native-runtime.cjs')
const { nativeInventorySnapshot, nativeInventoryDelta } = require('../society-agent/native-inventory-delta.cjs')
const { nativeNavigationResult } = require('../society-agent/native-navigation-result.cjs')
const { createNumenClient, credentials } = require('./numen-client.cjs')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ACTION = /^[A-Za-z0-9_.-]{1,64}$/
const copy = value => value === undefined ? null : structuredClone(value)
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
const fingerprint = (operation, args) => crypto.createHash('sha256').update(JSON.stringify([operation, canonical(args)])).digest('hex')
const controls = new Set(require('../neoforge-handshake/control-contract.cjs').controlOperations.map(row => row.id))
const fail = (code, extra = {}) => ({ ok: false, code, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false, ...extra })
const unknown = (code, extra = {}) => fail(code, { terminal: true, status: 'unknown', outcomeKnown: false, outcomeUnknown: true, ...extra })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const empty = { type: 'object', properties: {}, additionalProperties: false }
const moveSchema = { type: 'object', additionalProperties: false, required: ['position'], properties: {
  position: { type: 'object', additionalProperties: false, required: ['x', 'y', 'z'], properties: {
    x: { type: 'integer', minimum: -29999984, maximum: 29999984 }, y: { type: 'integer', minimum: -2048, maximum: 2048 }, z: { type: 'integer', minimum: -29999984, maximum: 29999984 }
  } }
} }
const core = [
  { id: 'body.identity', readOnly: true, parameters: empty, description: '本人身体 UUID、固定 provider、控制器和连接状态。' },
  { id: 'body.snapshot', readOnly: true, parameters: empty, description: '服务端实际状态、绝对坐标、真实菜单/完整库存；附采集时间和槽位命名空间。' },
  { id: 'body.move', readOnly: false, parameters: moveSchema, description: '步行至 16 格内绝对方块坐标，不挖路搭桥；按实际终点验证。wait 超时不取消。' }
]
function metadata (provider, bodyId, controllerId, ownerUuid = null) {
  return { schemaVersion: 1, provider, bodyId, playerUuid: bodyId, ownerUuid, controllerId,
    bodyKind: provider === 'numen' ? 'numen_fake_player' : 'connected_player', retryAutomatically: false }
}
function normalizedState (base, value, menu = value.menu) {
  const ownMenu = menu?.playerUuid === base.bodyId ? menu : null
  return { ...copy(value), ...base, ok: value.ok === true,
    status: ['alive', 'dead', 'offline', 'unavailable'].includes(value.status) ? value.status : 'unavailable',
    capturedAt: value.capturedAt || value.sampledAt || null, menuCapturedAt: ownMenu?.capturedAt || ownMenu?.sampledAt || null,
    health: ownMenu?.self?.health ?? value.health ?? value.self?.health ?? null,
    maxHealth: ownMenu?.self?.maxHealth ?? value.maxHealth ?? value.self?.maxHealth ?? null,
    hunger: ownMenu?.self?.food ?? value.hunger ?? value.self?.food ?? null,
    position: copy(value.position), dimension: value.dimension ?? null,
    inventory: ownMenu ? { ...nativeInventorySnapshot(ownMenu, base.bodyId), slotNamespace: 'player_menu_46' } :
      { available: false, slotNamespace: 'player_menu_46', items: [], totals: [], reason: 'canonical_menu_unavailable' },
    menu: copy(ownMenu), equipment: copy(ownMenu?.self?.equipment || value.equipment || value.self?.equipment),
    mana: copy(ownMenu?.self?.mana || value.self?.mana), currentAction: copy(value.currentAction) }
}
function withMineflayer (sdk, { controllerId, viewerUrl = null } = {}) {
  const base = () => metadata('mineflayer', sdk.identity().bodyId, controllerId || sdk.identity().controllerId)
  const decorate = value => ({ ...copy(value), ...base() })
  return {
    identity: () => decorate(sdk.identity()),
    operations (id) {
      const catalog = sdk.operations()
      const rows = catalog.operations.map(row => ({ ...row, provider: 'mineflayer', common: controls.has(row.id) || core.some(c => c.id === row.id), available: row.serverBindingAdvertised !== false }))
      for (const row of core) { const index = rows.findIndex(r => r.id === row.id); rows[index] = { ...rows[index], ...copy(row), available: true, provider: 'mineflayer', common: true } }
      return id === undefined ? { ...catalog, provider: 'mineflayer', operations: rows } : copy(rows.find(r => r.id === id))
    },
    capabilities: async () => decorate(await sdk.capabilities()),
    async snapshot () {
      const value = normalizedState(base(), await sdk.snapshot())
      if (value.ok && !Object.hasOwn(value.self || {}, 'mana')) {
        try { const spells = await sdk.read('spell.list', {}); if (spells.ok) value.mana = copy(spells.state?.mana) } catch { value.mana = null }
      }
      return value
    },
    async read (id, args = {}) {
      if (id === 'body.identity') { validateJsonArguments(args, empty); return this.identity() }
      if (id === 'body.snapshot') { validateJsonArguments(args, empty); return this.snapshot() }
      return decorate(await sdk.read(id, args))
    },
    async submit (request) {
      if (!ACTION.test(request?.action_id || '')) return decorate(fail('action_id_invalid_common_contract'))
      if (request.operation === 'body.move') { try { validateJsonArguments(request.args || {}, moveSchema) } catch { return decorate(fail('action_arguments_invalid')) } }
      return decorate(await sdk.submit(request))
    },
    actionStatus: async id => decorate(await sdk.actionStatus(id)),
    wait: async (id, options) => decorate(await sdk.wait(id, options)),
    cancel: async id => decorate(await sdk.cancel(id)), stop: async () => decorate(await sdk.stop()),
    claimControl: async () => decorate({ ok: true, control: 'existing_sdk_writer_lock', permissionChanged: false }),
    releaseControl: async () => decorate(fail('mineflayer_release_requires_close')),
    restore: async () => decorate(fail('provider_operation_unavailable_no_body_replacement')),
    health: async () => decorate(sdk.health()),
    viewer: () => ({ ...base(), ok: !!viewerUrl, url: viewerUrl, readOnly: true, code: viewerUrl ? 'existing_mineflayer_view' : 'viewer_url_not_configured' }),
    close: async () => sdk.close()
  }
}
async function withNumen (client, { bodyId, ownerUuid, controllerId, ledgerDir, viewerUrl = null }) {
  if (!UUID.test(bodyId || '') || !UUID.test(ownerUuid || '') || !ACTION.test(controllerId || '') || !path.isAbsolute(ledgerDir || '')) throw Error('numen_body_binding_invalid')
  const base = metadata('numen', bodyId, controllerId, ownerUuid)
  await client.rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'maw-world-adapter', version: '1' } })
  const owned = await client.call('list_companions')
  const body = owned.ok && owned.companions?.find(row => row.bodyId === bodyId && row.ownerUuid === ownerUuid)
  if (!body || !/^[A-Za-z0-9_]{1,16}$/.test(body.name || '')) throw Error('numen_body_not_owned')
  const ledger = new NativeLedger(path.join(ledgerDir, 'numen'), body.name)
  if (ledger.playerUuid && ledger.playerUuid !== bodyId) { ledger.close(); throw Error('numen_ledger_body_mismatch') }
  let closed = false, lease = null, active = null, submitting = false, rows = [], closing = null
  const statusReads = new Map()
  const decorate = value => ({ ...copy(value), ...base })
  const bound = (name, args = {}) => client.call(name, { ...args, companion: bodyId })
  const safe = async task => { try { return await task() } catch (error) { return decorate(unknown(error.code || 'numen_transport_unconfirmed')) } }
  function canonicalState (value) {
    if (!value.nativeState) return null
    const native = value.nativeState
    if (value.bodyId !== bodyId || value.ownerUuid !== ownerUuid || native.bodyId !== bodyId || native.menu?.playerUuid !== bodyId ||
        native.self?.playerUuid !== bodyId) throw Error('numen_state_identity_mismatch')
    const result = { ...normalizedState(base, { ...value, self: native.self, capturedAt: native.capturedAt }, native.menu),
      account: body.name, capturedTick: native.capturedTick, sampling: 'same_server_tick', menuError: null }
    delete result.nativeState
    return result
  }
  async function snapshot () {
    if (closed) return decorate({ ...fail('adapter_closed'), status: 'offline' })
    const value = await bound('get_state')
    if (value.bodyId !== bodyId || value.ownerUuid !== ownerUuid) {
      if (value.ok === false && !value.bodyId) return decorate({ ...fail(value.code || 'body_state_unavailable'), status: 'unavailable' })
      throw Error('numen_state_identity_mismatch')
    }
    const canonical = canonicalState(value)
    if (canonical) return canonical
    let menu = null, menuError = null
    if (value.ok) {
      const result = await bound('mod_query', { operation: 'menu.snapshot' })
      if (result.ok && result.state?.playerUuid === bodyId) menu = result.state
      else menuError = result.code || 'canonical_menu_unavailable'
    }
    const result = { ...normalizedState(base, value, menu), account: body.name, sampling: 'separate_body_menu_and_mana_reads', menuError }
    if (value.ok && rows.some(row => row.id === 'spell.list')) {
      try {
        const spells = await bound('mod_query', { operation: 'spell.list' })
        result.mana = spells.ok && (!spells.playerUuid || spells.playerUuid === bodyId) ? copy(spells.state?.mana) : null
      } catch { result.mana = null; result.manaError = 'mana_query_unavailable' }
    }
    return result
  }
  function leaseValid () { return !!lease && lease.expiresAt > Date.now() }
  async function claimControl () {
    if (closed) return decorate(fail('adapter_closed'))
    const result = await bound('claim_control', { controller_id: controllerId })
    if (result.ok && result.bodyId === bodyId && /^[a-f0-9]{64}$/.test(result.lease?.leaseId || '') && result.lease.controllerId === controllerId) lease = copy(result.lease)
    // The lease is private to the transport, never in Agent/stdout receipts.
    return decorate(result.ok ? { ok: true, expiresAt: lease?.expiresAt ?? null, control: 'server_lease', permissionChanged: false } : fail(result.code || 'control_not_acquired'))
  }
  function receipt (raw, record, id) {
    const operation = record?.id || raw.modOperation || 'numen.lua'
    if (raw.bodyId && raw.bodyId !== bodyId) return decorate(unknown('action_receipt_body_mismatch', { action_id: id, operation }))
    if (raw.code === 'unknown_action_id' || raw.phase === 'unknown') return decorate(unknown(raw.code || 'action_unknown', { action_id: id, operation }))
    if (!raw.phase) return decorate({ ...fail(raw.code || 'action_receipt_invalid'), action_id: id, operation, terminal: true, status: 'failed' })
    if (record && ((raw.modOperation && (raw.modOperation !== record.id || fingerprint(raw.modOperation, raw.arguments || {}) !== record.fingerprint)) ||
        (!raw.modOperation && raw.fingerprint !== record.remoteFingerprint))) return decorate(unknown('remote_action_fingerprint_mismatch', { action_id: id, operation }))
    const terminal = raw.phase === 'terminal'
    if (operation === 'body.move' && terminal && raw.ok && record &&
        (!raw.after?.position || raw.after.dimension !== record.beforeDimension)) return decorate(unknown('navigation_terminal_context_unavailable', { action_id: id, operation }))
    const result = { ...copy(raw.outcome || {}), actualPosition: copy(raw.after?.position), dimension: raw.after?.dimension ?? null,
      inventoryDelta: null, rawOutcome: copy(raw.outcome) }
    if (operation === 'body.move' && terminal && raw.ok && raw.after?.position && record) Object.assign(result,
      nativeNavigationResult({ requestedPosition: record.args.position, position: raw.after.position, exact: true }), { proofSource: 'owned_numen_server_position' })
    const ok = raw.ok === true && result.ok !== false
    return decorate({ ok, action_id: id, operation, accepted: !terminal, terminal,
      status: terminal ? (ok ? 'succeeded' : raw.outcome?.cancelled || raw.outcome?.code === 'cancelled_before_dispatch' ? 'cancelled' : 'failed') : raw.phase === 'accepted' ? 'accepted' : 'running',
      outcomeKnown: terminal, outcomeUnknown: false, capturedAt: raw.sampledAt || raw.completedAt || null,
      actualPosition: copy(result.actualPosition), result: terminal ? result : null, replayed: raw.replayed === true })
  }
  async function actionStatus (id) {
    if (!ACTION.test(id || '')) return decorate(fail('action_id_invalid_common_contract'))
    const record = ledger.records.get(id)
    if (record?.kind === 'result') return decorate(copy(record.result))
    if (closed) return decorate(unknown('adapter_closed', { action_id: id }))
    // A waiter and a host terminal-event poll can overlap. They must share
    // one read/commit, otherwise two results invalidate the durable journal.
    if (statusReads.has(id)) return copy(await statusReads.get(id))
    const pending = safe(async () => {
      const raw = await bound('action_status', { action_id: id }), value = receipt(raw, record, id)
      if (record && value.terminal && value.outcomeKnown) {
        try {
          // Current hosts persist the actual terminal-tick menu/inventory in
          // the action receipt. Do not make three more HTTP reads per action.
          const after = canonicalState(raw.after || {}) || await snapshot()
          if (after.ok) {
            value.actualPosition = copy(value.actualPosition || after.position)
            value.result = { ...value.result, actualPosition: copy(value.actualPosition), dimension: value.result?.dimension || after.dimension,
              afterObservationCapturedAt: after.capturedAt,
              inventoryDelta: nativeInventoryDelta(record.beforeInventory, after.inventory) }
          }
        } catch { /* A known action outcome stays known when a later read fails. */ }
        ledger.append({ ...record, kind: 'result', result: value })
      }
      if (active === id && value.terminal) active = null
      return value
    })
    statusReads.set(id, pending)
    try { return copy(await pending) } finally { if (statusReads.get(id) === pending) statusReads.delete(id) }
  }
  async function discover () {
    const native = await client.call('mod_operations')
    if (!native.ok || !Array.isArray(native.operations)) throw Error('numen_native_operations_unavailable')
    // List is cheap. Explain fetches one actual signature on demand; reconnect
    // must not spend 48 requests or guess the Mineflayer parameter contract.
    rows = native.operations.map(row => ({ ...copy(row), parameters: null, provider: 'numen', common: controls.has(row.id), available: true,
      permission: 'owned_body_lease_and_native_rules', execution: row.readOnly ? 'awaitable_read' : 'asynchronous_action' }))
    rows.push(...core.map(row => ({ ...copy(row), provider: 'numen', available: true, common: true, execution: row.readOnly ? 'awaitable_read' : 'asynchronous_action' })),
      { id: 'numen.lua', readOnly: false, available: true, provider: 'numen', execution: 'asynchronous_action',
        parameters: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 16384 } } },
        description: '通过原生 Numen Lua 执行服务端能力；先用 luaOperations 发现，不执行客户端专用函数。' },
      { id: 'body.observe', readOnly: true, available: false, provider: 'numen', parameters: empty,
        description: '此版统一层尚未映射 Numen 周边扫描；可发现并显式调用 Numen 原生 scan Lua。' })
  }
  async function explain (row) {
    if (!row || row.parameters) return row
    const value = await client.call('mod_operations', { operation: row.id })
    if (!value.ok || value.operation?.id !== row.id || value.operation.readOnly !== row.readOnly || !value.operation.parameters) throw Error('numen_operation_schema_unavailable')
    Object.assign(row, copy(value.operation)); return row
  }
  try { await discover(); await snapshot() } catch (error) { ledger.close(); throw error }
  const operationRow = row => row ? { ...copy(row), parametersAvailable: !!row.parameters,
    permission: row.readOnly ? 'authenticated_owner_own_body' : 'owned_body_lease_independent_mode_and_native_rules',
    returns: row.readOnly ? 'own_body_data_or_explicit_unavailable' : 'accepted_then_original_action_id_terminal_or_unknown',
    invocation: row.readOnly ? 'adapter.read(id,args)' : 'adapter.submit({action_id,operation:id,args})' } : null
  const operations = id => id === undefined ? { schemaVersion: 1, provider: 'numen', bodyKind: base.bodyKind,
    operationCount: rows.length, availableCount: rows.filter(row => row.available).length, allGameplayVerified: false,
    explain: 'await adapter.operations(id)', operations: rows.map(operationRow) } : explain(rows.find(row => row.id === id)).then(operationRow)
  async function submit ({ action_id: id, operation, args = {} } = {}) {
    if (!ACTION.test(id || '')) return decorate(fail('action_id_invalid_common_contract'))
    if (closed) return decorate(fail('adapter_closed'))
    const row = rows.find(row => row.id === operation)
    if (!row?.available || row.readOnly) return decorate(fail('submit_requires_available_mutation'))
    try { await explain(row) } catch (error) { return decorate(fail(error.code || 'operation_schema_unavailable')) }
    try { validateJsonArguments(args, row.parameters) } catch { return decorate(fail('action_arguments_invalid')) }
    const immutable = copy(args), hash = fingerprint(operation, immutable), previous = ledger.records.get(id)
    if (previous) {
      if (previous.fingerprint !== hash) return decorate(fail('action_id_conflict', { action_id: id }))
      return { ...await actionStatus(id), replayed: true, dispatched: false }
    }
    if (submitting || active || ledger.broken || ledger.unresolvedById.size) return decorate(fail('body_action_blocked', { unresolved: ledger.unresolved() }))
    if (!leaseValid()) return decorate(fail('control_lease_required'))
    submitting = true
    let record
    try {
      const before = await snapshot()
      if (closed) return decorate(fail('adapter_closed'))
      if (!before.ok || before.status !== 'alive') return decorate(fail('body_not_alive'))
      if (before.blocked || before.currentAction || before.programRunning) return decorate(fail('body_action_blocked'))
      if (before.permissionMode !== 'bypass') return decorate(fail('numen_independent_permission_required'))
      let code = null
      if (operation === 'body.move') {
        const p = immutable.position
        if (!before.position || Math.hypot(p.x + .5 - before.position.x, p.y - before.position.y, p.z + .5 - before.position.z) > 16) return decorate(fail('movement_target_outside_loaded_local_range'))
        code = `local p=numen.route.plan({to={x=${p.x},y=${p.y},z=${p.z}},costs={dig=false,place=false,consent=false}}); if not p.ok then error(p.why) end; local m=numen.move.go(p); print(m.pos.x,m.pos.y,m.pos.z)`
      } else if (operation === 'numen.lua') code = immutable.code
      record = { callId: id, playerUuid: bodyId, id: operation, args: immutable, fingerprint: hash,
        remoteFingerprint: code ? crypto.createHash('sha256').update(code).digest('hex') : null,
        beforeInventory: copy(before.inventory), beforeDimension: before.dimension, provider: 'numen', ownerUuid }
      ledger.append({ ...record, kind: 'intent' }); active = id
      const raw = await bound(code ? 'lua' : 'mod_action', { lease_id: lease.leaseId, action_id: id,
        ...(code ? { code } : { operation, arguments: immutable }) })
      lease.expiresAt = Date.now() + 85000
      if (!raw.phase) {
        const result = decorate({ ...fail(raw.code || 'action_rejected'), terminal: true, status: 'failed', action_id: id, operation, dispatched: false })
        ledger.append({ ...record, kind: 'result', result }); active = null; return result
      }
      const result = receipt(raw, record, id)
      if (result.terminal) return actionStatus(id)
      return { ...result, dispatched: true }
    } catch (error) {
      if (!record) return decorate(fail(error.code || 'body_read_failed_before_dispatch'))
      // Intent remains unresolved. Only an original-ID status query may settle it.
      active = null
      return decorate(unknown(error.code || 'action_submission_unconfirmed', { action_id: id, operation }))
    } finally { submitting = false }
  }
  return {
    async identity () { const state = await snapshot(); return decorate({ ok: state.ok, account: body.name, connected: state.ok && state.status === 'alive', status: state.status, capturedAt: state.capturedAt }) },
    operations, capabilities: async () => {
      const state = await safe(snapshot)
      return decorate({ ok: state.ok === true, ...operations(), controlAcquired: leaseValid(), numenRestoreExisting: true, status: state.status || 'unavailable', capturedAt: state.capturedAt || null })
    },
    snapshot: () => safe(snapshot),
    async read (id, args = {}) {
      const row = rows.find(row => row.id === id)
      if (!row?.available || !row.readOnly) return decorate(fail('read_requires_available_read_only_operation'))
      try { await explain(row) } catch (error) { return decorate(fail(error.code || 'operation_schema_unavailable')) }
      try { validateJsonArguments(args, row.parameters) } catch { return decorate(fail('action_arguments_invalid')) }
      if (id === 'body.identity') return this.identity()
      if (id === 'body.snapshot') return this.snapshot()
      if (closed) return decorate(fail('adapter_closed'))
      return safe(async () => {
        const value = await bound('mod_query', { operation: id, arguments: args })
        if ((value.playerUuid && value.playerUuid !== bodyId) || (value.bodyId && value.bodyId !== bodyId)) return decorate(fail('query_receipt_body_mismatch'))
        return decorate(value)
      })
    },
    luaOperations: async group => safe(async () => decorate(await client.call('operations', group ? { group } : {}))),
    submit, actionStatus,
    async wait (id, { timeoutMs = 50000, intervalMs = 500 } = {}) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 5000) return decorate(fail('wait_budget_invalid'))
      const deadline = Date.now() + timeoutMs
      while (true) {
        const value = await actionStatus(id)
        if (value.terminal || Date.now() >= deadline) return { ...value, waitExpired: !value.terminal, actionCancelled: false }
        await sleep(Math.min(intervalMs, deadline - Date.now()))
      }
    },
    async cancel (id) {
      if (!ACTION.test(id || '') || !leaseValid() || closed) return decorate(fail('control_lease_required'))
      return safe(async () => { const raw = await bound('action_cancel', { lease_id: lease.leaseId, action_id: id }); return raw.phase === 'terminal' ? actionStatus(id) : decorate({ ...raw, cancelRequested: raw.ok === true, rollback: false }) })
    },
    async stop () {
      const state = await this.snapshot()
      const id = active || state.currentAction?.action_id
      return id ? this.cancel(id) : decorate({ ok: state.ok, code: state.ok ? 'body_idle' : 'body_state_unavailable' })
    },
    claimControl: () => safe(claimControl),
    async releaseControl () {
      if (!leaseValid() || closed) return decorate(fail('control_lease_required'))
      if (active || submitting || ledger.unresolvedById.size) return decorate(fail('reconcile_action_before_release'))
      return safe(async () => { const value = await bound('release_control', { lease_id: lease.leaseId }); if (value.ok) lease = null; return decorate(value) })
    },
    async restore () {
      if (!leaseValid() || closed) return decorate(fail('control_lease_required'))
      if (ledger.unresolvedById.size || active) return decorate(fail('reconcile_action_before_restore'))
      return safe(async () => { const value = await bound('restore_companion', { lease_id: lease.leaseId }); if (value.bodyId !== bodyId) return decorate(fail('restore_original_body_failed')); return this.snapshot() })
    },
    health: async () => {
      const state = await safe(snapshot)
      return decorate({ ok: state.ok && !ledger.broken, connected: state.ok && state.status === 'alive', status: state.status || 'unavailable', controlAcquired: leaseValid(),
        inFlight: active, mutationBlocked: ledger.broken || ledger.unresolvedById.size > (active ? 1 : 0), unresolved: ledger.unresolved(), ledgerScope: 'local_shadow_and_server_body_journal', modelRequests: 0 })
    },
    viewer: () => decorate({ ok: !!viewerUrl, url: viewerUrl, readOnly: true, requiresOwnerToken: true }),
    close () {
      if (!closing) {
        closed = true
        // Keep this writer's lock until already-issued status reads have
        // persisted their terminal evidence. No new remote work is started.
        closing = Promise.allSettled([...statusReads.values()]).then(() => {
          ledger.close(); lease = null
          return decorate({ ok: true, closed: true, actionsCancelled: false, bodyRemoved: false })
        })
      }
      return closing
    }
  }
}
async function connect (config) {
  if (config?.provider === 'java-client') return require('../java-client/index.cjs').connectJavaClient(config)
  if (config?.provider === 'numen') {
    const auth = credentials(config.credentialsFile)
    const url = new URL(auth.url)
    return withNumen(createNumenClient({ ...auth, timeoutMs: config.timeoutMs }), { ...config, ownerUuid: auth.ownerUuid,
      viewerUrl: config.viewerUrl || (url.pathname === '/numen/mcp' ? new URL('/numen/view/', url).href : null) })
  }
  if (config?.provider !== 'mineflayer') throw Error('world_provider_must_be_explicit')
  if (!config.host || !Number.isInteger(config.port) || !/^[A-Za-z0-9_]{1,16}$/.test(config.username || '') || !path.isAbsolute(config.ledgerDir || '') || !UUID.test(config.expectedUuid || '')) throw Error('mineflayer_body_binding_invalid')
  const bot = require('mineflayer').createBot({ host: config.host, port: config.port, username: config.username, version: '1.21.1', auth: 'offline' })
  bot.on('error', () => {})
  let sdk, login, loginPhase = null
  try {
    sdk = attachNativeBody(bot, { ...config, account: config.username })
    if (config.loginFile) login = attachOfflineLogin(bot, { credentialPath: config.loginFile, username: config.username,
      query: () => sdk.capabilities(), onState: state => { loginPhase = state.phase } })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(Error('mineflayer_connect_timeout')), config.connectTimeoutMs ?? 25000)
      const onSpawn = () => finish(), onEnd = () => finish(Error('mineflayer_connection_ended')), onError = () => finish(Error('mineflayer_connection_failed'))
      function finish (error) { clearTimeout(timer); bot.off('spawn', onSpawn); bot.off('end', onEnd); bot.off('error', onError); error ? reject(error) : resolve() }
      bot.once('spawn', onSpawn); bot.once('end', onEnd); bot.once('error', onError)
    })
    if (login) {
      const deadline = Date.now() + 20000
      while (!login.ready() && Date.now() < deadline && !['failed', 'closed'].includes(loginPhase)) await sleep(100)
      if (!login.ready()) throw Error('mineflayer_authentication_not_ready')
    }
    const capabilities = await sdk.capabilities()
    if (!capabilities.ok) throw Error('mineflayer_native_bridge_not_ready')
    const adapter = withMineflayer(sdk, config), close = adapter.close
    adapter.close = async () => {
      login?.close(); await close()
      const ended = await new Promise(resolve => {
        const timer = setTimeout(() => { bot.off('end', finish); resolve(false) }, 5000)
        function finish () { clearTimeout(timer); resolve(true) }
        bot.once('end', finish); bot.quit('World adapter closing')
      })
      return { ...metadata('mineflayer', config.expectedUuid, config.controllerId), ok: ended, closed: true }
    }
    return adapter
  } catch (error) { login?.close(); sdk?.close(); bot.quit('World adapter initialization rejected'); throw error }
}
module.exports = { connect, withMineflayer, withNumen, normalizedState }
