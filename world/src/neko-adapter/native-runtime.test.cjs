'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { attachNekoNative, handleNativeMessage, NativeLedger } = require('./native-runtime.cjs')
const { modOperationCatalog } = require('../neoforge-handshake/mod-call-client.cjs')
const UUID = '11111111-1111-4111-8111-111111111111'
function body (directory, invoke = async () => ({ ok: true, playerUuid: UUID })) {
  const bot = new EventEmitter(); bot.username = 'NekoQA'
  const client = new EventEmitter(); client.uuid = UUID
  const sent = []; client.write = (name, data) => { sent.push({ name, data }); return true }
  bot._client = client
  const sdk = { call: invoke, operations: modOperationCatalog, callStatus: () => ({ mutationBlocked: false }),
    contract: () => ({ playerUuid: UUID, directOperationCount: 48 }), detach () {} }
  const runtime = attachNekoNative(bot, { ledgerDir: directory, attach: () => sdk })
  return { bot, runtime, sent }
}
function fixture (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maw-neko-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()))
    assert.match(path.basename(dir), /^maw-neko-/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

test('discovery, native schemas, private identity and exact component values survive', async t => {
  const dir = fixture(t), components = '{id:"ars_nouveau:novice_spell_book",components:{"minecraft:custom_name":\'{"text":"法术书"}\'}}'
  const { bot, runtime } = body(dir, async () => ({ ok: true, playerUuid: UUID, componentsSnbt: components }))
  t.after(runtime.close)
  const list = await runtime.request({ action: 'list' })
  assert.equal(list.playerUuid, UUID); assert.equal(list.operationCount, 48)
  assert.equal(list.operations.filter(x => x.readOnly).length, 23)
  assert.equal((await runtime.request({ action: 'explain', id: 'colony.found' })).operation.parameters.required.includes('expectedSnbt'), true)
  assert.equal((await runtime.request({ action: 'explain' })).ok, false)
  const read = await runtime.request({ action: 'call', id: 'spell.list' })
  assert.equal(read.result.componentsSnbt, components)
  assert.equal(fs.existsSync(path.join(dir, 'nekoqa/native-actions.jsonl')), false)
  assert.equal(bot.listenerCount('respawn'), 1)
})

test('write intent/result are durable; same callId is returned without applying again', async t => {
  const dir = fixture(t); let applied = 0
  let { runtime } = body(dir, async () => { applied++; return { ok: true, playerUuid: UUID, state: { containerId: 1 } } })
  const message = { action: 'call', id: 'curios.open', callId: 'open-1', args: {} }
  const first = await runtime.request(message)
  assert.equal(first.ok, true); assert.equal(applied, 1)
  assert.equal((await runtime.request(message)).replayed, true); assert.equal(applied, 1)
  assert.equal((await runtime.request({ ...message, args: { requestId: 'other' } })).code, 'native_call_id_conflict')
  runtime.close()
  ;({ runtime } = body(dir, async () => { applied++; throw Error('must not resend') }))
  t.after(runtime.close)
  assert.equal((await runtime.request(message)).replayed, true); assert.equal(applied, 1)
  const result = await runtime.request({ action: 'result', callId: 'open-1' })
  assert.equal(result.result.state.containerId, 1)
  const records = fs.readFileSync(path.join(dir, 'nekoqa/native-actions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.deepEqual(records.map(r => r.kind), ['intent', 'result'])
})

test('unknown blocks all new mutations across reconnect; reads and movement remain available', async t => {
  const dir = fixture(t); let writes = 0
  let { runtime, bot, sent } = body(dir, async id => {
    if (id === 'colony.status') return { ok: true, playerUuid: UUID }
    writes++; throw Object.assign(Error('timeout'), { outcomeKnown: false, outcomeUnknown: true })
  })
  const result = await runtime.request({ action: 'call', id: 'curios.open', callId: 'uncertain-1' })
  assert.equal(result.outcomeUnknown, true); assert.equal(runtime.bodyBlocked(), true)
  assert.equal(bot._client.write('window_click', {}), false)
  assert.equal(bot._client.write('custom_payload', { channel: 'maw_agent:spell_action' }), false)
  assert.equal(bot._client.write('keep_alive', {}), true); assert.equal(bot._client.write('position', {}), true)
  assert.equal((await runtime.request({ action: 'call', id: 'colony.status' })).ok, true)
  assert.equal((await runtime.request({ action: 'call', id: 'curios.open', callId: 'uncertain-2' })).code, 'native_mutation_blocked')
  assert.equal(writes, 1); assert.equal(sent.length, 2)
  runtime.close()
  ;({ runtime } = body(dir)); t.after(runtime.close)
  assert.equal(runtime.status().mutationBlocked, true)
  assert.equal((await runtime.request({ action: 'call', id: 'curios.open', callId: 'uncertain-3' })).code, 'native_mutation_blocked')
  assert.equal((await runtime.request({ action: 'result', callId: 'uncertain-1' })).outcomeUnknown, true)
})

test('single native write owns the hand: competing actions rejected, own payload permitted', async t => {
  const dir = fixture(t); let release, bot
  const own = body(dir, async () => {
    assert.equal(bot._client.write('custom_payload', { channel: 'maw_agent:mod_action' }), true)
    await new Promise(resolve => { release = resolve })
    assert.equal(bot._client.write('custom_payload', { channel: 'maw_agent:mod_action' }), true)
    return { ok: true, playerUuid: UUID }
  })
  bot = own.bot; const runtime = own.runtime; t.after(runtime.close)
  const first = runtime.request({ action: 'call', id: 'curios.open', callId: 'pending' })
  assert.equal(runtime.bodyBlocked(), true)
  assert.equal(bot._client.write('held_item_slot', { slotId: 1 }), false)
  assert.equal((await runtime.request({ action: 'call', id: 'curios.open', callId: 'competitor' })).code, 'native_mutation_blocked')
  release(); assert.equal((await first).ok, true)
  assert.equal(runtime.bodyBlocked(), false)
  assert.equal(bot._client.write('held_item_slot', { slotId: 1 }), true)
})

test('busy body and invalid arguments never dispatch or leave an intent', async t => {
  const dir = fixture(t); let count = 0
  const { bot, runtime } = body(dir, async () => { count++; return { ok: true } }); t.after(runtime.close)
  runtime.bindAgent({ actions: { executing: true } })
  assert.equal((await runtime.request({ action: 'call', id: 'curios.open', callId: 'busy' })).code, 'native_body_busy')
  assert.equal((await runtime.request({ action: 'call', id: 'curios.open', callId: 'invalid', args: { readOnly: true } })).code, 'MOD_CALL_ARGUMENT_UNSUPPORTED')
  runtime.bindAgent({ actions: { executing: false } }); bot._bodyOwner = { name: 'combat' }
  assert.equal((await runtime.request({ action: 'call', id: 'curios.open', callId: 'combat' })).code, 'native_body_busy')
  assert.equal(count, 0); assert.equal(fs.existsSync(path.join(dir, 'nekoqa/native-actions.jsonl')), false)
})

test('respawn or disconnect during dispatch preserves unknown; never promotes a late success', async t => {
  const dir = fixture(t); let bot
  const own = body(dir, async () => { bot.emit('respawn'); return { ok: true, playerUuid: UUID } }); bot = own.bot
  t.after(own.runtime.close)
  const result = await own.runtime.request({ action: 'call', id: 'curios.open', callId: 'respawn' })
  assert.equal(result.ok, false); assert.equal(result.outcomeUnknown, true)
  assert.equal(result.result.receipt.ok, true)
  assert.equal(own.runtime.status().mutationBlocked, true)
})

test('crash intent, conflicting writer and truncated journal fail closed', t => {
  const dir = fixture(t), first = new NativeLedger(dir, 'NekoQA')
  assert.throws(() => new NativeLedger(dir, 'NekoQA'), /EEXIST/)
  first.append({ kind: 'intent', callId: 'crash', id: 'curios.open', fingerprint: 'hash', playerUuid: UUID })
  first.close()
  const { runtime } = body(dir); t.after(runtime.close)
  assert.equal(runtime.status().mutationBlocked, true)
  runtime.close()
  fs.appendFileSync(path.join(dir, 'nekoqa/native-actions.jsonl'), '{"partial":')
  assert.throws(() => body(dir), /NEKO_NATIVE_LEDGER_INCOMPLETE/)
  assert.equal(fs.existsSync(path.join(dir, 'nekoqa/writer.lock')), false)
})

test('WebSocket replies are requester-only, correlated and independent of chat', async t => {
  const dir = fixture(t), { bot, runtime } = body(dir); t.after(runtime.close)
  bot.chat = () => { throw Error('must not use game chat') }
  const agent = { bot }, received = [], unrelated = []
  const socket = { readyState: 1, send: x => received.push(JSON.parse(x)) }
  const other = { readyState: 1, send: x => unrelated.push(x) }
  const message = { type: 'native_mod', schemaVersion: 1, requestId: 'private-1', action: 'list' }
  assert.equal(await handleNativeMessage(agent, socket, message), true)
  assert.equal(received[0].playerUuid, UUID); assert.equal(received[0].requestId, 'private-1')
  assert.equal(received[0].action, 'list'); assert.equal(received[0].id, null)
  assert.equal(received[0].operationCount, 48); assert.equal(unrelated.length, 0)
  await handleNativeMessage(agent, other, { ...message, schemaVersion: 99 })
  assert.equal(JSON.parse(unrelated[0]).code, 'native_schema_version_invalid')
})
