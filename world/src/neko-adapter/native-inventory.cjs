'use strict'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RESOURCE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
// Prompt context and !inventory must describe the same native items as the GUI.
// Mod SNBT remains available through menu.current; do not flood every prompt
// with entire books, bags or mod component trees.
function nativeInventoryText (agent) {
  const bot = agent?.bot
  if (!bot?.mawNative) return null // Unconfigured vanilla Neko keeps its original query.
  const uuid = typeof bot._client?.uuid === 'string' ? bot._client.uuid.toLowerCase() : null, menu = bot.mawNative.sdk?.menu.current()
  const unavailable = code => `NATIVE_INVENTORY_UNAVAILABLE ${code}; do not infer native inventory from proxy items. Read !modStatus and menu.current.`
  if (!UUID.test(uuid || '') || typeof menu?.playerUuid !== 'string' || menu.playerUuid.toLowerCase() !== uuid) return unavailable('native_actor_or_menu_unavailable')
  const items = menu.windowId === 0 && menu.menuType === 'minecraft:inventory' ? menu.slots : menu.playerInventory
  const validItem = item => item === null || item && typeof item.id === 'string' && item.id.length <= 256 && RESOURCE.test(item.id) &&
    Number.isSafeInteger(item.count) && item.count > 0 && typeof item.snbt === 'string'
  if (!Array.isArray(items) || items.length !== 46 || Array.from(items).some(item => !validItem(item)) ||
      !validItem(menu.carried ?? null)) return unavailable('native_inventory_snapshot_invalid')
  const itemView = (item, slot) => ({ ...(slot === undefined ? {} : { slot,
    currentMenuSlot: menu.menuType === 'minecraft:inventory' ? slot : menu.menuType === 'minecraft:crafting' && slot >= 9 && slot <= 44 ? slot + 1 : null,
    role: slot === 0 ? 'crafting_result' : slot <= 4 ? 'crafting_input' : slot <= 8 ? 'armor' : slot < 36 ? 'inventory' : slot <= 44 ? 'hotbar' : 'offhand',
    ...(slot >= 36 && slot <= 44 ? { hotbarSlot: slot - 36 } : {}) }), id: item.id, count: item.count,
    ...(typeof item.displayName === 'string' ? { name: item.displayName.slice(0, 256) } : {}),
    componentsSource: 'menu.current (full native SNBT)' })
  const carried = menu.carried ? itemView(menu.carried) : null
  const body = { schemaVersion: 1, source: 'same_player_native_menu', playerUuid: uuid,
    windowId: menu.windowId, stateId: menu.stateId, menuType: menu.menuType, selectedHotbarSlot: menu.selectedHotbarSlot,
    slots: items.flatMap((item, slot) => item ? [itemView(item, slot)] : []),
    equippedSlots: [5,6,7,8].filter(slot => items[slot]), carried,
    inventorySlotLayout: 'inventory menu: grid 1-4; backpack 9-35; hotbar menu slots 36-44 = hotbar indices 0-8. Never click menu slot 1 to equip hotbar index 1.',
    slotScope: 'canonical_player_inventory; when another menu is open use currentMenuSlot if non-null, otherwise menu.current actual slots for menu.click. Never assume canonical slot equals open-window slot.',
    emptyHotbarSlots: Array.from({ length: 9 }, (_, i) => i).filter(i => !items[36 + i]) }
  return 'NATIVE_INVENTORY\n' + JSON.stringify(body)
}
// Rendering registries and tracked-entity geometry are still sent to the real
// viewer. They are not inventory choices and must not bury the model's slots in
// tens of thousands of tokens. Preserve original indices, components and CAS.
function compactNativeMenu (state) {
  if (!state || !Array.isArray(state.slots)) return state
  const keys = ['schemaVersion', 'kind', 'playerUuid', 'windowId', 'stateId', 'menuType', 'title', 'selectedHotbarSlot', 'carried']
  const view = Object.fromEntries(keys.filter(k => Object.hasOwn(state, k)).map(k => [k, state[k]]))
  view.slotCount = state.slots.length
  view.slots = state.slots.flatMap((item, slot) => item ? [{ slot, ...item, mayPickup: state.mayPickup?.[slot] ?? null }] : [])
  view.emptySlots = state.slots.flatMap((item, slot) => item ? [] : [slot])
  const hotbarStart = state.menuType === 'minecraft:inventory' ? 36 : state.menuType === 'minecraft:crafting' ? 37 : null
  if (hotbarStart !== null) view.hotbar = Array.from({ length: 9 }, (_, index) => ({
    hotbarSlot: index, menuSlot: hotbarStart + index, item: state.slots[hotbarStart + index] ?? null }))
  view.slotLayout = state.menuType === 'minecraft:inventory' ? 'result 0; crafting inputs 1-4; armor 5-8; backpack 9-35; HOTBAR 36-44 (indices 0-8); offhand 45' :
    state.menuType === 'minecraft:crafting' ? 'result 0; crafting inputs 1-9; backpack 10-36; HOTBAR 37-45 (indices 0-8)' : 'Use actual slot numbers in this menu; slot 0 is not hotbar index 0.'
  if (Array.isArray(state.playerInventory) && state.menuType !== 'minecraft:inventory') view.playerInventory = state.playerInventory.flatMap((item, slot) => item ? [{ slot, ...item }] : [])
  return view
}
module.exports = { nativeInventoryText, compactNativeMenu }
