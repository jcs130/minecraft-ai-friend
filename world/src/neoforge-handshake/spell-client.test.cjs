'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { attachSpellClient } = require('./spell-client.cjs')

const PLAYER = '9d5f8ad8-97a1-4dcb-b35c-774f5e7b8683'
const OTHER = 'edec6451-7b77-4920-9ec6-ed7c3bb994dd'
const BOOK = '{id:"ars_nouveau:novice_spell_book",count:1,components:{"ars_nouveau:spell_caster":{spells:{"0":{recipe:["ars_nouveau:glyph_self","ars_nouveau:glyph_heal"]}}}}}'
const STATE = { playerUuid: PLAYER, heldItem: 'ars_nouveau:novice_spell_book', heldSnbt: BOOK,
  selectedHotbarSlot: 2, mana: { current: 150, max: 150 }, health: 10, casterEquipped: true }

test('learning and editing use held-item CAS, keep native receipts and treat respawn as unknown', async t => {
  const { bot, spell, writes, emit } = fixture(t)
  let read = spell.list(); emit({ requestId: writes.at(-1).body.requestId, action: 'list', ok: true, state: STATE }); await read
  const learning = spell.learnGlyph({ requestId: 'learn-native-1' })
  assert.equal(writes.at(-1).body.kind, 'learn_glyph'); assert.equal(writes.at(-1).body.expectedHeldSnbt, BOOK)
  emit({ requestId: 'learn-native-1', action: 'learn_glyph', ok: false, code: 'glyph_item_not_held', state: STATE })
  assert.equal((await learning).code, 'glyph_item_not_held')
  const writing = spell.configure({ slot: 1, name: '跳跃', glyphs: ['ars_nouveau:glyph_self', 'ars_nouveau:glyph_leap'], requestId: 'write-native-1' })
  assert.deepEqual(writes.at(-1).body.glyphs, ['ars_nouveau:glyph_self', 'ars_nouveau:glyph_leap'])
  const rejected = assert.rejects(writing, e => e.outcomeUnknown && e.retryAutomatically === false)
  bot.emit('respawn'); await rejected; assert.equal(spell.current(), null)
  await assert.rejects(spell.configure({ slot: 1, name: '跳跃', glyphs: ['ars_nouveau:glyph_self'], requestId: 'write-native-1', expectedHeldSnbt: BOOK, expectedHotbarSlot: 2 }), /ALREADY_ISSUED/)
  read = spell.glyphs({ offset: 24, limit: 12 })
  emit({ requestId: writes.at(-1).body.requestId, action: 'glyphs', ok: true, glyphs: [], state: STATE }); await read
  const selecting = spell.select(0); emit({ requestId: writes.at(-1).body.requestId, action: 'select', ok: true, state: STATE }); assert.equal((await selecting).ok, true)
})

function fixture (t, options) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot._client.uuid = PLAYER
  const writes = []
  bot._client.write = (name, packet) => writes.push({ name, channel: packet.channel,
    body: JSON.parse(packet.data.toString('utf8')) })
  const spell = attachSpellClient(bot, options)
  const errors = []
  spell.events.on('protocolError', error => errors.push(error.message))
  const emit = body => bot._client.emit('custom_payload', { channel: 'maw_agent:spell_state',
    data: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'spell_receipt', engine: 'ars_nouveau',
      playerUuid: PLAYER, outcomeKnown: true, ...body })) })
  t.after(() => spell.detach())
  return { bot, spell, writes, emit, errors }
}

test('zero-cost native expenditure confirms a cast without inventing target effects; ambiguous casts stay unknown', async t => {
  const { spell, writes, emit } = fixture(t)
  const read = spell.list()
  emit({ requestId: writes.at(-1).body.requestId, action: 'list', ok: true, state: STATE }); await read
  const cast = spell.cast('ars_nouveau:slot_0', { requestId: 'zero-cost-once' })
  emit({ requestId: 'zero-cost-once', action: 'cast', ok: true, castConfirmed: true,
    manaBefore: 150, manaAfter: 150, manaSpent: 0, nativeExpendedCost: 0,
    castEvidence: 'native_expenditure_event', effectVerified: false, state: STATE })
  const result = await cast
  assert.equal(result.castConfirmed, true); assert.equal(result.manaSpent, 0)
  assert.equal(result.castEvidence, 'native_expenditure_event'); assert.equal(result.effectVerified, false)
  const ambiguous = spell.cast('ars_nouveau:slot_0', { requestId: 'no-expenditure-proof' })
  emit({ requestId: 'no-expenditure-proof', action: 'cast', ok: false, outcomeKnown: false,
    code: 'ars_cast_outcome_unknown', castConfirmed: false, effectVerified: false, state: STATE })
  assert.equal((await ambiguous).outcomeKnown, false)
  assert.equal(spell.current(), null)
  await assert.rejects(spell.cast('ars_nouveau:slot_0', { requestId: 'no-expenditure-proof', expectedHeldSnbt: BOOK, expectedHotbarSlot: 2 }), /ALREADY_ISSUED/)
})

test('native list and explain preserve actual recipe and book components, without an actor parameter', async t => {
  const { spell, writes, emit } = fixture(t)
  const list = spell.list()
  const query = writes[0]
  assert.equal(query.channel, 'maw_agent:spell_query')
  assert.deepEqual(Object.keys(query.body).sort(), ['kind', 'requestId', 'schemaVersion'])
  const configured = { id: 'ars_nouveau:slot_0', glyphs: ['ars_nouveau:glyph_self', 'ars_nouveau:glyph_heal'], manaCost: 80 }
  emit({ requestId: query.body.requestId, action: 'list', ok: true, state: STATE, spells: [configured] })
  assert.deepEqual((await list).spells, [configured])
  assert.equal(spell.current().heldSnbt, BOOK)
  const explanation = spell.explain(configured.id)
  assert.equal(writes[1].body.spellId, configured.id)
  emit({ requestId: writes[1].body.requestId, action: 'explain', ok: true, state: STATE, spell: configured })
  assert.deepEqual((await explanation).spell, configured)
})

test('cast sends exact native book and hotbar preconditions, and keeps failure as failure', async t => {
  const { spell, writes, emit } = fixture(t)
  const observation = spell.list()
  emit({ requestId: writes[0].body.requestId, action: 'list', ok: true, state: STATE })
  await observation
  const cast = spell.cast('ars_nouveau:slot_0', { requestId: 'heal-once' })
  assert.deepEqual(writes[1], { name: 'custom_payload', channel: 'maw_agent:spell_action', body: {
    schemaVersion: 1, kind: 'cast', requestId: 'heal-once', spellId: 'ars_nouveau:slot_0',
    expectedHeldSnbt: BOOK, expectedHotbarSlot: 2
  } })
  emit({ requestId: 'heal-once', action: 'cast', ok: false, code: 'ars_cast_not_confirmed',
    nativeInteraction: 'CONSUME', manaBefore: 0, manaAfter: 0, effectVerified: false, state: STATE })
  const result = await cast
  assert.equal(result.ok, false)
  assert.equal(result.nativeInteraction, 'CONSUME')
  assert.equal(result.effectVerified, false)
  await assert.rejects(spell.cast('ars_nouveau:slot_0', { requestId: 'heal-once' }), /SPELL_CAST_ALREADY_ISSUED/)
  assert.equal(writes.length, 2)
})

test('foreign UUID or wrong action cannot resolve a request or contaminate the held book', async t => {
  const { spell, writes, emit, errors } = fixture(t)
  const list = spell.list()
  const requestId = writes[0].body.requestId
  emit({ requestId, action: 'list', playerUuid: OTHER, state: { ...STATE, playerUuid: OTHER } })
  emit({ requestId, action: 'cast', state: STATE })
  assert.equal(spell.current(), null)
  assert.deepEqual(errors, ['SPELL_ACTOR_MISMATCH', 'SPELL_ACTION_MISMATCH'])
  emit({ requestId, action: 'list', state: STATE, ok: true })
  assert.equal((await list).ok, true)
  assert.equal(spell.current().playerUuid, PLAYER)
})

test('cast timeout is unknown, sends once, invalidates state and refuses same ID replay', async t => {
  const { spell, writes, emit } = fixture(t, { timeoutMs: 15 })
  const observation = spell.list()
  emit({ requestId: writes[0].body.requestId, action: 'list', ok: true, state: STATE })
  await observation
  await assert.rejects(spell.cast('ars_nouveau:slot_0', { requestId: 'lost-receipt' }), error => {
    assert.match(error.message, /SPELL_CAST_OUTCOME_UNKNOWN/)
    assert.equal(error.requestId, 'lost-receipt')
    assert.equal(error.outcomeUnknown, true)
    assert.equal(error.retryAutomatically, false)
    return true
  })
  assert.equal(writes.length, 2)
  assert.equal(spell.current(), null)
  assert.throws(() => spell.cast('ars_nouveau:slot_0'), /SPELL_STATE_UNAVAILABLE/)
  await assert.rejects(spell.cast('ars_nouveau:slot_0', { requestId: 'lost-receipt',
    expectedHeldSnbt: BOOK, expectedHotbarSlot: 2 }), /SPELL_CAST_ALREADY_ISSUED/)
  assert.equal(writes.length, 2)
})

test('disconnect leaves cast unknown and never auto-resends on the same object', async t => {
  const { spell, bot, writes } = fixture(t)
  const cast = spell.cast('ars_nouveau:slot_0', { expectedHeldSnbt: BOOK, expectedHotbarSlot: 2 })
  bot.emit('end')
  await assert.rejects(cast, error => error.outcomeUnknown === true && error.retryAutomatically === false)
  await assert.rejects(spell.list(), /SPELL_CONNECTION_CLOSED/)
  assert.equal(spell.current(), null)
  assert.equal(writes.length, 1)
})

test('oversized and native unknown receipts discard potentially stale state', async t => {
  const { spell, emit, writes } = fixture(t)
  const observation = spell.list()
  emit({ requestId: writes[0].body.requestId, action: 'list', ok: true, state: STATE })
  await observation
  const first = spell.cast('ars_nouveau:slot_0', { requestId: 'b' })
  emit({ requestId: 'b', action: 'cast', ok: true, stateUnavailable: true })
  await first
  assert.equal(spell.current(), null)
  const next = spell.list()
  emit({ requestId: writes.at(-1).body.requestId, action: 'list', ok: true, state: STATE })
  await next
  const second = spell.cast('ars_nouveau:slot_0', { requestId: 'd' })
  emit({ requestId: 'd', action: 'cast', ok: false, outcomeKnown: false, state: STATE })
  await second
  assert.equal(spell.current(), null)
  assert.throws(() => spell.cast('ars_nouveau:slot_0'), /SPELL_STATE_UNAVAILABLE/)
})

test('respawn retires pending reads/casts and late old replies cannot refill the cache', async t => {
  const { spell, bot, writes, emit } = fixture(t)
  const list = spell.list(), readId = writes.at(-1).body.requestId
  const cast = spell.cast('ars_nouveau:slot_0', { requestId: 'cast-before-respawn', expectedHeldSnbt: BOOK, expectedHotbarSlot: 2 })
  bot.emit('respawn')
  await assert.rejects(list, error => error.outcomeKnown === true && error.outcomeUnknown === false)
  await assert.rejects(cast, error => error.outcomeUnknown === true)
  emit({ requestId: readId, action: 'list', ok: true, state: STATE })
  emit({ requestId: 'cast-before-respawn', action: 'cast', ok: true, state: STATE })
  assert.equal(spell.current(), null)
  await assert.rejects(spell.cast('ars_nouveau:slot_0', { requestId: 'cast-before-respawn', expectedHeldSnbt: BOOK, expectedHotbarSlot: 2 }), /ALREADY_ISSUED/)
  assert.equal(writes.length, 2)
  const fresh = spell.list(); emit({ requestId: writes.at(-1).body.requestId, action: 'list', ok: true, state: STATE })
  await fresh; assert.equal(spell.current().heldSnbt, BOOK)
})

test('unmatched, malformed UTF-8 and oversized receipts cannot seed a book or resolve a query', async t => {
  const { spell, bot, writes, emit, errors } = fixture(t)
  emit({ requestId: 'unsolicited', action: 'list', ok: true, state: STATE }); assert.equal(spell.current(), null)
  const read = spell.list(); const requestId = writes.at(-1).body.requestId
  for (const value of [null, [], 'text', 7]) bot._client.emit('custom_payload', { channel: 'maw_agent:spell_state', data: Buffer.from(JSON.stringify(value)) })
  bot._client.emit('custom_payload', { channel: 'maw_agent:spell_state', data: Buffer.from([0xc3, 0x28]) })
  bot._client.emit('custom_payload', { channel: 'maw_agent:spell_state', data: Buffer.alloc(65537) })
  emit({ requestId, action: 'list', ok: true, state: { ...STATE, playerUuid: OTHER } })
  assert.equal(errors.length, 3); assert.equal(spell.current(), null)
  emit({ requestId, action: 'list', ok: true, state: STATE }); await read
})

test('cache cloning and disconnect prevent external mutation and stale receipt resurrection', async t => {
  const { spell, bot, writes, emit } = fixture(t)
  const read = spell.list(); const requestId = writes.at(-1).body.requestId
  spell.events.on('receipt', body => { body.state.heldSnbt = 'listener-change' })
  emit({ requestId, action: 'list', ok: true, state: STATE }); const receipt = await read
  assert.equal(receipt.state.heldSnbt, BOOK)
  receipt.state.heldSnbt = 'changed'; const cache = spell.current(); cache.heldSnbt = 'also-changed'
  assert.equal(spell.current().heldSnbt, BOOK)
  bot.emit('end'); emit({ requestId, action: 'list', ok: true, state: STATE })
  assert.equal(spell.current(), null)
  spell.detach(); assert.equal(bot.listenerCount('spawn'), 0); assert.equal(bot.listenerCount('respawn'), 0)
})

test('invalid IDs, actor options and out of range preconditions never reach the wire', t => {
  const { spell, writes } = fixture(t)
  for (const id of ['heal', 'ars_nouveau:slot_-1', 'ars_nouveau:slot_00', 'ars_nouveau:slot_100']) {
    assert.throws(() => spell.explain(id), /INVALID_SPELL_ID/)
  }
  assert.throws(() => spell.cast('ars_nouveau:slot_0', { bodyUuid: OTHER }), /UNSUPPORTED_SPELL_OPTION/)
  for (const slot of [-1, 9, 1.5]) {
    assert.throws(() => spell.cast('ars_nouveau:slot_0', { expectedHeldSnbt: BOOK, expectedHotbarSlot: slot }), /SPELL_STATE_UNAVAILABLE/)
  }
  assert.equal(writes.length, 0)
})

test('request matching handles out of order list/explain receipts', async t => {
  const { spell, writes, emit } = fixture(t)
  const list = spell.list()
  const explain = spell.explain('ars_nouveau:slot_0')
  emit({ requestId: writes[1].body.requestId, action: 'explain', ok: false, code: 'ars_spellbook_not_held' })
  emit({ requestId: writes[0].body.requestId, action: 'list', ok: true, spells: [], state: { ...STATE, heldSnbt: '', casterEquipped: false } })
  assert.equal((await explain).code, 'ars_spellbook_not_held')
  assert.deepEqual((await list).spells, [])
})
