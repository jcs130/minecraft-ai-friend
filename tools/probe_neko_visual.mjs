// Explicit, bounded ordinary-player UI QA. Real Neko initBot + WS + own viewer;
// no Agent.start, model, console, fixtures, replay or autonomous background task.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
for (const key of ['nekoDirectory', 'stateDirectory', 'assetDirectory', 'viewerHostFile']) assert(path.isAbsolute(config[key] || ''), key)
assert(/^[A-Za-z0-9_]{3,16}$/.test(config.username))
assert(Number.isInteger(config.durationSeconds) && config.durationSeconds >= 30 && config.durationSeconds <= 1800)
for (const key of ['port', 'viewerPort', 'wsPort']) assert(Number.isInteger(config[key]) && config[key] > 1024 && config[key] <= 65535)
assert(!fs.existsSync(config.stateDirectory), 'Use a fresh QA directory; never replay or replace a previous journal')
fs.mkdirSync(config.stateDirectory, { recursive: true })
const save = (name, value) => fs.writeFileSync(path.join(config.stateDirectory, name), JSON.stringify(value, null, 2) + '\n')
const eventsFile = path.join(config.stateDirectory, 'events.jsonl')
const record = (kind, value) => fs.appendFileSync(eventsFile, JSON.stringify({ at: new Date().toISOString(), kind, ...value }) + '\n')
process.env.MAW_NEKO_ADAPTER_FILE = path.resolve(import.meta.dirname, '../world/src/neko-adapter/native-runtime.cjs')
process.env.MAW_NEKO_LEDGER_DIR = path.join(config.stateDirectory, 'ledger')
process.env.NEKO_PLUGIN_WS_HOST = '127.0.0.1'; process.env.NEKO_PLUGIN_WS_PORT = String(config.wsPort)
process.env.NEKO_AGENT_SCREENSHOT_INTERVAL_MS = '0'; process.env.DEBUG_CHAT = '0'; process.env.STATUS_NL = '0'
const load = relative => import(pathToFileURL(path.join(config.nekoDirectory, relative)))
const { setSettings } = await load('src/agent/settings.js')
setSettings({ minecraft_version: '1.21.1', host: config.host, port: config.port, auth: 'offline',
  allow_insecure_coding: false, blocked_actions: ['!newAction'], chat_ingame: false, only_chat_with: [], speak: false })
const { prepareNativeWorldPreviewHost, createNativePlayerPresentation } = await import(pathToFileURL(config.viewerHostFile))
const prepared = await prepareNativeWorldPreviewHost({ assetDirectory: config.assetDirectory, port: config.viewerPort })
const { initBot } = await load('src/utils/mcdata.js')
const { wsServer } = await load('src/websocket/ws_server.js')
const { ActionManager } = await load('src/agent/action_manager.js')
const { attachNativeViewerPackets } = require('../world/src/neoforge-handshake/native-viewer-packet.cjs')
const { attachNativeModPresentation } = require('../world/src/neko-adapter/native-presentation.cjs')
const nbt = createRequire(path.join(config.nekoDirectory, 'package.json'))('prismarine-nbt')
const bot = initBot(config.username), sdk = bot.mawNative.sdk
const agent = { name: config.username, bot, blocked_actions: ['!newAction'], isIdle: () => !agent.actions.executing }
agent.actions = new ActionManager(agent); bot.mawNative.bindAgent(agent)
const stream = attachNativeViewerPackets(bot, prepared.registrySha256)
const observer = attachNativeModPresentation(bot, sdk)
const errors = [], operations = []
let closed = false, ready = false, poll, deadline, viewer, packetCount = 0
const snapshot = () => ({ schemaVersion: 1, pid: process.pid, phase: closed ? 'stopped' : ready ? 'observing' : 'starting',
  username: config.username, playerUuid: bot._client.uuid ?? null, modelCalls: 0, agentFrameworkStarted: false,
  qwenpawConnected: false, health: bot.health ?? null, food: bot.food ?? null,
  position: bot.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null, native: bot.mawNative.status(),
  menu: sdk.menu.current(), presentation: observer.status(), operations, errors, packetCount,
  viewerUrl: viewer?.url ?? null, endpoint: `${config.host}:${config.port}` })
viewer = prepared.attach({ bot, nativeStream: stream, expectedUsername: config.username, simplifyNBT: nbt.simplify,
  getAgentStatus: () => ({ username: config.username, mode: 'observing', goal: '原生模组操作与画面验收（无模型调用）',
    receipts: operations.map(receipt => ({ at: receipt.at, action: { type: receipt.operation },
      result: { ok: receipt.ok, code: receipt.code ?? (receipt.ok ? 'native_receipt_ok' : 'native_receipt_refused') } })) }),
  getPresentationState: () => createNativePlayerPresentation({ playerUuid: bot._client.uuid, menu: sdk.menu.current(),
    ...observer.current(), modOperations: operations }) })
bot._client.on('custom_payload', packet => {
  if (!packet.channel.startsWith('maw_agent:')) return
  packetCount++
  try {
    const body = JSON.parse(Buffer.from(packet.data).toString('utf8'))
    if (body.playerUuid) assert.equal(body.playerUuid.toLowerCase(), bot._client.uuid.toLowerCase())
    record('private_packet', { channel: packet.channel, body })
  } catch (error) { errors.push({ kind: 'packet', message: error.message }) }
})
for (const client of [sdk.mods, sdk.domum, sdk.spell, sdk.menu]) client.events.on('receipt', receipt => {
  operations.push({ at: new Date().toISOString(), playerUuid: receipt.playerUuid, operation: receipt.action ?? receipt.query ?? 'menu', ok: receipt.ok, code: receipt.code ?? null })
  if (operations.length > 12) operations.shift()
})
async function finish (reason) {
  if (closed) return
  closed = true; clearInterval(poll); clearTimeout(deadline); observer.close()
  const waitUntil = Date.now() + 15000
  while (bot.mawNative.status().inFlight && Date.now() < waitUntil) await new Promise(resolve => setTimeout(resolve, 50))
  record('stopped', { reason }); save('status.json', { ...snapshot(), reason })
  for (const socket of wsServer.clients) socket.close()
  wsServer.stop(); bot.clearControlStates(); bot.quit('Native visual QA complete')
  await new Promise(resolve => setTimeout(resolve, 600))
  stream.detach(); bot.mawNative.close(); await viewer.close()
  save('exit.json', { reason, code: errors.length ? 1 : 0, modelCalls: 0 })
  process.exit(errors.length ? 1 : 0)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => void finish(signal))
process.on('uncaughtException', error => { errors.push({ kind: 'exception', message: error.stack }); void finish('exception') })
process.on('unhandledRejection', error => { errors.push({ kind: 'rejection', message: String(error?.stack || error) }); void finish('rejection') })
bot.on('error', error => errors.push({ kind: 'connection', message: error.message }))
bot.on('kicked', reason => errors.push({ kind: 'kicked', message: String(reason) }))
bot.on('end', () => { if (!closed) void finish('disconnected') })
bot.once('spawn', async () => {
  await viewer.listen(); wsServer.start()
  await new Promise((resolve, reject) => { wsServer.wss.once('listening', resolve); wsServer.wss.once('error', reject) })
  wsServer.setAgent(agent); ready = true; save('ready.json', snapshot())
  console.log(JSON.stringify({ ready: true, player: config.username, playerUuid: bot._client.uuid, viewer: viewer.url, modelCalls: 0 }))
  poll = setInterval(() => { save('status.json', snapshot()); if (fs.existsSync(path.join(config.stateDirectory, 'stop.requested'))) void finish('requested_stop') }, 1000)
})
deadline = setTimeout(() => void finish('bounded_qa_complete'), config.durationSeconds * 1000)
