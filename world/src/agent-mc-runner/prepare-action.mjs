import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { validateJsonArguments } = require('../neoforge-handshake/mod-call-client.cjs')
const worldActions = new Set(['world.dig', 'world.place', 'world.interact'])
const needsInventoryMenu = new Set([...worldActions, 'inventory.equip', 'inventory.equipSlot', 'inventory.selectHotbar', 'inventory.select'])

/** Fill mechanical compare-and-swap fields from fresh own-body observations.
 * Never choose a target, resource, recipe, item type or route for the model.
 */
export async function prepareAction({ operation, args: input = {}, actionId, call, execute }) {
  const args = structuredClone(input), preflightActionIds = []
  // Read aliases are unambiguous wrappers, not gameplay intent. The native
  // tool still validates its original arguments and records the actual read.
  if (['mc_read', 'mc_help', 'mc_operations', 'mc_state', 'mc_result', 'mc_wait', 'mc_viewer', 'mc_lua_operations'].includes(operation)) {
    return { ok: true, read: { tool: operation, args }, preflightActionIds, normalization: 'explicit_read_tool_envelope' }
  }
  const help = await call('mc_help', { operation })
  const reject = (code, detail = {}) => ({ ok: false, code, intendedActionDispatched: false, preflightActionIds, help, ...detail })
  if (!help.parameters || help.available === false) return reject('action_operation_unavailable')
  if (help.readOnly) {
    try { validateJsonArguments(args, help.parameters) }
    catch (error) {
      if (!String(error.code || '').startsWith('MOD_CALL_')) throw error
      return reject(error.code, { field: error.field ?? null, missingFields: error.missingFields ?? [] })
    }
    return { ok: true, read: { tool: 'mc_read', args: { operation, args } }, preflightActionIds, help }
  }
  let state = await call('mc_state')
  if (!state.ok || state.status !== 'alive') return reject('action_body_unavailable', { observed: state })
  if (needsInventoryMenu.has(operation) && state.menu?.windowId !== 0) {
    if (state.menu?.carried) return reject('clear_cursor_before_action', { observed: state.menu.carried })
    const id = actionId + '-close'; preflightActionIds.push(id)
    const closed = await execute({ action_id: id, operation: 'menu.close', args: {} })
    if (!closed.ok) return reject('action_menu_close_failed', { receipt: closed })
    state = await call('mc_state')
    if (!state.ok || state.menu?.windowId !== 0) return reject('action_inventory_unavailable', { observed: state })
  }
  const fill = (key, value) => {
    if (!Object.hasOwn(args, key) && Object.hasOwn(help.parameters.properties || {}, key) && value !== undefined) args[key] = structuredClone(value)
  }
  const selected = state.menu?.selectedHotbarSlot
  const slots = state.menu?.slots || []
  if (['inventory.selectHotbar', 'inventory.select'].includes(operation)) {
    if (Number.isInteger(args.hotbarSlot) && args.hotbarSlot >= 0 && args.hotbarSlot <= 8) fill('expectedSnbt', slots[36 + args.hotbarSlot]?.snbt ?? '')
  }
  if (['inventory.equip', 'inventory.equipSlot'].includes(operation)) {
    const source = slots[args.sourceSlot]
    if (source && args.expectedId && source.id !== args.expectedId) return reject('action_source_item_mismatch', { observed: source })
    fill('expectedSnbt', source?.snbt)
  }
  if (worldActions.has(operation)) {
    const place = operation === 'world.place', position = place ? args.referencePosition : args.position
    const expectedId = place ? args.referenceBlockId : args.expectedBlockId
    const propertiesKey = place ? 'referenceProperties' : 'expectedProperties'
    if (!position || !['x', 'y', 'z'].every(k => Number.isInteger(position[k])) || typeof expectedId !== 'string') return reject('action_target_intent_required')
    if (place && (!args.face || !['x', 'y', 'z'].every(k => Number.isInteger(args.face[k])) || Object.values(args.face).reduce((s, x) => s + Math.abs(x), 0) !== 1)) return reject('action_place_face_invalid')
    const target = place ? Object.fromEntries(['x', 'y', 'z'].map(k => [k, position[k] + args.face[k]])) : position
    const protection = await call('mc_read', { operation: 'protection.query', args: { action: place ? 'place' : operation === 'world.dig' ? 'break' : 'use', position: target } })
    if (!protection.ok || !['allow_likely', 'allow'].includes(protection.state?.status)) return reject('action_protection_not_allowed', { protection })
    if (!Object.hasOwn(args, propertiesKey)) {
      const id = actionId + '-aim'; preflightActionIds.push(id)
      const aimed = await execute({ action_id: id, operation: 'world.lookAt', args: { position } })
      const observed = aimed.result || aimed
      if (!aimed.ok || observed.block?.id !== expectedId || !['x', 'y', 'z'].every(k => observed.position?.[k] === position[k])) return reject('action_visible_target_mismatch', { observed })
      fill(propertiesKey, observed.block.properties)
    }
    if (place) {
      fill('hotbarSlot', selected)
      const held = slots[36 + args.hotbarSlot]
      if (!args.itemId || held?.id !== args.itemId) return reject('action_held_item_intent_mismatch', { observed: held ?? null, inventory: state.inventory })
      fill('expectedSnbt', held.snbt)
    } else {
      fill('expectedHotbarSlot', selected)
      fill('expectedHeldSnbt', slots[36 + args.expectedHotbarSlot]?.snbt ?? '')
    }
  }
  try { validateJsonArguments(args, help.parameters) }
  catch (error) {
    if (!String(error.code || '').startsWith('MOD_CALL_')) throw error
    return reject(error.code, { field: error.field ?? null, missingFields: error.missingFields ?? [] })
  }
  return { ok: true, args, preflightActionIds, help }
}
