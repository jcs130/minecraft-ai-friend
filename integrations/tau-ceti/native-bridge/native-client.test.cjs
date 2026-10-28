'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachTauNativeClient, contract } = require('./native-client.cjs')
const UUID = '11111111-2222-3333-8444-555555555555'
const OTHER = '99999999-2222-3333-8444-555555555555'
const pause = () => new Promise(resolve => setImmediate(resolve))
function fixture (options = {}) {
  const bot = new EventEmitter(), wire = new EventEmitter(), packets = []
  wire.uuid = UUID; wire.write = (name, body) => { packets.push({ name, ...body, json: JSON.parse(body.data) }) }
  bot._client = wire; bot.inventory = { slots: { 36: { name: 'stone_bricks', count: 1 } } }
  const client = attachTauNativeClient(bot, { timeoutMs: 100, readIntervalMs: 0, ...options })
  const payload = (channel, value) => wire.emit('custom_payload', { channel, data: Buffer.from(JSON.stringify(value)) })
  const menu = (more = {}) => ({ schemaVersion: 1, kind: 'menu_state', playerUuid: UUID, serverEpoch: 'epoch-1', capturedAt: new Date().toISOString(),
    windowId: 0, stateId: 3, slots: [null, { id: 'touhou_little_maid:smart_slab', count: 1, snbt: '{id:"touhou_little_maid:smart_slab",count:1}', componentsComplete: true }], carried: null, ...more })
  const reply = (packet, more = {}) => payload('maw_agent:world_state', { schemaVersion: 1, kind: 'world_receipt', playerUuid: UUID,
    serverEpoch: 'epoch-1', requestId: packet.json.requestId, query: packet.json.kind, ok: true, status: 'ok', capturedAt: new Date().toISOString(), ...more })
  return { bot, wire, packets, client, payload, menu, reply }
}

test('one original snapshot identifies a mod item without rewriting Mineflayer projection', async t => {
  const f = fixture(); t.after(() => f.client.detach())
  const read = f.client.snapshot(); await pause(); assert.equal(f.packets.length, 1)
  f.reply(f.packets[0], { menu: f.menu(), self: { health: 7, mana: null } })
  const state = await read
  assert.equal(state.menu.slots[1].id, 'touhou_little_maid:smart_slab')
  assert.equal(state.self.health, 7); assert.equal(state.self.mana, null)
  assert.equal(f.bot.inventory.slots[36].name, 'stone_bricks')
})

test('a bounded unavailable menu invalidates cached slots instead of retaining old click targets', async t => {
  const f=fixture();t.after(()=>f.client.detach())
  f.payload('maw_agent:menu_state',f.menu());assert.ok(f.client.currentMenu())
  f.payload('maw_agent:menu_state',{schemaVersion:1,kind:'menu_state_error',playerUuid:UUID,code:'native_state_byte_budget'})
  assert.equal(f.client.currentMenu(),null)
  assert.equal(f.client.diagnostics().at(-1).code,'native_state_byte_budget')
})

test('reconciliation never promotes historical action slots to a current menu', async t => {
  const f=fixture();t.after(()=>f.client.detach())
  f.payload('maw_agent:menu_state',f.menu({windowId:0}))
  const waiting=f.client.actionStatus('old-action','epoch-1');await pause()
  f.reply(f.packets[0],{receipt:{outcomeKnown:true,status:'completed',state:f.menu({windowId:8})}})
  const result=await waiting;assert.equal(result.receipt.state.windowId,8)
  assert.equal(f.client.currentMenu(),null)
})

test('schema diagnostics reject unknown fields and numeric strings without a network retry', async t => {
  const f = fixture(); t.after(() => f.client.detach())
  let result = await f.client.read('inventory.inspect', { to: [1, 2, 3] })
  assert.equal(result.diagnostic.field, 'args.slot'); assert.deepEqual(result.example, { slot: 36 })
  result = await f.client.inspect('36'); assert.equal(result.diagnostic.field, 'args.slot')
  result = await f.client.read('inventory.inspect', { slot: 36, to: 4 }); assert.equal(result.diagnostic.field, 'args.to')
  assert.equal(f.packets.length, 0)
})

test('a static schema is never advertised as remote capability proof', async t => {
  const f = fixture({ timeoutMs: 5 }); t.after(() => f.client.detach())
  assert.equal(f.client.state().remoteCapabilitiesObserved, false)
  const result = await f.client.operations(); assert.equal(result.code, 'native_receipt_not_observed')
  assert.equal(f.client.state().remoteCapabilitiesObserved, false)
  assert.equal(f.packets.length, 1)
})

test('foreign player data and wrong read operation cannot resolve a request', async t => {
  const f = fixture(); t.after(() => f.client.detach())
  const promise = f.client.snapshot(); await pause(); const packet = f.packets[0]
  f.reply(packet, { playerUuid: OTHER, menu: f.menu({ playerUuid: OTHER }) })
  f.reply(packet, { query: 'recipes' }); assert.equal(f.client.state().pending, 1)
  f.reply(packet, { menu: f.menu() }); assert.equal((await promise).ok, true)
  assert(f.client.diagnostics().length >= 2)
})

test('partial recipe coverage and continuation are preserved without auto-reading the rest', async t => {
  const f = fixture(); t.after(() => f.client.detach())
  const promise = f.client.recipes({ outputId: 'create:cogwheel', limit: 1 }); await pause()
  f.reply(f.packets[0], { status: 'partial', complete: false, capturedAt: '2026-10-28T00:00:00Z', recipes: [{ recipeId: 'create:crafting/kinetics/cogwheel' }], nextOffset: 1, remainingCount: 4 })
  const result = await promise; assert.equal(result.status, 'partial'); assert.equal(result.nextOffset, 1)
  assert.equal(result.capturedAt, '2026-10-28T00:00:00Z'); assert.equal(f.packets.length, 1)
})

test('click sends complete native CAS and identical ID is deduplicated after state changes', async t => {
  const f = fixture(); t.after(() => f.client.detach()); f.payload('maw_agent:menu_state', f.menu())
  const promise = f.client.click({ slot: 1, requestId: 'action-1' }); await pause()
  assert.equal(f.packets.length, 1); const sent = f.packets[0].json
  assert.equal(sent.expectedItemId, 'touhou_little_maid:smart_slab'); assert.match(sent.expectedSnbt, /smart_slab/)
  assert.equal(sent.expectedStateId, 3); assert.equal(sent.expectedCarriedSnbt, '')
  const result = { schemaVersion: 1, kind: 'action_receipt', action: 'click', playerUuid: UUID, requestId: 'action-1', ok: true,
    status: 'completed', changed: true, outcomeKnown: true, state: f.menu({ stateId: 4, slots: [null, null], carried: f.menu().slots[1] }) }
  f.payload('maw_agent:menu_state', result); assert.equal((await promise).changed, true)
  assert.equal((await f.client.click({ slot: 1, requestId: 'action-1' })).changed, true)
  assert.equal(f.packets.length, 1)
  const conflict = await f.client.click({ slot: 0, requestId: 'action-1' }); assert.equal(conflict.diagnostic.issue, 'request_id_conflict')
  assert.equal(f.packets.length, 1)
  const {schemaVersion,requestId,playerUuid,...args}=sent
  const reordered=Object.fromEntries(Object.entries(args).reverse())
  assert.equal((await f.client.call('menu.click',reordered,{requestId:'action-1'})).changed,true)
  assert.equal(f.packets.length,1)
})

test('numeric action identity is rejected before sending an unmatchable receipt request', async t => {
  const f=fixture();t.after(()=>f.client.detach());f.payload('maw_agent:menu_state',f.menu())
  const result=await f.client.click({slot:1,requestId:42})
  assert.equal(result.diagnostic.field,'requestId');assert.equal(f.packets.length,0)
})

test('native close works without a projected Mineflayer window and deduplicates the original ID', async t => {
  const f=fixture();t.after(()=>f.client.detach());f.bot.currentWindow=null
  f.payload('maw_agent:menu_state',f.menu({windowId:9,menuType:'farmersdelight:cooking_pot'}))
  const args={windowId:9,expectedStateId:3,expectedServerEpoch:'epoch-1'}
  const waiting=f.client.call('menu.close',args,{requestId:'close-pot'});await pause()
  assert.equal(f.packets[0].json.action,'close')
  f.payload('maw_agent:menu_state',{schemaVersion:1,kind:'action_receipt',action:'close',playerUuid:UUID,requestId:'close-pot',ok:true,status:'completed',changed:true,outcomeKnown:true,state:f.menu({windowId:0})})
  assert.equal((await waiting).status,'completed');assert.equal(f.client.currentMenu().windowId,0)
  assert.equal((await f.client.call('menu.close',args,{requestId:'close-pot'})).changed,true)
  assert.equal(f.packets.length,1)
})

test('incomplete original components block a click rather than constructing a fake empty stack', async t => {
  const f = fixture(); t.after(() => f.client.detach())
  const m = f.menu(); m.slots[1].snbt = null; m.slots[1].componentsComplete = false
  f.payload('maw_agent:menu_state', m)
  assert.equal((await f.client.click({ slot: 1 })).code, 'native_components_incomplete')
  assert.equal(f.packets.length, 0)
})

test('timeout quarantines further writes; same action is reconciled only by an actual read', async t => {
  const f = fixture({ timeoutMs: 8 }); t.after(() => f.client.detach()); f.payload('maw_agent:menu_state', f.menu())
  const failed = await f.client.click({ slot: 1, requestId: 'slow-action' })
  assert.equal(failed.status, 'unknown'); assert.equal(failed.changed, null)
  const blocked = await f.client.click({ slot: 0, requestId: 'new-action' }); assert.equal(blocked.code, 'unreconciled_previous_action')
  assert.equal(f.packets.length, 1)
  const status = f.client.actionStatus('slow-action', 'epoch-1'); await pause()
  assert.equal(f.packets[1].json.kind, 'action_status'); assert.equal(f.packets[1].json.actionRequestId, 'slow-action')
  f.reply(f.packets[1], { receipt: { ok: true, status: 'completed', outcomeKnown: true, changed: true, state: f.menu() } })
  await status; assert.equal(f.client.state().unreconciledAction, null); assert.equal(f.packets.length, 2)
})

test('an explicitly unknown server receipt never reports a confirmed unchanged inventory', async t => {
  const f = fixture(); t.after(() => f.client.detach()); f.payload('maw_agent:menu_state', f.menu())
  const action = f.client.click({ slot: 1, requestId: 'unknown-action' }); await pause()
  f.payload('maw_agent:menu_state', { schemaVersion: 1, kind: 'action_receipt', action: 'click', playerUuid: UUID, requestId: 'unknown-action',
    ok: false, status: 'unknown', outcomeKnown: false, outcomeUnknown: true, changed: null })
  const result = await action; assert.equal(result.changed, null); assert.equal(f.client.currentMenu(), null)
  assert.equal(f.client.state().unreconciledAction.requestId, 'unknown-action')
})

test('known game denial is a business receipt and does not trigger another click', async t => {
  const f = fixture(); t.after(() => f.client.detach()); f.payload('maw_agent:menu_state', f.menu())
  const action = f.client.click({ slot: 1, requestId: 'denied-action' }); await pause()
  f.payload('maw_agent:menu_state', { schemaVersion: 1, kind: 'action_receipt', action: 'click', playerUuid: UUID, requestId: 'denied-action',
    ok: false, status: 'blocked', code: 'slot_permission_denied', changed: false, outcomeKnown: true })
  const result = await action; assert.equal(result.status, 'blocked'); assert.equal(result.code, 'slot_permission_denied')
  assert.equal(f.packets.length, 1); assert.equal(f.client.state().unreconciledAction, null)
})

test('death cancels observations, quarantines writes and detach restores listener ownership', async () => {
  const f = fixture({ timeoutMs: 50 }); f.payload('maw_agent:menu_state', f.menu())
  const action = f.client.click({ slot: 1, requestId: 'death-action' }); await pause(); f.bot.emit('death')
  assert.equal((await action).status, 'unknown'); assert.equal(f.client.currentMenu(), null)
  f.client.detach(); f.client.detach()
  assert.equal(f.wire.listenerCount('custom_payload'), 0); assert.equal(f.bot.listenerCount('spawn'), 0)
  assert.equal(f.bot.getMaxListeners(), 10); assert.equal(f.wire.getMaxListeners(), 10)
})

test('unlimited listener budgets stay unlimited and external changes are never overwritten', () => {
  const bot = new EventEmitter(); bot._client = new EventEmitter(); bot._client.write = () => {}
  bot.setMaxListeners(0); bot._client.setMaxListeners(0)
  const client = attachTauNativeClient(bot); bot._client.setMaxListeners(100); client.detach()
  assert.equal(bot.getMaxListeners(), 0); assert.equal(bot._client.getMaxListeners(), 100)
})

test('invalid raw UTF-8, oversized packets and a closed connection never crash the bot', async () => {
  const f = fixture()
  f.wire.emit('custom_payload', { channel: 'maw_agent:world_state', data: Buffer.from([0xff]) })
  f.wire.emit('custom_payload', { channel: 'maw_agent:world_state', data: Buffer.alloc(contract.limits.stateBytes + 1) })
  assert.equal(f.client.diagnostics().length, 2); f.client.detach()
  assert.equal((await f.client.snapshot()).ok, false); assert.equal(f.packets.length, 0)
})
