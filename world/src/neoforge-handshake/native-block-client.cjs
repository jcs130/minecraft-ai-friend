'use strict'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const direction = face => {
  const entries = [face.x, face.y, face.z]
  if (entries.some(value => !Number.isInteger(value) || Math.abs(value) > 1) ||
      entries.filter(value => value !== 0).length !== 1) throw new Error('INVALID_BLOCK_FACE')
  if (face.y < 0) return 0
  if (face.y > 0) return 1
  if (face.z < 0) return 2
  if (face.z > 0) return 3
  if (face.x < 0) return 4
  return 5
}

const sequenceByBot = new WeakMap()
const surfaceOffsets = [[0.5, 0.5, 0.5], [0.5, 0.1, 0.5], [0.5, 0.9, 0.5],
  [0.1, 0.5, 0.5], [0.9, 0.5, 0.5], [0.5, 0.5, 0.1], [0.5, 0.5, 0.9]]
const samePosition = (a, b) => a && b && ['x', 'y', 'z'].every(key => a[key] === b[key])

// Mineflayer's vanilla heldItem may be undefined for a real NeoForge item.
// Trust the server's private inventory snapshot, then send vanilla use-on-block
// under this player's connection. Never retry an unknown placement automatically.
async function placeNativeHeld (bot, menu, world, { hotbarSlot, itemId, referenceBlock, face, expectedBlockId,
  verificationOffset, expectedItemSnbt, expectedReference, onDispatch = () => {} }) {
  if (!Number.isInteger(hotbarSlot) || hotbarSlot < 0 || hotbarSlot > 8) throw new Error('INVALID_HOTBAR_SLOT')
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(itemId) ||
      !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(expectedBlockId)) throw new Error('INVALID_REGISTRY_ID')
  if (verificationOffset !== undefined && (!Array.isArray(verificationOffset) || verificationOffset.length !== 3 ||
      verificationOffset.some(value => !Number.isFinite(value) || value < 0 || value > 1))) {
    throw new Error('INVALID_VERIFICATION_OFFSET')
  }
  if (!referenceBlock?.position || !bot.entity?.position) throw new Error('BLOCK_OR_POSITION_UNAVAILABLE')
  const faceNumber = direction(face)
  const dest = referenceBlock.position.offset(face.x, face.y, face.z)
  if (bot.entity.position.distanceTo(dest.offset(0.5, 0.5, 0.5)) > 6) throw new Error('BLOCK_OUT_OF_REACH')
  // Conservative player-volume preflight, before use is sent. In particular a
  // thin shaft may still be rejected by the server when its voxel contains the
  // builder. Do not turn this known, avoidable failure into an unknown write.
  const p = bot.entity.position, halfWidth = (bot.entity.width || 0.6) / 2 + 0.001
  if (p.x + halfWidth > dest.x && p.x - halfWidth < dest.x + 1 &&
      p.z + halfWidth > dest.z && p.z - halfWidth < dest.z + 1 &&
      p.y + (bot.entity.height || 1.8) > dest.y && p.y < dest.y + 1) {
    return { ok: false, code: 'destination_overlaps_player', position: dest,
      hint: 'Move your body clear of the destination voxel before placing; no use packet was sent.', retryAutomatically: false }
  }

  bot.setQuickBarSlot(hotbarSlot)
  // setQuickBarSlot may suppress a packet when the client believes this slot
  // was already selected. Force one authoritative selection before use.
  bot._client.write('held_item_slot', { slotId: hotbarSlot })
  let selected = null
  for (let i = 0; i < 20; i++) {
    const state = menu.current()
    if (state?.menuType === 'minecraft:inventory' && state.selectedHotbarSlot === hotbarSlot) {
      selected = state.slots?.[36 + hotbarSlot]
      break
    }
    await wait(75)
  }
  if (selected?.id !== itemId || selected.count < 1) {
    return { ok: false, code: 'native_item_not_selected', selected: selected?.id || null, retryAutomatically: false }
  }
  if (expectedItemSnbt !== undefined && selected.snbt !== expectedItemSnbt) {
    return { ok: false, code: 'native_placement_item_changed', retryAutomatically: false }
  }
  const target = bot.blockAt(dest)
  if (!target) return { ok: false, code: 'destination_not_loaded', retryAutomatically: false }
  if (target.name !== 'air') return { ok: false, code: 'destination_not_air', retryAutomatically: false }

  const dx = 0.5 + face.x * 0.5
  const dy = 0.5 + face.y * 0.5
  const dz = 0.5 + face.z * 0.5
  if (expectedReference) {
    const actual = await world.lookAtBlock(referenceBlock, [dx, dy, dz])
    const properties = value => JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b))))
    if (!actual.ok || !samePosition(actual.position, referenceBlock.position) || actual.block?.id !== expectedReference.id || properties(actual.block.properties) !== properties(expectedReference.properties)) {
      return { ok: false, code: 'native_placement_reference_changed', observed: actual, retryAutomatically: false }
    }
    // A visible block is not proof that the requested face is visible. Sending
    // its hidden top face can place and consume an item behind that same block,
    // where the postcondition cannot be observed from this body.
    if (actual.hit?.face !== faceNumber) {
      return { ok: false, code: 'native_placement_face_not_visible', observed: actual,
        requestedFace: faceNumber, visibleFace: actual.hit?.face ?? null,
        hint: 'Reposition to see the requested face, or choose the observed face with an empty destination. No placement was sent.',
        retryAutomatically: false }
    }
    const held = menu.current()?.slots?.[36 + hotbarSlot]
    if (held?.snbt !== selected.snbt || menu.current()?.selectedHotbarSlot !== hotbarSlot) {
      return { ok: false, code: 'native_placement_item_changed', retryAutomatically: false }
    }
  }
  await bot.lookAt(referenceBlock.position.offset(dx, dy, dz), true)
  const sequence = (sequenceByBot.get(bot) || 0) + 1
  sequenceByBot.set(bot, sequence)
  onDispatch()
  bot._client.write('block_place', { location: referenceBlock.position, direction: faceNumber,
    hand: 0, cursorX: dx, cursorY: dy, cursorZ: dz, insideBlock: false, sequence })

  let observed = null
  const offsets = verificationOffset === undefined ? surfaceOffsets : Array(6).fill(verificationOffset)
  for (const offset of offsets) {
    await wait(250)
    const menuState = menu.current()
    if (menuState?.menuType !== 'minecraft:inventory') {
      return { ok: false, code: 'placement_opened_menu', menuType: menuState?.menuType || null,
        position: dest, retryAutomatically: false }
    }
    const proxy = bot.blockAt(dest)
    if (!proxy) continue
    // Try bounded visible surfaces when the centre is occluded. These are only
    // ray targets: success still requires the server's native block identity
    // at the exact destination, never the translated proxy. Explicit offsets
    // for thin mod shapes stay explicit. The use packet is never repeated.
    observed = await world.lookAtBlock(proxy, offset)
    if (observed.ok && samePosition(observed.position, dest) && observed.block?.id === expectedBlockId) {
      const after = menu.current()?.slots?.[36 + hotbarSlot]
      return { ok: true, position: observed.position, nativeBlock: observed.block,
        itemCountBefore: selected.count, itemCountAfter: after?.count || 0, retryAutomatically: false }
    }
  }
  return { ok: false, code: 'placement_not_verified', observed, retryAutomatically: false }
}

module.exports = { placeNativeHeld }
