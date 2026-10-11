'use strict'
// Private JSONL IPC. The caller owns this process and chooses exactly one body.
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline')
const { connect } = require('./index.cjs')
const REQUEST = /^[A-Za-z0-9_.:-]{1,96}$/
async function dispatch (adapter, m) {
  if (!m || !REQUEST.test(m.request_id || '')) throw Error('world_rpc_request_invalid')
  switch (m.method) {
    case 'operations': return adapter.operations(m.operation)
    case 'identity': return adapter.identity()
    case 'capabilities': return adapter.capabilities()
    case 'snapshot': return adapter.snapshot()
    case 'read': return adapter.read(m.operation, m.args || {})
    case 'submit': return adapter.submit({ action_id: m.action_id, operation: m.operation, args: m.args || {} })
    case 'result': return adapter.actionStatus(m.action_id)
    case 'wait': return adapter.wait(m.action_id, { timeoutMs: m.timeoutMs ?? 50000 })
    case 'cancel': return adapter.cancel(m.action_id)
    case 'stop': return adapter.stop()
    case 'claim': return adapter.claimControl()
    case 'release': return adapter.releaseControl()
    case 'restore': return adapter.restore()
    case 'viewer': return adapter.viewer()
    case 'luaOperations': return adapter.luaOperations ? adapter.luaOperations(m.group) : { ok: false, code: 'provider_operation_unavailable' }
    case 'health': return adapter.health()
    default: throw Error('world_rpc_method_unsupported')
  }
}
async function main (file) {
  let config
  try { config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { throw Error('world_private_config_unreadable') }
  if (!path.isAbsolute(config.ledgerDir || '') ||
      (config.provider === 'numen' && !path.isAbsolute(config.credentialsFile || '')) ||
      (config.loginFile && !path.isAbsolute(config.loginFile))) throw Error('world_private_paths_must_be_absolute')
  const adapter = await connect(config)
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  const reply = m => process.stdout.write(JSON.stringify(m) + '\n')
  let closing = false
  async function close () {
    if (closing) return
    closing = true; input.close(); process.stdin.pause(); process.stdin.unref?.()
    await adapter.close()
  }
  input.on('line', async line => {
    let m
    try {
      if (Buffer.byteLength(line, 'utf8') > 131072) throw Error('world_rpc_request_over_budget')
      m = JSON.parse(line)
      if (closing) throw Error('world_adapter_closing')
      if (m.method === 'close') {
        if (!REQUEST.test(m.request_id || '')) throw Error('world_rpc_request_invalid')
        reply({ request_id: m.request_id, ok: true, result: { closing: true } }); await close(); return
      }
      reply({ request_id: m.request_id, ok: true, result: await dispatch(adapter, m) })
    } catch (error) {
      reply({ request_id: REQUEST.test(m?.request_id || '') ? m.request_id : null, ok: false,
        error: { code: /^[A-Za-z0-9_]{1,100}$/.test(error.code || error.message) ? error.code || error.message : 'world_rpc_failed', retryAutomatically: false } })
    }
  })
  input.on('close', () => { close().catch(() => { process.exitCode = 1 }) })
  process.on('SIGINT', () => { close().catch(() => { process.exitCode = 1 }) })
  process.on('SIGTERM', () => { close().catch(() => { process.exitCode = 1 }) })
  reply({ event: 'world_adapter_ready', ...await adapter.identity() })
}
if (require.main === module) main(process.argv[2]).catch(error => {
  const code = /^[A-Za-z0-9_]{1,100}$/.test(error.code || error.message) ? error.code || error.message : 'world_adapter_initialization_failed'
  process.stderr.write(code + '\n'); process.exitCode = 1
})
module.exports = { dispatch }
