'use strict'
// Optional owned connection for Python/other runtimes. JSONL is private IPC,
// never Minecraft chat. The parent Agent process owns/supervises this child.
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline')
const { attachNativeBody } = require('./index.cjs')
const ID = /^[A-Za-z0-9_.:-]{1,96}$/
async function dispatch (sdk, message) {
  if (!message || !ID.test(message.request_id || '') || typeof message.method !== 'string') throw Error('SDK_RPC_REQUEST_INVALID')
  switch (message.method) {
    case 'operations': return sdk.operations(message.operation)
    case 'identity': return sdk.identity()
    case 'capabilities': return sdk.capabilities()
    case 'snapshot': return sdk.snapshot()
    case 'read': return sdk.read(message.operation, message.args || {})
    case 'submit': return sdk.submit({ action_id: message.action_id, operation: message.operation, args: message.args || {} })
    case 'result': return sdk.actionStatus(message.action_id)
    case 'wait': return sdk.wait(message.action_id, { timeoutMs: message.timeoutMs ?? 50000 })
    case 'cancel': return sdk.cancel(message.action_id)
    case 'stop': return sdk.stop()
    case 'health': return sdk.health()
    default: throw Error('SDK_RPC_METHOD_UNSUPPORTED')
  }
}
async function main (configFile) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''))
  if (!config.host || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 ||
      !/^[A-Za-z0-9_]{1,16}$/.test(config.username) || !path.isAbsolute(config.ledgerDir)) throw Error('SDK_RPC_CONFIG_INVALID')
  const bot = require('mineflayer').createBot({ host: config.host, port: config.port, username: config.username, version: '1.21.1', auth: 'offline' })
  let sdk
  try { sdk = attachNativeBody(bot, { ...config, account: config.username }) } catch (error) { bot.quit('Native SDK initialization rejected'); throw error }
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  const reply = body => process.stdout.write(JSON.stringify(body)+'\n')
  let closing = false
  function shutdown () {
    if (closing) return
    closing = true; input.close(); sdk.close(); bot.quit('Native SDK parent stopping')
  }
  input.on('line', async line => {
    let request
    try {
      if (Buffer.byteLength(line, 'utf8') > 131072) throw Error('SDK_RPC_REQUEST_BUDGET_EXCEEDED')
      request = JSON.parse(line)
      if (request.method === 'close') {
        if (!ID.test(request.request_id || '')) throw Error('SDK_RPC_REQUEST_INVALID')
        reply({ request_id: request.request_id, ok: true, result: { closing: true } }); shutdown(); return
      }
      const result = await dispatch(sdk, request)
      reply({ request_id: request.request_id, ok: true, result })
    } catch (error) { reply({ request_id: ID.test(request?.request_id || '') ? request.request_id : null,
      ok: false, error: { code: error.code || error.message, retryAutomatically: false } }) }
  })
  input.on('close', shutdown)
  bot.on('spawn', () => reply({ event: 'body_connected', ...sdk.identity() }))
  bot.on('death', () => reply({ event: 'body_dead', ...sdk.identity() }))
  bot.on('error', error => process.stderr.write('SDK connection: '+error.message+'\n'))
  bot.on('end', reason => { reply({ event: 'body_disconnected', reason: String(reason), ...sdk.identity() }); shutdown() })
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
}
if (require.main === module) main(process.argv[2]).catch(error => { process.stderr.write(error.message+'\n'); process.exitCode = 1 })
module.exports = { dispatch }
