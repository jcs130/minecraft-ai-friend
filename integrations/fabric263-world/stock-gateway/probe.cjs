'use strict'
// Acceptance client: public, unmodified Mineflayer; no loadPlugin or adapter.
const path = require('node:path')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const runtime = process.argv[2]
const runId = process.argv[3]
const version = process.argv[4] || '1.21.1'
const expectedFloor = process.argv[5] || 'sea_lantern'
if (!['sea_lantern', 'any'].includes(expectedFloor)) throw new Error('expected floor must be sea_lantern or any')
if (!runtime || !/^[a-z0-9-]{1,64}$/.test(runId || '') || !['auto', '1.21.1', '26.1'].includes(version)) throw new Error('runtime, new run ID and supported stock version required')
const req = createRequire(path.resolve(runtime, 'package.json'))
const receiptFile = path.resolve(runtime, runId + '.json')
const fd = fs.openSync(receiptFile, 'wx')
const receipt = { schemaVersion: 1, runId, startedAt: new Date().toISOString(), packageVersion: req('mineflayer/package.json').version,
  entry: "require('mineflayer').createBot", externalPlugins: [], version, port: 39786, observations: [], success: false }
let finished = false
let observedFloor
const bot = req('mineflayer').createBot({ host: '127.0.0.1', port: 39786, version: version === 'auto' ? false : version,
  username: version === 'auto' ? 'StockAutoBridge' : version === '1.21.1' ? 'StockGate1211' : 'StockGate261', auth: 'offline', logErrors: false, respawn: false })
const timeout = setTimeout(() => finish('timeout'), 30000)
function finish (reason) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  Object.assign(receipt, { reason, observedAt: new Date().toISOString(), negotiatedVersion: bot.version })
  fs.writeSync(fd, JSON.stringify(receipt, null, 2)); fs.closeSync(fd)
  console.log(JSON.stringify(receipt))
  if (typeof bot.quit === 'function') bot.quit('stock_gateway_probe_done'); else bot.end('stock_gateway_probe_done')
  setTimeout(() => process.exit(receipt.success ? 0 : 1), 300)
}
process.once('uncaughtException', error => { receipt.observations.push({ kind: 'uncaught_error', message: error.message }); finish('uncaught_error') })
bot.on('error', error => { receipt.observations.push({ kind: 'error', message: error.message }); finish('error') })
bot.on('kicked', reason => { receipt.observations.push({ kind: 'kicked', reason }); finish('kicked') })
bot.on('end', reason => { if (!finished) { receipt.observations.push({ kind: 'end', reason }); finish('disconnected') } })
bot.on('messagestr', value => {
  if (!value.startsWith('MC_NATIVE ')) return
  const row = JSON.parse(value.slice(10))
  receipt.observations.push({ kind: 'private_native_read', data: row })
  if (row.requestId === 'stock-status-1' && row.status === 'ok' && row.health?.current > 0 && row.position && row.bodyId === bot._client.uuid) {
    bot.chat('/agent stock-floor-1 block ' + [observedFloor.position.x, observedFloor.position.y, observedFloor.position.z].join(' '))
  }
  if (row.requestId === 'stock-floor-1') {
    if (row.status === 'ok' && row.block?.nativeId === 'minecraft:' + observedFloor.name) {
      receipt.success = true
      finish('authoritative_status_and_actual_floor_verified')
    } else finish('native_floor_verification_failed')
  }
})
bot.once('spawn', async () => {
  receipt.observations.push({ kind: 'spawn', position: bot.entity.position, health: bot.health, uuid: bot._client.uuid })
  try {
    await bot.waitForChunksToLoad()
    const floor = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!floor || floor.name === 'air' || (expectedFloor !== 'any' && floor.name !== expectedFloor)) throw new Error('actual_floor_not_observed:' + floor?.name)
    observedFloor = floor
    receipt.observations.push({ kind: 'world', floor: { name: floor.name, stateId: floor.stateId, position: floor.position }, health: bot.health })
    bot.chat('/agent stock-status-1 status')
  } catch (error) { receipt.observations.push({ kind: 'read_error', message: error.message }); finish('world_read_failed') }
})
