'use strict'

// Read-only control case: use the supplied package's public createBot directly.
// No loadPlugin, supplied client, packet overrides, registry injection or SDK.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')

const runtime = process.argv[2]
const version = process.argv[3] || 'auto'
if (!runtime || !['auto', '26.3'].includes(version)) {
  throw new TypeError('Usage: node stock_probe.cjs <independent Node project> [auto|26.3]; loopback lab 39781 only')
}
const req = createRequire(path.resolve(runtime, 'package.json'))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const packageFile = req.resolve('mineflayer/package.json')
const packageRoot = path.dirname(packageFile)
const manifest = req('mineflayer/package.json')
const receipt = {
  schemaVersion: 1, startedAt: new Date().toISOString(), host: '127.0.0.1', port: 39781,
  requestedVersion: version, package: { name: manifest.name, version: manifest.version,
    loaderSha256: hash(path.join(packageRoot, 'lib/loader.js')),
    versionTableSha256: hash(path.join(packageRoot, 'lib/version.js')) },
  entry: "require('mineflayer').createBot", externalPlugins: [],
  suppliedClient: false, customPackets: false, registryInjection: false,
  login: false, spawn: false, chunksLoaded: false, nativeInformationVerified: false,
  observations: [], errors: []
}
let bot
let finished = false
const deadline = setTimeout(() => finish('timeout', 'bounded_read_did_not_finish'), 30000)
function finish (status, reason) {
  if (finished) return
  finished = true
  clearTimeout(deadline)
  Object.assign(receipt, { status, reason, observedAt: new Date().toISOString() })
  process.stdout.write(JSON.stringify(receipt) + '\n')
  try {
    if (typeof bot?.quit === 'function') bot.quit('bounded_stock_compatibility_probe')
    else bot?.end('bounded_stock_compatibility_probe')
  } catch (error) { process.stderr.write(error.message + '\n') }
  // Exit only this short-lived probe, including outstanding sockets after a failure.
  setTimeout(() => process.exit(status === 'partial' ? 3 : 2), 300)
}
function failed (error, event) {
  receipt.errors.push({ event, name: error.name, code: error.code || null, message: error.message })
  finish('unavailable', event)
}
process.once('uncaughtException', error => failed(error, 'uncaught_exception'))
process.once('unhandledRejection', error => failed(error instanceof Error ? error : new Error(String(error)), 'unhandled_rejection'))
try {
  const mineflayer = req('mineflayer')
  receipt.package.latestSupportedVersion = mineflayer.latestSupportedVersion
  receipt.package.testedVersions = mineflayer.testedVersions
  receipt.package.minecraftDataVersion = req('minecraft-data/package.json').version
  receipt.package.minecraftProtocolVersion = req('minecraft-protocol/package.json').version
  bot = mineflayer.createBot({
    host: receipt.host, port: receipt.port,
    username: version === 'auto' ? 'MFStockAuto' : 'MFStockExplicit',
    auth: 'offline', version: version === 'auto' ? false : version,
    logErrors: false, respawn: false
  })
  bot.on('error', error => failed(error, 'error'))
  bot.on('kicked', reason => {
    receipt.observations.push({ kind: 'kicked', reason })
    finish('unavailable', 'kicked')
  })
  bot.on('end', reason => {
    receipt.observations.push({ kind: 'end', reason })
    finish('unavailable', 'connection_ended')
  })
  bot.on('login', () => { receipt.login = true })
  bot.once('spawn', async () => {
    receipt.spawn = true
    try {
      await bot.waitForChunksToLoad()
      if (finished) return
      receipt.chunksLoaded = true
      const floor = bot.blockAt(bot.entity.position.offset(0, -1, 0))
      receipt.observations.push({ kind: 'world', version: bot.version, health: bot.health,
        position: bot.entity.position,
        floor: floor && { name: floor.name, stateId: floor.stateId, properties: floor.getProperties() },
        inventory: bot.inventory.items().map(item => ({ name: item.name, type: item.type, count: item.count })) })
      // Login is not acceptance of native IDs, custom component codecs or menus.
      finish('partial', 'basic_read_observed_native_information_not_verified')
    } catch (error) { failed(error, 'world_read_failed') }
  })
} catch (error) { failed(error, 'create_bot_failed') }
