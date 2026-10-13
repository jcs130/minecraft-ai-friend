/** My Agent World environment port for the independent agent-mc/v1 harness.
 * One native SDK/provider owns the body; this port never starts the default
 * vanilla engine, another connection, a viewer, a model or a control heartbeat.
 */
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from 'agent-mc-world/client'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
export { TaskMonitor, evaluateTask } from './task-monitor.mjs'
const require = createRequire(import.meta.url)
const { connect: connectBody } = require('../world-adapter/index.cjs')
const { credentials } = require('../world-adapter/numen-client.cjs')
const { validateJsonArguments } = require('../neoforge-handshake/mod-call-client.cjs')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ID = /^[A-Za-z0-9_.-]{1,64}$/
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const operation = { type: 'string', pattern: '^[a-z][A-Za-z0-9_.:-]{0,95}$' }
const actionId = { type: 'string', pattern: ID.source }
// The envelope carries a provider-specific object; its exact schema is checked
// by the existing native adapter after operation discovery.
const args = { type: 'object', properties: {}, additionalProperties: true }
const copy = value => structuredClone(value)
const error = code => Object.assign(new Error(code), { code })
const fail = code => ({ ok: false, code, retryAutomatically: false })

function validateConfig(config) {
  if (!['mineflayer', 'numen'].includes(config?.provider) || !/^[A-Za-z0-9_]{1,16}$/.test(config.username || '') ||
      !ID.test(config.controllerId || '') || !path.isAbsolute(config.dataDir || '') || !path.isAbsolute(config.ledgerDir || '')) throw error('maw_host_config_invalid')
  const data = path.resolve(config.dataDir), ledger = path.resolve(config.ledgerDir)
  const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)
  if (overlaps(data, ledger)) throw error('maw_host_journals_must_be_separate')
  for (const key of ['credentialsFile', 'loginFile']) if (config[key] && !path.isAbsolute(config[key])) throw error('maw_host_private_path_invalid')
  if (config.provider === 'mineflayer' && (!config.host || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || !UUID.test(config.expectedUuid || ''))) throw error('maw_host_mineflayer_binding_invalid')
  if (config.provider === 'numen' && (!UUID.test(config.bodyId || '') || !path.isAbsolute(config.credentialsFile || ''))) throw error('maw_host_numen_binding_invalid')
  if (config.pollMs !== undefined && (!Number.isInteger(config.pollMs) || config.pollMs < 250 || config.pollMs > 5000)) throw error('maw_host_poll_interval_invalid')
  if (config.viewerUrl) {
    const url = new URL(config.viewerUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw error('maw_host_viewer_url_must_not_contain_credentials')
  }
}

export function executionOf(value, id = value.action_id) {
  if (!id) return undefined
  const phases = { accepted: 'accepted', running: 'running', succeeded: 'completed', failed: 'blocked', cancelled: 'cancelled', unknown: 'blocked' }
  return { kind: 'task', id, phase: phases[value.status] || (value.accepted ? 'accepted' : 'rejected'),
    terminal: value.terminal === true || (!value.accepted && !['accepted', 'running'].includes(value.status)), goalCompleted: false,
    evidence: { provider: value.provider, bodyId: value.bodyId, operation: value.operation, nativeStatus: value.status ?? null,
      outcomeKnown: value.outcomeKnown ?? null, outcomeUnknown: value.outcomeUnknown ?? null,
      actualPosition: value.actualPosition || value.result?.actualPosition || null, code: value.code || value.result?.code || null,
      retryAutomatically: false } }
}

export class MyAgentWorldEnvironment {
  id = 'minecraft'
  #config; #connect; #body = null; #host = null; #identity = null; #state = null
  #watchers = new Map(); #generation = 0; #stopping = false; #eventFailure = false
  constructor(config, { connect = connectBody } = {}) { validateConfig(config); this.#config = copy(config); this.#connect = connect }
  #own(value) {
    if (value?.bodyId && value.bodyId !== this.#identity?.bodyId) throw error('maw_host_body_identity_changed')
    if (value?.provider && value.provider !== this.#config.provider) throw error('maw_host_body_provider_changed')
    if (value?.controllerId && value.controllerId !== this.#config.controllerId) throw error('maw_host_controller_changed')
    return value
  }
  #ready() { if (!this.#body || this.#stopping) throw error('maw_host_not_connected'); return this.#body }
  async start(host) {
    if (this.#body) throw error('maw_host_already_connected')
    this.#host = host; this.#stopping = false; this.#eventFailure = false
    const generation = ++this.#generation
    const body = await this.#connect(copy(this.#config))
    if (generation !== this.#generation || this.#stopping) { await body.close(); throw error('maw_host_start_cancelled') }
    try {
      const identity = await body.identity()
      const expected = this.#config.provider === 'numen' ? this.#config.bodyId : this.#config.expectedUuid
      if (identity.bodyId !== expected || identity.provider !== this.#config.provider || identity.controllerId !== this.#config.controllerId ||
          (identity.account && identity.account !== this.#config.username)) throw error('maw_host_body_binding_mismatch')
      this.#identity = copy(identity); this.#body = body
      this.#state = this.#own(await body.snapshot())
      if (!this.#state.ok) throw error('maw_host_initial_state_unavailable')
    } catch (cause) { this.#body = null; this.#identity = null; this.#state = null; await body.close(); throw cause }
  }
  async stop() {
    this.#stopping = true; ++this.#generation
    for (const watch of this.#watchers.values()) clearTimeout(watch.timer)
    this.#watchers.clear()
    const body = this.#body; this.#body = null; this.#state = null; this.#identity = null; this.#host = null
    if (body) await body.close() // Numen keeps its body/actions; Mineflayer closes its owned connection.
  }
  envPromptVars() { return { 'minecraft.current_task': JSON.stringify(this.#state?.currentAction || null), 'minecraft.goals': 'Goals and memory belong to the host.' } }
  requestFacts() {
    if (!this.#state) return null
    const s = this.#state
    const fact = { provider: this.#config.provider, bodyId: this.#identity.bodyId, capturedAt: s.capturedAt,
      status: s.status, position: s.position, dimension: s.dimension, health: s.health, maxHealth: s.maxHealth,
      hunger: s.hunger, mana: s.mana, currentAction: s.currentAction,
      inventory: { available: s.inventory?.available, slotNamespace: s.inventory?.slotNamespace,
        items: s.inventory?.items?.map(({ slot, id, count }) => ({ slot, id, count })) },
      menu: s.menu ? { windowId: s.menu.windowId, stateId: s.menu.stateId } : null }
    return { text: '', snapshotTypes: ['maw.body'], parts: [{ key: 'maw.body', text: JSON.stringify(fact) }] }
  }
  console() {
    return { label: 'My Agent World', lamps: [{ label: '原生身体', state: this.#body ? 'online' : 'offline' }], links: [],
      panels: [{ id: 'connection', title: '原生身体' }],
      invoke: async (panel, method) => {
        if (panel !== 'connection' || method !== 'state') throw error('maw_host_operator_action_unavailable')
        return { schemaVersion: 1, provider: this.#config.provider, identity: this.#identity && copy(this.#identity),
          server: { host: this.#config.host ?? null, port: this.#config.port ?? null }, viewerStarted: false }
      } }
  }
  #out(value, execution) {
    const serialized = JSON.stringify(value)
    const failed = value.ok === false ? { failed: true } : {}
    if (Buffer.byteLength(serialized) > 65536) return { text: JSON.stringify({ bodyId: this.#identity?.bodyId,
      code: 'full_native_result_in_private_artifact', bytes: Buffer.byteLength(serialized) }), ...failed, execution,
      blobs: [{ bytes: Buffer.from(serialized), mime: 'application/json', fallbackText: 'Full native result, including exact item components.' }] }
    return { text: serialized, ...failed, ...(execution ? { execution } : {}) }
  }
  async #publish(value, id, generation) {
    if (generation !== this.#generation || this.#stopping || !this.#host) return
    this.#own(value)
    const receipt = executionOf(value, id)
    const out = this.#out(value, receipt)
    await this.#host.pushEvent({ type: 'maw.action', source: 'minecraft', origin: 'external', ts: new Date().toISOString(),
      text: out.text, blobs: out.blobs, execution: receipt, meta: { provider: this.#config.provider, bodyId: this.#identity.bodyId,
        action_id: id, provenance: 'own_native_provider_receipt' } }, { trigger: value.outcomeUnknown ? 'interrupt' : 'flush' })
  }
  #watch(id) {
    if (this.#watchers.has(id)) return
    if (this.#watchers.size >= 16) throw error('maw_host_action_watch_budget')
    const generation = this.#generation, body = this.#body, started = Date.now(), watch = { timer: null }
    const poll = async () => {
      if (generation !== this.#generation || this.#stopping) return
      try {
        const value = this.#own(await body.actionStatus(id))
        if (generation !== this.#generation || this.#stopping) return
        if (value.terminal) {
          this.#watchers.delete(id)
          try {
            const state = this.#own(await body.snapshot())
            if (generation === this.#generation && !this.#stopping) this.#state = state
          } catch { /* A later read failure does not undo a known action receipt. */ }
          await this.#publish(value, id, generation); return
        }
        if (Date.now() - started > 600000) {
          this.#watchers.delete(id)
          await this.#publish({ ...value, code: 'watch_expired_query_original_action_id', status: 'unknown', terminal: true,
            outcomeKnown: false, outcomeUnknown: true, retryAutomatically: false }, id, generation)
          return
        }
        watch.timer = setTimeout(poll, this.#config.pollMs ?? 1000)
      } catch {
        this.#watchers.delete(id); this.#eventFailure = true // Block new dispatch if evidence cannot be archived.
      }
    }
    this.#watchers.set(id, watch)
    watch.timer = setTimeout(poll, this.#config.pollMs ?? 1000)
  }
  tools() {
    const tool = (name, description, parameters, tags, handler) => ({ name, description, parameters, tags, interruptible: true,
      handler: async (input, context) => {
        validateJsonArguments(input, parameters); context.signal?.throwIfAborted()
        return handler(input, context)
      } })
    const listing = async a => {
      const body = this.#ready()
      if (a.operation) return this.#out(await body.operations(a.operation) || fail('operation_unavailable'))
      const catalog = await body.operations()
      const rows = catalog.operations.filter(row => !a.prefix || row.id.startsWith(a.prefix))
      const offset = a.offset ?? 0, limit = a.limit ?? 24
      return this.#out({ ok: true, provider: this.#config.provider, bodyId: this.#identity.bodyId, total: rows.length,
        nextOffset: offset + limit < rows.length ? offset + limit : null, allGameplayVerified: false,
        operations: rows.slice(offset, offset + limit).map(({ id, description, readOnly, available, execution, permission }) =>
          ({ id, description, readOnly, available, execution, permission })) })
    }
    const discovery = object({ operation, prefix: { type: 'string', maxLength: 96 }, offset: { type: 'integer', minimum: 0, maximum: 10000 }, limit: { type: 'integer', minimum: 1, maximum: 24 } })
    return [
      tool('mc_operations', '分页列出当前身体实际能力；operation 查看一项真实参数、权限和回执。以本 provider 的目录为准。', discovery, ['read'], listing),
      tool('mc_help', '按需发现原生 API。没有启用的模组明确 unavailable；不猜另一个 provider 的参数。', discovery, ['read'], listing),
      tool('mc_state', '本人实际血量、魔力、绝对坐标、菜单、装备和完整物品组件。附 UUID 与采集时间，不扫描其他账号。', object(), ['read', 'snapshot'], async () => {
        this.#state = this.#own(await this.#ready().snapshot()); return this.#out(this.#state)
      }),
      tool('mc_read', '执行目录中 readOnly=true 的本人原生查询；大结果保存在私有 JSON 制品，保持完整组件。', object({ operation, args }, ['operation']), ['read'], async a => {
        const body = this.#ready(), row = await body.operations(a.operation)
        if (!row?.readOnly || row.available === false) return this.#out(fail('read_requires_available_read_only_operation'))
        return this.#out(this.#own(await body.read(a.operation, a.args || {})))
      }),
      tool('mc_do', '提交一个原生动作。action_id 必须稳定且唯一；受理不等于完成。读 mc_result/mc_events 核验，未知时只对账不重做。', object({ action_id: actionId, operation, args }, ['action_id', 'operation']), ['act'], async (a, context) => {
        const body = this.#ready()
        if (this.#eventFailure || this.#watchers.size >= 16) return this.#out(fail('maw_host_receipt_delivery_unavailable'))
        const row = await body.operations(a.operation)
        if (!row || row.readOnly || row.available === false) return this.#out(fail('submit_requires_available_mutation_operation'))
        context.signal?.throwIfAborted()
        const value = this.#own(await body.submit({ action_id: a.action_id, operation: a.operation, args: a.args || {} }))
        if (!value.terminal && (value.accepted || ['accepted', 'running'].includes(value.status))) this.#watch(a.action_id)
        return this.#out(value, executionOf(value, a.action_id))
      }),
      tool('mc_result', '查询原 action_id 的终态。断线后沿用原 UUID 和 SDK ledgerDir，不能把 unknown 当失败重试。', object({ action_id: actionId }, ['action_id']), ['read'], async a => {
        const value = this.#own(await this.#ready().actionStatus(a.action_id)); return this.#out(value, executionOf(value, a.action_id))
      }),
      tool('mc_wait', '等候原 action_id，最多30秒；等待超时不取消、不重投。', object({ action_id: actionId, timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 } }, ['action_id']), ['read'], async a => {
        const value = this.#own(await this.#ready().wait(a.action_id, { timeoutMs: a.timeoutMs ?? 30000 })); return this.#out(value, executionOf(value, a.action_id))
      }),
      tool('mc_cancel', '显式取消本人原 action_id；取消请求不等于回滚，继续核对终态。', object({ action_id: actionId }, ['action_id']), ['act'], async a => this.#out(this.#own(await this.#ready().cancel(a.action_id)))),
      tool('mc_control', 'Numen 显式 claim/release/restore 原身体；Mineflayer 复用 SDK 排他锁。stop 仅停止本人动作。不授OP、不自动续租。', object({ action: { enum: ['claim', 'release', 'stop', 'restore'] } }, ['action']), ['act'], async a => {
        const method = { claim: 'claimControl', release: 'releaseControl', stop: 'stop', restore: 'restore' }[a.action]
        return this.#out(this.#own(await this.#ready()[method]()))
      }),
      tool('mc_lua_operations', '仅 Numen：发现原生 Lua 函数与签名，再用 mc_do 的 numen.lua 操作。不提供服务器任意JavaScript执行。', object({ group: { type: 'string', maxLength: 80 } }), ['read'], async a => {
        const body = this.#ready(); return this.#out(body.luaOperations ? await body.luaOperations(a.group) : fail('provider_operation_unavailable'))
      }),
      tool('mc_viewer', '返回配置的本人原生模组画面入口。复用已有可视化，不启动1.20.6默认画面、不创建观战替身。', object(), ['read'], async () => this.#out(this.#own(await this.#ready().viewer()))),
    ]
  }
}

export const HOST_INSTRUCTIONS = 'My Agent World native environment, agent-mc/v1. Read mc_connection action:environment. Connect explicitly, discover mc_operations/mc_help and use the exact provider schema. mc_do accepts one {action_id,operation,args}, not generic vanilla steps. Acceptance is not completion. Consume mc_events or query mc_result. Only the host judges goals. No model loop or additional game/MCP network listener is started.'

export function createMyAgentWorldClient(config, { log = nullLogger(), modelFacts, connect } = {}) {
  validateConfig(config)
  const environment = new MyAgentWorldEnvironment(config, connect ? { connect } : {})
  let host = config.host, port = config.port
  if (config.provider === 'numen') { const endpoint = new URL(credentials(config.credentialsFile).url); host = endpoint.hostname; port = Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80) }
  class NativeClient extends MinecraftAgentClient {
    validateConfig() { validateConfig(config) }
    async environment() { return readFileSync(new URL('./ENV_PROMPT.txt', import.meta.url), 'utf8') }
    async operatorState() { return { schema: 'minecraft-client-console/v1', runtime: { phase: this.status().phase, run: this.journal.run },
      connection: await environment.console().invoke('connection', 'state', []), links: [], viewerAssetNote: 'Uses the explicitly configured My Agent World native 1.21.1 viewer.' } }
  }
  return new NativeClient({ cfg: { ...copy(MINECRAFT_CLIENT_DEFAULTS), host, port, username: config.username, version: '1.21.1', viewerPort: 0 },
    dataDir: config.dataDir, agentName: config.username, log, modelFacts }, environment, { profile: 'my-agent-world', toolPrefix: 'mc' })
}
