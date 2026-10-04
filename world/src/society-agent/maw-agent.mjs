import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import readline from 'node:readline'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const { parsePlan, visibleSurfaces, unknownOutcome, gameJSON } = require('./plan.cjs')
const { QwenTaskClient } = require('./qwen-task-client.cjs')
const mineflayer = require('mineflayer'), nbt = require('prismarine-nbt')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { attachNativeViewerPackets } = require('../neoforge-handshake/native-viewer-packet.cjs')
const { attachMenuClient } = require('../neoforge-handshake/menu-client.cjs')
const { attachWorldClient } = require('../neoforge-handshake/world-client.cjs')
const { attachMaidClient } = require('../neoforge-handshake/maid-client.cjs')
const { attachColonyClient } = require('../neoforge-handshake/colony-client.cjs')
const { attachSpellClient } = require('../neoforge-handshake/spell-client.cjs')
const { craftNativeGrid } = require('../neoforge-handshake/native-crafting-client.cjs')
const { placeNativeHeld } = require('../neoforge-handshake/native-block-client.cjs')

const configPath = process.argv[2]
if (!configPath) throw Error('Usage: node maw-agent.mjs <private runtime config>')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (!/^[A-Za-z0-9_]{1,16}$/.test(config.username) || config.gameHost !== '127.0.0.1' || ![config.gamePort, config.viewerPort].every(p => Number.isInteger(p) && p > 1024 && p < 65536)) throw Error('AGENT_CONFIG_INVALID')
const root = fs.realpathSync(config.stateDirectory)
const stateFile = path.join(root, 'state.json'), ledger = path.join(root, 'actions.jsonl'), paused = path.join(root, 'autonomy.paused')
const old = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null
if (old && (old.username !== config.username || old.sessionId !== config.sessionId)) throw Error('AGENT_STATE_IDENTITY_MISMATCH')
const status = { schemaVersion: 1, username: config.username, sessionId: config.sessionId, online: false, mode: 'starting', goal: old?.goal || '在 My Agent World 生存、成长，建立自己的生活与社会关系', reason: '', round: old?.round || 0, deaths: old?.deaths || 0, receipts: [], lastDecision: old?.lastDecision || null, lastError: null }
// A lost process cannot turn an already dispatched action into a safe retry.
// Keep the complete ledger and stop autonomy for operator reconciliation.
if (fs.existsSync(ledger)) {
  const pending = new Map()
  for (const line of fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean)) {
    const event = JSON.parse(line)
    if (event.kind === 'action_intent') pending.set(event.actionId, event)
    if (event.kind === 'action_result') pending.delete(event.actionId)
  }
  if (pending.size && !fs.existsSync(paused)) fs.writeFileSync(paused, JSON.stringify({ reason: 'interrupted_action_outcome', actionIds: [...pending.keys()], at: new Date().toISOString() }))
}
function persist () {
  status.updatedAt = new Date().toISOString()
  fs.writeFileSync(stateFile + '.tmp', gameJSON(status, 2)); fs.renameSync(stateFile + '.tmp', stateFile)
}
function record (kind, body) {
  const event = { schemaVersion: 1, at: new Date().toISOString(), kind, ...body }
  const fd = fs.openSync(ledger, 'a')
  try { fs.writeSync(fd, gameJSON(event) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  console.log('MAW_AGENT ' + gameJSON(event))
  if (kind === 'action_result') status.receipts = [...status.receipts, event].slice(-8)
  persist()
}
function receiptSummaries () {
  return status.receipts.map(event => ({ at: event.at, actionId: event.actionId, action: event.action,
    result: Object.fromEntries(['ok', 'code', 'outcome', 'outcomeUnknown', 'outcomeKnown', 'effectVerified', 'castConfirmed', 'manaBefore', 'manaAfter', 'manaSpent', 'position', 'nativeBlock', 'beforeBlock', 'afterBlock', 'inventoryBefore', 'inventoryAfter', 'foodBefore', 'foodAfter', 'receiptIDs', 'remainingInputs', 'outputId', 'outputCount', 'count', 'truncated', 'maids', 'maid', 'tasks', 'spell', 'colonyId', 'colony', 'colonies', 'buildings', 'requests', 'citizens', 'itemId', 'accepted', 'inventoryRemaining', 'observed', 'selected', 'retryAutomatically', 'serverCode', 'phase', 'buildingPosition', 'builderPosition', 'requestStillOpen'].filter(key => event.result?.[key] !== undefined).map(key => [key, event.result[key]])) }))
}
const qwen = new QwenTaskClient({ baseURL: config.qwenURL, agentId: config.agentId, sessionId: config.sessionId, journalPath: path.join(root, 'model-task.json') })
const { prepareNativeWorldPreviewHost, createNativePlayerPresentation } = await import(pathToFileURL(path.resolve(config.viewerHostModule)))
const prepared = await prepareNativeWorldPreviewHost({ assetDirectory: config.assetDirectory, port: config.viewerPort })
const bot = mineflayer.createBot({ host: config.gameHost, port: config.gamePort, username: config.username, version: '1.21.1', auth: 'offline', hideErrors: true })
const stream = attachNativeViewerPackets(bot, prepared.registrySha256)
const menu = attachMenuClient(bot), query = attachWorldClient(bot), maid = attachMaidClient(bot), colony = attachColonyClient(bot), spell = attachSpellClient(bot)
let spellCatalog = null, spellObservedAt = null
const observeSpellReceipt = body => {
  if (body.playerUuid !== bot._client.uuid) return
  if (!spell.current()) { spellCatalog = null; spellObservedAt = null; return }
  if (body.state?.playerUuid === bot._client.uuid) spellObservedAt = Date.now()
  if (Array.isArray(body.spells)) spellCatalog = body
}
const clearSpellPresentation = () => { spellCatalog = null; spellObservedAt = null }
spell.events.on('receipt', observeSpellReceipt)
bot.on('spawn', clearSpellPresentation); bot.on('end', clearSpellPresentation)
const viewer = prepared.attach({ bot, expectedUsername: config.username, nativeStream: stream, simplifyNBT: nbt.simplify,
  getPresentationState: () => createNativePlayerPresentation({ playerUuid: bot._client.uuid, menu: menu.current(), spellState: spell.current(), spellCatalog, spellObservedAt }),
  getAgentStatus: () => JSON.parse(gameJSON({ ...status, receipts: receiptSummaries(), health: bot.health ?? null, food: bot.food ?? null, position: bot.entity?.position || null, native: stream.health(), modelTask: qwen.status?.() || null })) })
await viewer.listen()
bot.loadPlugin(pathfinder)
let closing = false, epoch = 0, navigationTimer = null
function stopMovement () { clearTimeout(navigationTimer); bot.pathfinder.stop(); bot.clearControlStates(); bot.stopDigging(); bot.deactivateItem() }
bot.on('spawn', () => {
  epoch++
  const movements = new Movements(bot)
  movements.canDig = false; movements.allow1by1towers = false; movements.allowParkour = false
  movements.allowFreeMotion = false; movements.maxDropDown = 2; movements.canOpenDoors = true
  bot.pathfinder.setMovements(movements)
  status.online = true; record('spawn', { uuid: bot._client.uuid, position: bot.entity.position, epoch })
})
bot.on('death', () => { epoch++; stopMovement(); status.deaths++; record('death', { position: bot.entity?.position, epoch }) })
bot.on('kicked', reason => { status.lastError = 'kicked:' + JSON.stringify(reason); record('kicked', { reason }); shutdown(1) })
bot.on('error', error => { status.lastError = error.message; record('connection_error', { error: error.message }) })
bot.on('end', reason => { status.online = false; record('connection_end', { reason }); if (!closing) shutdown(1) })
stream.events.on('unavailable', error => { status.lastError = error.message; record('native_unavailable', { error: error.message }); if (!closing) shutdown(1) })

const wait = ms => new Promise(r => setTimeout(r, ms))
const ownMenu = () => {
  const state = menu.current()
  if (!state || state.playerUuid?.toLowerCase() !== bot._client.uuid?.toLowerCase()) throw Error('OWN_MENU_UNAVAILABLE')
  return state
}
function safePosition (position, max = 16) {
  const pos = new Vec3(position.x, position.y, position.z)
  if (!bot.entity || bot.entity.position.distanceTo(pos.offset(0.5, 0, 0.5)) > max) throw Error('ACTION_OUTSIDE_LOADED_LOCAL_RANGE')
  if (viewer.world.stateIdAt(position) === null || !bot.blockAt(pos)) throw Error('ACTION_BLOCK_NOT_LOADED')
  return pos
}
async function navigate (position, near = 1) {
  const pos = safePosition(position)
  navigationTimer = setTimeout(() => bot.pathfinder.stop(), 25000)
  try { await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, near)) }
  finally { clearTimeout(navigationTimer); bot.clearControlStates() }
  return { ok: bot.entity.position.distanceTo(pos) < near + 1.5, position: bot.entity.position }
}
async function inspect () {
  // These are read-only queries under this exact authenticated player UUID.
  // Avoid asking the model to repeatedly list data that the observation then
  // accidentally hides; mutation still requires an explicit selected action.
  const nativeStatuses = await Promise.allSettled([maid.list(), colony.status(), spell.list()])
  const compactMod = value => {
    if (Array.isArray(value)) return value.slice(0, 24).map(compactMod)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['snbt', 'heldSnbt', 'requestId', 'replayScope'].includes(key)).map(([key, item]) => [key, compactMod(item)]))
    return value
  }
  const modStates = Object.fromEntries(['maid', 'colony', 'spell'].map((name, index) => [name, nativeStatuses[index].status === 'fulfilled' ? compactMod(nativeStatuses[index].value) : { available: false, error: nativeStatuses[index].reason?.message || 'read_only_query_unavailable' }]))
  const state = ownMenu()
  const entities = Object.values(bot.entities).filter(e => e.id !== bot.entity.id && e.position?.distanceTo(bot.entity.position) <= 12).slice(0, 16)
  return { account: bot.username, uuid: bot._client.uuid, health: bot.health, food: bot.food, position: bot.entity.position, time: bot.time,
    nativeStream: stream.health(), menu: { windowId: state.windowId, menuType: state.menuType, selectedHotbarSlot: state.selectedHotbarSlot, carried: state.carried,
      slots: state.slots.map((item, slot) => item?.count > 0 ? { slot, ...item } : null).filter(Boolean) },
    surfaces: visibleSurfaces(viewer.world, bot.entity.position),
    entities: entities.map(e => ({ entityId: e.id, name: e.name || e.displayName || null, type: e.type, position: e.position })),
    spells: spell.current(), modStates, receipts: receiptSummaries(), deaths: status.deaths, lastDecisionError: status.lastError }
}
async function execute (action, plannedEpoch) {
  const check = () => { if (closing || epoch !== plannedEpoch || !status.online || bot.health <= 0 || fs.existsSync(paused)) throw Error('ACTION_CONTEXT_CHANGED') }
  const guardedClient = new Proxy(bot._client, { get: (target, key) => key === 'write' ? (name, data) => { check(); return target.write(name, data) } : Reflect.get(target, key) })
  const guardedBot = new Proxy(bot, { get: (target, key) => key === '_client' ? guardedClient : typeof Reflect.get(target, key) === 'function' ? Reflect.get(target, key).bind(target) : Reflect.get(target, key) })
  check()
  if (!status.online || bot.health <= 0) throw Error('PLAYER_NOT_ALIVE')
  switch (action.type) {
    case 'inspect': return inspect()
    case 'navigate': return navigate(action.position)
    case 'gather': case 'dig': {
      const pos = safePosition(action.position, 12)
      if (bot.entity.position.distanceTo(pos) > 4.4) await navigate(action.position, 2)
      check()
      const block = bot.blockAt(pos), actual = await query.lookAtBlock(block)
      check()
      if (!actual.ok || actual.position.x !== pos.x || actual.position.y !== pos.y || actual.position.z !== pos.z) return { ok: false, code: 'not_visible_or_reachable', actual }
      if (action.expectedId && actual.block?.id !== action.expectedId) return { ok: false, code: 'native_identity_changed', actual }
      if (bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5)) > 5) return { ok: false, code: 'dig_out_of_reach' }
      const before = ownMenu().slots.filter(s => s?.count).map(s => ({ id: s.id, count: s.count }))
      await bot.dig(block, true)
      check()
      await wait(700)
      check()
      const stateId = viewer.world.stateIdAt(action.position), id = viewer.world.states.get(stateId)?.name
      if (action.type === 'gather' && ['minecraft:air', 'minecraft:cave_air'].includes(id)) {
        try { await navigate(action.position, 1) } catch {}
        await wait(900)
        check()
      }
      return { ok: ['minecraft:air', 'minecraft:cave_air'].includes(id), position: action.position, beforeBlock: actual.block, afterBlock: id, inventoryBefore: before, inventoryAfter: ownMenu().slots.filter(s => s?.count).map(s => ({ id: s.id, count: s.count })) }
    }
    case 'craft': return craftNativeGrid({ current: () => { check(); return menu.current() }, click: (slot, button) => { check(); return menu.click(slot, button) } }, action)
    case 'select': bot.setQuickBarSlot(action.hotbarSlot); bot._client.write('held_item_slot', { slotId: action.hotbarSlot }); await wait(150); return { ok: ownMenu().selectedHotbarSlot === action.hotbarSlot, selectedHotbarSlot: ownMenu().selectedHotbarSlot }
    case 'place': return placeNativeHeld(guardedBot, menu, query, { hotbarSlot: action.hotbarSlot, itemId: action.itemId, expectedBlockId: action.blockId, referenceBlock: bot.blockAt(safePosition(action.position, 5)), face: new Vec3(action.face.x, action.face.y, action.face.z), verificationOffset: action.verificationOffset || [0.5, 0.5, 0.5] })
    case 'use_block': {
      const block = bot.blockAt(safePosition(action.position, 5)), actual = await query.lookAtBlock(block)
      check()
      if (!actual.ok) return actual
      await bot.activateBlock(block); await wait(500)
      return { ok: true, code: 'interaction_sent_inspect_result', nativeBlock: actual.block, menu: ownMenu(), effectVerified: false }
    }
    case 'use_item': bot.activateItem(); await wait(500); bot.deactivateItem(); return { ok: true, code: 'interaction_sent_inspect_result', effectVerified: false, menu: ownMenu() }
    case 'eat': {
      const food = bot.inventory.items().find(i => i.name === action.item || ['bread', 'apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'baked_potato', 'carrot'].includes(i.name))
      if (!food || bot.food >= 20) return { ok: false, code: food ? 'already_full' : 'no_edible_item' }
      const before = bot.food; await bot.equip(food, 'hand'); check(); await bot.consume(); await wait(250)
      return { ok: bot.food > before, foodBefore: before, foodAfter: bot.food }
    }
    case 'attack': {
      const target = bot.entities[action.entityId]
      const hostile = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'spider', 'cave_spider', 'witch', 'pillager', 'vindicator', 'creeper', 'endermite', 'silverfish'])
      if (!target || !hostile.has(target.name) || target.position.distanceTo(bot.entity.position) > 3.2) return { ok: false, code: 'no_reachable_hostile' }
      await bot.lookAt(target.position.offset(0, 1, 0)); check(); bot.attack(target); await wait(650)
      return { ok: true, code: 'attack_sent', effectVerified: false, target: { id: target.id, type: target.name, position: target.position } }
    }
    case 'menu_click': return menu.click(action.slot, action.button ?? 0)
    case 'close_menu': { const id = ownMenu().windowId; if (id !== 0) bot._client.write('close_window', { windowId: id }); await wait(250); return { ok: ownMenu().windowId === 0 } }
    case 'maid': {
      const arg = action.args || {}, uuid = action.maidUuid
      if (action.operation === 'list') return maid.list()
      if (action.operation === 'status') return maid.status(uuid)
      if (action.operation === 'tasks') return maid.tasks(uuid)
      if (action.operation === 'follow') return maid.setFollow({ maidUuid: uuid, follow: arg.follow })
      if (action.operation === 'pickup') return maid.setPickup({ maidUuid: uuid, pickup: arg.pickup })
      if (action.operation === 'task') return maid.setTask({ maidUuid: uuid, taskId: arg.taskId })
      return maid.openBag({ maidUuid: uuid })
    }
    case 'colony': return colony[action.operation](action.args || {})
    case 'spell': return action.operation === 'list' ? spell.list() : action.operation === 'explain' ? spell.explain(action.id) : spell.cast(action.id)
    case 'wait': await wait(action.seconds * 1000); return { ok: true, waitedSeconds: action.seconds }
    default: throw Error('UNSUPPORTED_ACTION')
  }
}

const guide = `你是 My Agent World 的普通生存玩家 ${config.username}，这是你长期生活的世界，不是服主。制定你自己的生活目标，真实采集、合成、种地、建设、探索、发展殖民地并照顾自己的东方女仆伙伴。现在从一无所有起步，先解决木材、基础工具、食物和避难处，再逐步探索农夫乐事/Create/Ars/MineColonies/TLM。没有物资就真实获取，不能假称完成，不请求give/tp。保持跨轮同一目标与实际进展，失败查原因再改变方案。
每轮只输出一个 JSON 对象，例如 {"goal":"采集天然木材","reason":"先建立工具与补给","actions":[{"type":"inspect"},{"type":"navigate","position":{"x":10,"y":64,"z":20}}]}，最多8动作。每个动作使用type字段，不要用技能名称代替type。没有markdown，不要执行宿主文件/终端工具。仅此JSON用于你的真实游戏身体。所有坐标为绝对整数；一次导航目标距当前位置<=16格，路径不能自动挖路搭路。surfaces是8格内第一可见表面，不能透视地下矿石。gather/dig需真实直视方块，expectedId可校验原生ID。
动作：inspect；navigate(position)；gather(position,expectedId)挖一次并走近拾取；dig(position,expectedId)；craft(ingredients:[{slot,id,count:1}],outputId,outputCount)真实原生合成；select(hotbarSlot:0..8)；place(position:参照方块坐标,face:{x,y,z}:一个方向为±1,hotbarSlot,itemId,blockId)；use_block(position)；use_item；eat(item可选原版名称)；attack(entityId，仅3格内敌对怪一次)；menu_click(slot,button:0拾取整堆/1放一个)；close_menu；wait(seconds<=30)。背包合成格1..4两行两列，结果0；工作台合成格1..9三行，结果0。真实背包菜单物品9..44，快捷栏36..44。craft要求空网格/空cursor，辅助器使用真实组件和回执，不发明配方；木板=1原木放slot1产4对应木板，工作台=4木板放slots1,2,3,4，木棍=slots1,3木板产4。配方材料与物品ID必须是库存中真实原生ID。
模组动作：maid(operation:list/status/tasks/follow/pickup/task/bag,maidUuid,args)，只操作本人已拥有、8格内伙伴。例如{"type":"maid","operation":"follow","maidUuid":"从modStates.maid.maids读取的真实uuid","args":{"follow":true}}。modStates含本人的实际女仆/殖民地/法术只读状态，已有uuid不要反复登记或发明身份。女仆hunger=0为模组未使用字段，不能当成饿死。colony(operation:status/found/placeBuilder/requestBuild/deliver/stockResource,args，真实库存/建筑材料/位置/expectedSnbt)；其inventorySlot0..8对应背包菜单36..44的快捷栏，其9..35对应普通库存9..35。spell(operation:list/explain/cast,id原生法术)，真实持书魔力/冷却。先获取准确字段，做不了报告能力/资源缺口。界面点击失败未知不能重投；使用交互sent并非效果已验证。施法castConfirmed且manaSpent才是确认，不夸大effectVerified:false。epoch死亡/重生变化时旧动作立即取消。
每轮优先查看健康、饥饿、menu的cursor/网格和最近回执。cursor有物品要放回真实空格，网格剩料要回收，不再盲craft。不要挖脚下、不往水/岩浆/怪物里导航。低血应先避险/进食。经确证消失或重生要重看状态。开箱/工作台/女仆背包后完成交互请close_menu。`

async function loop () {
  while (!closing) {
    if (!status.online || !menu.current() || bot.health <= 0) { status.mode = 'waiting_for_player'; persist(); await wait(1000); continue }
    if (fs.existsSync(paused)) { status.mode = 'paused'; persist(); await wait(1000); continue }
    try {
      const observedEpoch = epoch
      const observation = await inspect()
      if (closing || fs.existsSync(paused) || observedEpoch !== epoch || !status.online || bot.health <= 0) { record('observation_discarded', { reason: 'player_context_changed' }); await wait(1000); continue }
      status.mode = 'thinking'; status.round++; status.lastError = null; persist()
      const decision = await qwen.run(guide + '\n当前真实观察：\n' + gameJSON(observation) + '\n持续目标：' + status.goal)
      if (closing) break
      if (decision.status !== 'completed') throw Error(`${decision.status === 'unknown' ? 'MODEL_TASK_UNKNOWN' : 'MODEL_TASK_' + String(decision.status).toUpperCase()}: ${decision.error?.nativeCode || decision.error?.code || decision.taskId || 'no task handle'}`)
      if (decision.resumed === true) { record('decision_discarded', { taskId: decision.taskId, reason: 'task_resumed_from_previous_observation' }); await wait(1000); continue }
      if (observedEpoch !== epoch || !status.online || bot.health <= 0) { record('decision_discarded', { taskId: decision.taskId, reason: 'player_epoch_changed' }); await wait(1000); continue }
      const plan = parsePlan(decision.text)
      status.goal = plan.goal; status.reason = plan.reason; status.lastDecision = { at: new Date().toISOString(), taskId: decision.taskId, actions: plan.actions }; record('decision', status.lastDecision)
      status.mode = 'acting'; const plannedEpoch = epoch
      for (const action of plan.actions) {
        if (closing || fs.existsSync(paused) || epoch !== plannedEpoch || bot.health <= 0) break
        const actionId = randomUUID()
        record('action_intent', { actionId, action })
        try {
          const result = await execute(action, plannedEpoch)
          record('action_result', { actionId, action, result })
          if (unknownOutcome(result)) { fs.writeFileSync(paused, JSON.stringify({ reason: 'unknown_action_outcome', actionId, action, at: new Date().toISOString() })); status.mode = 'paused_unknown'; break }
          if (result?.ok === false && !['inspect', 'maid', 'colony', 'spell'].includes(action.type)) break
        } catch (error) {
          const unknown = /TIMEOUT|CONNECTION_CLOSED|UNKNOWN|uncertain/i.test(error.message)
          record('action_result', { actionId, action, result: { ok: false, code: error.message, outcome: unknown ? 'unknown' : 'known_rejection', retryAutomatically: false } })
          if (unknown) { fs.writeFileSync(paused, JSON.stringify({ reason: 'unknown_action_outcome', actionId, action, at: new Date().toISOString() })); status.mode = 'paused_unknown' }
          break
        }
      }
      status.mode = fs.existsSync(paused) ? 'paused' : 'observing'; persist(); await wait(config.decisionIntervalMs || 15000)
    } catch (error) {
      status.lastError = error.message; record('decision_error', { error: error.message })
      if (/UNKNOWN|UNCERTAIN|INTENT_PENDING|TASK_NOT_FOUND/i.test(error.message)) { fs.writeFileSync(paused, JSON.stringify({ reason: 'unknown_model_task', error: error.message })); status.mode = 'paused_unknown' }
      else if (/MODEL_QUOTA_EXCEEDED|AUTHENTICATION|MODEL_NOT_FOUND|SUBMISSION_REJECTED/.test(error.message)) { fs.writeFileSync(paused, JSON.stringify({ reason: 'model_configuration_or_quota', error: error.message })); status.mode = 'paused_model' }
      else status.mode = 'decision_backoff'
      persist(); await wait(30000)
    }
  }
}
const heartbeat = setInterval(persist, 3000)
async function shutdown (code = 0) {
  if (closing) return
  closing = true; stopMovement(); clearInterval(heartbeat)
  status.mode = 'stopping'; persist()
  await viewer.close(); stream.detach(); bot.quit('My Agent World supervisor stopping')
  spell.events.off('receipt', observeSpellReceipt)
  bot.off('spawn', clearSpellPresentation); bot.off('end', clearSpellPresentation)
  for (const client of [menu, query, maid, colony, spell]) client.detach()
  setTimeout(() => process.exit(code), 500).unref()
}
readline.createInterface({ input: process.stdin }).on('line', line => { if (line.trim() === '{"kind":"shutdown"}') shutdown(0) })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => shutdown(0))
record('worker_started', { viewer: viewer.url, account: bot.username, agentId: config.agentId })
await loop()
