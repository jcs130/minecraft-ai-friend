'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const runtime = process.argv[2]
const runId = process.argv[3]
const plan = process.argv[4]
if (!runtime || !/^[a-z0-9-]{1,40}$/.test(runId || '') || !['walk', 'dig', 'pickup', 'chest', 'craft', 'pot', 'return', 'inspect'].includes(plan)) throw new Error('runtime, unique runId and explicit plan required')
const file = path.resolve(runtime, runId + '.json')
if (fs.existsSync(file)) {
  const original = JSON.parse(fs.readFileSync(file, 'utf8'))
  process.stdout.write(JSON.stringify({ ...original, queriedExisting: true, actionWasNotReplayed: true }) + '\n')
  process.exit(original.actualSuccess === true ? 0 : 2)
}
const req = createRequire(path.resolve(runtime, 'package.json'))
const { Vec3 } = req('vec3')
const receipt = { schemaVersion: 1, runId, plan, status: 'accepted', completed: [], unknown: [],
  stockPackageVersion: req('mineflayer/package.json').version, externalPlugins: [], port: 39786,
  startedAt: new Date().toISOString(), actualSuccess: false }
const fd = fs.openSync(file, 'wx')
const save = () => { fs.ftruncateSync(fd, 0); fs.writeSync(fd, JSON.stringify(receipt, null, 2), 0, 'utf8'); fs.fsyncSync(fd) }
save()
let finished = false
let counter = 0
const waiters = new Map()
const bot = req('mineflayer').createBot({ host: '127.0.0.1', port: 39786, version: '1.21.1', username: 'StockGate1211', auth: 'offline', logErrors: false, respawn: false })
const timer = setTimeout(() => finish(new Error('bounded_exercise_timeout')), 60000)
function finish (error) {
  if (finished) return
  finished = true; clearTimeout(timer)
  for (const row of waiters.values()) { clearTimeout(row.timer); row.reject(new Error('exercise_stopped')) }
  waiters.clear()
  bot.clearControlStates?.()
  if (error) { receipt.status = 'failed_or_unknown'; receipt.reason = error.message }
  else { receipt.status = 'completed'; receipt.actualSuccess = true }
  receipt.observedAt = new Date().toISOString(); save(); fs.closeSync(fd)
  console.log(JSON.stringify(receipt))
  if (bot.quit) bot.quit('bounded_stock_exercise_finished'); else bot.end('bounded_stock_exercise_finished')
  setTimeout(() => process.exit(error ? 1 : 0), 300)
}
bot.on('error', finish)
bot.on('kicked', value => finish(new Error('kicked:' + JSON.stringify(value))))
bot.on('end', value => { if (!finished) finish(new Error('disconnected:' + value)) })
process.once('uncaughtException', finish)
process.once('unhandledRejection', finish)
bot.on('messagestr', message => {
  if (!message.startsWith('MC_NATIVE ')) return
  const row = JSON.parse(message.slice(10))
  const waiter = waiters.get(row.requestId)
  if (waiter) { clearTimeout(waiter.timer); waiters.delete(row.requestId); waiter.resolve(row) }
})
function read (section, args = '') {
  const id = runId + '-' + ++counter
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error('private_read_timeout:' + section)) }, 4000)
    waiters.set(id, { resolve, reject, timer })
    bot.chat('/agent ' + id + ' ' + section + (args ? ' ' + args : ''))
  })
}
function identity (item) {
  return item?.components?.find(row => row.type === 'custom_data')?.data?.value?.maw_native?.value?.id?.value || null
}
function requireTrue (condition, reason) { if (!condition) throw new Error(reason) }
async function step (name, action) {
  receipt.unknown.push(name); save()
  const value = await action()
  receipt.unknown = receipt.unknown.filter(item => item !== name)
  receipt.completed.push({ name, observedAt: new Date().toISOString(), value }); save()
  return value
}
async function open (position) {
  const target = bot.blockAt(new Vec3(...position))
  requireTrue(target, 'target_chunk_unknown')
  // Public openBlock accepts a real interaction target even when openContainer's
  // built-in chest-name allowlist cannot identify a mod machine carrier.
  return bot.openBlock(target)
}
async function inventory (filter) {
  const value = await read('inventory', '0 12 ' + filter)
  requireTrue(['ok', 'partial'].includes(value.status), 'native_inventory_unavailable')
  return value
}
async function close (window) { bot.closeWindow(window); await bot.waitForTicks(3) }
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); await bot.waitForTicks(3)
    receipt.bodyId = bot._client.uuid
    if (plan === 'walk') await step('normal_forward_movement', async () => {
      const initial = await read('status')
      const target = new Vec3(-10.5, bot.entity.position.y + bot.entity.height, 4.5)
      await bot.lookAt(target, true); bot.setControlState('forward', true)
      for (let tick = 0; tick < 60; tick++) {
        if (Math.hypot(bot.entity.position.x + 10.5, bot.entity.position.z - 4.5) < 0.3) break
        await bot.waitForTicks(1)
      }
      bot.clearControlStates(); await bot.waitForTicks(3)
      const final = await read('status')
      requireTrue(final.status === 'ok' && Math.hypot(final.position.x + 10.5, final.position.z - 4.5) < 0.65, 'server_position_did_not_reach_target')
      return { initial: initial.position, final: final.position, health: final.health }
    })
    if (plan === 'dig') await step('normal_dig', async () => {
      const block = bot.blockAt(new Vec3(-8, 150, 5))
      requireTrue(block?.name === 'dirt', 'fixture_dirt_not_present_do_not_replay')
      await bot.dig(block, true); await bot.waitForTicks(3)
      requireTrue(bot.blockAt(block.position)?.name === 'air', 'actual_dirt_not_removed')
      receipt.actualChanges = { removedBlock: { x: -8, y: 150, z: 5 }, resultingBlock: 'air' }; save()
      const state = await inventory('minecraft:dirt')
      requireTrue(state.rows.some(row => row.item?.nativeId === 'minecraft:dirt' && row.item.count >= 1), 'native_dirt_drop_not_observed')
      return state
    })
    if (plan === 'pickup') await step('item_pickup_reconciles_prior_dig_without_replaying_it', async () => {
      requireTrue(bot.blockAt(new Vec3(-8, 150, 5))?.name === 'air', 'prior_dig_result_not_observed')
      let actual = await inventory('minecraft:dirt')
      if (!actual.rows.some(row => row.item?.nativeId === 'minecraft:dirt' && row.item.count >= 1)) {
        const item = Object.values(bot.entities).find(entity => entity.name === 'item' && identity(entity.metadata?.[8]) === 'minecraft:dirt' && entity.position.distanceTo(new Vec3(-8, 150, 5)) < 3)
        requireTrue(item, 'actual_visible_dirt_drop_not_observed')
        await bot.lookAt(item.position.offset(0, bot.entity.height, 0), true); bot.setControlState('forward', true)
        for (let tick = 0; tick < 50; tick++) {
          if (!bot.entities[item.id] || Math.hypot(bot.entity.position.x - item.position.x, bot.entity.position.z - item.position.z) < 0.5) break
          await bot.waitForTicks(1)
        }
        bot.clearControlStates(); await bot.waitForTicks(5)
        actual = await inventory('minecraft:dirt')
      }
      requireTrue(actual.rows.some(row => row.item?.nativeId === 'minecraft:dirt' && row.item.count >= 1), 'actual_dirt_pickup_not_confirmed')
      return { block: 'air', actual }
    })
    if (plan === 'chest') await step('ordinary_clicks_take_real_native_rice_and_planks', async () => {
      const window = await open([-8, 150, 3])
      const moved = []
      for (const [slot, nativeId, count] of [[0, 'farmersdelight:rice', 8], [2, 'minecraft:oak_planks', 8]]) {
        requireTrue(identity(window.slots[slot]) === nativeId && window.slots[slot].count === count, 'unexpected_original_chest_stack:' + nativeId)
        let destination = window.inventoryStart
        while (destination < window.inventoryEnd && window.slots[destination]) destination++
        requireTrue(destination < window.inventoryEnd, 'player_inventory_full')
        await bot.clickWindow(slot, 0, 0); await bot.clickWindow(destination, 0, 0); await bot.waitForTicks(3)
        const actual = await read('menu', '0 12 ' + nativeId)
        requireTrue(actual.rows.some(row => row.nativeSlot === destination && row.item?.nativeId === nativeId && row.item.count === count), 'server_did_not_confirm_chest_transfer:' + nativeId)
        moved.push({ nativeId, count, actual })
      }
      requireTrue(identity(window.slots[1]) === 'farmersdelight:cooking_pot', 'same_carrier_other_native_item_was_changed')
      await close(window)
      return moved
    })
    if (plan === 'craft') await step('ordinary_inventory_crafting', async () => {
      const actualRecipe = await read('recipes', '0 12 minecraft:crafting_table')
      requireTrue(actualRecipe.rows?.length > 0, 'server_recipe_not_observed')
      const type = bot.registry.itemsByName.crafting_table.id
      const recipe = bot.recipesFor(type, null, 1)[0]
      requireTrue(recipe, 'stock_recipe_materials_not_present')
      await bot.craft(recipe, 1); await bot.waitForTicks(3)
      const final = await inventory('minecraft:crafting_table')
      requireTrue(final.rows.some(row => row.item?.nativeId === 'minecraft:crafting_table' && row.item.count === 1), 'real_crafting_result_not_observed')
      return { actualRecipe, final }
    })
    if (plan === 'pot') await step('ordinary_clicks_put_four_real_rice_in_native_cooking_pot', async () => {
      const actualBlock = await read('block', '-8 150 7')
      requireTrue(actualBlock.status === 'ok' && actualBlock.block.nativeId === 'farmersdelight:cooking_pot', 'actual_pot_block_not_verified')
      const window = await open([-8, 150, 7])
      requireTrue(!window.slots[0], 'pot_already_has_input_do_not_replay')
      const slot = window.slots.findIndex((item, index) => index >= window.inventoryStart && identity(item) === 'farmersdelight:rice')
      requireTrue(slot >= 0 && window.slots[slot].count === 8, 'expected_eight_rice_before_split')
      await bot.clickWindow(slot, 1, 0); await bot.clickWindow(0, 0, 0); await bot.waitForTicks(3)
      const actual = await read('menu', '0 12 farmersdelight:rice')
      requireTrue(actual.nativeMenu === 'farmersdelight:cooking_pot' && actual.rows.some(row => row.nativeSlot === 0 && row.item?.nativeId === 'farmersdelight:rice' && row.item.count === 4), 'native_pot_input_not_confirmed')
      await close(window)
      return { actualBlock, actual }
    })
    if (plan === 'return') await step('ordinary_clicks_return_remaining_rice_to_shared_fixture_chest', async () => {
      const window = await open([-8, 150, 3])
      requireTrue(!window.slots[0], 'original_rice_chest_slot_not_empty')
      const slot = window.slots.findIndex((item, index) => index >= window.inventoryStart && identity(item) === 'farmersdelight:rice')
      requireTrue(slot >= 0 && window.slots[slot].count === 4, 'expected_four_remaining_rice')
      await bot.clickWindow(slot, 0, 0); await bot.clickWindow(0, 0, 0); await bot.waitForTicks(3)
      const actual = await read('menu', '0 12 farmersdelight:rice')
      requireTrue(actual.rows.some(row => row.nativeSlot === 0 && row.item?.nativeId === 'farmersdelight:rice' && row.item.count === 4), 'returned_native_stack_not_confirmed')
      await close(window); return actual
    })
    if (plan === 'inspect') await step('reconnect_actual_inventory_and_body', async () => {
      const state = await read('status')
      const rice = await inventory('farmersdelight:rice')
      const craftingTable = await inventory('minecraft:crafting_table')
      requireTrue(state.status === 'ok' && state.bodyId === bot._client.uuid && state.health.current > 0, 'body_reconnect_not_verified')
      requireTrue(rice.totalCount === 0 && craftingTable.rows.some(row => row.item?.nativeId === 'minecraft:crafting_table' && row.item.count === 1), 'expected_post_transfer_inventory_not_verified')
      return { status: state, rice, craftingTable }
    })
    finish()
  } catch (error) { finish(error) }
})
module.exports = { identity }
