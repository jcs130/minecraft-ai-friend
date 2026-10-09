'use strict'

const { Vec3 } = require('vec3')
const { craftNativeGrid } = require('./native-crafting-client.cjs')
const { craftNativeRecipe } = require('./recipe-crafting-client.cjs')
const { placeNativeHeld } = require('./native-block-client.cjs')
const { nativeFoodOptions, consumeNativeFood } = require('../society-agent/native-food.cjs')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const known = (code, more = {}) => ({ ok: false, code, outcomeKnown: true, outcomeUnknown: false, retryAutomatically: false, ...more })
const propertyKey = value => JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b))))

// Ordinary player construction, on the existing connection. All inventory work
// uses native snapshots; the server still performs crafting, use and harvesting.
function attachConstructionClient (bot, menu, world, native) {
  let closed = false, generation = 0
  const contextChanged = () => { generation++ }
  for (const event of ['spawn', 'respawn', 'death']) bot.on(event, contextChanged)
  const own = () => String(bot._client.uuid || '').toLowerCase()
  function state () {
    const value = menu.current()
    if (closed || !value || value.playerUuid?.toLowerCase() !== own()) return null
    return value
  }
  function localBlock (position, reach = 6) {
    if (!bot.entity?.position || !position || !['x', 'y', 'z'].every(k => Number.isInteger(position[k]))) return null
    const p = new Vec3(position.x, position.y, position.z)
    if (bot.entity.position.distanceTo(p.offset(0.5, 0.5, 0.5)) > reach) return null
    return bot.blockAt(p)
  }
  const result = value => ({ ...value, playerUuid: own(), retryAutomatically: false })
  async function lookAt ({ position, aimOffset }) {
    const block = !closed && localBlock(position, 8)
    if (!block) return result(known('native_target_out_of_reach_or_unloaded'))
    // A block centre may be occluded even when its lower/side surface is visible.
    // Only rotate and ask the real server raycast; never inspect through blocks.
    const offsets = aimOffset ? [aimOffset] : [[0.5, 0.5, 0.5], [0.5, 0.1, 0.5], [0.5, 0.9, 0.5],
      [0.1, 0.5, 0.5], [0.9, 0.5, 0.5], [0.5, 0.5, 0.1], [0.5, 0.5, 0.9]]
    try {
      let receipt
      for (let index = 0; index < offsets.length; index++) {
        if (index) await bot.waitForTicks(2) // Native world queries require two server ticks between requests.
        receipt = await world.lookAtBlock(block, offsets[index])
        if (!receipt.ok && block.name === 'air' && ['different_visible_block', 'no_visible_block'].includes(receipt.code)) {
          return result({ ...receipt, raycastAttempts: index + 1,
            requestedVoxel: { cachedAir: true, source: 'client_chunk_projection', nativeBlockVerified: false },
            hint: 'The requested voxel is AIR in the client cache; air has no target surface. The reply describes the first server-visible block. Aim at an existing support/reference block before placing into the empty destination. Repositioning cannot make air raycastable.' })
        }
        if (receipt.ok || !['different_visible_block', 'no_visible_block'].includes(receipt.code)) {
          return result({ ...receipt, aimOffsetUsed: offsets[index], raycastAttempts: index + 1 })
        }
      }
      return result({ ...receipt, raycastAttempts: offsets.length,
        hint: 'Target surfaces are occluded. Move to a clear side before repeating; no interaction was performed.' })
    }
    catch (error) { return result(known('native_look_not_observed', { detail: error.message })) }
  }
  async function select ({ hotbarSlot, expectedSnbt, expectedId }) {
    const before = state()
    if (before?.menuType !== 'minecraft:inventory' || before.carried) return result(known('close_menu_and_empty_cursor_first'))
    const item = before.slots?.[36 + hotbarSlot]
    if (expectedId !== undefined && (item?.id ?? 'minecraft:air') !== expectedId ||
        expectedSnbt !== undefined && (item?.snbt ?? '') !== expectedSnbt) return result(known('native_selection_item_changed'))
    const fullSnbt = item?.snbt ?? ''
    bot.setQuickBarSlot(hotbarSlot)
    bot._client.write('held_item_slot', { slotId: hotbarSlot })
    for (let i = 0; i < 30; i++) {
      const after = state()
      if (after?.selectedHotbarSlot === hotbarSlot && (after.slots?.[36 + hotbarSlot]?.snbt ?? '') === fullSnbt) {
        return result({ ok: true, code: 'native_hotbar_selected', outcomeKnown: true, hotbarSlot, held: after.slots[36 + hotbarSlot] })
      }
      await wait(50)
    }
    return result(known('native_hotbar_selection_not_observed'))
  }
  async function equip ({ sourceSlot, hotbarSlot, expectedId, expectedSnbt }) {
    if (sourceSlot >= 5 && sourceSlot <= 8) return result(known('native_equip_source_not_inventory_or_grid'))
    const before = state(), destination = 36 + hotbarSlot
    if (before?.menuType !== 'minecraft:inventory' || before.carried) return result(known('close_menu_and_empty_cursor_first'))
    const item = before.slots[sourceSlot]
    if (!item || item.id !== expectedId || !item.snbt || before.mayPickup?.[sourceSlot] !== true ||
        expectedSnbt !== undefined && item.snbt !== expectedSnbt) return result(known('native_equip_source_changed'))
    if (sourceSlot !== destination && before.slots[destination]) return result(known('native_equip_hotbar_not_empty'))
    const receiptIDs = []
    if (sourceSlot !== destination) {
      for (const slot of [sourceSlot, destination]) {
        const receipt = await menu.click(slot, 0)
        if (receipt?.requestId) receiptIDs.push(receipt.requestId)
        if (!receipt?.ok || receipt.changed !== true) return result({ ...known(receipt?.code ?? 'native_equip_click_rejected'),
          outcomeKnown: receipt?.outcomeKnown !== false, outcomeUnknown: receipt?.outcomeUnknown === true,
          receiptIDs, inspectNativeStateBeforeRetry: true })
        const after = state()
        if (slot === sourceSlot ? after?.carried?.snbt !== item.snbt || after.slots[sourceSlot] :
          after?.carried || after?.slots[destination]?.snbt !== item.snbt) return result(known('native_equip_state_changed', { receiptIDs }))
      }
    }
    return { ...await select({ hotbarSlot, expectedSnbt: item.snbt }), receiptIDs }
  }
  async function craft (args) {
    if (!state()) return result(known('native_inventory_unavailable'))
    return result(await craftNativeGrid(menu, args))
  }
  async function craftRecipe (args) {
    if (!state()) return result(known('native_inventory_unavailable'))
    return result(await craftNativeRecipe(menu, native, own(), args))
  }
  function food () {
    const current = state()
    return result({ ok: true, ...nativeFoodOptions(current, own()), self: current?.self ?? null })
  }
  async function consume ({ itemId, inventorySlot, expectedSnbt }) {
    const uuid = own(), epoch = generation
    const initial = state()
    const selected = nativeFoodOptions(initial, uuid).items.find(item => item.id === itemId &&
      (inventorySlot === undefined || item.slot === inventorySlot))
    if (!selected || expectedSnbt !== undefined && selected.snbt !== expectedSnbt) return result(known('native_food_item_changed'))
    let dispatched = false
    const check = () => {
      if (closed || own() !== uuid || generation !== epoch || bot.health <= 0) throw Error('native_food_context_changed')
    }
    const guardedMenu = { current: () => { check(); return menu.current() }, click: async (...args) => {
      check(); dispatched = true; return menu.click(...args)
    } }
    try {
      return result(await consumeNativeFood({ bot: {
        activateItem () { check(); dispatched = true; bot.activateItem() },
        deactivateItem () { bot.deactivateItem() }
      }, menu: guardedMenu, uuid, itemId, inventorySlot: selected.slot, check, wait,
      select: hotbarSlot => select({ hotbarSlot, expectedId: itemId, expectedSnbt: selected.snbt }) }))
    } catch (error) {
      return result({ ...known(error.message), outcomeKnown: !dispatched, outcomeUnknown: dispatched })
    }
  }
  async function place (args) {
    const before = state(), block = localBlock(args.referencePosition)
    if (before?.menuType !== 'minecraft:inventory' || before.carried) return result(known('close_menu_and_empty_cursor_first'))
    if (!block) return result(known('native_target_out_of_reach_or_unloaded'))
    const held = before.slots?.[36 + args.hotbarSlot]
    if (held?.id !== args.itemId || !held.snbt || args.expectedSnbt !== undefined && held.snbt !== args.expectedSnbt) {
      return result(known('native_placement_held_item_changed'))
    }
    let dispatched = false
    try {
      const value = await placeNativeHeld(bot, menu, world, {
        hotbarSlot: args.hotbarSlot, itemId: args.itemId, expectedItemSnbt: held.snbt,
        expectedBlockId: args.blockId, referenceBlock: block, face: new Vec3(args.face.x, args.face.y, args.face.z),
        expectedReference: { id: args.referenceBlockId, properties: args.referenceProperties },
        verificationOffset: args.verificationOffset ?? [0.5, 0.5, 0.5],
        onDispatch: () => { dispatched = true }
      })
      const verified = value.ok === true && value.itemCountAfter === value.itemCountBefore - 1
      return result({ ...value, ...(value.ok && !verified ? { ok: false, code: 'native_placement_inventory_not_verified' } : {}),
        outcomeKnown: !dispatched || verified, outcomeUnknown: dispatched && !verified,
        nativePlacementVerified: verified })
    } catch (error) {
      return result({ ...known(error.code || error.message), outcomeKnown: !dispatched, outcomeUnknown: dispatched })
    }
  }
  async function dig (args) {
    const before = state(), block = localBlock(args.position, 4.5)
    if (before?.menuType !== 'minecraft:inventory' || before.carried) return result(known('close_menu_and_empty_cursor_first'))
    if (!block) return result(known('native_target_out_of_reach_or_unloaded'))
    const actual = await lookAt(args)
    if (!actual.ok || actual.block?.id !== args.expectedBlockId || propertyKey(actual.block.properties) !== propertyKey(args.expectedProperties)) {
      return result(known('native_dig_block_changed', { observed: actual }))
    }
    if (actual.block.destroySpeed < 0 || !actual.block.canHarvestWithMainHand) return result(known('native_harvest_tool_required', { observed: actual.block }))
    const latest = state()
    if (latest?.selectedHotbarSlot !== args.expectedHotbarSlot || (latest.slots[36 + args.expectedHotbarSlot]?.snbt ?? '') !== args.expectedHeldSnbt) {
      return result(known('native_dig_held_item_changed'))
    }
    try {
      await bot.dig(block, true)
      await bot.waitForTicks(2)
      const proxy = bot.blockAt(block.position), after = await world.lookAtBlock(block, args.aimOffset ?? [0.5, 0.5, 0.5])
      const absent = proxy?.name === 'air' && (!after.ok && ['different_visible_block', 'no_visible_block'].includes(after.code))
      return result({ ok: absent, code: absent ? 'native_block_removed' : 'native_dig_not_verified', position: args.position,
        observed: after, outcomeKnown: absent, outcomeUnknown: !absent, dropsCollected: false })
    } catch (error) { return result({ ...known(error.code || error.message), outcomeKnown: false, outcomeUnknown: true }) }
  }
  return { lookAt, select, equip, craft, craftRecipe, food, consume, place, dig, detach () {
    closed = true
    for (const event of ['spawn', 'respawn', 'death']) bot.off(event, contextChanged)
  } }
}
module.exports = { attachConstructionClient }
