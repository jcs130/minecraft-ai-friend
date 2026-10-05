import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import readline from 'node:readline'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const { parsePlan, visibleSurfaces, unknownOutcome, gameJSON } = require('./plan.cjs')
const { QwenTaskClient } = require('./qwen-task-client.cjs')
const { modelDecisionError, classifyModelFailure, restoreModelBackoff, nextModelBackoff, modelBackoffRemaining } = require('./model-failure-policy.cjs')
const { runActionWithDeadline, installActionPacketFence } = require('./action-deadline.cjs')
const { nearbyNativeEntities, validateNativeEntityTarget, validateNativeAttackTarget } = require('./native-entity-observation.cjs')
const { nativeInventorySnapshot, nativeInventoryDelta, nativeDigResult, summarizeNativeInventoryReceipt } = require('./native-inventory-delta.cjs')
const { selectNativeHotbar } = require('./native-hotbar-selection.cjs')
const { attachNativeWorldQuery } = require('./native-world-query.cjs')
const { agentToolCatalog } = require('./tool-catalog.cjs')
const { nativeFoodOptions, consumeNativeFood } = require('./native-food.cjs')
const { boundModReceipt, verifyMaidOutcome, verifyEntityInteraction } = require('./native-mod-outcomes.cjs')
const { nativeBlockInteractionPacket, readNativeBlockBeforeAction } = require('./native-block-interaction.cjs')
const { createNativeRecipeDiscovery } = require('./native-recipe-discovery.cjs')
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
const status = { schemaVersion: 1, username: config.username, sessionId: config.sessionId, online: false, mode: 'starting', goal: old?.goal || '在 My Agent World 生存、成长，建立自己的生活与社会关系', reason: '', round: old?.round || 0, deaths: old?.deaths || 0, receipts: [], lastDecision: old?.lastDecision || null, lastError: null, modelBackoff: restoreModelBackoff(old?.modelBackoff) }
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
function compactReceipt (result) {
  const value = summarizeNativeInventoryReceipt(result)
  // Full recipe definitions/components stay in the private action journal.
  // Repeat only a bounded discovery summary into model/viewer observations.
  if (Array.isArray(value.recipes)) value.recipes = value.recipes.map(recipe => ({ recipeId: recipe.recipeId, type: recipe.type,
    serializer: recipe.serializer, definitionAvailable: recipe.definitionAvailable, code: recipe.code,
    ingredients: recipe.ingredients?.map(ingredient => ({ index: ingredient.index, empty: ingredient.empty, requiredCount: ingredient.requiredCount,
      alternatives: ingredient.alternatives?.map(item => ({ id: item.id, count: item.count })) })),
    output: recipe.output && { id: recipe.output.id, count: recipe.output.count }, grid: recipe.grid, processing: recipe.processing }))
  return value
}
function receiptSummaries () {
  return status.receipts.map(event => ({ at: event.at, actionId: event.actionId, action: event.action,
    result: compactReceipt(Object.fromEntries(['ok', 'code', 'outcome', 'outcomeUnknown', 'outcomeKnown', 'blockBroken', 'pickupConfirmed', 'inventoryDelta', 'effectVerified', 'castConfirmed', 'manaBefore', 'manaAfter', 'manaSpent', 'position', 'block', 'hit', 'nativeBlock', 'beforeBlock', 'afterBlock', 'inventoryBefore', 'inventoryAfter', 'foodBefore', 'foodAfter', 'consumedCount', 'receiptIDs', 'remainingInputs', 'outputId', 'outputCount', 'count', 'truncated', 'maids', 'maid', 'tasks', 'spell', 'colonyId', 'colony', 'colonies', 'buildings', 'requests', 'citizens', 'itemId', 'accepted', 'inventoryRemaining', 'observed', 'selected', 'requestedHotbarSlot', 'selectedHotbarSlot', 'lastObservedHotbarSlot', 'proofSource', 'retryAutomatically', 'serverCode', 'phase', 'buildingPosition', 'builderPosition', 'requestStillOpen', 'tools', 'tool', 'limits', 'recipes', 'recipeTypes', 'matchedCount', 'offset', 'nextOffset', 'source', 'entity', 'attackPurpose', 'attackSent', 'target', 'healthBefore', 'healthAfter', 'postcondition', 'menuOpened', 'windowId', 'menuType', 'observedChanges'].filter(key => event.result?.[key] !== undefined).map(key => [key, event.result[key]]))) }))
}
const qwen = new QwenTaskClient({ baseURL: config.qwenURL, agentId: config.agentId, sessionId: config.sessionId, journalPath: path.join(root, 'model-task.json') })
const { prepareNativeWorldPreviewHost, createNativePlayerPresentation } = await import(pathToFileURL(path.resolve(config.viewerHostModule)))
const prepared = await prepareNativeWorldPreviewHost({ assetDirectory: config.assetDirectory, port: config.viewerPort })
const bot = mineflayer.createBot({ host: config.gameHost, port: config.gamePort, username: config.username, version: '1.21.1', auth: 'offline', hideErrors: true })
const stream = attachNativeViewerPackets(bot, prepared.registrySha256)
const menu = attachMenuClient(bot), query = attachWorldClient(bot), maid = attachMaidClient(bot), colony = attachColonyClient(bot), spell = attachSpellClient(bot)
const nativeQuery = attachNativeWorldQuery(bot)
const recipeDiscovery = createNativeRecipeDiscovery(nativeQuery)
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
let closing = false, epoch = 0, activeActionScope = null, nativeBlockUseSequence = 0
const actionFence = installActionPacketFence(bot._client, info => record('interrupted_action_packet_blocked', info))
function stopMovement () {
  // stop() waits for a subsequent path node; setGoal(null) immediately emits
  // goal_updated and rejects goto's promise in the locked pathfinder version.
  let failed = false
  for (const stop of [() => bot.pathfinder.setGoal(null), () => bot.clearControlStates(),
    () => bot.stopDigging(), () => bot.deactivateItem()]) {
    try { stop() } catch { failed = true }
  }
  if (failed) throw Error('ACTION_BODY_STOP_INCOMPLETE')
}
bot.on('spawn', () => {
  epoch++
  const movements = new Movements(bot)
  movements.canDig = false; movements.allow1by1towers = false; movements.allowParkour = false
  movements.allowFreeMotion = false; movements.maxDropDown = 2; movements.canOpenDoors = true
  bot.pathfinder.setMovements(movements)
  status.online = true; record('spawn', { uuid: bot._client.uuid, position: bot.entity.position, epoch })
})
bot.on('death', () => { epoch++; activeActionScope?.abort('context'); try { stopMovement() } catch {} status.deaths++; record('death', { position: bot.entity?.position, epoch }) })
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
async function navigate (position, near = 1, actionScope) {
  actionScope?.check()
  const pos = safePosition(position)
  try {
    await runActionWithDeadline(async scope => {
      scope.phase('navigate'); actionScope?.check()
      await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, near))
      scope.check(); actionScope?.check()
    }, { timeoutMs: 25000, checkContext: () => actionScope?.check(), onAbort: ({ reason }) => {
      // Cancel the outer action synchronously, before native goto's late
      // continuation can perform pickup or any subsequent mutation.
      actionScope?.abort(reason === 'deadline' ? 'deadline' : 'context')
      stopMovement()
    } })
  } finally { bot.clearControlStates() }
  actionScope?.check()
  return { ok: bot.entity.position.distanceTo(pos) < near + 1.5, position: bot.entity.position }
}
async function inspect () {
  // These are read-only queries under this exact authenticated player UUID.
  // Avoid asking the model to repeatedly list data that the observation then
  // accidentally hides; mutation still requires an explicit selected action.
  const observingUuid = bot._client.uuid, observingEpoch = epoch
  const nativeStatuses = await Promise.allSettled([maid.list(), colony.status(), spell.list(), recipeDiscovery.get(observingUuid, observingEpoch)])
  const compactMod = value => {
    if (Array.isArray(value)) return value.slice(0, 24).map(compactMod)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['snbt', 'heldSnbt', 'requestId', 'replayScope'].includes(key)).map(([key, item]) => [key, compactMod(item)]))
    return value
  }
  const modStates = Object.fromEntries(['maid', 'colony', 'spell'].map((name, index) => [name,
    nativeStatuses[index].status === 'fulfilled' && boundModReceipt(nativeStatuses[index].value, bot._client.uuid)
      ? compactMod(nativeStatuses[index].value) : { available: false, error: 'same_player_mod_query_unavailable' }]))
  // Do not truncate the real recipe type catalogue or an incomplete-definition
  // reason. This is one native recipe page, cached for at least 30 seconds.
  modStates.recipes = nativeStatuses[3].status === 'fulfilled' && boundModReceipt(nativeStatuses[3].value, bot._client.uuid) &&
    observingUuid === bot._client.uuid && observingEpoch === epoch ? nativeStatuses[3].value :
    { available: false, error: 'same_player_recipe_discovery_unavailable' }
  const state = ownMenu()
  const inventory = nativeInventorySnapshot(state, bot._client.uuid)
  const entityObservation = nearbyNativeEntities(viewer.world.entitySnapshot(), {
    uuid: bot._client.uuid, entityId: bot.entity.id, position: bot.entity.position })
  return { account: bot.username, uuid: bot._client.uuid, health: bot.health, food: bot.food, self: state.self ?? null, position: bot.entity.position, time: bot.time,
    nativeStream: stream.health(), menu: { windowId: state.windowId, menuType: state.menuType, selectedHotbarSlot: state.selectedHotbarSlot, carried: state.carried,
      slotLayout: state.slotLayout ?? null, dataValues: state.dataValues ?? null,
      slots: state.slots.map((item, slot) => item?.count > 0 ? { slot, ...item } : null).filter(Boolean) },
    inventory, foodOptions: nativeFoodOptions(state, bot._client.uuid),
    surfaces: visibleSurfaces(viewer.world, bot.entity.position),
    entities: entityObservation.entities, entityObservation,
    spells: spell.current(), modStates, receipts: receiptSummaries(), deaths: status.deaths, lastDecisionError: status.lastError }
}
function checkActionContext (plannedEpoch) {
  const reason = closing ? 'shutdown' : fs.existsSync(paused) ? 'maintenance' :
    epoch !== plannedEpoch || !status.online || bot.health <= 0 ? 'context' : null
  if (reason) { const error = Error('ACTION_CONTEXT_CHANGED'); error.actionInterruptionReason = reason; throw error }
}
async function execute (action, plannedEpoch, scope) {
  const check = () => { scope.check(); checkActionContext(plannedEpoch) }
  const pause = ms => scope.wait(ms)
  const guardedClient = new Proxy(bot._client, { get: (target, key) => key === 'write' ? (name, data) => { check(); return target.write(name, data) } : Reflect.get(target, key) })
  const guardedBot = new Proxy(bot, { get: (target, key) => key === '_client' ? guardedClient : typeof Reflect.get(target, key) === 'function' ? Reflect.get(target, key).bind(target) : Reflect.get(target, key) })
  const select = slot => selectNativeHotbar({ menu, client: bot._client, expectedUuid: bot._client.uuid, slot,
    check, signal: scope.signal, timeoutMs: 5000, sendSelection: selected => {
      check(); const locallySelected = bot.quickBarSlot === selected; bot.setQuickBarSlot(selected)
      if (locallySelected) guardedClient.write('held_item_slot', { slotId: selected })
    } })
  const body = () => ({ uuid: bot._client.uuid, entityId: bot.entity.id, position: bot.entity.position })
  check()
  if (!status.online || bot.health <= 0) throw Error('PLAYER_NOT_ALIVE')
  switch (action.type) {
    case 'tools': return agentToolCatalog(action.operation === 'explain' ? action.id : undefined)
    case 'recipes': { const result = await nativeQuery.recipes(action.args); check(); return result }
    case 'entity_inspect': { const result = await nativeQuery.entity(action); check(); return result }
    case 'inspect': { const result = await inspect(); check(); return result }
    case 'navigate': return navigate(action.position, 1, scope)
    case 'gather': case 'dig': {
      const pos = safePosition(action.position, 12)
      scope.phase('approach')
      if (bot.entity.position.distanceTo(pos) > 4.4) await navigate(action.position, 2, scope)
      check()
      const block = bot.blockAt(pos), actual = await readNativeBlockBeforeAction(query, block, [0.5, 0.5, 0.5], check)
      check()
      if (!actual.ok || !boundModReceipt(actual, bot._client.uuid) || actual.position.x !== pos.x || actual.position.y !== pos.y || actual.position.z !== pos.z) return { ok: false, code: 'not_visible_or_reachable', actual }
      if (action.expectedId && actual.block?.id !== action.expectedId) return { ok: false, code: 'native_identity_changed', actual }
      if (bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5)) > 5) return { ok: false, code: 'dig_out_of_reach' }
      const before = nativeInventorySnapshot(ownMenu(), bot._client.uuid)
      if (!before.available && action.type === 'gather') return { ok: false, code: 'native_inventory_unavailable_before_dig', blockBroken: false,
        pickupConfirmed: false, reason: before.reason, outcomeKnown: true, retryAutomatically: false }
      // dig(forceLook) itself awaits lookAt before installing stopDigging.
      // Split that await so a cancelled look cannot later start a new dig.
      scope.phase('aim'); await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true); check()
      scope.phase('dig'); await bot.dig(block, 'ignore')
      check()
      scope.phase('verify'); await pause(700)
      check()
      const stateId = viewer.world.stateIdAt(action.position), id = viewer.world.states.get(stateId)?.name
      if (action.type === 'gather' && ['minecraft:air', 'minecraft:cave_air'].includes(id)) {
        scope.phase('pickup')
        try { await navigate(action.position, 1, scope) } catch (error) { check(); if (error.result?.outcomeUnknown) throw error }
        await pause(900)
        check()
      }
      return nativeDigResult({ type: action.type, position: action.position, beforeBlock: actual.block, afterBlock: id,
        beforeInventory: before, afterInventory: nativeInventorySnapshot(menu.current(), bot._client.uuid) })
    }
    case 'craft': return craftNativeGrid({ current: () => { check(); return menu.current() }, click: (slot, button) => { check(); return menu.click(slot, button) } }, action)
    case 'select': return select(action.hotbarSlot)
    case 'place': return placeNativeHeld(guardedBot, menu, query, { hotbarSlot: action.hotbarSlot, itemId: action.itemId, expectedBlockId: action.blockId, referenceBlock: bot.blockAt(safePosition(action.position, 5)), face: new Vec3(action.face.x, action.face.y, action.face.z), verificationOffset: action.verificationOffset || [0.5, 0.5, 0.5] })
    case 'block_inspect': case 'use_block': {
      const block = bot.blockAt(safePosition(action.position, action.type === 'block_inspect' ? 8 : 5)), offset = action.aimOffset ?? [0.5, 0.5, 0.5]
      const actual = await readNativeBlockBeforeAction(query, block, offset, check)
      check()
      if (!actual.ok || !boundModReceipt(actual, bot._client.uuid)) return { ok: false, code: actual.code || 'same_player_block_query_unavailable', outcomeKnown: true, retryAutomatically: false }
      if (action.expectedId && actual.block.id !== action.expectedId) return { ok: false, code: 'native_identity_changed', nativeBlock: actual.block, retryAutomatically: false }
      if (action.type === 'block_inspect') return actual
      const beforeMenu = ownMenu(), beforeInventory = nativeInventorySnapshot(beforeMenu, bot._client.uuid)
      // Mineflayer.activateBlock re-aims at the voxel centre. Use the actual
      // server-ray face and cursor, which may differ from the requested aim.
      const use = nativeBlockInteractionPacket(actual, { playerUuid: bot._client.uuid, position: action.position, sequence: nativeBlockUseSequence + 1 })
      if (!use.ok) return use
      nativeBlockUseSequence++; guardedClient.write('block_place', use.packet)
      await pause(500); check()
      const after = await query.lookAtBlock(block, offset); check()
      const afterMenu = ownMenu(), inventoryDelta = nativeInventoryDelta(beforeInventory, nativeInventorySnapshot(afterMenu, bot._client.uuid))
      const menuOpened = afterMenu.windowId > 0 && afterMenu.windowId !== beforeMenu.windowId
      const itemChanged = inventoryDelta.available && (inventoryDelta.added.length > 0 || inventoryDelta.removed.length > 0)
      return { ok: true, code: menuOpened || itemChanged ? 'native_block_interaction_observed' : 'native_block_interaction_sent_unverified',
        nativeBlock: actual.block, observed: boundModReceipt(after, bot._client.uuid) ? after : null, inventoryDelta, menuOpened,
        windowId: afterMenu.windowId, menuType: afterMenu.menuType, effectVerified: menuOpened || itemChanged, retryAutomatically: false }
    }
    case 'use_item': bot.activateItem(); await pause(500); check(); bot.deactivateItem(); return { ok: true, code: 'interaction_sent_inspect_result', effectVerified: false, menu: ownMenu() }
    case 'eat': return consumeNativeFood({ bot: guardedBot, menu, uuid: bot._client.uuid, check, wait: pause, select,
      itemId: action.itemId ?? (action.item ? (action.item.includes(':') ? action.item : `minecraft:${action.item}`) : undefined), inventorySlot: action.inventorySlot })
    case 'attack': case 'entity_interact': {
      const target = bot.entities[action.entityId]
      const interaction = action.type === 'entity_interact', validate = interaction ? validateNativeEntityTarget : validateNativeAttackTarget
      const options = { expectedUuid: action.expectedUuid, expectedId: action.expectedId, intent: action.intent ?? 'combat', interaction }
      const evidence = await nativeQuery.entity(action); check()
      const nativeTarget = validate(viewer.world.entitySnapshot(), target, body(), evidence, options)
      if (!nativeTarget.ok) return nativeTarget
      await bot.lookAt(target.position.offset(0, 1, 0), true); check(); await pause(150); check()
      const secondEvidence = await nativeQuery.entity(action); check()
      const stillTarget = validate(viewer.world.entitySnapshot(), bot.entities[action.entityId], body(), secondEvidence, options)
      if (!stillTarget.ok || stillTarget.nativeEntity.uuid !== nativeTarget.nativeEntity.uuid) return { ok: false, code: 'native_target_changed_before_attack' }
      const beforeMenu = ownMenu()
      if (interaction) guardedClient.write('use_entity', { target: action.entityId, mouse: 0, hand: action.hand === 'off' ? 1 : 0, sneaking: false })
      else bot.attack(bot.entities[action.entityId])
      await pause(650); check()
      const after = await nativeQuery.entity(action); check()
      if (interaction) return { ...verifyEntityInteraction(beforeMenu, ownMenu(), secondEvidence, after, bot._client.uuid), target: stillTarget.nativeEntity }
      const healthBefore = secondEvidence.entity.health, healthAfter = boundModReceipt(after, bot._client.uuid) && after.ok && after.entity?.uuid === secondEvidence.entity.uuid ? after.entity.health : null
      const damageObserved = Number.isFinite(healthBefore) && Number.isFinite(healthAfter) && healthAfter < healthBefore
      return { ok: true, code: damageObserved ? 'native_target_health_decreased' : 'attack_sent_unverified', attackSent: true,
        attackPurpose: stillTarget.attackPurpose, effectVerified: damageObserved, target: stillTarget.nativeEntity, healthBefore, healthAfter,
        postcondition: { source: 'server_native_entity_state', damageObserved, killConfirmed: false }, retryAutomatically: false }
    }
    case 'menu_click': return menu.click(action.slot, action.button ?? 0)
    case 'close_menu': { const id = ownMenu().windowId; if (id !== 0) bot._client.write('close_window', { windowId: id }); await pause(250); check(); return { ok: ownMenu().windowId === 0 } }
    case 'maid': {
      const arg = action.args || {}, uuid = action.maidUuid
      if (action.operation === 'list') return maid.list()
      if (action.operation === 'status') return maid.status(uuid)
      if (action.operation === 'tasks') return maid.tasks(uuid)
      if (['follow', 'pickup', 'task'].includes(action.operation)) {
        const result = action.operation === 'follow' ? await maid.setFollow({ maidUuid: uuid, follow: arg.follow }) :
          action.operation === 'pickup' ? await maid.setPickup({ maidUuid: uuid, pickup: arg.pickup }) : await maid.setTask({ maidUuid: uuid, taskId: arg.taskId })
        check(); return verifyMaidOutcome(action, result, bot._client.uuid)
      }
      return maid.openBag({ maidUuid: uuid })
    }
    case 'colony': return colony[action.operation](action.args || {})
    case 'spell': return action.operation === 'list' ? spell.list() : action.operation === 'explain' ? spell.explain(action.id) : spell.cast(action.id)
    case 'wait': await pause(action.seconds * 1000); check(); return { ok: true, waitedSeconds: action.seconds }
    default: throw Error('UNSUPPORTED_ACTION')
  }
}

const guide = `你是 My Agent World 的普通生存玩家 ${config.username}，这是你长期生活的世界，不是服主。制定你自己的生活目标，真实采集、合成、种地、建设、探索、发展殖民地并照顾自己的东方女仆伙伴。现在从一无所有起步，先解决木材、基础工具、食物和避难处，再逐步探索农夫乐事/Create/Ars/MineColonies/TLM。没有物资就真实获取，不能假称完成，不请求give/tp。保持跨轮同一目标与实际进展，失败查原因再改变方案。
每轮只输出一个 JSON 对象，例如 {"goal":"采集天然木材","reason":"先建立工具与补给","actions":[{"type":"inspect"},{"type":"navigate","position":{"x":10,"y":64,"z":20}}]}，最多8动作。每个动作使用type字段，不要用技能名称代替type。没有markdown，不要执行宿主文件/终端工具。仅此JSON用于你的真实游戏身体。所有坐标为绝对整数；一次导航目标距当前位置<=16格，路径不能自动挖路搭路。surfaces是8格内第一可见表面，不能透视地下矿石。gather/dig需真实直视方块，expectedId可校验原生ID。
工具可发现：{"type":"tools","operation":"list"}列实际能力，{"type":"tools","operation":"explain","id":"recipes"}读精确参数。支持recipes、block_inspect、entity_inspect、entity_interact和现有模组桥。不要把以前失败时“只能攻击敌对/不能吃腐肉”等旧推断当永久限制；读取新目录与实际状态再决定。recipes args用真实recipeId/recipeType/outputId和offset/limit；definitionAvailable=false是内容缺口，不要编造配方。
生存优先于旧探索目标：每轮先根据真实self.health/maxHealth、self.food/saturation、foodOptions和可见危险决定吃饭、避险或休息，再决定是否找动物/远行；极低血量时不要机械重复原目标。休息不会凭空回血：看实际饥饿和回血结果；选可达安全地面，避免反复卡在同一台阶。执行器不会替你救援、给物品、传送或代定食物，计划仍由你根据观察制定。满足基本生存后，用modStates.recipes真实目录查当前库存可做的农夫乐事食物、切菜板或Create配方，再自然取得材料和操作；没有真实回执和产物不能报告已完成。
动作：inspect；navigate(position)；gather(position,expectedId)挖一次并走近拾取；dig(position,expectedId)；craft(ingredients:[{slot,id,count:1}],outputId,outputCount)真实原生合成；select(hotbarSlot:0..8)；place(position:参照方块坐标,face:{x,y,z}:一个方向为±1,hotbarSlot,itemId,blockId)；block_inspect/use_block(position,aimOffset可选)；use_item；eat(itemId可选真实食品ID,inventorySlot可选9..44)；entity_inspect/entity_interact/attack均需entityId和expectedUuid（entities里的真实UUID），expectedId可选。attack意图combat用于真实敌人含模组；hunt_food用于无主未命名牛猪羊鸡兔和食用鱼，不伤NPC、宠物、队友。没有合法证据就不派发，不能把协议proxy-zombie当敌人。menu_click(slot,button:0拾取整堆/1放一个)；close_menu；wait(seconds<=30)。背包合成格1..4两行两列，结果0；工作台合成格1..9三行，结果0。真实背包菜单物品9..44，快捷栏36..44。craft要求空网格/空cursor，辅助器使用真实组件和回执，不发明配方；木板=1原木放slot1产4对应木板，工作台=4木板放slots1,2,3,4，木棍=slots1,3木板产4。配方材料与物品ID必须是库存中真实原生ID。
模组探索：先recipes查询实际配方，再block_inspect看真实机器状态。Create磨石processing会明确waiting_input/waiting_power/processing/output_ready；不把手摇或计时估算当产物。农夫乐事切菜板的真实形状仅1/16高，block_inspect/use_block要显式aimOffset:[0.5,0.03,0.5]，放料、持正确刀/斧再次使用，再检查BE库存与本人inventoryDelta；厨房菜单读取真实dataValues/slotLayout。食品由foodOptions的真实FOOD组件发现，腐肉和mod食品可以吃，副作用自行权衡；吃东西先关闭菜单、留空cursor，有需要会原生搬到空快捷栏，不会擅丢其他物品。发出交互sent_unverified不等于成功或可以盲目重复。
foodOptions.items每项food.nativeComponent是服务器实际FOOD完整原定义，含默认effects/食用转换等；SNBT保存组件patch，不能因其中没有effects就断言无副作用。腐肉可能引发饥饿，按原生effects概率、当前血量和替代食物权衡。additionalItemHooksDescribed=false表示额外模组Java消费钩子尚未完整描述，不保证已列尽风险。modStates.recipes仅每30秒缓存一小页和真实recipeTypes目录，observedAt/observationEpoch表明新旧；精确recipes动作可读配方下一页。definitionAvailable=false和code保留边界，不可编造材料、加工时长或模组玩法。
模组动作：maid(operation:list/status/tasks/follow/pickup/task/bag,maidUuid,args)，只操作本人已拥有、8格内伙伴。例如{"type":"maid","operation":"follow","maidUuid":"从modStates.maid.maids读取的真实uuid","args":{"follow":true}}。modStates含本人的实际女仆/殖民地/法术只读状态，已有uuid不要反复登记或发明身份。女仆hunger=0为模组未使用字段，不能当成饿死。colony(operation:status/found/placeBuilder/requestBuild/deliver/stockResource,args，真实库存/建筑材料/位置/expectedSnbt)；其inventorySlot0..8对应背包菜单36..44的快捷栏，其9..35对应普通库存9..35。spell(operation:list/explain/cast,id原生法术)，真实持书魔力/冷却。先获取准确字段，做不了报告能力/资源缺口。界面点击失败未知不能重投；使用交互sent并非效果已验证。施法castConfirmed且manaSpent才是确认，不夸大effectVerified:false。epoch死亡/重生变化时旧动作立即取消。
每轮优先查看健康、饥饿、menu的cursor/网格和最近回执。cursor有物品要放回真实空格，网格剩料要回收，不再盲craft。采集前按原生物品ID选择正确工具，Soul Spell、法术书或协议代理图标不代表镐；不要硬套固定工具槽。gather只有blockBroken=true且pickupConfirmed=true、inventoryDelta.added显示本人真实库存增加才算采集完成；slot0是合成结果预览，不算已有物品。no_pickup_confirmed只说明本次没确认拿到掉落，不要称已采集，也不要自动重复挖已经变成air的方块；先检查工具、可见掉落和实际背包再制定新计划。dig仅确认方块破坏，不能当成收到物资。不要挖脚下、不往水/岩浆/怪物里导航。低血应先避险/进食。经确证消失或重生要重看状态。开箱/工作台/女仆背包后完成交互请close_menu。`

async function loop () {
  while (!closing) {
    // Removing a marker is not reconciliation of a timed-out body's closures.
    // A fenced worker requires an explicit owned restart after ledger review.
    if (actionFence.status().blocked) { status.mode = 'paused_unknown'; persist(); await wait(1000); continue }
    if (!status.online || !menu.current() || bot.health <= 0) { status.mode = 'waiting_for_player'; persist(); await wait(1000); continue }
    if (fs.existsSync(paused)) { status.mode = 'paused'; persist(); await wait(1000); continue }
    // A restart cannot shorten this persisted cooldown. The gate precedes
    // inspection/submission and stays responsive to maintenance/shutdown.
    if (modelBackoffRemaining(status.modelBackoff) > 0) { status.mode = 'model_rate_backoff'; persist(); await wait(1000); continue }
    try {
      const observedEpoch = epoch
      const observation = await inspect()
      if (closing || fs.existsSync(paused) || observedEpoch !== epoch || !status.online || bot.health <= 0) { record('observation_discarded', { reason: 'player_context_changed' }); await wait(1000); continue }
      status.mode = 'thinking'; status.round++; status.lastError = null; persist()
      const decision = await qwen.run(guide + '\n当前真实观察：\n' + gameJSON(observation) + '\n持续目标：' + status.goal)
      if (closing) break
      if (decision.status !== 'completed') throw modelDecisionError(decision)
      status.modelBackoff = null; persist()
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
          const result = await runActionWithDeadline(scope => execute(action, plannedEpoch, scope), {
            timeoutMs: 45000, checkContext: () => checkActionContext(plannedEpoch),
            onScope: scope => { activeActionScope = scope },
            onAbort: () => { actionFence.block(); stopMovement() }
          })
          record('action_result', { actionId, action, result })
          if (unknownOutcome(result)) {
            actionFence.block(); try { stopMovement() } catch {}
            if (!fs.existsSync(paused)) fs.writeFileSync(paused, JSON.stringify({ reason: 'unknown_action_outcome', actionId, action, at: new Date().toISOString() }))
            status.mode = 'paused_unknown'; break
          }
          if (result?.ok === false && !['inspect', 'maid', 'colony', 'spell'].includes(action.type)) break
        } catch (error) {
          const unknown = error.result?.outcomeUnknown === true || error.outcomeUnknown === true || error.outcomeKnown === false || /TIMEOUT|CONNECTION_CLOSED|UNKNOWN|uncertain/i.test(error.message)
          if (unknown) { actionFence.block(); try { stopMovement() } catch {} }
          record('action_result', { actionId, action, result: error.result || { ok: false, code: error.message, outcome: unknown ? 'unknown' : 'known_rejection', retryAutomatically: false } })
          if (unknown) { if (!fs.existsSync(paused)) fs.writeFileSync(paused, JSON.stringify({ reason: 'unknown_action_outcome', actionId, action, at: new Date().toISOString() })); status.mode = 'paused_unknown' }
          break
        } finally { activeActionScope = null }
      }
      status.mode = fs.existsSync(paused) ? 'paused' : 'observing'; persist(); await wait(config.decisionIntervalMs || 15000)
    } catch (error) {
      status.lastError = error.message; record('decision_error', { error: error.message })
      const policy = classifyModelFailure(error)
      if (policy.action === 'pause_unknown' || policy.action === 'pause_model') {
        fs.writeFileSync(paused, JSON.stringify({ reason: policy.pauseReason, reasonCode: policy.reasonCode, error: error.message })); status.mode = policy.action === 'pause_unknown' ? 'paused_unknown' : 'paused_model'
      } else if (policy.action === 'rate_backoff') {
        status.modelBackoff = nextModelBackoff(status.modelBackoff, policy)
        status.mode = 'model_rate_backoff'; record('model_rate_backoff', status.modelBackoff)
      } else status.mode = 'decision_backoff'
      persist(); await wait(policy.action === 'rate_backoff' ? 1000 : 30000)
    }
  }
}
const heartbeat = setInterval(persist, 3000)
async function shutdown (code = 0) {
  if (closing) return
  closing = true; activeActionScope?.abort('shutdown'); try { stopMovement() } catch {} clearInterval(heartbeat)
  status.mode = 'stopping'; persist()
  await viewer.close(); stream.detach(); bot.quit('My Agent World supervisor stopping')
  spell.events.off('receipt', observeSpellReceipt)
  bot.off('spawn', clearSpellPresentation); bot.off('end', clearSpellPresentation)
  for (const client of [menu, query, nativeQuery, maid, colony, spell]) client.detach()
  setTimeout(() => process.exit(code), 500).unref()
}
readline.createInterface({ input: process.stdin }).on('line', line => { if (line.trim() === '{"kind":"shutdown"}') shutdown(0) })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => shutdown(0))
record('worker_started', { viewer: viewer.url, account: bot.username, agentId: config.agentId })
await loop()
