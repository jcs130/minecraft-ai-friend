'use strict'

const ACTIONS = new Set(['inspect', 'navigate', 'gather', 'dig', 'craft', 'select', 'place', 'use_block', 'use_item', 'eat', 'attack', 'menu_click', 'close_menu', 'maid', 'colony', 'spell', 'wait'])
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const position = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 29999984)
const unknownOutcome = result => result?.outcomeUnknown === true || result?.outcomeKnown === false || result?.outcome === 'unknown' || /outcome_unknown|receipt_timeout|uncertain/i.test(result?.code || '')
const gameJSON = (value, space) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, space)
function parsePlan (text) {
  if (typeof text !== 'string' || text.length > 20000) throw Error('PLAN_TEXT_INVALID')
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
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
    if (['navigate', 'gather', 'dig', 'place', 'use_block'].includes(action.type) && !position(action.position)) throw Error('PLAN_POSITION_INVALID')
    if (action.type === 'craft' && (!ID.test(action.outputId) || !Array.isArray(action.ingredients) || action.ingredients.length < 1 || action.ingredients.length > 9 ||
        action.ingredients.some(i => !ID.test(i.id) || !Number.isInteger(i.slot) || i.slot < 1 || i.slot > 9 || (i.count !== undefined && (!Number.isInteger(i.count) || i.count < 1 || i.count > 64))))) throw Error('PLAN_CRAFT_INVALID')
    if (action.type === 'select' && (!Number.isInteger(action.hotbarSlot) || action.hotbarSlot < 0 || action.hotbarSlot > 8)) throw Error('PLAN_HOTBAR_INVALID')
    if (action.type === 'menu_click' && (!Number.isInteger(action.slot) || action.slot < 0 || action.slot > 200 || ![0, 1].includes(action.button ?? 0))) throw Error('PLAN_MENU_INVALID')
    if (action.type === 'wait' && (!Number.isFinite(action.seconds) || action.seconds < 0 || action.seconds > 30)) throw Error('PLAN_WAIT_INVALID')
    if (action.type === 'place' && (!ID.test(action.itemId) || !ID.test(action.blockId) || !position(action.face) || ['x', 'y', 'z'].reduce((s, k) => s + Math.abs(action.face[k]), 0) !== 1 || !Number.isInteger(action.hotbarSlot) || action.hotbarSlot < 0 || action.hotbarSlot > 8)) throw Error('PLAN_PLACE_INVALID')
    if (action.type === 'maid' && !['list', 'status', 'tasks', 'follow', 'pickup', 'task', 'bag'].includes(action.operation)) throw Error('PLAN_MAID_INVALID')
    if (action.type === 'colony' && !['status', 'found', 'placeBuilder', 'requestBuild', 'deliver', 'stockResource'].includes(action.operation)) throw Error('PLAN_COLONY_INVALID')
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
        const p = { x: Math.floor(pose.x - Math.sin(yaw) * Math.cos(pitch) * d), y: Math.floor(pose.y + 1.62 - Math.sin(pitch) * d), z: Math.floor(pose.z - Math.cos(yaw) * Math.cos(pitch) * d) }
        const stateId = world.stateIdAt(p)
        const state = world.states.get(stateId)
        if (!state) break
        if (air.has(state.name)) continue
        found.set(`${p.x},${p.y},${p.z}`, { position: p, id: state.name, properties: state.properties, distance: Number(d.toFixed(2)) })
        break
      }
    }
  }
  return [...found.values()].sort((a, b) => a.distance - b.distance).slice(0, 72)
}
module.exports = { parsePlan, visibleSurfaces, unknownOutcome, gameJSON }
