'use strict'

// Transport acceptance only. No movement or inventory writes before registry validation.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(process.argv[2] || '')
const marker = JSON.parse(fs.readFileSync(path.join(root, 'pack-source.json'), 'utf8'))
if (marker.scope !== 'isolated_testing') throw new Error('isolated_lab_marker_required')
const mineflayer = require('mineflayer')
const { attachForge } = require('./forge_client.cjs')
const result = { schemaVersion: 1, name: 'SAOBridgeProbe', minecraft: '1.20.1', connected: false,
  spawn: false, purpose: 'handshake_only_no_world_actions', packets: {}, errors: [], observedAt: new Date().toISOString() }
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 39676, username: result.name, auth: 'offline',
  version: '1.20.1', hideErrors: true, physicsEnabled: false })
bot.physicsEnabled = false
result.modLogin = []
attachForge(bot._client, root, state => {
  result.modLogin.push({ channel: state.channel, kind: state.kind, bytes: state.bytes,
    name: state.name, mappingCount: state.mappings?.length })
})
let timer
function finish (reason) {
  clearTimeout(timer)
  if (result.finishedAt) return
  result.reason = reason
  result.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(root, 'handshake-probe.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  bot.quit('isolated transport test complete')
  setTimeout(() => process.exit(result.spawn ? 0 : 1), 500)
}
bot._client.on('packet', (p, m) => { result.packets[m.name] = (result.packets[m.name] || 0) + 1 })
bot.on('login', () => { result.connected = true; result.uuid = bot._client.uuid })
bot.on('spawn', () => {
  result.spawn = true
  result.position = bot.entity.position
  result.dimension = bot.game.dimension
  result.health = bot.health
  console.log(JSON.stringify({ stage: 'spawn', uuid: result.uuid, position: result.position }))
  clearTimeout(timer); timer = setTimeout(() => finish('spawn_observed'), 5000)
})
bot.on('error', e => { result.errors.push({ name: e.name, message: e.message, field: e.field, stack: e.stack?.slice(0,2400) }) })
bot.on('kicked', reason => { result.kick = reason; finish('kicked') })
bot.on('end', reason => finish(`end:${reason}`))
timer = setTimeout(() => finish('timeout'), 45000)
