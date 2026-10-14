import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const entry = process.env.MAW_HOST_UNDER_TEST ? pathToFileURL(process.env.MAW_HOST_UNDER_TEST).href : new URL('./index.mjs', import.meta.url).href
const { MyAgentWorldEnvironment, createMyAgentWorldClient, HOST_INSTRUCTIONS } = await import(entry)
const require = createRequire(entry)
const { createMinecraftMcpServer } = await import(pathToFileURL(require.resolve('agent-mc-world/mcp')).href)
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href)
const { InMemoryTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/inMemory.js')).href)
const BODY = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maw-harness-'))
  const cleanup = []
  t.after(async () => {
    for (const close of cleanup.reverse()) await close()
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.match(path.basename(directory), /^maw-harness-/)
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const config = { provider: 'mineflayer', username: 'SDKFixture', controllerId: 'fixture-controller', expectedUuid: BODY,
    host: '127.0.0.1', port: 28979, ledgerDir: path.join(directory, 'native'), dataDir: path.join(directory, 'harness'), pollMs: 250 }
  const identity = { provider: 'mineflayer', bodyId: BODY, playerUuid: BODY, controllerId: config.controllerId, account: config.username }
  const records = new Map(), calls = [], events = []
  const schema = { type: 'object', properties: {}, additionalProperties: false }
  const rows = [{ id: 'body.move', readOnly: false, available: true, description: 'Walk', parameters: schema },
    { id: 'spell.list', readOnly: true, available: true, parameters: schema },
    { id: 'wandscape.found', readOnly: false, available: false, parameters: schema }]
  const state = { ...identity, ok: true, status: 'alive', capturedAt: '2026-10-13T00:00:00Z', position: { x: 0.5, y: 64, z: 0.5 },
    dimension: 'minecraft:overworld', health: 19, maxHealth: 22, hunger: 18, mana: { current: 23, max: 32 }, currentAction: null,
    inventory: { available: true, slotNamespace: 'player_menu_46', items: [{ slot: 36, id: 'ars_nouveau:novice_spell_book', count: 1,
      snbt: '{id:"ars_nouveau:novice_spell_book",count:1,components:{"minecraft:custom_name":"real book"}}' }] },
    menu: { windowId: 0, stateId: 9 }, equipment: {} }
  const flags = { done: false, unknown: false, wrongIdentity: false, readForeign: false, archiveFailure: false }
  const body = {
    identity: async () => ({ ...identity, ...(flags.wrongIdentity ? { bodyId: OTHER } : {}) }),
    operations: async id => id ? structuredClone(rows.find(row => row.id === id)) : { operations: structuredClone(rows) },
    snapshot: async () => structuredClone(state),
    read: async (id, args) => { calls.push(['read', id, args]); return { ...identity, ok: true, mana: state.mana, ...(flags.readForeign ? { bodyId: OTHER } : {}) } },
    submit: async request => {
      calls.push(['submit', structuredClone(request)])
      if (records.has(request.action_id)) return { ...records.get(request.action_id), replayed: true, dispatched: false }
      if (flags.unknown) return { ...identity, ok: false, code: 'body_action_blocked', unresolved: ['old-action'] }
      const receipt = { ...identity, ok: true, action_id: request.action_id, operation: request.operation, accepted: true, status: 'accepted', terminal: false }
      records.set(request.action_id, receipt); return receipt
    },
    actionStatus: async id => {
      calls.push(['result', id])
      if (flags.unknown) return { ...identity, ok: false, action_id: id, status: 'unknown', terminal: true, outcomeKnown: false, outcomeUnknown: true }
      if (flags.done) { state.position.x = 3.5; return { ...records.get(id), ok: true, accepted: false, status: 'succeeded', terminal: true,
        outcomeKnown: true, outcomeUnknown: false, actualPosition: state.position } }
      return records.get(id) || { ...identity, ok: false, action_id: id, status: 'unknown', terminal: true, outcomeUnknown: true }
    },
    wait: async id => body.actionStatus(id), cancel: async id => { calls.push(['cancel', id]); return { ...identity, ok: true, action_id: id, cancelRequested: true, terminal: false } },
    claimControl: async () => { calls.push(['claim']); return { ...identity, ok: true } },
    releaseControl: async () => { calls.push(['release']); return { ...identity, ok: true } },
    stop: async () => { calls.push(['stop']); return { ...identity, ok: true } },
    restore: async () => { calls.push(['restore']); return { ...identity, ok: false, code: 'provider_operation_unavailable' } },
    viewer: () => ({ ...identity, ok: false, code: 'viewer_url_not_configured', readOnly: true }),
    close: async () => { calls.push(['close']); return { ok: true } },
  }
  const connect = async () => { calls.push(['connect']); return body }
  const environment = new MyAgentWorldEnvironment(config, { connect })
  const host = { pushEvent: async event => { if (flags.archiveFailure) throw Error('disk failure'); events.push(event); return event } }
  const invoke = async (name, input = {}, signal) => {
    const outcome = await environment.tools().find(tool => tool.name === name).handler(input, { signal })
    return { ...outcome, value: JSON.parse(outcome.text) }
  }
  cleanup.push(() => environment.stop())
  return { config, identity, rows, state, records, calls, events, flags, body, connect, environment, host, invoke, directory, cleanup }
}

test('construction and connection never claim, spawn another body, start a model or execute work', async t => {
  const f = fixture(t)
  assert.deepEqual(f.calls, [])
  await f.environment.start(f.host)
  assert.deepEqual(f.calls, [['connect']])
  await f.environment.stop()
  assert.deepEqual(f.calls, [['connect'], ['close']])
})

test('real Java client provider preserves the existing harness tools and original body binding', async t => {
  const f = fixture(t)
  Object.assign(f.config, { provider: 'java-client', expectedServer: '127.0.0.1:28978', credentialsFile: path.join(f.directory, 'client-private.json') })
  f.identity.provider = 'java-client'; f.state.provider = 'java-client'
  const environment = new MyAgentWorldEnvironment(f.config, { connect: f.connect })
  f.cleanup.push(() => environment.stop()); await environment.start(f.host)
  const tool = environment.tools().find(t => t.name === 'mc_state')
  const result = JSON.parse((await tool.handler({}, {})).text)
  assert.equal(result.provider, 'java-client'); assert.equal(result.bodyId, BODY)
  assert.equal(f.calls.filter(c => c[0] === 'connect').length, 1)
  assert.equal(f.calls.some(c => ['claim', 'submit'].includes(c[0])), false)
})
test('binding mismatch closes the returned adapter before admitting tools', async t => {
  const f = fixture(t); f.flags.wrongIdentity = true
  await assert.rejects(f.environment.start(f.host), /body_binding_mismatch/)
  assert.equal(f.calls.filter(c => c[0] === 'close').length, 1)
  await assert.rejects(f.invoke('mc_state'), /not_connected/)
})
test('progressive discovery uses actual provider availability and exact per-operation schemas', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  const page = (await f.invoke('mc_operations', { limit: 1 })).value
  assert.equal(page.total, 3); assert.equal(page.nextOffset, 1); assert.equal(page.operations[0].id, 'body.move')
  assert.equal(page.allGameplayVerified, false)
  assert.deepEqual((await f.invoke('mc_help', { operation: 'spell.list' })).value.parameters, f.rows[1].parameters)
  assert.equal((await f.invoke('mc_operations', { prefix: 'wandscape.' })).value.operations[0].available, false)
})
test('state keeps real mana, absolute coordinates and complete native SNBT', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  const state = (await f.invoke('mc_state')).value
  assert.deepEqual(state.mana, { current: 23, max: 32 }); assert.equal(state.inventory.items[0].slot, 36)
  assert.equal(state.inventory.items[0].snbt, f.state.inventory.items[0].snbt)
  assert.equal(state.capturedAt, '2026-10-13T00:00:00Z'); assert.equal(state.bodyId, BODY)
  assert.equal(JSON.parse(f.environment.requestFacts().parts[0].text).position.x, .5)
})

test('compact model facts preserve custom display names and the real underlying item id separately', async t => {
  const f = fixture(t)
  f.state.inventory.items = [{ slot: 36, id: 'minecraft:player_head', name: '大背包', count: 1, snbt: '{id:"minecraft:player_head",count:1}' }]
  await f.environment.start(f.host)
  const item = JSON.parse(f.environment.requestFacts().parts[0].text).inventory.items[0]
  assert.equal(item.id, 'minecraft:player_head'); assert.equal(item.name, '大背包'); assert.equal(item.count, 1)
})
test('nonempty provider arguments pass unchanged through the envelope validator', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  const arguments_ = { position: { x: 3, y: 64, z: 1 }, expectedSnbt: '{components:{}}' }
  await f.invoke('mc_do', { action_id: 'nonempty', operation: 'body.move', args: arguments_ })
  assert.deepEqual(f.calls.find(c => c[0] === 'submit')[1].args, arguments_)
})
test('read-only separation, disabled operations and strict tool schemas reject without dispatch', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  assert.equal((await f.invoke('mc_read', { operation: 'body.move' })).value.code, 'read_requires_available_read_only_operation')
  assert.equal((await f.invoke('mc_do', { action_id: 'a', operation: 'spell.list' })).failed, true)
  assert.equal((await f.invoke('mc_do', { action_id: 'b', operation: 'wandscape.found' })).failed, true)
  await assert.rejects(f.invoke('mc_do', { action_id: 'bad/id', operation: 'body.move' }))
  await assert.rejects(f.invoke('mc_state', { secret: 'extra' }))
  assert.equal(f.calls.filter(c => c[0] === 'submit' || c[0] === 'read').length, 0)
})
test('foreign-body results are never displayed as this player', async t => {
  const f = fixture(t); await f.environment.start(f.host); f.flags.readForeign = true
  await assert.rejects(f.invoke('mc_read', { operation: 'spell.list' }), /identity_changed/)
})
test('accepted tasks emit one real terminal event while the host is idle, with no goal-completion claim', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  const accepted = await f.invoke('mc_do', { action_id: 'walk-1', operation: 'body.move' })
  assert.equal(accepted.execution.phase, 'accepted'); assert.equal(accepted.execution.terminal, false)
  assert.equal(accepted.execution.goalCompleted, false); assert.equal(f.events.length, 0)
  f.flags.done = true
  await sleep(600)
  assert.equal(f.events.length, 1); assert.equal(f.events[0].execution.phase, 'completed')
  assert.equal(f.events[0].execution.goalCompleted, false); assert.equal(f.events[0].execution.evidence.actualPosition.x, 3.5)
  assert.equal(JSON.parse(f.environment.requestFacts().parts[0].text).position.x, 3.5)
})
test('unknown receipts remain explicit and only the original action is queried', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  await f.invoke('mc_do', { action_id: 'old-action', operation: 'body.move' }); f.flags.unknown = true
  await sleep(400)
  assert.equal(f.events[0].execution.evidence.outcomeUnknown, true)
  assert.equal(f.events[0].execution.phase, 'blocked')
  const value = await f.invoke('mc_do', { action_id: 'new-action', operation: 'body.move' })
  assert.equal(value.value.code, 'body_action_blocked')
  assert.equal(f.records.size, 1)
  assert.deepEqual(f.calls.filter(c => c[0] === 'result').map(c => c[1]), ['old-action'])
})
test('stop removes watchers and closes the owned provider without an implicit cancellation or restore', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  await f.invoke('mc_do', { action_id: 'continues-in-provider', operation: 'body.move' })
  await f.environment.stop(); await sleep(350)
  assert.equal(f.calls.some(c => ['result', 'claim', 'cancel', 'restore'].includes(c[0])), false)
})
test('event archive failure blocks subsequent dispatch instead of silently losing evidence', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  f.flags.done = true; f.flags.archiveFailure = true
  await f.invoke('mc_do', { action_id: 'archived-1', operation: 'body.move' }); await sleep(400)
  assert.equal((await f.invoke('mc_do', { action_id: 'archived-2', operation: 'body.move' })).value.code, 'maw_host_receipt_delivery_unavailable')
  assert.equal(f.records.size, 1)
})
test('request abortion before dispatch changes nothing; accepted cancellation must name the original action', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.invoke('mc_do', { action_id: 'never', operation: 'body.move' }, controller.signal))
  assert.equal(f.records.size, 0)
  await f.invoke('mc_do', { action_id: 'cancel-this', operation: 'body.move' })
  const reply = await f.invoke('mc_cancel', { action_id: 'cancel-this' })
  assert.equal(reply.value.cancelRequested, true); assert.equal(reply.value.terminal, false)
  assert.deepEqual(f.calls.filter(c => c[0] === 'cancel'), [['cancel', 'cancel-this']])
})
test('large native results retain exact components in a private JSON artifact', async t => {
  const f = fixture(t); await f.environment.start(f.host)
  f.state.inventory.items[0].snbt = 'x'.repeat(70000)
  const value = await f.invoke('mc_state')
  assert.equal(value.value.code, 'full_native_result_in_private_artifact')
  assert.equal(JSON.parse(Buffer.from(value.blobs[0].bytes).toString()).inventory.items[0].snbt.length, 70000)
  assert.ok(value.text.length < 300)
})
test('invalid or overlapping journals fail before any body connection', t => {
  const f = fixture(t)
  assert.throws(() => new MyAgentWorldEnvironment({ ...f.config, dataDir: f.config.ledgerDir }), /separate/)
  assert.throws(() => new MyAgentWorldEnvironment({ ...f.config, dataDir: 'relative' }), /config_invalid/)
  assert.throws(() => new MyAgentWorldEnvironment({ ...f.config, viewerUrl: 'https://example.test/?token=private' }), /credentials/)
  assert.throws(() => new MyAgentWorldEnvironment({ ...f.config, provider: 'auto' }), /config_invalid/)
  assert.deepEqual(f.calls, [])
})
test('the real core preserves request deduplication and explicit turn closure around the native environment', async t => {
  const f = fixture(t), client = createMyAgentWorldClient(f.config, { connect: f.connect })
  f.cleanup.push(() => client.disconnect())
  assert.equal(client.status().phase, 'disconnected')
  await client.connect(); client.beginTurn('real-decision')
  const request = { action_id: 'stable-action', operation: 'body.move' }
  const first = await client.call('mc_do', request, { requestId: 'tool-call', turnId: 'real-decision' })
  const second = await client.call('mc_do', request, { requestId: 'tool-call', turnId: 'real-decision' })
  assert.deepEqual(second, first); assert.equal(f.calls.filter(c => c[0] === 'submit').length, 1)
  assert.equal(first.control.turnEnded, false)
  await client.endTurn('real-decision'); assert.equal(f.calls.some(c => c[0] === 'cancel'), false)
  f.flags.done = true; await sleep(450)
  const events = await client.events()
  assert.equal(events.events[0].execution.phase, 'completed')
  assert.equal(client.task('task', 'stable-action').goalCompleted, false)
  await assert.rejects(client.call('mc_do', { ...request, operation: 'changed' }, { requestId: 'tool-call' }), /different arguments/)
})
test('MCP initializes with matching host instructions and actual native tools, without connecting', async t => {
  const f = fixture(t), runtime = createMyAgentWorldClient(f.config, { connect: f.connect })
  const server = createMinecraftMcpServer(runtime, 'test', { instructions: HOST_INSTRUCTIONS })
  const client = new Client({ name: 'native-host-contract', version: '1' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  f.cleanup.push(async () => { await client.close(); await server.close(); await runtime.disconnect() })
  await Promise.all([server.connect(st), client.connect(ct)])
  assert.match(client.getInstructions(), /one \{action_id,operation,args\}/)
  const tools = await client.listTools(), names = tools.tools.map(tool => tool.name)
  assert.ok(names.includes('mc_operations') && names.includes('mc_protocol') && names.includes('mc_do'))
  assert.ok(!names.includes('mc_script'))
  assert.deepEqual(f.calls, [])
  const guide = await client.callTool({ name: 'mc_connection', arguments: { action: 'environment' } })
  assert.match(guide.content[0].text, /原生身体/)
  assert.doesNotMatch(guide.content[0].text, /mc_script/)
})
