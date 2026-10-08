'use strict'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const namespace = { type: 'string', pattern: '^[a-z0-9_.-]+:[a-z0-9_./-]+$', maxLength: 256 }
const uuid = { type: 'string', pattern: UUID.source }
const requestId = { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,64}$' }
const aimOffset = { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 3, maxItems: 3 }
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
const position = { type: 'object', required: ['x', 'y', 'z'], additionalProperties: false,
  properties: Object.fromEntries(['x', 'y', 'z'].map(k => [k, integer(-2147483648, 2147483647)])) }
const snbt = { type: 'string', minLength: 1, maxLength: 65536 }
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const inventory = { inventorySlot: integer(0, 35), expectedSnbt: snbt, requestId }
const stock = object({ ...inventory, buildingPosition: position, quantity: integer(1, 64) },
  ['inventorySlot', 'expectedSnbt', 'buildingPosition', 'quantity'])
const hut = object({ ...inventory, position }, ['position', 'inventorySlot', 'expectedSnbt'])
const domumSelection = { ...object({ selection: { type: 'string', enum: ['group', 'variant'] }, groupId: namespace,
  variantIndex: integer(0, 4095), choiceSnbt: snbt, requestId }, ['selection', 'groupId']),
  allOf: [{ if: { properties: { selection: { const: 'variant' } }, required: ['selection'] },
    then: { required: ['variantIndex', 'choiceSnbt'] } }] }

// Explicit bindings, not dynamic property traversal or a remote eval endpoint.
// These are the actual low-level APIs. Maw's body-plan descriptors are separate.
const definitions = [
  ['world.interact', false, '本人实际主手右键近处可见方块，调用原生 useItemOn；组件/方块状态 CAS，接受交互后仍须观察效果。',
    object({ position, aimOffset, expectedBlockId: namespace, expectedProperties: { type: 'object', properties: {}, additionalProperties: { type: 'string', maxLength: 256 } },
      expectedHeldSnbt: { type: 'string', maxLength: 60000 }, expectedHotbarSlot: integer(0, 8), requestId },
      ['position', 'expectedBlockId', 'expectedProperties', 'expectedHeldSnbt', 'expectedHotbarSlot']), (c, a) => c.mods.world.interact(a)],
  ['colony.management', true, '在小屋旁查询实际岗位/住房模块、居民及 CAS；需本城镇成员。',
    object({ buildingPosition: position, requestId }, ['buildingPosition']), (c, a) => c.colony.management(a)],
  ['colony.assignCitizen', false, '按模块完整居民列表 CAS 原生雇用/解雇或安排住房；跨建筑先解除原岗位。',
    object({ buildingPosition: position, moduleId: integer(1, 65535), expectedModuleKey: { type: 'string', minLength: 1, maxLength: 256 }, citizenId: integer(1, 2147483647), assign: { type: 'boolean' },
      expectedAssignedCitizenIds: { type: 'array', items: integer(1, 2147483647), maxItems: 24, uniqueItems: true }, requestId },
    ['buildingPosition', 'moduleId', 'expectedModuleKey', 'citizenId', 'assign', 'expectedAssignedCitizenIds']), (c, a) => c.colony.assignCitizen(a)],
  ['colony.setHiringMode', false, '设置原生 default/auto/manual/locked 招聘模式；旧模式 CAS 与 MANAGE_HUTS 权限。',
    object({ buildingPosition: position, moduleId: integer(1, 65535), expectedModuleKey: { type: 'string', minLength: 1, maxLength: 256 }, mode: { type: 'string', enum: ['default', 'auto', 'manual', 'locked'] },
      expectedMode: { type: 'string', enum: ['default', 'auto', 'manual', 'locked'] }, requestId }, ['buildingPosition', 'moduleId', 'expectedModuleKey', 'mode', 'expectedMode']), (c, a) => c.colony.setHiringMode(a)],
  ['colony.pauseCitizen', false, '按居民原暂停状态 CAS 暂停/恢复工作。',
    object({ buildingPosition: position, citizenId: integer(1, 2147483647), paused: { type: 'boolean' }, expectedPaused: { type: 'boolean' }, requestId },
      ['buildingPosition', 'citizenId', 'paused', 'expectedPaused']), (c, a) => c.colony.pauseCitizen(a)],
  ['colony.research', true, '大学旁分页查询原生研究、前置、实际成本与本人/大学资源是否足够。',
    object({ buildingPosition: position, offset: integer(0, 10000), limit: integer(1, 12), requestId }, ['buildingPosition']), (c, a) => c.colony.research(a)],
  ['colony.startResearch', false, '通过原生大学逻辑开始研究，核对前置并实际扣除材料；不跳过时间。',
    object({ buildingPosition: position, researchId: namespace, requestId }, ['buildingPosition', 'researchId']), (c, a) => c.colony.startResearch(a)],
  ['spell.glyphs', true, '分页发现 Ars 符文、本人是否已学、配置是否启用及等级。',
    object({ offset: integer(0, 10000), limit: integer(1, 24), requestId }), (c, a) => c.spell.glyphs(a)],
  ['spell.learnGlyph', false, '右键学习本人手中真实符文；原生消耗一件并同步已学和魔力上限。',
    object({ expectedHeldSnbt: snbt, expectedHotbarSlot: integer(0, 8), requestId }), (c, a) => c.spell.learnGlyph(a)],
  ['spell.configure', false, '配置手中真实法术书的槽位；检查已学/启用符文、书等级、长度与原生组合规则。',
    object({ slot: integer(0, 99), name: { type: 'string', maxLength: 64 }, glyphs: { type: 'array', items: namespace, minItems: 1, maxItems: 32 },
      expectedHeldSnbt: snbt, expectedHotbarSlot: integer(0, 8), requestId }, ['slot', 'name', 'glyphs']), (c, a) => c.spell.configure(a)],
  ['spell.select', false, '按手中书完整 SNBT CAS 选择一个已配置的实际槽位。',
    object({ slot: integer(0, 99), expectedHeldSnbt: snbt, expectedHotbarSlot: integer(0, 8), requestId }, ['slot']), (c, a) => { const { slot, ...options } = a; return c.spell.select(slot, options) }],
  ['create.settings', true, '查询本人近处可见机械原生数值/过滤设置、可编辑条件及 CAS。',
    object({ position, aimOffset, requestId }, ['position']), (c, a) => c.mods.create.settings(a)],
  ['create.fluids', true, '读取近处可见机器当前面的真实流体罐；装卸仍用真实容器和原生方块交互。',
    object({ position, aimOffset, requestId }, ['position']), (c, a) => c.mods.create.fluids(a)],
  ['create.setValue', false, '修改原生机械面板数值；方块、行为、旧值及手中物品 CAS，保留扳手/权限要求。',
    object({ position, aimOffset, expectedBlockId: namespace, behaviourIndex: integer(0, 65535), expectedBehaviour: { type: 'string', maxLength: 256 },
      expectedRow: integer(0, 65535), expectedValue: integer(-1000000, 1000000), row: integer(0, 65535), value: integer(0, 1000000),
      expectedHeldSnbt: { type: 'string', maxLength: 60000 }, expectedHotbarSlot: integer(0, 8), requestId },
      ['position', 'expectedBlockId', 'behaviourIndex', 'expectedBehaviour', 'expectedRow', 'expectedValue', 'row', 'value', 'expectedHeldSnbt', 'expectedHotbarSlot']), (c, a) => c.mods.create.setValue(a)],
  ['create.setFilter', false, '用实际手持物原生设置/清除过滤器；实际 FilterItem 会正常消耗/退还。',
    object({ position, aimOffset, expectedBlockId: namespace, behaviourIndex: integer(0, 65535), expectedBehaviour: { type: 'string', maxLength: 256 },
      expectedFilterSnbt: { type: 'string', maxLength: 60000 }, expectedHeldSnbt: { type: 'string', maxLength: 60000 }, expectedHotbarSlot: integer(0, 8), requestId },
      ['position', 'expectedBlockId', 'behaviourIndex', 'expectedBehaviour', 'expectedFilterSnbt', 'expectedHeldSnbt', 'expectedHotbarSlot']), (c, a) => c.mods.create.setFilter(a)],
  ['curios.state', true, '查询本人真实饰品槽、完整组件和原生菜单槽位映射。', object(), c => c.mods.curios.state()],
  ['curios.open', false, '打开本人原生饰品菜单；使用 menu.click 取放，原装备/诅咒/有效槽规则保留。',
    object({ requestId }), (c, a) => c.mods.curios.open(a)],
  ['curios.page', false, '切换当前本人饰品菜单页；容器/状态 CAS 且游标必须为空。',
    object({ page: integer(0, 255), expectedContainerId: integer(0, 255), expectedStateId: integer(0, 32767), requestId },
      ['page', 'expectedContainerId', 'expectedStateId']), (c, a) => c.mods.curios.page(a)],
  ['menu.current', true, '本人当前原生菜单缓存；未收到或失效时返回 null。', object(), c => c.menu.current()],
  ['menu.close', false, '关闭本人当前原生界面；光标必须为空。按原版关闭包发送，等待本人原生菜单快照确认；超时为 unknown，不重试。', object(), c => c.menu.close()],
  ['menu.click', false, '原生 PICKUP，0 左键整堆、1 右键逐个；使用当前完整槽位/游标 CAS。',
    object({ slot: integer(0, 200), button: { ...integer(0, 1), default: 0 } }, ['slot']), (c, a) => c.menu.click(a.slot, a.button ?? 0)],
  ['world.look', true, '服务端读取本人准星首个可见方块及有限真实机器状态。', object(), c => c.world.look()],
  ['native.recipes', true, '分页读取本服真实 RecipeManager；定义可读不代表机器已实现。',
    object({ recipeId: namespace, recipeType: namespace, outputId: namespace, offset: integer(0, 10000), limit: integer(1, 12) }), (c, a) => c.native.recipes(a)],
  ['native.entity', true, '读取本人已跟踪、可见实体的实际身份与关系。',
    object({ entityId: integer(0, Number.MAX_SAFE_INTEGER), expectedUuid: uuid }, ['entityId', 'expectedUuid']), (c, a) => c.native.entity(a)],
  ['colony.status', true, '本人可访问城镇、建筑、工单和居民请求。', object(), c => c.colony.status()],
  ['colony.capabilities', true, '读取原蓝图、hut 类型及原生权限/放置条件。', object(), c => c.colony.capabilities()],
  ['colony.resources', true, '分页完整建筑需求与实际小屋/关联货架库存。',
    object({ buildingPosition: position, offset: integer(0, 10000), limit: integer(1, 24), requestId }, ['buildingPosition']), (c, a) => c.colony.resources(a)],
  ['colony.found', false, '消耗本人真实市政厅物品建立原生城镇。',
    object({ ...inventory, position, name: { type: 'string', minLength: 1, maxLength: 64 } }, ['position', 'name', 'inventorySlot', 'expectedSnbt']), (c, a) => c.colony.found(a)],
  ['colony.placeBuilder', false, '消耗本人建筑工 hut 物品，登记原生建筑。', hut, (c, a) => c.colony.placeBuilder(a)],
  ['colony.placeHut', false, '放置已支持的真实 hut；不会直接建成建筑。',
    object({ ...hut.properties, hutType: { type: 'string', enum: ['builder', 'home', 'farmer', 'warehouse', 'blacksmith', 'cook', 'deliveryman', 'university'] } },
      [...hut.required, 'hutType']), (c, a) => c.colony.placeHut(a)],
  ['colony.requestBuild', false, '在原生权限/距离规则下登记施工单。',
    object({ buildingPosition: position, builderPosition: position, requestId }, ['buildingPosition', 'builderPosition']), (c, a) => c.colony.requestBuild(a)],
  ['colony.deliver', false, '按真实居民请求 token、本人槽位完整 SNBT 交货。',
    object({ ...stock.properties, token: { type: 'string', minLength: 1, maxLength: 256 } }, [...stock.required, 'token']), (c, a) => c.colony.deliver(a)],
  ['colony.stockResource', false, '按完整组件和剩余需求，向实际建筑组合库存供料。', stock, (c, a) => c.colony.stockResource(a)],
  ['maid.list', true, '列出本人附近已拥有的女仆。', object(), c => c.maid.list()],
  ['maid.status', true, '读取本人伙伴状态和实际库存摘要。', object({ maidUuid: uuid }, ['maidUuid']), (c, a) => c.maid.status(a.maidUuid)],
  ['maid.tasks', true, '读取女仆实际可用任务及原生启用条件。', object({ maidUuid: uuid }, ['maidUuid']), (c, a) => c.maid.tasks(a.maidUuid)],
  ['maid.setTask', false, '设置本人女仆的原生任务，不代做劳动。',
    object({ maidUuid: uuid, taskId: namespace, requestId }, ['maidUuid', 'taskId']), (c, a) => c.maid.setTask(a)],
  ['maid.setFollow', false, '设置并核验本人女仆跟随。',
    object({ maidUuid: uuid, follow: { type: 'boolean' }, requestId }, ['maidUuid', 'follow']), (c, a) => c.maid.setFollow(a)],
  ['maid.setPickup', false, '设置并核验本人女仆拾取。',
    object({ maidUuid: uuid, pickup: { type: 'boolean' }, requestId }, ['maidUuid', 'pickup']), (c, a) => c.maid.setPickup(a)],
  ['maid.openBag', false, '打开本人女仆的真实菜单，再用 menu.click 操作。',
    object({ maidUuid: uuid, requestId }, ['maidUuid']), (c, a) => c.maid.openBag(a)],
  ['spell.current', true, '本人最近已收到的 Ars 法术状态缓存，不发送查询。', object(), c => c.spell.current()],
  ['spell.list', true, '读取本人当前法术书已配置槽位及魔力。', object(), c => c.spell.list()],
  ['spell.explain', true, '读取真实配置槽的 glyph、费用和效果定义。',
    object({ spellId: { type: 'string', pattern: '^ars_nouveau:slot_(0|[1-9][0-9]?)$' } }, ['spellId']), (c, a) => c.spell.explain(a.spellId)],
  ['spell.cast', false, '按本人当前真实书及魔力调用原生施法；确认不等于已命中。',
    object({ spellId: { type: 'string', pattern: '^ars_nouveau:slot_(0|[1-9][0-9]?)$' }, expectedHeldSnbt: snbt,
      expectedHotbarSlot: integer(0, 8), requestId }, ['spellId']), (c, a) => { const { spellId, ...options } = a; return c.spell.cast(spellId, options) }],
  ['domum.current', true, '本人当前有效切割台缓存；输入变化后需重新 state。', object(), c => c.domum.current()],
  ['domum.state', true, '读取本人真实切割台输入/输出、材料组、变体及 CAS。', object({ requestId }), (c, a) => c.domum.state(a)],
  ['domum.choices', true, '分页读取实际组的完整变体模板和材料规则。',
    object({ groupId: namespace, offset: integer(0, 10000), limit: integer(1, 24), requestId }, ['groupId']), (c, a) => c.domum.choices(a)],
  ['domum.select', false, '调用原生 group/variant 按钮；输出仍须真实取出。',
    domumSelection, (c, a) => c.domum.select(a)],
  ['collision.query', true, '本人可见方块的真实有界碰撞查询；不自动转头、不接入寻路。',
    object({ position, expectedBlockId: namespace, expectedProperties: { type: 'object', properties: {}, additionalProperties: { type: 'string', maxLength: 256 } },
      dimension: namespace, requestId }, ['position', 'expectedBlockId', 'expectedProperties']), (c, a) => c.collision.query(a)]
].map(([id, readOnly, description, parameters, invoke]) => ({ id, readOnly, description, parameters, invoke }))
const byId = new Map(definitions.map(d => [d.id, d]))

function failure (code, details = {}) {
  return Object.assign(new Error(code), { code, outcomeKnown: true, outcomeUnknown: false,
    knownNotApplied: true, retryAutomatically: false, ...details })
}
function safeJson (value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 2048 || depth > 16) throw failure('MOD_CALL_ARGUMENT_BUDGET_EXCEEDED')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw failure('MOD_CALL_ARGUMENTS_NOT_JSON')
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || descriptor.get || descriptor.set) throw failure('MOD_CALL_ARGUMENTS_NOT_JSON')
    if (Array.isArray(value) && key === 'length') continue
    safeJson(descriptor.value, budget, depth + 1)
  }
}
function validate (value, schema, path = 'args') {
  const bad = () => { throw failure('MOD_CALL_ARGUMENT_INVALID', { field: path }) }
  if (schema.type === 'object') {
    if (!value || Array.isArray(value) || typeof value !== 'object') bad()
    if ((schema.required || []).some(k => !Object.hasOwn(value, k))) bad()
    for (const [key, item] of Object.entries(value)) {
      const child = Object.hasOwn(schema.properties, key) ? schema.properties[key] : schema.additionalProperties
      if (!child || child === false) throw failure('MOD_CALL_ARGUMENT_UNSUPPORTED', { field: `${path}.${key}` })
      validate(item, child, `${path}.${key}`)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) bad()
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) bad()
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) bad()
      validate(value[i], schema.items, `${path}[${i}]`)
    }
  } else if (schema.type === 'number') {
    if (!Number.isFinite(value) || value < schema.minimum || value > schema.maximum) bad()
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) bad()
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) ||
        (schema.pattern && !new RegExp(schema.pattern).test(value))) bad()
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') bad()
  if (schema.enum && !schema.enum.includes(value)) bad()
}
function modOperationCatalog (id) {
  const rows = definitions.map(({ invoke, ...d }) => structuredClone(d))
  if (id !== undefined) {
    const operation = rows.find(d => d.id === id)
    return operation ? { ok: true, schemaVersion: 1, operation, readOnly: true } :
      { ok: false, code: 'mod_operation_not_found', readOnly: true, retryAutomatically: false }
  }
  return { ok: true, schemaVersion: 1, source: 'installed_mod_client_call_bindings', readOnly: true,
    operations: rows, operationCount: rows.length, remoteSupportVerified: false,
    limits: ['native_adapters_only_not_body_plans', 'server_preconditions_and_permissions_apply', 'no_automatic_retry'] }
}

function validateModArguments (id, args = {}) {
  const definition = typeof id === 'string' ? byId.get(id) : null
  if (!definition) throw failure('MOD_OPERATION_NOT_FOUND')
  safeJson(args)
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > 65536) throw failure('MOD_CALL_ARGUMENT_BUDGET_EXCEEDED')
  validate(args, definition.parameters)
  if (id === 'domum.select' && args.selection === 'variant' &&
      (!Object.hasOwn(args, 'variantIndex') || !Object.hasOwn(args, 'choiceSnbt'))) throw failure('MOD_CALL_VARIANT_PARAMETERS_REQUIRED')
  return true
}

function attachModCallClient (bot, clients, isClosed = () => false) {
  let closed = false, epoch = 0, inFlight = null, unknown = null
  const identity = () => typeof bot._client.uuid === 'string' && UUID.test(bot._client.uuid) ? bot._client.uuid.toLowerCase() : null
  const contextChanged = () => { epoch++ }
  bot.on('spawn', contextChanged); bot.on('respawn', contextChanged)
  async function call (id, args = {}) {
    validateModArguments(id, args)
    const definition = byId.get(id)
    const immutableArgs = structuredClone(args)
    if (closed || isClosed()) throw failure('MOD_CALL_CONNECTION_CLOSED')
    const uuid = identity(), observedEpoch = epoch
    if (!uuid) throw failure('MOD_CALL_PLAYER_NOT_READY')
    if (!definition.readOnly && unknown) throw failure('MOD_CALL_BLOCKED_AFTER_UNKNOWN', { blockedBy: structuredClone(unknown) })
    if (!definition.readOnly && inFlight) throw failure('MOD_CALL_MUTATION_ALREADY_PENDING', { blockedBy: inFlight })
    if (!definition.readOnly) inFlight = id
    try {
      const receipt = await definition.invoke(clients, immutableArgs)
      if (closed || isClosed() || epoch !== observedEpoch || identity() !== uuid) {
        if (definition.readOnly) throw failure('MOD_CALL_READ_CONTEXT_CHANGED')
        throw Object.assign(new Error('MOD_CALL_MUTATION_CONTEXT_CHANGED'), { code: 'MOD_CALL_MUTATION_CONTEXT_CHANGED',
          outcomeKnown: false, outcomeUnknown: true, retryAutomatically: false, receipt })
      }
      if (receipt?.playerUuid && (typeof receipt.playerUuid !== 'string' || receipt.playerUuid.toLowerCase() !== uuid)) {
        throw Object.assign(new Error('MOD_CALL_RECEIPT_PLAYER_MISMATCH'), { code: 'MOD_CALL_RECEIPT_PLAYER_MISMATCH',
          outcomeKnown: definition.readOnly, outcomeUnknown: !definition.readOnly, retryAutomatically: false })
      }
      if (!definition.readOnly && (!receipt || typeof receipt.ok !== 'boolean')) {
        throw Object.assign(new Error('MOD_CALL_MUTATION_RECEIPT_INVALID'), { code: 'MOD_CALL_MUTATION_RECEIPT_INVALID',
          outcomeKnown: false, outcomeUnknown: true, retryAutomatically: false })
      }
      if (!definition.readOnly && (receipt.outcomeKnown === false || receipt.outcomeUnknown === true || receipt.outcome === 'unknown' ||
          receipt.code === 'action_outcome_unknown')) unknown = { operation: id, requestId: receipt.requestId ?? null, code: receipt.code ?? 'outcome_unknown' }
      return structuredClone(receipt) // Preserve values without exposing adapter caches to mutation.
    } catch (error) {
      const knownNotSent = error.outcomeUnknown !== true && (error.outcomeUnknown === false || error.knownNotApplied === true ||
        (error.dispatched !== true && (['INVALID_MENU_SLOT', 'INVALID_MENU_BUTTON', 'SPELL_STATE_UNAVAILABLE',
          'SPELL_ACTOR_UNAVAILABLE', 'SPELL_CONNECTION_CLOSED', 'MENU_CONNECTION_CLOSED'].includes(error.message) ||
          error.message.startsWith('MENU_STATE_UNAVAILABLE:'))))
      if (!definition.readOnly && !knownNotSent) {
        unknown = { operation: id, requestId: error.requestId ?? null, code: error.code ?? 'native_call_outcome_unknown' }
        error.outcomeKnown = false; error.outcomeUnknown = true; error.retryAutomatically = false
      }
      throw error
    } finally { if (!definition.readOnly) inFlight = null }
  }
  return { call, operations: modOperationCatalog,
    callStatus: () => ({ schemaVersion: 1, scope: 'sdk.call_only', closed: closed || isClosed(), epoch,
      inFlightMutation: inFlight, mutationBlocked: unknown !== null, unknown: structuredClone(unknown),
      persistentLedgerRequired: true, retryAutomatically: false }),
    detach () { if (closed) return; closed = true; bot.off('spawn', contextChanged); bot.off('respawn', contextChanged) } }
}

module.exports = { attachModCallClient, modOperationCatalog, validateModArguments }
