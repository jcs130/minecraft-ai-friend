'use strict'

// Planning aid for the existing authenticated SDK, never a second controller.
// Inspired by Folkways' revalidate/reserve/replant workflow; no upstream code copied.
function planCropHarvest (observation, menu) {
  const skip = code => ({ ok: false, code, nextAction: null })
  if (!observation?.ok || !observation.playerUuid || observation.playerUuid !== menu?.playerUuid) return skip('crop_observation_identity_invalid')
  if (menu.windowId !== 0 || menu.carried || !Number.isInteger(menu.selectedHotbarSlot) || menu.selectedHotbarSlot < 0 || menu.selectedHotbarSlot > 8) return skip('crop_inventory_not_ready')
  const p = observation.position, block = observation.block, crop = block?.crop
  if (!p || !['x', 'y', 'z'].every(k => Number.isSafeInteger(p[k])) || !observation.dimension) return skip('crop_absolute_position_required')
  if (crop?.source !== 'native_crop_block' || !crop.seedPlacesThisCrop || !crop.seedItemId) return skip('crop_not_supported_by_single_cell_plan')
  if (crop.mature !== true) return skip('crop_not_mature')
  const seedSlot = menu.slots?.findIndex((s, index) => index >= 9 && index <= 44 && s?.id === crop.seedItemId && s.count >= 1)
  if (seedSlot === undefined || seedSlot < 0) return skip('reserve_seed_before_harvest')
  return {
    ok: true, code: 'crop_ready_reserve_seed_and_revalidate', dimension: observation.dimension,
    nextAction: { operation: 'world.dig', args: { position: { ...p }, expectedBlockId: block.id,
      expectedProperties: { ...block.properties }, expectedHotbarSlot: menu.selectedHotbarSlot,
      expectedHeldSnbt: menu.slots?.[36 + menu.selectedHotbarSlot]?.snbt ?? '' } },
    replant: { cropBlockId: block.id, seedItemId: crop.seedItemId, observedSeedSlot: seedSlot,
      position: { ...p }, soilPosition: { x: p.x, y: p.y - 1, z: p.z },
      requiresFreshSoilObservation: true, requiresFreshInventory: true },
    retryAutomatically: false,
    instruction: 'Use a durable action_id; stop on unknown. After confirmed harvest, inspect exposed soil, select a real seed and world.place on its upper face. Verify the native crop state. Do not assume dropped seeds were picked up.'
  }
}

module.exports = { planCropHarvest }
