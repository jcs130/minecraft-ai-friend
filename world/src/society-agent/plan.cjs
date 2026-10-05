'use strict'

const ACTIONS = new Set(['tools', 'inspect', 'navigate', 'gather', 'dig', 'craft', 'select', 'place', 'block_inspect', 'block_verify', 'recipes', 'entity_inspect', 'entity_interact', 'use_block', 'use_item', 'eat', 'attack', 'menu_click', 'close_menu', 'maid', 'colony', 'spell', 'domum', 'collision', 'wait'])
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const position = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 29999984)
const unknownOutcome = result => result?.outcomeUnknown === true || result?.outcomeKnown === false || result?.outcome === 'unknown' || /outcome_unknown|receipt_timeout|uncertain/i.test(result?.code || '')
const gameJSON = (value, space) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, space)
function parsePlan (text) {
  if (typeof text !== 'string' || text.length > 20000) throw Error('PLAN_TEXT_INVALID')
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    // One complete plan wrapper only. The native role may append its bounded
    // single-line anchor after the closing fence; it never supplies actions.
    // Do not choose a first/last JSON from ambiguous output or ignore prose.
    const fenced = /^```(?:json)?\s*([\s\S]*?)```([\s\S]*)$/.exec(cleaned)
    if (!fenced) throw Error('PLAN_TEXT_WRAPPER_INVALID')
    const anchor = fenced[2].trim()
    if (anchor && (anchor.length > 256 || !/^⟧ [^\r\n\v\f\u0085\u2028\u2029{}\[\]`⟧]+ ⟧$/.test(anchor) || !anchor.slice(2, -2).trim())) throw Error('PLAN_TEXT_WRAPPER_INVALID')
    cleaned = fenced[1].trim()
  }
  const plan = JSON.parse(cleaned)
  if (!plan || typeof plan.goal !== 'string' || !plan.goal.trim() || plan.goal.length > 500 ||
      typeof plan.reason !== 'string' || plan.reason.length > 1500 || !Array.isArray(plan.actions) || plan.actions.length > 8) throw Error('PLAN_SCHEMA_INVALID')
  plan.actions = plan.actions.map(action => {
    if (!action || typeof action !== 'object') throw Error('PLAN_ACTION_INVALID')
    if (action.type && action.action && action.type !== action.action) throw Error('PLAN_ACTION_AMBIGUOUS')
    const result = { ...action, type: action.type || action.action }
    delete result.action
    return result
  })
  for (const action of plan.actions) {
    if (!action || !ACTIONS.has(action.type)) throw Error('PLAN_ACTION_INVALID')
    if (['navigate', 'gather', 'dig', 'place', 'use_block', 'block_inspect', 'collision'].includes(action.type) && !position(action.position)) throw Error('PLAN_POSITION_INVALID')
    if (action.aimOffset !== undefined && (!['gather', 'dig', 'use_block', 'block_inspect', 'collision'].includes(action.type) || !Array.isArray(action.aimOffset) || action.aimOffset.length !== 3 || action.aimOffset.some(value => !Number.isFinite(value) || value < 0 || value > 1))) throw Error('PLAN_AIM_OFFSET_INVALID')
    if (action.type === 'collision' && (!ID.test(action.expectedBlockId || '') ||
        !action.expectedProperties || typeof action.expectedProperties !== 'object' || Array.isArray(action.expectedProperties) ||
        Object.keys(action.expectedProperties).length > 32 || Object.entries(action.expectedProperties).some(([k, v]) => !/^[a-z0-9_]{1,64}$/.test(k) || typeof v !== 'string' || !/^[a-z0-9_.:-]{1,96}$/.test(v)) ||
        (action.dimension !== undefined && !ID.test(action.dimension)))) throw Error('PLAN_COLLISION_INVALID')
    if (action.type === 'domum') {
      const args = action.args ?? {}
      if (!['state', 'choices', 'select'].includes(action.operation) || !args || typeof args !== 'object' || Array.isArray(args) ||
          (args.requestId !== undefined && (typeof args.requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(args.requestId)))) throw Error('PLAN_DOMUM_INVALID')
      const keys = action.operation === 'state' ? ['requestId'] : action.operation === 'choices' ? ['groupId', 'offset', 'limit', 'requestId'] : ['selection', 'groupId', 'variantIndex', 'choiceSnbt', 'requestId']
      if (Object.keys(args).some(key => !keys.includes(key))) throw Error('PLAN_DOMUM_INVALID')
      if (action.operation !== 'state' && (typeof args.groupId !== 'string' || args.groupId.length > 256 || !ID.test(args.groupId))) throw Error('PLAN_DOMUM_INVALID')
      if (action.operation === 'choices' && (!Number.isInteger(args.offset ?? 0) || (args.offset ?? 0) < 0 || (args.offset ?? 0) > 10000 || !Number.isInteger(args.limit ?? 12) || (args.limit ?? 12) < 1 || (args.limit ?? 12) > 24)) throw Error('PLAN_DOMUM_INVALID')
      if (action.operation === 'select' && (!['group', 'variant'].includes(args.selection) ||
          (args.selection === 'group' && (args.variantIndex !== undefined || args.choiceSnbt !== undefined)) ||
          (args.selection === 'variant' && (!Number.isInteger(args.variantIndex) || args.variantIndex < 0 || args.variantIndex > 4095 || typeof args.choiceSnbt !== 'string' || !args.choiceSnbt.trim() || Buffer.byteLength(args.choiceSnbt, 'utf8') > 8192)))) throw Error('PLAN_DOMUM_INVALID')
    }
    if (['use_block', 'block_inspect'].includes(action.type) && action.recipeId !== undefined && !ID.test(action.recipeId)) throw Error('PLAN_BLOCK_RECIPE_INVALID')
    if (action.type === 'use_block' && action.intent !== undefined && !['interact', 'load', 'process', 'collect'].includes(action.intent)) throw Error('PLAN_BLOCK_INTENT_INVALID')
    if (action.type === 'block_verify' && (!UUID.test(action.verificationId || '') || !['observe', 'change', 'output', 'pickup'].includes(action.goal ?? 'observe') ||
        !Number.isInteger(action.waitMs ?? 1500) || (action.waitMs ?? 1500) < 0 || (action.waitMs ?? 1500) > 8000)) throw Error('PLAN_BLOCK_VERIFY_INVALID')
    if (action.type === 'tools' && (!['list', 'explain'].includes(action.operation) || (action.operation === 'explain' && (typeof action.id !== 'string' || !/^[a-z_]{1,64}$/.test(action.id))))) throw Error('PLAN_TOOL_QUERY_INVALID')
    if (['entity_inspect', 'entity_interact', 'attack'].includes(action.type) && (!Number.isSafeInteger(action.entityId) || action.entityId < 0 || !UUID.test(action.expectedUuid || '') || (action.expectedId !== undefined && !ID.test(action.expectedId)))) throw Error('PLAN_ENTITY_IDENTITY_INVALID')
    if (action.type === 'attack' && action.intent !== undefined && !['combat', 'hunt_food'].includes(action.intent)) throw Error('PLAN_ATTACK_INTENT_INVALID')
    if (action.type === 'entity_interact' && action.hand !== undefined && !['main', 'off'].includes(action.hand)) throw Error('PLAN_ENTITY_HAND_INVALID')
    if (action.type === 'eat' && ((action.itemId !== undefined && !ID.test(action.itemId)) || (action.inventorySlot !== undefined && (!Number.isInteger(action.inventorySlot) || action.inventorySlot < 9 || action.inventorySlot > 44)) || (action.item !== undefined && (typeof action.item !== 'string' || !/^(?:minecraft:)?[a-z0-9_]+$/.test(action.item))))) throw Error('PLAN_FOOD_INVALID')
    if (action.type === 'recipes') {
      const args = action.args ?? {}
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['recipeId', 'recipeType', 'outputId', 'offset', 'limit'].includes(key)) || ['recipeId', 'recipeType', 'outputId'].some(key => args[key] !== undefined && !ID.test(args[key])) || !Number.isInteger(args.offset ?? 0) || (args.offset ?? 0) < 0 || (args.offset ?? 0) > 10000 || !Number.isInteger(args.limit ?? 6) || (args.limit ?? 6) < 1 || (args.limit ?? 6) > 12) throw Error('PLAN_RECIPE_QUERY_INVALID')
    }
    if (action.type === 'craft' && (!ID.test(action.outputId) || !Array.isArray(action.ingredients) || action.ingredients.length < 1 || action.ingredients.length > 9 ||
        action.ingredients.some(i => !ID.test(i.id) || !Number.isInteger(i.slot) || i.slot < 1 || i.slot > 9 || (i.count !== undefined && (!Number.isInteger(i.count) || i.count < 1 || i.count > 64))))) throw Error('PLAN_CRAFT_INVALID')
    if (action.type === 'select' && (!Number.isInteger(action.hotbarSlot) || action.hotbarSlot < 0 || action.hotbarSlot > 8)) throw Error('PLAN_HOTBAR_INVALID')
    if (action.type === 'menu_click' && (!Number.isInteger(action.slot) || action.slot < 0 || action.slot > 200 || ![0, 1].includes(action.button ?? 0))) throw Error('PLAN_MENU_INVALID')
    if (action.type === 'wait' && (!Number.isFinite(action.seconds) || action.seconds < 0 || action.seconds > 30)) throw Error('PLAN_WAIT_INVALID')
    if (action.type === 'place' && (!ID.test(action.itemId) || !ID.test(action.blockId) || !position(action.face) || ['x', 'y', 'z'].reduce((s, k) => s + Math.abs(action.face[k]), 0) !== 1 || !Number.isInteger(action.hotbarSlot) || action.hotbarSlot < 0 || action.hotbarSlot > 8)) throw Error('PLAN_PLACE_INVALID')
    if (action.type === 'maid' && !['list', 'status', 'tasks', 'follow', 'pickup', 'task', 'bag'].includes(action.operation)) throw Error('PLAN_MAID_INVALID')
    if (action.type === 'maid' && action.operation !== 'list' && (!UUID.test(action.maidUuid || '') || (action.operation === 'follow' && typeof action.args?.follow !== 'boolean') || (action.operation === 'pickup' && typeof action.args?.pickup !== 'boolean') || (action.operation === 'task' && !ID.test(action.args?.taskId || '')))) throw Error('PLAN_MAID_ARGUMENT_INVALID')
    if (action.type === 'colony' && !['status', 'capabilities', 'resources', 'found', 'placeBuilder', 'placeHut', 'requestBuild', 'deliver', 'stockResource'].includes(action.operation)) throw Error('PLAN_COLONY_INVALID')
    if (action.type === 'colony' && action.operation === 'resources') {
      const args = action.args
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['buildingPosition', 'offset', 'limit', 'requestId'].includes(key)) ||
          !position(args.buildingPosition) || !Number.isInteger(args.offset ?? 0) || (args.offset ?? 0) < 0 || (args.offset ?? 0) > 10000 ||
          !Number.isInteger(args.limit ?? 12) || (args.limit ?? 12) < 1 || (args.limit ?? 12) > 24 ||
          (args.requestId !== undefined && (typeof args.requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(args.requestId)))) throw Error('PLAN_COLONY_RESOURCES_INVALID')
    }
    if (action.type === 'colony' && action.operation === 'placeHut' && (!position(action.args?.position) ||
        !['builder', 'home', 'farmer', 'warehouse', 'blacksmith', 'cook', 'deliveryman'].includes(action.args?.hutType) ||
        !Number.isInteger(action.args?.inventorySlot) || action.args.inventorySlot < 0 || action.args.inventorySlot > 35 ||
        typeof action.args?.expectedSnbt !== 'string' || !action.args.expectedSnbt)) throw Error('PLAN_COLONY_HUT_INVALID')
    if (action.type === 'spell' && !['list', 'explain', 'cast'].includes(action.operation)) throw Error('PLAN_SPELL_INVALID')
  }
  return plan
}

// Only first native solid surface hit on each conservative ray is disclosed.
// Loaded chunk availability is not permission to reveal buried ores.
function visibleSurfaces (world, pose, maxDistance = 8) {
  if (!pose || !world || world.error) return []
  const found = new Map()
  const air = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])
  for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 12) {
    for (const pitch of [-0.45, 0, 0.35, 0.7]) {
      for (let d = 0.5; d <= maxDistance; d += 0.25) {
        const sample = { x: pose.x - Math.sin(yaw) * Math.cos(pitch) * d, y: pose.y + 1.62 - Math.sin(pitch) * d, z: pose.z - Math.cos(yaw) * Math.cos(pitch) * d }
        const p = { x: Math.floor(sample.x), y: Math.floor(sample.y), z: Math.floor(sample.z) }
        const stateId = world.stateIdAt(p)
        const state = world.states.get(stateId)
        if (!state) break
        if (air.has(state.name)) continue
        found.set(`${p.x},${p.y},${p.z}`, { position: p, id: state.name, properties: state.properties, distance: Number(d.toFixed(2)),
          aimOffset: ['x', 'y', 'z'].map(key => Number((sample[key] - p[key]).toFixed(6))), aimSource: 'first_native_voxel_sample_not_server_ray_hit' })
        break
      }
    }
  }
  return [...found.values()].sort((a, b) => a.distance - b.distance).slice(0, 72)
}
module.exports = { parsePlan, visibleSurfaces, unknownOutcome, gameJSON }
