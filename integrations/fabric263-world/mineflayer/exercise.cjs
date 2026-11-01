'use strict'
// Explicit isolated-world acceptance probe. Mutations are journaled before
// connection and never replayed when the request ID already exists.
const { createBot } = require('./create_bot.cjs')
const { createRequire } = require('node:module')
const { once } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const [runtime, plan, requestId, username = 'MFPlayProbe'] = process.argv.slice(2)
if (!runtime || !['basic', 'items', 'craft', 'mod_menu', 'quests', 'reconnect'].includes(plan) || !/^[a-zA-Z0-9_.-]{1,64}$/.test(requestId || '')) throw new Error('Expected runtime, plan, unique requestId and optional QA username')
const directory = path.resolve(runtime, 'requests')
fs.mkdirSync(directory, { recursive: true })
const file = path.join(directory, requestId + '.json')
if (fs.existsSync(file)) { process.stdout.write(fs.readFileSync(file)); process.exit(0) }
const receipt = { schemaVersion: 1, requestId, plan, username, port: 39783,
  sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'), status: 'submitted', goalVerified: false,
  observedAt: new Date().toISOString(), steps: [] }
fs.writeFileSync(file, JSON.stringify(receipt, null, 2), { flag: 'wx' })
const req = createRequire(path.resolve(runtime, 'package.json'))
const { Vec3 } = req('vec3')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const save = () => fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n')
const log = row => process.stdout.write(JSON.stringify({ observedAt: new Date().toISOString(), ...row }) + '\n')
let bot
const deadline = setTimeout(() => { receipt.status = 'unknown'; receipt.reason = 'probe_deadline_do_not_replay'; save(); bot?.end('qa_deadline'); process.exit(1) }, 90000)
const item = i => i && { type: i.type, name: i.name, count: i.count, slot: i.slot, components: i.components }
async function step (name, action) {
  const row = { name, status: 'accepted', observedAt: new Date().toISOString() }; receipt.steps.push(row); save()
  try { row.result = await action(); row.status = 'completed'; row.completedAt = new Date().toISOString(); save(); log(row); return row.result } catch (e) { row.status = 'failed'; row.reason = e.message; save(); throw e }
}

async function main () {
  bot = createBot({ runtime, host: '127.0.0.1', port: 39783, username, auth: 'offline', version: '26.3', logErrors: false, respawn: false })
  bot.on('error', e => log({ kind: 'error', message: e.message, stack: e.stack }))
  bot.on('kicked', reason => log({ kind: 'kicked', reason }))
  bot.on('end', reason => {
    if (!['submitted', 'executing'].includes(receipt.status)) return
    receipt.status = 'unknown'; receipt.reason = 'connection_ended_do_not_replay:' + reason
    const active = receipt.steps.findLast(s => s.status === 'accepted'); if (active) active.status = 'unknown'
    save(); clearTimeout(deadline); log({ kind: 'result', status: 'unknown', requestId }); setTimeout(() => process.exit(1), 200)
  })
  bot.on('messagestr', text => log({ kind: 'chat', text: text.slice(0, 1000) }))
  bot._client.on('maw_native_view', data => log({ kind: 'view', ...data }))
  bot._client.on('maw_native_menu', data => log({ kind: 'menu', ...data }))
  await once(bot, 'spawn'); await bot.waitForChunksToLoad(); await bot.waitForTicks(10)
  receipt.bodyId = bot._client.uuid; receipt.serverEpoch = bot.registry.mawNativeRegistry.serverEpoch
  receipt.status = 'executing'; receipt.startPosition = bot.entity.position.clone(); save()
  if (bot.game.dimension !== 'overworld') throw new Error('Unexpected fixture dimension')
  if (plan === 'basic') {
    const { pathfinder, Movements, goals } = req('mineflayer-pathfinder')
    bot.loadPlugin(pathfinder)
    const movement = new Movements(bot); movement.canDig = false; movement.allow1by1towers = false; movement.allowFreeMotion = false
    bot.pathfinder.setMovements(movement)
    await step('walk_to_fixture', async () => {
      const from = bot.entity.position.clone(); await bot.pathfinder.goto(new goals.GoalNear(0, 150, 0, 1))
      if (bot.entity.position.distanceTo(new Vec3(0, 150, 0)) > 2) throw new Error('Actual position did not reach fixture')
      return { from, actual: bot.entity.position.clone(), health: bot.health }
    })
    await step('dig_actual_dirt', async () => {
      const block = bot.blockAt(new Vec3(2, 150, 0))
      if (block?.name !== 'dirt' || bot.entity.position.distanceTo(block.position) > 5) throw new Error('Dirt fixture missing or out of reach; no guessed target')
      await bot.dig(block); await sleep(1200)
      const after = bot.blockAt(block.position)
      if (after?.name !== 'air') throw new Error('Dig did not change the block to air')
      return { position: block.position, after: after.name, inventory: bot.inventory.items().map(item) }
    })
  }
  if (plan === 'basic' || plan === 'items') {
    await step('withdraw_real_vanilla_and_mod_items', async () => {
      const chest = bot.blockAt(new Vec3(3, 150, 1)); if (chest?.name !== 'chest') throw new Error('Expected real chest')
      const window = await bot.openContainer(chest)
      const before = window.containerItems().map(item)
      const oak = bot.registry.itemsByName.oak_planks; const rice = bot.registry.itemsByName['farmersdelight:rice']
      await window.withdraw(oak.id, null, 8); await window.withdraw(rice.id, null, 4)
      await bot.waitForTicks(5)
      const inventory = bot.inventory.items().map(item)
      const after = window.containerItems().map(item); await bot.closeWindow(window); await bot.waitForTicks(3)
      const actual = bot.inventory.items().map(item)
      if (!actual.some(i => i.name === 'farmersdelight:rice' && i.count === 4) || !actual.some(i => i.name === 'oak_planks' && i.count === 8)) throw new Error('Actual inventory delta differs after closing')
      return { before, after, inventory: actual, nativeType: window.type, slots: window.slots.length }
    })
  } else if (plan === 'craft') {
    await step('craft_from_native_server_recipe', async () => {
      const id = bot.registry.itemsByName.crafting_table.id
      const recipes = bot.recipesFor(id, null, 1, null)
      if (!recipes.length) throw new Error('No actually affordable native crafting-table recipe')
      await bot.craft(recipes[0], 1)
      await bot.waitForTicks(5)
      const inventory = bot.inventory.items().map(item)
      if (!inventory.some(i => i.name === 'crafting_table' && i.count >= 1)) throw new Error('Craft returned without actual output')
      return { recipe: recipes[0].nativeRecipeId, inventory }
    })
  } else if (plan === 'mod_menu') {
    await step('open_actual_farmers_delight_pot', async () => {
      const pot = bot.blockAt(new Vec3(3, 150, -1))
      if (pot?.name !== 'farmersdelight:cooking_pot' || bot.entity.position.distanceTo(pot.position) > 5) throw new Error('Pot fixture missing or out of reach')
      const event = once(bot, 'windowOpen'); await bot.activateBlock(pot); const [window] = await event
      if (window.type !== 'farmersdelight:cooking_pot' || window.slots.length !== window.nativeLayout.slotCount) throw new Error('Native menu identity/layout mismatch')
      if (window.slots[0]) throw new Error('Fixture input slot already occupied; reconcile original request')
      const rice = bot.inventory.items().find(i => i.name === 'farmersdelight:rice')
      if (!rice) throw new Error('No actual rice in inventory')
      const inWindow = window.slots.find(i => i?.name === rice.name)
      await bot.clickWindow(inWindow.slot, 0, 0); await bot.clickWindow(0, 0, 0); await bot.waitForTicks(5)
      if (window.slots[0]?.name !== rice.name || window.slots[0]?.count !== 4) throw new Error('Pot input slot did not receive rice')
      const deposited = item(window.slots[0]); await bot.closeWindow(window)
      return { blockState: pot.stateId, properties: pot.getProperties(), nativeType: window.type, slots: window.slots.length, layout: window.nativeLayout, deposited }
    })
  } else if (plan === 'quests') {
    await step('read_own_native_village_journal', async () => {
      bot.chat('/vq journal open'); await sleep(1500)
      const available = bot.native263.views.list()
      // 2.6.3 routes the journal command through the new reputation view.
      const channel = available.find(c => c.includes('journal')) || available.find(c => c === 'village-quest:reputation_view_v2')
      if (!channel) throw new Error('No original journal payload and matching native view observed')
      return bot.native263.views.get(channel)
    })
  } else {
    await step('reconnect_actual_state', async () => ({ bodyId: bot._client.uuid, position: bot.entity.position.clone(),
      health: bot.health, inventory: bot.inventory.items().map(item), floor: bot.blockAt(bot.entity.position.offset(0, -1, 0))?.name }))
  }
  receipt.status = 'completed'; receipt.goalVerified = true; receipt.endPosition = bot.entity.position.clone(); receipt.inventory = bot.inventory.items().map(item); save()
  bot.quit('qa_completed'); clearTimeout(deadline); log({ kind: 'result', status: receipt.status, requestId, goalVerified: true })
  setTimeout(() => process.exit(0), 500)
}
main().catch(error => { receipt.status = 'failed'; receipt.reason = error.message; receipt.stack = error.stack; save(); log({ kind: 'result', status: 'failed', reason: error.message }); clearTimeout(deadline); bot?.end('qa_failed'); setTimeout(() => process.exit(1), 500) })
