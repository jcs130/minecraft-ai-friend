// Native vanilla-protocol client; proves basic Agent access without a client mod.
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require = createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json')
const mineflayer = require('mineflayer')
const port = Number(process.argv[2]), output = process.argv[3]
const cold=process.argv[4]==='cold'
if (port < 25926 || port > 25930 || !output) throw new Error('isolated fixture only')
const result = { spawned: false, errors: [], commands: [], messages: [], snapshots: [] }
const bot = mineflayer.createBot({ host: '127.0.0.1', port, username: 'ag_VortexQA', version: '1.21.1', auth: 'offline', checkTimeoutInterval: 60000 })
bot.on('error', error => result.errors.push(String(error)))
bot.on('kicked', reason => result.errors.push(`kicked: ${JSON.stringify(reason)}`))
bot.on('messagestr', text => { if (result.messages.length < 160) result.messages.push(text) })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  await Promise.race([
    new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('end', reason => reject(new Error(`ended before spawn: ${reason}`))) }),
    sleep(20000).then(() => { throw new Error('spawn timeout') })
  ])
  result.spawned = true
  await sleep(1800)
  for (const command of ['/vrp class info', ...(cold?[]:['/vrp class choose knight']), '/vrp stats text', '/vrp skills spells', '/vrp cast fortify', ...(cold?['/vrp party info']:['/vrp party create']), '/vrp dungeon list', '/vrp dungeon enter crypt_of_the_fallen', '/spell list']) {
    const start = result.messages.length
    bot.chat(command)
    await sleep(1800)
    result.commands.push({ command, feedback: result.messages.slice(start) })
    result.snapshots.push({ health: bot.health, food: bot.food, attributes:bot.entity.attributes, effects:bot.entity.effects, inventory: bot.inventory.items().map(i => ({ name:i.name, count:i.count })) })
    if (bot.currentWindow) { bot.closeWindow(bot.currentWindow); await sleep(100) }
  }
  const reply=q=>result.commands.find(c=>c.command===q)?.feedback.join('\n')??''
  assert.match(reply('/vrp stats text'),/Class: Knight.*Level: 1/)
  if(!cold)assert.match(reply('/vrp class choose knight'),/Class selected: Knight/)
  else assert.match(reply('/vrp class info'),/Class: Knight/)
  assert.match(reply('/vrp skills spells'),/Fortify/)
  assert.match(reply('/vrp dungeon list'),/crypt_of_the_fallen/)
  assert.doesNotMatch(result.messages.join('\n'),/An internal error|Unknown sub-command/)
} catch (error) { result.errors.push(String(error)) }
finally {
  bot.quit('compatibility probe finished')
  await sleep(500)
  await writeFile(output, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ spawned: result.spawned, errors: result.errors, commands: result.commands }))
  process.exitCode = result.errors.length ? 1 : 0
}
