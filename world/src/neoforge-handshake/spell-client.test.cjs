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
  emit({ requestId: 'observation', action: 'list', ok: true, state: STATE })
  const cast = spell.cast('ars_nouveau:slot_0', { requestId: 'heal-once' })
  assert.deepEqual(writes[0], { name: 'custom_payload', channel: 'maw_agent:spell_action', body: {
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
  assert.equal(writes.length, 1)
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
  emit({ requestId: 'observation', action: 'list', state: STATE })
  await assert.rejects(spell.cast('ars_nouveau:slot_0', { requestId: 'lost-receipt' }), error => {
    assert.match(error.message, /SPELL_CAST_OUTCOME_UNKNOWN/)
    assert.equal(error.requestId, 'lost-receipt')
    assert.equal(error.outcomeUnknown, true)
    assert.equal(error.retryAutomatically, false)
    return true
  })
  assert.equal(writes.length, 1)
  assert.equal(spell.current(), null)
  assert.throws(() => spell.cast('ars_nouveau:slot_0'), /SPELL_STATE_UNAVAILABLE/)
  await assert.rejects(spell.cast('ars_nouveau:slot_0', { requestId: 'lost-receipt',
    expectedHeldSnbt: BOOK, expectedHotbarSlot: 2 }), /SPELL_CAST_ALREADY_ISSUED/)
  assert.equal(writes.length, 1)
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
  const { spell, emit } = fixture(t)
  emit({ requestId: 'a', action: 'list', state: STATE })
  emit({ requestId: 'b', action: 'cast', ok: true, stateUnavailable: true })
  assert.equal(spell.current(), null)
  emit({ requestId: 'c', action: 'list', state: STATE })
  emit({ requestId: 'd', action: 'cast', outcomeKnown: false, state: STATE })
  assert.equal(spell.current(), null)
  assert.throws(() => spell.cast('ars_nouveau:slot_0'), /SPELL_STATE_UNAVAILABLE/)
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
