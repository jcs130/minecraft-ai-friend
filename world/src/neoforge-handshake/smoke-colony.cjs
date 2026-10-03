'use strict'

// Loopback-only real Mineflayer query against a running isolated lab gateway.
const mineflayer = require('mineflayer')
const { attachColonyClient } = require('./colony-client.cjs')

const host = process.argv[2] || '127.0.0.1'
const port = Number(process.argv[3] || 28980)
const username = process.argv[4] || 'MawColonyQA'
if (host !== '127.0.0.1' && host !== 'localhost') throw Error('LOOPBACK_ONLY')

const bot = mineflayer.createBot({ host, port, username, version: '1.21.1', hideErrors: true })
const colony = attachColonyClient(bot)
const timer = setTimeout(() => finish({ ok: false, code: 'timeout' }), 15000)
let done = false

function finish (result) {
  if (done) return
  done = true
  clearTimeout(timer)
  console.log(JSON.stringify(result))
  bot.quit()
  setTimeout(() => process.exit(result.ok ? 0 : 1), 150)
}

bot.on('spawn', async () => {
  try {
    const response = await colony.status()
    finish({ ok: true, position: bot.entity.position, response })
  } catch (error) { finish({ ok: false, code: error.message }) }
})
bot.on('error', error => finish({ ok: false, code: error.message }))
bot.on('end', reason => { if (!done) finish({ ok: false, code: `disconnected:${reason}` }) })
