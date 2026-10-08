'use strict'

const activeMenus = new WeakSet()
const registryId = value => typeof value === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)
const empty = item => !item || item.id === 'minecraft:air' || item.count === 0
const quantity = value => Number.isInteger(value) && value >= 1 && value <= 64

class CraftFailure extends Error {
  constructor (code, details = {}) { super(code); this.code = code; this.details = details }
}

function layoutFor (state) {
  if (state?.menuType === 'minecraft:inventory') return { gridSize: 4, inventoryStart: 9, inventoryEnd: 44 }
  if (state?.menuType === 'minecraft:crafting') return { gridSize: 9, inventoryStart: 10, inventoryEnd: 45 }
  throw new CraftFailure('unsupported_crafting_menu')
}

// One real result-slot pickup, using the current player's original menu. The
// server computes the recipe and ItemStack; this helper never invents a result
// or reconstructs its components. A failure leaves observable inputs/cursor in
// place for inspection, without attempting an unknown action again or undoing it.
async function craftNativeGrid (menu, { ingredients, outputId, outputCount = 1, expectedOutputSnbt } = {}) {
  if (!menu || typeof menu.current !== 'function' || typeof menu.click !== 'function') {
    throw new TypeError('A native menu client is required')
  }
  if (activeMenus.has(menu)) return { ok: false, code: 'crafting_busy', receiptIDs: [], retryAutomatically: false }
  activeMenus.add(menu)
  const receiptIDs = []
  let phase = 'preflight'
  let initial
  let layout
  let destination
  let mutationObserved = false

  const fail = (code, details) => { throw new CraftFailure(code, details) }
  function current () {
    const state = menu.current()
    if (!state || !Array.isArray(state.slots)) fail('native_menu_state_unavailable')
    if (!Array.isArray(state.mayPickup) || state.mayPickup.length !== state.slots.length) {
      fail('native_menu_permissions_unavailable')
    }
    if (initial && (state.windowId !== initial.windowId || state.menuType !== initial.menuType ||
        state.playerUuid !== initial.playerUuid)) fail('crafting_menu_changed')
    return state
  }
  async function click (slot, button = 0) {
    current()
    const receipt = await menu.click(slot, button)
    if (typeof receipt?.requestId === 'string') receiptIDs.push(receipt.requestId)
    if (receipt?.changed === true) mutationObserved = true
    if (receipt?.ok !== true || receipt.changed !== true) {
      fail('native_click_rejected', { serverCode: receipt?.code || null, slot, button })
    }
    return current()
  }
  function requireItem (item, id, count, code) {
    if (empty(item) || item.id !== id || item.count !== count || typeof item.snbt !== 'string' || !item.snbt) {
      fail(code, { expectedId: id, expectedCount: count, observedId: item?.id || null, observedCount: item?.count || 0 })
    }
  }
  function playerSlots (state) {
    const slots = []
    for (let slot = layout.inventoryStart; slot <= layout.inventoryEnd; slot++) {
      slots.push({ slot, item: state.slots[slot], mayPickup: state.mayPickup[slot] })
    }
    return slots
  }

  try {
    initial = current()
    layout = layoutFor(initial)
    if (initial.slots.length <= layout.inventoryEnd || !Number.isInteger(initial.windowId)) fail('invalid_native_menu_layout')
    if (!Array.isArray(ingredients) || ingredients.length === 0 || ingredients.length > layout.gridSize ||
        !registryId(outputId) || !quantity(outputCount)) fail('invalid_crafting_request')
    const inputs = ingredients.map(ingredient => ({ ...ingredient, count: ingredient?.count ?? 1 }))
    const seen = new Set()
    const needed = new Map()
    for (const ingredient of inputs) {
      if (!Number.isInteger(ingredient.slot) || ingredient.slot < 1 || ingredient.slot > layout.gridSize ||
          seen.has(ingredient.slot) || !registryId(ingredient.id) || !quantity(ingredient.count)) fail('invalid_crafting_ingredient')
      seen.add(ingredient.slot)
      needed.set(ingredient.id, (needed.get(ingredient.id) || 0) + ingredient.count)
    }
    if (!empty(initial.carried)) fail('crafting_cursor_not_empty')
    for (let slot = 0; slot <= layout.gridSize; slot++) {
      if (!empty(initial.slots[slot])) fail(slot === 0 ? 'crafting_result_not_empty' : 'crafting_grid_not_empty', { slot })
    }
    const eligible = playerSlots(initial)
    destination = eligible.find(({ item, mayPickup }) => mayPickup === true && empty(item))?.slot
    if (destination === undefined) fail('no_empty_output_inventory_slot')
    for (const [id, count] of needed) {
      const available = eligible.reduce((total, { item, mayPickup }) => total +
        (!empty(item) && item.id === id && mayPickup === true && Number.isInteger(item.count) && item.count > 0 &&
          typeof item.snbt === 'string' && item.snbt ? item.count : 0), 0)
      if (available < count) fail('insufficient_ingredients', { id, needed: count, available })
    }

    phase = 'place_ingredients'
    for (const ingredient of inputs) {
      let placed = 0
      while (placed < ingredient.count) {
        let state = current()
        if (!empty(state.carried)) fail('crafting_cursor_changed')
        const source = playerSlots(state).find(({ slot, item, mayPickup }) => slot !== destination && !empty(item) &&
          item.id === ingredient.id && mayPickup === true && Number.isInteger(item.count) && item.count > 0)
        if (!source) fail('ingredient_inventory_changed', { id: ingredient.id })
        requireItem(source.item, ingredient.id, source.item.count, 'ingredient_components_unavailable')
        state = await click(source.slot)
        requireItem(state.carried, source.item.id, source.item.count, 'ingredient_pickup_not_verified')
        if (state.carried.snbt !== source.item.snbt || !empty(state.slots[source.slot])) fail('ingredient_pickup_components_changed')
        const amount = Math.min(source.item.count, ingredient.count - placed)
        for (let unit = 0; unit < amount; unit++) {
          state = current()
          requireItem(state.carried, ingredient.id, source.item.count - unit, 'ingredient_cursor_changed')
          if (placed === 0 ? !empty(state.slots[ingredient.slot]) :
            state.slots[ingredient.slot]?.id !== ingredient.id || state.slots[ingredient.slot]?.count !== placed) {
            fail('crafting_input_changed', { slot: ingredient.slot })
          }
          state = await click(ingredient.slot, 1)
          placed++
          requireItem(state.slots[ingredient.slot], ingredient.id, placed, 'ingredient_placement_not_verified')
          const remaining = source.item.count - unit - 1
          if (remaining === 0 ? !empty(state.carried) : state.carried?.id !== ingredient.id || state.carried?.count !== remaining) {
            fail('ingredient_cursor_count_changed')
          }
        }
        state = current()
        if (!empty(state.carried)) {
          const carried = state.carried
          if (!empty(state.slots[source.slot])) fail('ingredient_return_slot_changed')
          state = await click(source.slot)
          requireItem(state.slots[source.slot], carried.id, carried.count, 'ingredient_return_not_verified')
          if (state.slots[source.slot].snbt !== carried.snbt || !empty(state.carried)) fail('ingredient_return_components_changed')
        }
      }
    }

    phase = 'verify_result'
    let state = current()
    if (!empty(state.carried)) fail('crafting_cursor_not_empty')
    for (let slot = 1; slot <= layout.gridSize; slot++) {
      const expected = inputs.find(ingredient => ingredient.slot === slot)
      if (expected) requireItem(state.slots[slot], expected.id, expected.count, 'crafting_input_changed')
      else if (!empty(state.slots[slot])) fail('crafting_input_changed', { slot })
    }
    const produced = state.slots[0]
    requireItem(produced, outputId, outputCount, 'crafting_result_mismatch')
    if (expectedOutputSnbt !== undefined && produced.snbt !== expectedOutputSnbt) fail('crafting_recipe_output_components_mismatch')
    if (state.mayPickup[0] !== true) fail('crafting_result_not_pickable')
    if (!empty(state.slots[destination])) fail('output_inventory_slot_changed')

    phase = 'take_result'
    state = await click(0)
    requireItem(state.carried, outputId, outputCount, 'crafting_result_pickup_not_verified')
    if (state.carried.snbt !== produced.snbt) fail('crafting_result_components_changed')
    if (!empty(state.slots[destination])) fail('output_inventory_slot_changed')
    phase = 'store_result'
    state = await click(destination)
    requireItem(state.slots[destination], outputId, outputCount, 'crafting_output_store_not_verified')
    if (state.slots[destination].snbt !== produced.snbt || !empty(state.carried)) fail('crafting_output_components_changed')
    const remainingInputs = []
    for (let slot = 1; slot <= layout.gridSize; slot++) {
      if (!empty(state.slots[slot])) remainingInputs.push({ slot, ...state.slots[slot] })
    }
    return { ok: true, code: 'crafted', windowId: initial.windowId, menuType: initial.menuType,
      slot: destination, id: outputId, count: outputCount, snbt: state.slots[destination].snbt,
      item: structuredClone(state.slots[destination]), remainingInputs, receiptIDs, retryAutomatically: false }
  } catch (error) {
    const outcomeUnknown = !(error instanceof CraftFailure)
    return { ok: false, code: error.code || (outcomeUnknown ? 'native_click_outcome_unknown' : 'crafting_failed'),
      phase, outcomeUnknown, mutationObserved, error: error.message, ...(error.details || {}),
      receiptIDs, retryAutomatically: false, inspectNativeStateBeforeRetry: true }
  } finally {
    activeMenus.delete(menu)
  }
}

module.exports = { craftNativeGrid }
