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
    if (['create', 'curios', 'ysm'].includes(group)) { clients.mods ||= {}; clients.mods[group] = clients[group] }
    clients[group][method] = (...args) => {
      calls.push({ id: row.id, args })
      return Promise.resolve({ schemaVersion: 1, playerUuid: owner, ok: true, requestId: 'native-id', code: 'native', nested: { unchanged: 3 } })
    }
  }
  clients.mods.world = { interact: clients.world.interact }
  clients.menu.current = () => { calls.push({id:'menu.current',args:[]}); return {ok:true,code:'native',playerUuid:owner,menuType:'minecraft:inventory',selectedHotbarSlot:0,slots:Array(46).fill(null),carried:null} }
  clients.construction = { food: clients.inventory.food, consume: clients.inventory.consume, lookAt: clients.world.lookAt, select: clients.inventory.select, equip: clients.inventory.equip,
    craft: clients.native.craft, craftRecipe: clients.native.craftRecipe, place: clients.world.place, dig: clients.world.dig }
  const api = attachModCallClient(bot, clients)
  return { bot, calls, clients, api }
}
const setting = { position: pos, expectedBlockId: 'create:brass_funnel', behaviourIndex: 0,
  expectedBehaviour: 'com.simibubi.create.foundation.blockEntity.behaviour.filtering.FilteringBehaviour',
  expectedHeldSnbt: '', expectedHotbarSlot: 0 }
const args = {
  'inventory.consume': { itemId: 'minecraft:bread', inventorySlot: 9 },
  'world.lookAt': { position: pos }, 'inventory.select': { hotbarSlot: 0, expectedSnbt: '' },
  'inventory.equip': { sourceSlot: 9, hotbarSlot: 1, expectedId: 'minecraft:crafting_table' },
  'native.craft': { ingredients: [{ slot: 1, id: 'minecraft:oak_log' }], outputId: 'minecraft:oak_planks', outputCount: 4 },
  'native.craftRecipe': { recipeId: 'minecraft:oak_planks' },
  'world.place': { referencePosition: pos, face: { x: 0, y: 1, z: 0 }, referenceBlockId: 'minecraft:stone', referenceProperties: {},
    hotbarSlot: 0, itemId: 'create:shaft', blockId: 'create:shaft', expectedSnbt: '{id:"create:shaft",count:1}' },
  'world.dig': { position: pos, expectedBlockId: 'minecraft:short_grass', expectedProperties: {}, expectedHotbarSlot: 0, expectedHeldSnbt: '' },
  'world.interact': { position: pos, expectedBlockId: 'create:fluid_tank', expectedProperties: {}, expectedHeldSnbt: '', expectedHotbarSlot: 0 },
  'colony.management': { buildingPosition: pos }, 'colony.research': { buildingPosition: pos },
  'colony.assignCitizen': { buildingPosition: pos, moduleId: 2, expectedModuleKey: 'worker', citizenId: 3, assign: true, expectedAssignedCitizenIds: [] },
  'colony.setHiringMode': { buildingPosition: pos, moduleId: 2, expectedModuleKey: 'worker', mode: 'manual', expectedMode: 'auto' },
  'colony.pauseCitizen': { buildingPosition: pos, citizenId: 3, paused: true, expectedPaused: false },
  'colony.startResearch': { buildingPosition: pos, researchId: 'minecolonies:civilian/stamina' },
  'spell.configure': { slot: 1, name: '跳跃', glyphs: ['ars_nouveau:self', 'ars_nouveau:leap'] },
  'spell.select': { slot: 1 },
  'create.settings': { position: pos }, 'create.fluids': { position: pos },
  'create.setValue': { ...setting, expectedRow: 0, expectedValue: 64, row: 1, value: 16 },
  'create.setFilter': { ...setting, expectedFilterSnbt: '' },
  'curios.page': { page: 0, expectedContainerId: 1, expectedStateId: 2 },
  'ysm.select': { modelId: 'misc/2_steve', texture: 'tartaric_acid', expectedModelId: 'default', expectedTexture: 'default', expectedEnabled: true, expectedMandatory: false },
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
test('all 60 declared operations dispatch to the exact native adapter with actual arguments', async () => {
  const f = fixture()
  try {
    const list = f.api.operations()
    assert.equal(list.operationCount, 60); assert.equal(list.remoteSupportVerified, false)
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

test('interaction reports actual wrong hand and cannot dispatch after hand changes during visible aiming', async () => {
  const f = fixture()
  try {
    const wrong = await f.api.call('world.interact', { ...args['world.interact'], expectedHotbarSlot: 3 })
    assert.equal(wrong.observed.selectedHotbarSlot, 0); assert.match(wrong.hint, /inventory.select/)
    assert.equal(f.calls.some(row => row.id === 'world.interact'), false)
    let selected = 0
    f.clients.menu.current = () => ({ menuType: 'minecraft:inventory', selectedHotbarSlot: selected, slots: Array(46).fill(null), carried: null })
    f.clients.construction.lookAt = async () => { selected = 1; return { ok: true, aimOffsetUsed: [0.5, 0.1, 0.5] } }
    const changed = await f.api.call('world.interact', args['world.interact'])
    assert.equal(changed.code, 'native_interaction_menu_or_hand_changed')
    assert.equal(f.calls.some(row => row.id === 'world.interact'), false)
  } finally { f.api.detach() }
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
      ,['world.place', { ...args['world.place'], face: { x: 1, y: 1, z: 0 } }]
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

test('array schemas reject sparse, overlong, duplicate citizen IDs and unknown glyph fields before dispatch', async () => {
  const f = fixture()
  try {
    for (const data of [{ ...args['spell.configure'], glyphs: new Array(2) },
      { ...args['spell.configure'], glyphs: ['ars_nouveau:self', 5] },
      { ...args['spell.configure'], glyphs: Array(33).fill('ars_nouveau:self') },
      { ...args['spell.configure'], glyphs: [] }]) await assert.rejects(f.api.call('spell.configure', data), e => e.knownNotApplied)
    await assert.rejects(f.api.call('colony.assignCitizen', { ...args['colony.assignCitizen'], expectedAssignedCitizenIds: [2, 2] }), e => e.knownNotApplied)
    assert.equal(f.calls.length, 0)
  } finally { f.api.detach() }
})
