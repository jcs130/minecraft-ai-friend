'use strict'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])
function nativeInventorySnapshot (menu, expectedUuid) {
  const base = { available: false, source: 'native_player_inventory_menu', excludedSlots: [0], items: [], totals: [] }
  if (!UUID.test(expectedUuid || '') || menu?.playerUuid?.toLowerCase() !== expectedUuid.toLowerCase()) {
    return { ...base, reason: 'NATIVE_INVENTORY_PLAYER_BINDING_MISMATCH' }
  }
  // Container layouts are not player inventory layouts. An external menu
  // must supply the bridge's explicit canonical 46 player-menu slots.
  const slots = menu.windowId === 0 ? menu.slots : menu.playerInventory
  if (!Number.isInteger(menu.windowId) || menu.windowId < 0 || !Array.isArray(slots) || slots.length !== 46) {
    return { ...base, reason: 'NATIVE_PLAYER_INVENTORY_UNAVAILABLE' }
  }
  const items = [], totals = new Map()
  // Slot 0 is a crafting result preview, not an owned ItemStack. All other
  // canonical slots contain real player-owned inputs/equipment/storage; count
  // them together so a slot transfer cannot look like a newly acquired item.
  for (let slot = 1; slot < 46; slot++) {
    const item = slots[slot]
    if (item === null) continue
    if (!item || !ID.test(item.id || '') || !Number.isInteger(item.count) || item.count < 1 || item.count > 2147483647 ||
        typeof item.snbt !== 'string' || !item.snbt || Buffer.byteLength(item.snbt, 'utf8') > 65536) {
      return { ...base, reason: 'NATIVE_PLAYER_INVENTORY_SLOT_INVALID' }
    }
    items.push({ slot, id: item.id, count: item.count, snbt: item.snbt })
    totals.set(item.id, (totals.get(item.id) || 0) + item.count)
  }
  return { ...base, available: true, reason: null, playerUuid: expectedUuid.toLowerCase(), windowId: menu.windowId,
    items, totals: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => ({ id, count })) }
}
function nativeInventoryDelta (before, after) {
  const base = { available: false, source: 'native_player_inventory_menu', excludedSlots: [0], added: [], removed: [] }
  if (!before?.available || !after?.available) return { ...base, reason: before?.reason || after?.reason || 'NATIVE_PLAYER_INVENTORY_UNAVAILABLE' }
  if (before.playerUuid !== after.playerUuid) return { ...base, reason: 'NATIVE_INVENTORY_PLAYER_BINDING_MISMATCH' }
  const a = new Map(before.totals.map(item => [item.id, item.count])), b = new Map(after.totals.map(item => [item.id, item.count]))
  const added = [], removed = []
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const old = a.get(id) || 0, current = b.get(id) || 0, difference = current - old
    if (difference > 0) added.push({ id, count: difference, beforeCount: old, afterCount: current,
      stacks: after.items.filter(item => item.id === id).map(item => ({ ...item })) })
    if (difference < 0) removed.push({ id, count: -difference, beforeCount: old, afterCount: current })
  }
  return { ...base, available: true, reason: null, playerUuid: before.playerUuid, added, removed,
    attribution: 'observed_inventory_change_during_action_not_drop_entity_attributed' }
}
function nativeDigResult ({ type, position, beforeBlock, afterBlock, beforeInventory, afterInventory }) {
  if (!['dig', 'gather'].includes(type)) throw Error('NATIVE_DIG_RESULT_TYPE_INVALID')
  const inventoryDelta = nativeInventoryDelta(beforeInventory, afterInventory)
  const beforeId = typeof beforeBlock === 'string' ? beforeBlock : beforeBlock?.id
  const worldObserved = ID.test(beforeId || '') && ID.test(afterBlock || '')
  const blockBroken = worldObserved && !AIR.has(beforeId) && AIR.has(afterBlock)
  const pickupConfirmed = blockBroken && inventoryDelta.available && inventoryDelta.added.length > 0
  const ok = type === 'gather' ? pickupConfirmed : blockBroken
  return { ok, code: !worldObserved ? 'block_change_observation_unavailable' : !blockBroken ? 'block_not_broken' :
    type === 'dig' ? 'block_broken' : pickupConfirmed ? 'gather_pickup_confirmed' : 'no_pickup_confirmed',
    blockBroken, pickupConfirmed, inventoryDelta, position, beforeBlock, afterBlock,
    inventoryBefore: beforeInventory?.available ? beforeInventory.items : null,
    inventoryAfter: afterInventory?.available ? afterInventory.items : null,
    outcome: worldObserved ? 'known_observation' : 'unknown', outcomeKnown: worldObserved, outcomeUnknown: !worldObserved,
    retryAutomatically: false }
}
// The private action journal retains the complete native SNBT above. Model
// observations and the bounded viewer status need only the exact gain/counts;
// do not duplicate every full component stack into eight public summaries.
function summarizeNativeInventoryReceipt (result) {
  const item = ({ slot, id, count }) => ({ slot, id, count })
  const summary = { ...result }
  for (const key of ['inventoryBefore', 'inventoryAfter']) {
    if (Array.isArray(summary[key])) summary[key] = summary[key].map(item)
  }
  if (summary.inventoryDelta) {
    summary.inventoryDelta = { ...summary.inventoryDelta,
      added: summary.inventoryDelta.added.map(change => ({ ...change, stacks: change.stacks.map(item) })) }
  }
  return summary
}
module.exports = { nativeInventorySnapshot, nativeInventoryDelta, nativeDigResult, summarizeNativeInventoryReceipt }
