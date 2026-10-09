// A bounded real Agent.start run, using an isolated cwd and the player's own view.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
const require = createRequire(import.meta.url)
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (!path.isAbsolute(config.stateDirectory) || !path.isAbsolute(config.nekoDirectory) || !/^[A-Za-z0-9_]{3,16}$/.test(config.username) || config.durationSeconds < 30 || config.durationSeconds > 1800) throw Error('NEKO_TRIAL_CONFIG_INVALID')
const missionTurns = config.maxMissionTurns ?? 1, commandsPerTurn = config.commandsPerTurn ?? 24
if (!Number.isInteger(missionTurns) || missionTurns < 1 || missionTurns > 32 ||
    !Number.isInteger(commandsPerTurn) || commandsPerTurn < 1 || commandsPerTurn > 24 ||
    (config.task && !['create_windmill', 'create_food_chain'].includes(config.task.kind))) throw Error('NEKO_TRIAL_TASK_CONFIG_INVALID')
const root = fs.realpathSync(config.stateDirectory)
process.chdir(root)
fs.mkdirSync('bots/_supervisor', { recursive: true })
const lock = path.join(root, 'runner.lock')
const fd = fs.openSync(lock, 'wx')
fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); fs.fsyncSync(fd); fs.closeSync(fd)
let closing = false, agent, viewer, stream, heartbeat, presentationObserver, taskEvidence
const startedAt = Date.now(), eventsFile = path.join(root, 'trial-events.jsonl')
const report = { schemaVersion: 1, username: config.username, startedAt: new Date().toISOString(), phase: 'starting',
  model: 'qwen3.7-plus', provider: 'aliyun-codingplan-direct', qwenpawConnected: false, modelLoopStarted: false,
  deaths: 0, pathDistance: 0, commands: [], modOperations: [], privatePackets: 0, errors: [], fullModPlayVerified: false }
function record (kind, data = {}) {
  const event = { at: new Date().toISOString(), kind, ...data }
  fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n'); console.log('NEKO_TRIAL ' + JSON.stringify(event))
}
function snapshot () {
  const bot = agent?.bot
  return { at: new Date().toISOString(), phase: report.phase, username: config.username, playerUuid: bot?._client?.uuid ?? null,
    health: bot?.health ?? null, food: bot?.food ?? null, position: bot?.entity ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null,
    inventory: bot?.inventory?.items()?.map(i => ({ slot: i.slot, id: i.name, count: i.count })) ?? [],
    native: bot?.mawNative?.status() ?? null, model: modelBridge?.status() ?? null,
    presentation: presentationObserver?.status() ?? null, task: taskEvidence?.snapshot() ?? null }
}
function persist () {
  fs.writeFileSync(path.join(root, 'status.json.tmp'), JSON.stringify({ ...report, current: snapshot(), pid: process.pid }, null, 2))
  fs.renameSync(path.join(root, 'status.json.tmp'), path.join(root, 'status.json'))
}
let modelBridge
async function shutdown (reason, code = 0) {
  if (closing) return
  closing = true; report.phase = 'stopping'; report.reason = reason; clearInterval(heartbeat)
  modelBridge?.close()
  try { agent?.self_prompter?.stop(false); agent?.requestInterrupt(); agent?.bot?.pathfinder?.stop(); agent?.bot?.clearControlStates() } catch {}
  const waitEnd = Date.now() + 100000
  while (modelBridge?.status().inFlight && Date.now() < waitEnd) await new Promise(r => setTimeout(r, 200))
  const nativeWaitEnd = Date.now() + 20000
  while (agent?.bot?.mawNative?.status().inFlight && Date.now() < nativeWaitEnd) await new Promise(r => setTimeout(r, 50))
  try { agent?.history?.save() } catch {}
  const bot = agent?.bot
  if (bot) {
    bot._disposed = true
    try { const end = new Promise(r => { bot.once('end', r); setTimeout(r, 4000) }); bot.quit('Neko bounded trial finished'); await end } catch {}
  }
  try { await viewer?.close() } catch {}
  try { presentationObserver?.close() } catch {}
  try { stream?.detach?.() } catch {}
  try { bot?.mawNative?.close() } catch {}
  report.phase = 'stopped'; report.endedAt = new Date().toISOString(); record('stopped', { reason, code }); persist()
  if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.unlinkSync(lock)
  process.exit(code)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => void shutdown(signal))
process.on('uncaughtException', error => { report.errors.push({ kind: 'exception', message: String(error.message).slice(0, 240), stack: String(error.stack).slice(0, 2000) }); void shutdown('uncaught_exception', 1) })
process.on('unhandledRejection', error => { report.errors.push({ kind: 'rejection', message: String(error?.message || error).slice(0, 240) }); void shutdown('unhandled_rejection', 1) })
EventEmitter.defaultMaxListeners = 64
process.env.MC_FRAMEWORK_V2 = '0'
process.env.MC_ADMIN_MISSION = '0'
process.env.NEKO_AGENT_SCREENSHOT_INTERVAL_MS = '0'
process.env.DEBUG_CHAT = '0'
process.env.NEKO_PLUGIN_WS_HOST = '127.0.0.1'
process.env.NEKO_PLUGIN_WS_PORT = String(config.wsPort)
process.env.MAW_NEKO_ADAPTER_FILE = config.nativeRuntimeFile
process.env.MAW_NEKO_LEDGER_DIR = path.join(root, 'native-ledgers')
process.env.MAW_NEKO_CODINGPLAN_BRIDGE_FILE = config.modelBridgeFile
process.env.MAW_NEKO_CODINGPLAN_CONFIG = path.join(root, 'model-config.json')
const load = relative => import(pathToFileURL(path.join(config.nekoDirectory, relative)))
const { prepareNativeWorldPreviewHost, createNativePlayerPresentation } = await import(pathToFileURL(config.viewerHostFile))
const prepared = await prepareNativeWorldPreviewHost({ assetDirectory: config.assetDirectory, port: config.viewerPort })
const { attachNativeViewerPackets } = require(config.nativePacketFile)
const nbt = require('prismarine-nbt')
const { attachNativeModPresentation } = require('../world/src/neko-adapter/native-presentation.cjs')
// Agent's ESM graph has cycles and a top-level-await model registry. Import its
// public entry first; racing direct imports of cyclic command modules hits TDZ.
const { Agent } = await load('src/agent/agent.js')
const { createMindServer, registerAgent } = await load('src/mindcraft/mindserver.js')
const { serverProxy } = await load('src/agent/mindserver_proxy.js')
const { default: defaults } = await load('settings.js')
const queries = await load('src/agent/commands/queries.js')
const actions = await load('src/agent/commands/actions.js')
const allowed = new Set(['!modList', '!modExplain', '!modCall', '!modStatus', '!modResult', '!stats', '!inventory', '!entities', '!nearbyBlocks', '!craftable', '!goToCoordinates', '!searchForBlock', '!collectBlocks', '!craftRecipe', '!consume', '!stop'])
const attempts = require('../world/src/neko-adapter/task-attempts.cjs').createTaskAttemptGuard()
// Upstream runAsAction resolves labels by perform-function identity. Preserve
// those functions; observe body actions at ActionManager.runAction instead.
for (const command of [...queries.queryList, ...actions.actionsList.filter(c => c.name.startsWith('!mod'))]) {
  const original = command.perform
  command.perform = async (...args) => {
    if (closing) return JSON.stringify({ ok: false, code: 'NEKO_TRIAL_CLOSING', outcomeKnown: true, retryAutomatically: false })
    const began = Date.now()
    record('command_started', { name: command.name })
    try {
      const state = agent?.bot?.mawNative?.sdk?.menu?.current?.() ?? null
      const p = agent?.bot?.entity?.position
      const context = { position: p ? [p.x, p.y, p.z].map(n => Math.round(n * 10) / 10) : null,
        menu: state?.menuType ?? null, hand: state?.selectedHotbarSlot ?? agent?.bot?.quickBarSlot ?? null,
        held: state?.slots?.[36 + state?.selectedHotbarSlot]?.snbt ?? agent?.bot?.heldItem?.name ?? null, carried: state?.carried?.snbt ?? null }
      const rejected = command.name === '!modCall' ? attempts.before(args[1], args[2], context) : null
      const result = rejected ? JSON.stringify(rejected) : await original(...args)
      let receipt = {}
      try {
        const parsed = JSON.parse(result)
        if (command.name === '!modCall') attempts.observe(args[1], args[2], context, parsed)
        if (command.name === '!modCall') taskEvidence?.observe(parsed, Date.now(), JSON.parse(args[2]))
        receipt = Object.fromEntries(['ok', 'code', 'outcomeKnown', 'outcomeUnknown'].filter(key => Object.hasOwn(parsed, key)).map(key => [key, parsed[key]]))
        if (command.name === '!modCall') {
          const native = parsed.result ?? {}, operation = { playerUuid: parsed.playerUuid, operation: parsed.id ?? args[1],
            requestId: native.requestId ?? parsed.callId ?? null, at: new Date().toISOString(), ok: parsed.ok,
            readOnly: parsed.readOnly, changed: native.changed ?? null, code: native.code ?? parsed.code ?? null,
            outcomeUnknown: parsed.outcomeUnknown === true || native.outcomeKnown === false }
          report.modOperations.push(operation); if (report.modOperations.length > 8) report.modOperations.shift()
        }
      } catch {}
      const summary = { at: new Date().toISOString(), name: command.name, durationMs: Date.now() - began, result: String(result ?? '').slice(0, 450), receipt }
      report.commands.push(summary)
      fs.appendFileSync(path.join(root, 'command-results.jsonl'), JSON.stringify({ at: new Date().toISOString(), name: command.name, args: args.slice(1), result }) + '\n')
      record('command_finished', summary)
      return result
    } catch (error) { record('command_failed', { name: command.name, code: error.code ?? null, message: String(error.message).slice(0, 180) }); throw error }
  }
}
const settings = { ...defaults, minecraft_version: '1.21.1', host: '192.168.3.163', port: 28977, auth: 'offline',
  profile: config.profile, profiles: [], task: null, allow_insecure_coding: false, allow_vision: false, render_bot_view: false,
  auto_open_ui: false, chat_ingame: false, speak: false, language: 'en', only_chat_with: ['admin'],
  max_commands: 24, max_messages: 40, num_examples: 0, log_all_prompts: false,
  blocked_actions: [...queries.queryList, ...actions.actionsList].map(x => x.name).filter(name => !allowed.has(name)) }
const mindserver = createMindServer(false, config.mindPort)
registerAgent(settings, config.viewerPort)
await serverProxy.connect(config.username, config.mindPort)
agent = new Agent(); serverProxy.setAgent(agent)
agent.handleBotDisconnection = async reason => { if (!closing) { record('disconnected', { reason: String(reason).slice(0, 160) }); await shutdown('game_disconnected', 1) } }
const originalSetup = agent.setupBotEventHandlers.bind(agent)
agent.setupBotEventHandlers = bot => {
  stream = attachNativeViewerPackets(bot, prepared.registrySha256)
  const sdk = bot.mawNative.sdk
  presentationObserver = attachNativeModPresentation(bot, sdk)
  viewer = prepared.attach({ bot, nativeStream: stream, expectedUsername: config.username, simplifyNBT: nbt.simplify,
    getAgentStatus: () => ({ ...snapshot(), mode: report.phase === 'playing' ? 'acting' : report.phase,
      goal: config.task?.kind === 'create_windmill' ? '制作并启动机械动力风车' : config.task?.kind === 'create_food_chain' ? '风车磨粉、制作面包并进食' : config.mission, reason: report.reason ?? '',
      receipts: report.modOperations.map(c => ({ at: c.at, action: { type: c.operation }, result: { ok: c.ok, code: c.code ?? (c.ok ? 'native_receipt_ok' : 'native_receipt_refused'), outcomeUnknown: c.outcomeUnknown } })) }),
    getPresentationState: () => createNativePlayerPresentation({ playerUuid: bot._client.uuid, menu: sdk.menu.current(),
      ...presentationObserver.current(), modOperations: report.modOperations }) })
  void viewer.listen().then(() => record('viewer_ready', { url: viewer.url }))
  bot._client.on('packet', (data, meta) => {
    if (meta.name !== 'custom_payload' || !String(data.channel).startsWith('maw_agent:')) return
    report.privatePackets++
    fs.appendFileSync(path.join(root, 'native-packets.jsonl'), JSON.stringify({ at: new Date().toISOString(), channel: data.channel, base64: Buffer.from(data.data).toString('base64') }) + '\n')
  })
  bot.on('death', () => { report.deaths++; record('death'); void shutdown('trial_player_died', 1) })
  originalSetup(bot)
}
record('starting', { model: report.model, qwenpawConnected: false, mindPort: config.mindPort, wsPort: config.wsPort })
await agent.start(false, null, 0)
const originalRunAction = agent.actions.runAction.bind(agent.actions)
agent.actions.runAction = async (label, actionFn, options) => {
  if (closing) return { success: false, message: 'NEKO_TRIAL_CLOSING', interrupted: true }
  const began = Date.now(), before = snapshot()
  record('body_action_started', { label, position: before.position })
  try {
    const result = await originalRunAction(label, actionFn, options)
    const after = snapshot(), summary = { at: new Date().toISOString(), name: label, durationMs: Date.now() - began, result: String(result?.message ?? '').slice(0, 450), position: after.position }
    report.commands.push(summary)
    fs.appendFileSync(path.join(root, 'command-results.jsonl'), JSON.stringify({ at: new Date().toISOString(), name: label, before, after, result }) + '\n')
    record('body_action_finished', summary)
    return result
  } catch (error) { record('body_action_failed', { label, message: String(error.message).slice(0, 180) }); throw error }
}
// This is an action-verification trial, not unattended survival. Upstream
// self_preservation may dig shelter or preempt movement on village path blocks.
// Retire all autonomous modes; health loss stops our own trial instead.
for (const match of agent.bot.modes.getMiniDocs().matchAll(/^- ([a-z0-9_]+)\(/gm)) agent.bot.modes.setOn(match[1], false)
agent.bot.on('health', () => {
  if (report.initial && !closing && (config.task ? agent.bot.health < (config.minimumHealth ?? 8) : agent.bot.health < report.initial.health)) {
    void shutdown(config.task ? 'task_low_health' : 'trial_health_loss', 1)
  }
})
modelBridge = require(config.modelBridgeFile).fromEnvironment()
let previousPosition
heartbeat = setInterval(() => {
  if (closing) return
  const current = snapshot()
  if (current.position && previousPosition) report.pathDistance += Math.hypot(current.position.x - previousPosition.x, current.position.y - previousPosition.y, current.position.z - previousPosition.z)
  previousPosition = current.position
  persist()
  if (fs.existsSync(path.join(root, 'stop.requested'))) void shutdown('operator_stop')
  else if (Date.now() - startedAt > config.durationSeconds * 1000) void shutdown('bounded_trial_elapsed')
  else if (modelBridge.status().blocked) void shutdown('model_requires_review', 1)
}, 1000)
const deadline = Date.now() + 60000
while (!agent.bot.entity || !agent.vision_interpreter) {
  if (Date.now() > deadline) { await shutdown('spawn_timeout', 1); break }
  await new Promise(r => setTimeout(r, 250))
}
await new Promise(r => setTimeout(r, 2500))
if (closing) process.exit(0)
require('../world/src/neko-adapter/task-navigation.cjs').attachTaskNavigation(agent.bot)
record('task_navigation_constrained', { canDig: false, scaffolding: false, installedAfterSpawn: true })
if (config.task?.startAfterFile) {
  const marker = path.resolve(config.task.startAfterFile)
  if (path.dirname(marker) !== root) throw Error('NEKO_TASK_START_MARKER_OUTSIDE_STATE')
  report.phase = 'awaiting_task_start'; persist(); record('awaiting_task_start')
  while (!fs.existsSync(marker) && !closing) await new Promise(r => setTimeout(r, 250))
  if (closing) process.exit(0)
}
if (config.task) {
  const Evidence = config.task.kind === 'create_food_chain' ? require('../world/src/neko-adapter/food-chain-task.cjs').FoodChainTaskEvidence : require('../world/src/neko-adapter/windmill-task.cjs').WindmillTaskEvidence
  taskEvidence = new Evidence(agent.bot._client.uuid, config.task)
  // Reconstruct objective ownership from our durable completed receipts, never
  // from model claims or merely encountering a preexisting machine after reconnect.
  const journal = path.join(root, 'command-results.jsonl')
  const since = Date.parse(config.task.startedAt ?? report.startedAt)
  if (fs.existsSync(journal)) for (const line of fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line)
    if (entry.name === '!modCall' && Date.parse(entry.at) >= since) taskEvidence.observe(JSON.parse(entry.result), Date.parse(entry.at), JSON.parse(entry.args[1]))
  }
}
report.phase = 'playing'; report.initial = snapshot(); report.modelLoopStarted = true
require('../world/src/neko-adapter/task-context.cjs').attachTaskContext(agent.prompter, () => {
  const feedbackPath = path.join(root, 'task-feedback.txt')
  const bytes = fs.existsSync(feedbackPath) ? fs.readFileSync(feedbackPath) : Buffer.alloc(0)
  if (bytes.length > 8192) throw Error('NEKO_TASK_FEEDBACK_BUDGET_EXCEEDED')
  const objective = taskEvidence?.snapshot()
  const progress = objective ? { complete: objective.complete, progress: objective.progress, placedMachines: objective.placedMachines, placedBearings: objective.placedBearings,
    craftedOutputCounts: objective.crafts.reduce((map, row) => { map[row.outputId] = (map[row.outputId] ?? 0) + 1; return map }, {}),
    samples: objective.samples.slice(-2) } : null
  return config.mission + '\nVerified actual receipts (craft counts are calls, not item quantities): ' + JSON.stringify(progress) + '\nRecent known failed attempts (change approach, never retry unknown): ' + JSON.stringify(attempts.recent()) + '\nOperator clarification: ' + bytes.toString('utf8')
})
record('mission_started', { playerUuid: agent.bot._client.uuid, mission: config.mission }); persist()
for (let turn = 0; turn < missionTurns && !closing; turn++) {
  const remaining = modelBridge.status().maxCalls - modelBridge.status().calls
  if (remaining <= 0) { record('model_budget_completed', { calls: modelBridge.status().calls }); break }
  if (agent.bot.mawNative.status().mutationBlocked) { record('task_requires_reconciliation'); break }
  if (taskEvidence?.complete) break
  report.missionTurn = turn + 1
  const continuation = turn ? '\nContinue this same task from fresh observations. Do not repeat completed operations. Verified objective: ' + JSON.stringify(taskEvidence?.snapshot() ?? null) : ''
  const feedbackPath = path.join(root, 'task-feedback.txt')
  let feedback = ''
  if (fs.existsSync(feedbackPath)) {
    const bytes = fs.readFileSync(feedbackPath)
    if (bytes.length > 8192) throw Error('NEKO_TASK_FEEDBACK_BUDGET_EXCEEDED')
    feedback = '\nOperator task clarification:\n' + bytes.toString('utf8')
    record('task_feedback_applied', { bytes: bytes.length, turn: turn + 1 })
  }
  await agent.handleMessage('system', config.mission + continuation + feedback, Math.min(commandsPerTurn, remaining))
  persist()
}
if (taskEvidence?.complete) record('task_objective_verified', taskEvidence.snapshot())
if (!closing) { report.phase = 'observing'; report.afterMission = snapshot(); record('mission_returned'); persist() }
