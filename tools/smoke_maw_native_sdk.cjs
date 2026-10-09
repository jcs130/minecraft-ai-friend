'use strict'
// Bounded, zero-model ordinary-player smoke. Exactly one short walk, then
// disconnect/reconnect and replay the SAME action_id only through the ledger.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { once } = require('node:events'), { randomUUID } = require('node:crypto')
const mineflayer = require('mineflayer'), { Vec3 } = require('vec3')
const { attachNativeBody } = require('../world/src/native-sdk/index.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run (config) {
  if (!['127.0.0.1', '192.168.3.163'].includes(config.host) || ![28977, 28979].includes(config.port) ||
      !/^[A-Za-z0-9_]{1,16}$/.test(config.username) || !path.isAbsolute(config.ledgerDir) || !path.isAbsolute(config.report)) throw Error('SDK_SMOKE_CONFIG_INVALID')
  if (fs.existsSync(config.report)) throw Error('SDK_SMOKE_REPORT_ALREADY_EXISTS')
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), account: config.username, endpoint: `${config.host}:${config.port}`,
    modelRequests: 0, op: false, commandsSent: 0, checks: {}, receipts: [], ok: false }
  let bot, sdk, ended = false
  const attach = config.sdkModule ? require(config.sdkModule).attachNativeBody : attachNativeBody
  const connect = async expectedUuid => {
    bot = mineflayer.createBot({ host: config.host, port: config.port, username: config.username, version: '1.21.1', auth: 'offline', hideErrors: false })
    ended = false; bot.once('end', () => { ended = true }); bot.on('error', error => { report.connectionError = error.message })
    sdk = attach(bot, { ledgerDir: config.ledgerDir, controllerId: 'sdk-bounded-smoke', expectedUuid, account: config.username })
    let timer
    try { await Promise.race([once(bot, 'spawn'), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('SDK_SMOKE_LOGIN_TIMEOUT')), 30000) })]) }
    finally { clearTimeout(timer) }
    await sleep(750)
  }
  const disconnect = async () => {
    if (bot && !ended) { const done = once(bot, 'end'); sdk?.close(); bot.quit('Native SDK bounded smoke complete');
      let timer
      try { await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, 8000) })]) } finally { clearTimeout(timer) } }
    if (bot && !ended) throw Error('SDK_SMOKE_DISCONNECT_PENDING')
  }
  try {
    await connect()
    const caps = await sdk.capabilities(); report.capabilities = caps
    assert.equal(caps.ok, true); assert.equal(caps.bodyKind, 'connected_player')
    assert.equal(caps.nativeOperations.length, 60); assert.equal(caps.operations.operationCount, 70)
    report.checks.remoteOperations = true
    const before = await sdk.snapshot(); report.before = before
    assert.equal(before.ok, true); assert.equal(before.status, 'alive'); assert.equal(before.inventory.available, true)
    assert.equal(before.bodyId, bot._client.uuid); assert.ok(before.capturedAt)
    report.playerUuid = before.bodyId; report.checks.ownNativeSnapshot = true
    const observe = await sdk.read('body.observe', { radius: 8 }); report.observe = observe
    assert.equal(observe.ok, true); assert.equal(observe.bodyId, before.bodyId)
    assert.ok(observe.blocks.length <= 48 && observe.entities.length <= 24)
    assert.equal(observe.complete, false); report.checks.boundedNativeObservation = true
    const origin = new Vec3(Math.floor(before.position.x), Math.floor(before.position.y), Math.floor(before.position.z))
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    const safe = neighbors.map(([x, z]) => origin.offset(x, 0, z)).find(p => {
      const feet = bot.blockAt(p), head = bot.blockAt(p.offset(0, 1, 0)), ground = bot.blockAt(p.offset(0, -1, 0))
      return feet?.boundingBox === 'empty' && head?.boundingBox === 'empty' && ground?.boundingBox === 'block' &&
        ![feet.name, head.name, ground.name].some(name => /water|lava|fire|magma|cactus|campfire|berry/.test(name))
    })
    assert.ok(safe, 'No safe adjacent loaded walk target: stop without moving or teleporting')
    const request = { action_id: 'sdk-smoke-' + randomUUID(), operation: 'body.move', args: { position: { x: safe.x, y: safe.y, z: safe.z }, timeoutMs: 15000 } }
    report.request = request
    const accepted = sdk.submit(request); report.receipts.push(accepted); assert.equal(accepted.accepted, true)
    const terminal = await sdk.wait(request.action_id, { timeoutMs: 25000 }); report.receipts.push(terminal)
    assert.equal(terminal.status, 'succeeded'); assert.equal(terminal.result.reached, true)
    report.checks.actionTerminal = true
    const after = await sdk.snapshot(); report.after = after
    assert.equal(Math.floor(after.position.x), safe.x); assert.equal(Math.floor(after.position.z), safe.z)
    assert.ok(Math.hypot(after.position.x-before.position.x, after.position.z-before.position.z) > .3)
    report.checks.actualPositionVerified = true
    const ledger = path.join(config.ledgerDir, config.username.toLowerCase(), 'native-actions.jsonl')
    const ledgerBefore = fs.readFileSync(ledger)
    await disconnect(); report.checks.gracefulDisconnect = true; await sleep(500)
    await connect(before.bodyId)
    const reconciled = sdk.actionStatus(request.action_id); report.receipts.push(reconciled)
    assert.equal(reconciled.status, 'succeeded'); assert.equal(reconciled.bodyId, before.bodyId)
    report.checks.sameBodyReconnected = true
    const duplicate = sdk.submit(request); report.receipts.push(duplicate)
    assert.equal(duplicate.replayed, true); assert.equal(duplicate.dispatched, false)
    await sleep(500)
    assert.deepEqual(fs.readFileSync(ledger), ledgerBefore)
    const final = await sdk.snapshot(); report.final = final
    assert.equal(final.bodyId, before.bodyId)
    assert.ok(Math.hypot(final.position.x-after.position.x, final.position.y-after.position.y, final.position.z-after.position.z) < .25)
    assert.equal(sdk.health().inFlight, null); assert.equal(sdk.health().unresolved.length, 0)
    report.checks.noDuplicateExecution = true; report.ok = true
  } catch (error) { report.error = error.stack; throw error } finally {
    try { await disconnect(); report.cleanup = { connected: false, sdkClosed: true } } catch (error) { report.cleanup = { error: error.message }; report.ok = false }
    report.completedAt = new Date().toISOString()
    fs.mkdirSync(path.dirname(config.report), { recursive: true }); fs.writeFileSync(config.report, JSON.stringify(report, null, 2)+'\n')
  }
  return { ok: report.ok, checks: report.checks, playerUuid: report.playerUuid, report: config.report, modelRequests: 0 }
}
if (require.main === module) run(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))).then(value => {
  process.stdout.write(JSON.stringify(value)+'\n'); process.exitCode = value.ok ? 0 : 1
}, error => { process.stderr.write(error.message+'\n'); process.exitCode = 1 })
module.exports = { run }
