// Real Mineflayer login + chunk smoke for an isolated gateway, not production.
'use strict'
const mineflayer = require('mineflayer')

const host = process.argv[2] || '127.0.0.1'
const port = Number(process.argv[3] || 28977)
const username = process.argv[4] || 'MawGateSmoke'
if (host !== '127.0.0.1' && host !== 'localhost' && process.env.GATE_SMOKE_ALLOW_REMOTE !== '1') {
  console.error('Refusing non-loopback smoke without GATE_SMOKE_ALLOW_REMOTE=1')
  process.exit(2)
}

const bot = mineflayer.createBot({ host, port, username, version: '1.21.1', hideErrors: true })
const result = { host, port, login: false, spawn: false, chunkColumns: 0, timePackets: 0, ground: null, error: null }
let finished = false
const timeout = setTimeout(() => finish('timeout'), 15000)

function finish (reason) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  if (reason) result.error = reason
  const good = result.login && result.spawn && result.chunkColumns > 0 && result.timePackets > 0 && result.ground !== null && !result.error
  console.log(JSON.stringify(result))
  try { bot.quit() } catch (_) {}
  setTimeout(() => process.exit(good ? 0 : 1), 100)
}

bot.on('login', () => { result.login = true })
bot.on('chunkColumnLoad', () => { result.chunkColumns++ })
bot._client.on('update_time', () => { result.timePackets++ })
bot.on('spawn', () => {
  result.spawn = true
  setTimeout(() => {
    const pos = bot.entity?.position
    if (pos) {
      result.position = { x: pos.x, y: pos.y, z: pos.z }
      const block = bot.blockAt(pos.offset(0, -1, 0))
      if (block) result.ground = { name: block.name, stateId: block.stateId }
    }
    finish(null)
  }, 2500)
})
bot.on('error', (error) => { result.error = error.message })
bot.on('end', (reason) => { if (!finished) finish('disconnected: ' + reason) })
