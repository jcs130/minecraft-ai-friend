'use strict'
// Finite ordinary owner for isolated native Numen/maid UI tests. Never a model agent.
const fs = require('node:fs')
const path = require('node:path')
const bot = require('mineflayer').createBot({host: '127.0.0.1', port: Number(process.argv[2]),
  username: 'MawHeadQAOwner', auth: 'offline', version: '1.21.1', physicsEnabled: false})
const directory = process.argv[3]
let processing = false, lastId = '', windows = 0, nativeScreens = 0
bot._client.on('packet', (packet, meta) => {
  if (meta.name === 'open_window') windows++
  if (meta.name === 'custom_payload' && packet.channel === 'neoforge:advanced_open_screen') nativeScreens++
})
bot.once('spawn', () => fs.writeFileSync(path.join(directory, 'owner-ready.json'), JSON.stringify({uuid: bot.player.uuid})))
bot.on('error', error => { console.error(error); process.exitCode = 1 })
bot.on('kicked', reason => console.error('kicked', reason))
const timer = setInterval(async () => {
  if (fs.existsSync(path.join(directory, 'owner-release'))) {
    clearInterval(timer); bot.quit('QA done'); setTimeout(() => process.exit(process.exitCode || 0), 250); return
  }
  const input = path.join(directory, 'owner-command.json')
  if (processing || !fs.existsSync(input)) return
  const command = JSON.parse(fs.readFileSync(input, 'utf8'))
  if (command.id === lastId) return
  processing = true; lastId = command.id
  const result = {id: command.id, ok: false, windowsBefore: windows, nativeScreensBefore: nativeScreens}
  try {
    if (command.kind === 'interact' || command.kind === 'interact_at') {
      const target = Object.values(bot.entities).find(entity => entity.uuid === command.targetUuid)
      if (!target) throw Error('fixture entity not tracked')
      result.targetPosition=target.position
      if(command.kind === 'interact_at')await bot.activateEntityAt(target,target.position.offset(0,1,0))
      else await bot.activateEntity(target)
      await new Promise(resolve => setTimeout(resolve, 350))
    } else if (command.kind === 'close') {
      if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
      else bot._client.write('close_window',{windowId:0}) // A native-only container is hidden by the vanilla Gate.
    } else if (command.kind === 'equip') {
      const item = bot.inventory.items().find(item => item.name === command.item)
      if (!item) throw Error('fixture item not present')
      await bot.equip(item, 'hand')
    } else if (command.kind === 'unequip') await bot.unequip('hand')
    else if (command.kind !== 'inspect') throw Error('unknown test command')
    result.ok = true; result.windowsAfter = windows; result.nativeScreensAfter=nativeScreens; result.heldItem=bot.heldItem?.name||null; result.playerPosition=bot.entity.position
  } catch (error) { result.error = error.message }
  fs.writeFileSync(path.join(directory, 'owner-result.json'), JSON.stringify(result))
  processing = false
}, 50)
setTimeout(() => { bot.quit('QA timeout'); process.exit(2) }, 180000).unref()
