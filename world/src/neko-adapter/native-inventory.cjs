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
  const itemView = (item, slot) => ({ ...(slot === undefined ? {} : { slot }), id: item.id, count: item.count,
    ...(typeof item.displayName === 'string' ? { name: item.displayName.slice(0, 256) } : {}),
    componentsSource: 'menu.current (full native SNBT)' })
  const carried = menu.carried ? itemView(menu.carried) : null
  const body = { schemaVersion: 1, source: 'same_player_native_menu', playerUuid: uuid,
    windowId: menu.windowId, stateId: menu.stateId, menuType: menu.menuType, selectedHotbarSlot: menu.selectedHotbarSlot,
    slots: items.flatMap((item, slot) => item ? [itemView(item, slot)] : []),
    equippedSlots: [5,6,7,8].filter(slot => items[slot]), carried }
  return 'NATIVE_INVENTORY\n' + JSON.stringify(body)
}
module.exports = { nativeInventoryText }
