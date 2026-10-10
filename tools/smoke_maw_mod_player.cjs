'use strict'
// Finite ordinary-player test helper; actions are supplied by the isolated QA
// driver, never by a model. Native menu snapshots/receipts are preserved locally.
const fs = require('node:fs')
const path = require('node:path')
const { Vec3 } = require('vec3')
const mineflayer = require('mineflayer')
const { attachModAgentClient } = require('../world/src/neoforge-handshake/mod-agent-client.cjs')
const dir = process.argv[3]
const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file + '.part', JSON.stringify(value)); fs.renameSync(file + '.part', file) }
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.argv[2]), username: 'MawModQA', version: '1.21.1', auth: 'offline', hideErrors: true })
const sdk = attachModAgentClient(bot)
// Ten finite adapters each retire three lifecycle listeners on detach.
bot.setMaxListeners(32)
let busy = false, last = '', done = false, chatter = []
bot.on('message', message => { chatter.push(message.toString()); if (chatter.length > 100) chatter.shift() })
bot.once('spawn', () => write('player-ready.json', { uuid: bot._client.uuid, username: bot.username }))
bot.on('error', error => write('player-error.json', { error: error.message }))
bot.on('kicked', reason => write('player-kicked.json', { reason }))
const interval = setInterval(async () => {
  if (busy || done) return
  const file = path.join(dir, 'player-command.json')
  if (!fs.existsSync(file)) return
  const command = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (last === command.id) return
  last = command.id; busy = true
  try {
    let result
    if (command.kind === 'look') { await bot.lookAt(new Vec3(command.x, command.y, command.z), true); result = { ok: true } }
    else if (command.kind === 'call') result = await sdk.call(command.operation, command.arguments || {})
    else if (command.kind === 'inspect') result = { uuid: bot._client.uuid, position: bot.entity.position, menu: sdk.menu.current(), chatter }
    else if (command.kind === 'quit') { done = true; result = { ok: true }; clearInterval(interval); bot.quit('QA complete') }
    else throw Error('unknown_test_command')
    write('player-result.json', { id: last, result })
  } catch (error) { write('player-result.json', { id: last, error: { code: error.code || error.message, outcomeUnknown: error.outcomeUnknown === true } }) }
  finally { busy = false }
}, 50)
const lifetime = setTimeout(() => { clearInterval(interval); bot.quit('QA finite timeout'); process.exitCode = 2 }, 480000)
bot.once('end', () => { clearInterval(interval); clearTimeout(lifetime); sdk.detach() })
