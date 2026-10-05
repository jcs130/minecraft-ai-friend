'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachModCallClient, modOperationCatalog } = require('./mod-call-client.cjs')
const owner = '11111111-2222-3333-8444-555555555555'
const other = 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee'
const pos = { x: 1, y: 64, z: 2 }
const inventory = { inventorySlot: 1, expectedSnbt: '{count:1,id:"minecraft:oak_planks"}' }
function fixture () {
  const bot = new EventEmitter(); bot._client = { uuid: owner }
  const calls = [], clients = {}
  for (const row of modOperationCatalog().operations) {
    const [group, method] = row.id.split('.')
    clients[group] ||= {}
    clients[group][method] = (...args) => {
      calls.push({ id: row.id, args })
      return Promise.resolve({ schemaVersion: 1, playerUuid: owner, ok: true, requestId: 'native-id', code: 'native', nested: { unchanged: 3 } })
    }
  }
  const api = attachModCallClient(bot, clients)
  return { bot, calls, clients, api }
}
const args = {
  'menu.click': { slot: 9 }, 'native.entity': { entityId: 7, expectedUuid: other },
  'native.recipes': { recipeType: 'create:milling', limit: 2 },
  'colony.resources': { buildingPosition: pos }, 'colony.found': { ...inventory, position: pos, name: '测试城镇' },
  'colony.placeBuilder': { ...inventory, position: pos }, 'colony.placeHut': { ...inventory, position: pos, hutType: 'home' },
  'colony.requestBuild': { buildingPosition: pos, builderPosition: pos },
  'colony.deliver': { ...inventory, buildingPosition: pos, quantity: 1, token: 'native-token' },
  'colony.stockResource': { ...inventory, buildingPosition: pos, quantity: 1 },
  'maid.status': { maidUuid: other }, 'maid.tasks': { maidUuid: other },
  'maid.setTask': { maidUuid: other, taskId: 'touhou_little_maid:farm' },
  'maid.setFollow': { maidUuid: other, follow: true }, 'maid.setPickup': { maidUuid: other, pickup: true },
  'maid.openBag': { maidUuid: other }, 'spell.explain': { spellId: 'ars_nouveau:slot_0' },
  'spell.cast': { spellId: 'ars_nouveau:slot_0', requestId: 'cast-1' },
  'domum.choices': { groupId: 'domum_ornamentum:fpanel' },
  'domum.select': { selection: 'variant', groupId: 'domum_ornamentum:fpanel', variantIndex: 2, choiceSnbt: '{count:1}' },
  'collision.query': { position: pos, expectedBlockId: 'minecraft:stone', expectedProperties: {} }
}
test('all 30 declared operations dispatch to the exact native adapter with actual arguments', async () => {
  const f = fixture()
  try {
    const list = f.api.operations()
    assert.equal(list.operationCount, 30); assert.equal(list.remoteSupportVerified, false)
    for (const row of list.operations) {
      const result = await f.api.call(row.id, args[row.id] || {})
      assert.equal(result.code, 'native'); assert.equal(f.calls.at(-1).id, row.id)
    }
    assert.deepEqual(f.calls.find(c => c.id === 'menu.click').args, [9, 0])
    assert.deepEqual(f.calls.find(c => c.id === 'maid.status').args, [other])
    assert.deepEqual(f.calls.find(c => c.id === 'spell.cast').args, ['ars_nouveau:slot_0', { requestId: 'cast-1' }])
    assert.deepEqual(f.calls.find(c => c.id === 'native.recipes').args, [args['native.recipes']])
  } finally { f.api.detach() }
})
test('catalog exposes JSON schema and remains immutable to the caller', () => {
  const catalog = modOperationCatalog()
  const operation = catalog.operations.find(d => d.id === 'colony.stockResource')
  assert.equal(operation.readOnly, false); assert.equal(operation.parameters.additionalProperties, false)
  assert(operation.parameters.required.includes('expectedSnbt'))
  operation.parameters.properties.inventorySlot.maximum = 1000
  assert.equal(modOperationCatalog(operation.id).operation.parameters.properties.inventorySlot.maximum, 35)
  assert.equal(modOperationCatalog('colony.hire').code, 'mod_operation_not_found')
})
test('unknown methods and invalid, extra, other-player or overriding parameters cannot dispatch', async () => {
  const f = fixture()
  try {
    for (const [id, data] of [
      ['colony.hire', {}], ['constructor', {}], ['native.recipes', { playerUuid: other }],
      ['colony.stockResource', { ...args['colony.stockResource'], quantity: 0 }],
      ['colony.stockResource', { ...args['colony.stockResource'], inventorySlot: 36 }],
      ['menu.click', { slot: 1, button: 2 }], ['maid.setFollow', { maidUuid: other, follow: 1 }],
      ['domum.select', { selection: 'variant', groupId: 'domum_ornamentum:fpanel' }],
      ['domum.select', { ...args['domum.select'], state: {} }]
    ]) {
      await assert.rejects(f.api.call(id, data), e => e.outcomeKnown && e.knownNotApplied)
    }
    assert.equal(f.calls.length, 0); assert.equal(f.api.callStatus().mutationBlocked, false)
  } finally { f.api.detach() }
})
test('non-JSON accessors, prototypes, cycles and budgets are rejected without invocation', async () => {
  const f = fixture(); let accessed = 0
  const getter = {}; Object.defineProperty(getter, 'slot', { enumerable: true, get () { accessed++; return 1 } })
  const cyclic = {}; cyclic.slot = cyclic
  try {
    for (const data of [getter, new Date(), { slot: Infinity }, cyclic, JSON.parse('{"constructor":{}}'), { slot: 'x'.repeat(70000) }]) {
      await assert.rejects(f.api.call('menu.click', data))
    }
    assert.equal(accessed, 0); assert.equal(f.calls.length, 0)
  } finally { f.api.detach() }
})
test('the caller cannot change mutation arguments while dispatch waits', async () => {
  const f = fixture(); let finish
  f.clients.colony.stockResource = data => new Promise(resolve => { finish = () => resolve({ ok: true, playerUuid: owner, quantity: data.quantity }) })
  try {
    const data = structuredClone(args['colony.stockResource'])
    const pending = f.api.call('colony.stockResource', data); data.quantity = 64
    finish(); assert.equal((await pending).quantity, 1)
  } finally { f.api.detach() }
})
test('one pending mutation blocks another, while read-only status remains callable', async () => {
  const f = fixture(); let finish
  f.clients.menu.click = () => new Promise(resolve => { finish = resolve })
  try {
    const first = f.api.call('menu.click', { slot: 9 })
    await assert.rejects(f.api.call('maid.setFollow', args['maid.setFollow']), { code: 'MOD_CALL_MUTATION_ALREADY_PENDING' })
    await f.api.call('colony.status')
    finish({ ok: true, playerUuid: owner }); await first
    assert.equal(f.api.callStatus().inFlightMutation, null)
    await f.api.call('maid.setFollow', args['maid.setFollow'])
  } finally { f.api.detach() }
})
test('unknown native receipt blocks subsequent mutations, survives respawn and does not block inspection', async () => {
  const f = fixture()
  f.clients.menu.click = () => Promise.resolve({ ok: false, playerUuid: owner, requestId: 'ambiguous', outcomeKnown: false, changed: null })
  try {
    const native = await f.api.call('menu.click', { slot: 9 }); assert.equal(native.outcomeKnown, false)
    f.bot.emit('respawn')
    await assert.rejects(f.api.call('maid.setFollow', args['maid.setFollow']), { code: 'MOD_CALL_BLOCKED_AFTER_UNKNOWN' })
    await f.api.call('colony.status')
    assert.equal(f.api.callStatus().unknown.requestId, 'ambiguous')
  } finally { f.api.detach() }
})
test('a thrown write error is conservatively unknown even if its message looks like validation', async () => {
  const f = fixture()
  f.clients.menu.click = () => { throw Object.assign(new Error('INVALID_MENU_SLOT'), { outcomeUnknown: true }) }
  try {
    await assert.rejects(f.api.call('menu.click', { slot: 9 }), e => e.outcomeUnknown === true)
    assert.equal(f.api.callStatus().mutationBlocked, true)
  } finally { f.api.detach() }
})
test('explicit not-dispatched errors and known server rejection do not create an unknown fence', async () => {
  const f = fixture()
  f.clients.domum.select = () => { throw Object.assign(new Error('DOMUM_STATE_UNAVAILABLE'), { outcomeUnknown: false, knownNotApplied: true }) }
  try {
    await assert.rejects(f.api.call('domum.select', args['domum.select']))
    assert.equal(f.api.callStatus().mutationBlocked, false)
    f.clients.colony.stockResource = () => ({ ok: false, playerUuid: owner, code: 'quantity_exceeds_remaining_need', accepted: 0 })
    assert.equal((await f.api.call('colony.stockResource', args['colony.stockResource'])).accepted, 0)
    assert.equal(f.api.callStatus().mutationBlocked, false)
  } finally { f.api.detach() }
})
test('lifecycle changes retire read results and fence a pending mutation without replay', async () => {
  const f = fixture(); let readDone, writeDone
  f.clients.colony.status = () => new Promise(resolve => { readDone = resolve })
  f.clients.menu.click = () => new Promise(resolve => { writeDone = resolve })
  try {
    const read = f.api.call('colony.status'), write = f.api.call('menu.click', { slot: 9 })
    f.bot.emit('spawn'); readDone({ ok: true, playerUuid: owner }); writeDone({ ok: true, playerUuid: owner })
    await assert.rejects(read, { code: 'MOD_CALL_READ_CONTEXT_CHANGED' })
    await assert.rejects(write, e => e.outcomeUnknown === true)
    assert.equal(f.api.callStatus().mutationBlocked, true)
  } finally { f.api.detach() }
})
test('foreign player receipts do not settle into a successful game result', async () => {
  const f = fixture()
  f.clients.menu.click = () => ({ ok: true, playerUuid: other })
  try {
    await assert.rejects(f.api.call('menu.click', { slot: 9 }), { code: 'MOD_CALL_RECEIPT_PLAYER_MISMATCH' })
    assert.equal(f.api.callStatus().mutationBlocked, true)
  } finally { f.api.detach() }
})
test('return values cannot mutate adapter caches and disconnect/detach removes new listeners', async () => {
  const f = fixture(); const cache = { playerUuid: owner, value: { count: 3 } }
  f.clients.menu.current = () => cache
  const result = await f.api.call('menu.current'); result.value.count = 100
  assert.equal(cache.value.count, 3)
  f.api.detach(); f.api.detach()
  await assert.rejects(f.api.call('menu.click', { slot: 9 }), { code: 'MOD_CALL_CONNECTION_CLOSED' })
  assert.equal(f.bot.listenerCount('spawn'), 0); assert.equal(f.bot.listenerCount('respawn'), 0)
})
