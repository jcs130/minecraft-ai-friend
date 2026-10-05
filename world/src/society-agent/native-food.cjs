'use strict'
const { nativeInventorySnapshot, nativeInventoryDelta } = require('./native-inventory-delta.cjs')
const validFood = food => food && Number.isInteger(food.nutrition) && food.nutrition >= 0 &&
  Number.isFinite(food.saturation) && food.saturation >= 0 && typeof food.canAlwaysEat === 'boolean' &&
  Number.isFinite(food.eatSeconds) && food.eatSeconds >= 0 && food.eatSeconds <= 60
function nativeFoodOptions (state, uuid) {
  const inventory = nativeInventorySnapshot(state, uuid)
  if (!inventory.available) return { available: false, reason: inventory.reason, items: [] }
  const slots = state.windowId === 0 ? state.slots : state.playerInventory
  return { available: true, source: 'server_native_food_component', items: inventory.items.filter(item => item.slot >= 9 && item.slot <= 44 && validFood(slots[item.slot].food))
    .map(item => ({ ...item, food: { ...slots[item.slot].food }, hotbarSlot: item.slot >= 36 ? item.slot - 36 : null })) }
}
// Uses native menus for movement and this same body's vanilla use-item action.
// The proxy heldItem/name/food registry is never consulted or force-equipped.
async function consumeNativeFood ({ bot, menu, uuid, itemId, inventorySlot, select, check, wait, timeoutMs = 6000 }) {
  const rejection = code => ({ ok: false, code, effectVerified: false, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false })
  check()
  let state = menu.current()
  if (state?.windowId !== 0 || state?.menuType !== 'minecraft:inventory' || state.carried !== null) return rejection('food_requires_empty_cursor_and_player_menu')
  const options = nativeFoodOptions(state, uuid)
  const foodItem = options.items.find(item => (itemId === undefined || item.id === itemId) && (inventorySlot === undefined || item.slot === inventorySlot))
  if (!foodItem) return rejection('native_food_item_unavailable')
  if (!state.self || state.self.playerUuid?.toLowerCase() !== uuid.toLowerCase() || !Number.isFinite(state.self.food)) return rejection('native_food_body_state_unavailable')
  if (state.self.food >= 20 && !foodItem.food.canAlwaysEat) return rejection('already_full')
  let slot = foodItem.slot
  const receiptIDs = []
  if (slot < 36) {
    const destination = state.slots.findIndex((item, index) => index >= 36 && index <= 44 && item === null)
    if (destination < 0) return rejection('food_requires_free_hotbar_slot')
    for (const [index, clickSlot] of [slot, destination].entries()) {
      check(); const receipt = await menu.click(clickSlot, 0); check(); receiptIDs.push(receipt.requestId)
      if (receipt.ok !== true) return { ...receipt, receiptIDs, retryAutomatically: false }
      const moved = index === 0 ? receipt.state?.carried : receipt.state?.slots?.[destination]
      if (receipt.stateUnavailable || receipt.state?.playerUuid?.toLowerCase() !== uuid.toLowerCase() ||
          receipt.state.windowId !== 0 || receipt.state.menuType !== 'minecraft:inventory' ||
          moved?.id !== foodItem.id || moved.count !== foodItem.count || moved.snbt !== foodItem.snbt ||
          (index === 0 ? receipt.state.slots?.[destination] !== null : receipt.state.carried !== null)) return { ok: false,
        code: 'food_preparation_state_unavailable', receiptIDs, outcome: 'unknown', outcomeKnown: false, outcomeUnknown: true, retryAutomatically: false }
    }
    slot = destination
  }
  const selection = await select(slot - 36); check()
  if (!selection.ok) return { ...selection, receiptIDs }
  for (let attempt = 0; attempt < 15; attempt++) {
    state = menu.current()
    if (state?.playerUuid?.toLowerCase() === uuid.toLowerCase() && state.selectedHotbarSlot === slot - 36) break
    await wait(100); check()
  }
  const selected = state?.slots?.[slot]
  if (state?.windowId !== 0 || state.selectedHotbarSlot !== slot - 36 || selected?.id !== foodItem.id || selected.snbt !== foodItem.snbt || !validFood(selected.food)) return rejection('native_food_selection_changed')
  const beforeInventory = nativeInventorySnapshot(state, uuid), foodBefore = state.self?.food
  if (!beforeInventory.available || state.self?.playerUuid?.toLowerCase() !== uuid.toLowerCase() || !Number.isFinite(foodBefore)) return rejection('native_food_body_state_unavailable')
  check(); bot.activateItem()
  const started = Date.now()
  try {
    while (Date.now() - started < Math.max(timeoutMs, selected.food.eatSeconds * 1000 + 1500)) {
      await wait(100); check()
      const afterState = menu.current(), afterInventory = nativeInventorySnapshot(afterState, uuid)
      const delta = nativeInventoryDelta(beforeInventory, afterInventory)
      const removed = delta.removed.find(item => item.id === foodItem.id)?.count ?? 0
      const foodAfter = afterState?.self?.playerUuid?.toLowerCase() === uuid.toLowerCase() ? afterState.self.food : null
      if (delta.available && removed > 0 && Number.isFinite(foodAfter)) {
        const single = removed === 1
        return { ok: single, code: single ? 'native_food_consumed' : 'native_food_consumption_count_anomaly', itemId: foodItem.id,
          consumedCount: removed, foodBefore, foodAfter, inventoryDelta: delta, receiptIDs, effectVerified: single,
          outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false }
      }
    }
    return { ok: false, code: 'native_food_consumption_unverified', itemId: foodItem.id, foodBefore, receiptIDs,
      effectVerified: false, outcome: 'unknown', outcomeKnown: false, outcomeUnknown: true, retryAutomatically: false }
  } finally { bot.deactivateItem() } // RELEASE_USE_ITEM is allowed cancellation even after the action fence closes.
}
module.exports = { nativeFoodOptions, consumeNativeFood }
