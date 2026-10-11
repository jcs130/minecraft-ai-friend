'use strict'
// Isolated real native scene/food/motion proof, with explicitly supplied fixtures.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const mineflayer = require('mineflayer'), { Vec3 } = require('vec3')
const { attachNativeWorldQuery } = require('../world/src/society-agent/native-world-query.cjs')
const directory = path.resolve(process.argv[2]), login = JSON.parse(fs.readFileSync(path.join(directory, 'login.json')))
assert.ok(/(?:^|\r?\n)server-port=28978\r?\n/.test(fs.readFileSync(path.join(directory, 'server/server.properties'), 'utf8')), 'Isolated port required')
assert.ok(fs.existsSync(path.join(directory, 'ready.json')), 'Dedicated isolated host required')
const report = { checks: {}, suppliedFixtures: true, paidModelCalls: 0, productionActions: 0, ok: false }, scenes = [], slots = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const consoleCommand = command => fs.appendFileSync(path.join(directory, 'console.jsonl'), JSON.stringify({ command }) + '\n')
const subscribe = bot => bot._client.write('custom_payload', { channel: 'maw_agent:scene_subscribe', data: Buffer.from([1]) })
let bot
async function main () {
  consoleCommand('setworldspawn 0 -60 0'); consoleCommand('gamerule doMobSpawning false'); consoleCommand('gamerule doWeatherCycle false')
  consoleCommand('setblock 1 -60 2 farmersdelight:stove[facing=north,lit=true]')
  consoleCommand('data merge block 1 -60 2 {Inventory:{Size:6,Items:[{Slot:0,id:"minecraft:beef",count:1}]},CookingTimes:[I;0,0,0,0,0,0],CookingTotalTimes:[I;2400,0,0,0,0,0]}')
  consoleCommand('setblock -2 -60 2 create:creative_motor[facing=east]'); consoleCommand('setblock -1 -60 2 create:cogwheel[axis=x]')
  consoleCommand('setblock 4 -59 0 create:windmill_bearing[facing=east]')
  for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) consoleCommand(`setblock 5 ${-59 + y} ${z} create:white_sail[facing=east]`)
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 28979, username: login.username, version: '1.21.1', auth: 'offline', physicsEnabled: false })
  const world = attachNativeWorldQuery(bot)
  bot.on('error', () => {}); bot._client.on('custom_payload', p => { if (p.channel === 'maw_agent:scene_state') scenes.push({ bytes: p.data.length, at: Date.now(), data: JSON.parse(p.data.toString('utf8')) }) })
  bot._client.on('set_slot', p => slots.push(p)); bot._client.on('window_items', p => slots.push(p))
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('spawn_timeout')), 25000); bot.once('spawn', () => { clearTimeout(timer); resolve() }); bot.once('end', () => reject(Error('spawn_disconnected'))) })
  subscribe(bot); await delay(500); report.checks.prelogin_scene_denied = scenes.length === 0
  bot.chat('/login ' + login.password)
  let caps
  for (let i = 0; i < 40; i++) { caps = await world.capabilities(); if (caps.ok) break; await delay(100) }
  assert.ok(caps?.ok, 'authentication_required')
  consoleCommand('tp ' + login.username + ' 2.5 -60 0.5')
  consoleCommand('give ' + login.username + ' ars_nouveau:novice_spell_book[minecraft:base_color="red"]')
  subscribe(bot); await delay(1800)
  report.checks.unassembled_original_sails = scenes.some(r => r.data.blocks.filter(b => b.id === 'create:white_sail').length === 9)
  bot.setQuickBarSlot(8)
  const bearing = bot.blockAt(new Vec3(4, -59, 0)); assert.ok(bearing); await bot.activateBlock(bearing, new Vec3(-1, 0, 0))
  await delay(2500)
  const self = scenes.map(r => r.data)
  report.checks.same_player_uuid_only = self.length > 4 && self.every(r => r.playerUuid === bot._client.uuid)
  report.checks.payload_and_radius_budget = scenes.every(r => r.bytes <= 65536 && r.data.blocks.length <= 24 && r.data.radius === 16)
  const foods = self.flatMap(r => r.blocks.filter(b => b.id === 'farmersdelight:stove').flatMap(b => b.foods))
  report.checks.real_stove_inventory = foods.some(f => f.id === 'minecraft:beef' && f.count === 1 && f.cookingTotalTime === 2400)
  report.checks.real_cooking_progress = foods.length > 2 && foods.at(-1).cookingTime > foods[0].cookingTime
  const wheels = self.flatMap(r => r.blocks.filter(b => b.id === 'create:cogwheel'))
  report.checks.real_rpm_and_angle = wheels.some(b => Math.abs(b.kinetic?.rpm) === 16) && new Set(wheels.map(b => b.kinetic?.angleDegrees)).size > 3
  const rotors = self.flatMap(r => r.contraptions || []); report.rotors = rotors.slice(-1)
  report.checks.actual_assembled_windmill = rotors.some(r => r.available && r.sailCount === 9 && r.blocks.length === 9)
  report.checks.actual_rotor_motion = new Set(rotors.map(r => r.angleDegrees)).size > 3
  const items = slots.flatMap(p => p.items || [p.item]).filter(Boolean)
  const markers = items.flatMap(i => i.components || []).filter(c => c.type === 'custom_model_data').map(c => c.data)
  const catalog = JSON.parse(fs.readFileSync(path.join(path.dirname(directory), 'artifacts/maw-native-items.json')))
  const book = catalog.items.find(r => r.nativeItem === 'ars_nouveau:novice_spell_book')
  report.checks.raw_book_red_component_mapping = markers.includes(book.variants.red.customModelData)
  const before = scenes.length; bot._client.write('custom_payload', { channel: 'maw_agent:scene_subscribe', data: Buffer.from([0]) }); await delay(700)
  report.checks.unsubscribe_stops_stream = scenes.length - before <= 1
  report.samples = scenes; report.ok = Object.values(report.checks).every(Boolean)
}
main().catch(e => { report.error = e.stack }).finally(async () => {
  if (bot) { bot.quit('scene QA finished'); await delay(500) }
  fs.writeFileSync(path.join(directory, 'native-scene-acceptance.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, error: report.error })); process.exitCode = report.ok ? 0 : 1
})
