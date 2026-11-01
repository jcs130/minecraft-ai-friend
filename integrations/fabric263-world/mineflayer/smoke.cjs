'use strict'

const { createBot } = require('./create_bot.cjs')
const fs = require('node:fs')
const path = require('node:path')
const runtime = process.argv[2]
const port = Number(process.argv[3] || 39783)
const username = process.argv[4] || 'MF263Probe'
const log = row => process.stdout.write(JSON.stringify({ observedAt: new Date().toISOString(), ...row }) + '\n')
let bot
let done = false
let spawnAt = 0
let ticks = 0
const recentPackets = []
const timer = setTimeout(() => finish('timeout'), 90000)
function finish (reason) {
  if (done) return
  done = true
  clearTimeout(timer)
  log({ kind: 'finish', reason, physicsTicks: ticks, recentPackets, position: bot?.entity?.position, health: bot?.health,
    nativeRegistry: bot?.registry?.mawNativeRegistry && { ...bot.registry.mawNativeRegistry, menus: undefined, components: undefined } })
  if (bot?.quit) bot.quit('bounded_native_protocol_probe')
  else bot?.end('bounded_native_protocol_probe')
  setTimeout(() => process.exit(reason === 'observed' ? 0 : 1), 1000)
}
bot = createBot({ runtime, host: '127.0.0.1', port, username, auth: 'offline', version: '26.3',
  respawn: false, logErrors: false })
bot._client.on('packet', (_packet, meta) => { recentPackets.push(meta.name); if (recentPackets.length > 24) recentPackets.shift() })
bot.on('error', error => { log({ kind: 'error', message: error.message, stack: error.stack }); finish('error') })
bot._client.on('maw_login_query', query => log({ kind: 'login_query', ...query }))
bot._client.on('maw_fabric_sync', data => log({ kind: 'fabric_sync', ...data }))
bot._client.on('maw_mod_configuration', data => log({ kind: 'mod_configuration', ...data }))
bot._client.on('maw_native_view', data => log({ kind: 'native_view', ...data }))
bot._client.on('custom_payload', packet => log({ kind: 'custom_payload', channel: packet.channel, bytes: packet.data?.length }))
bot.on('kicked', reason => { log({ kind: 'kicked', reason }); finish('kicked') })
bot.on('end', reason => { log({ kind: 'end', reason }); if (!done) finish('end') })
bot.on('login', () => log({ kind: 'login', username: bot.username, uuid: bot._client.uuid }))
bot.on('death', () => { log({ kind: 'death' }); finish('death') })
bot.on('messagestr', text => log({ kind: 'chat', text: text.slice(0, 1000) }))
bot.on('spawn', async () => {
  spawnAt = Date.now()
  log({ kind: 'spawn', position: bot.entity.position, health: bot.health, dimension: bot.game?.dimension })
  try {
    await bot.waitForChunksToLoad()
    const floor = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    log({ kind: 'chunks', floor: floor && { name: floor.name, nativeId: bot.registry.blocks[floor.type]?.nativeId,
      position: floor.position, stateId: floor.stateId, shapes: floor.shapes, properties: floor.getProperties() },
    inventory: bot.inventory.items().map(i => ({ name: i.name, type: i.type, count: i.count, components: i.components })) })
  } catch (error) { log({ kind: 'probe_error', message: error.message }); finish('probe_error') }
})
bot.on('physicsTick', () => {
  ticks++
  if (spawnAt && Date.now() - spawnAt > 8000) finish('observed')
})
