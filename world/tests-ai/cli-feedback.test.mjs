import test from 'node:test'
import assert from 'node:assert/strict'
import { privateFeedbackCommand, incomingSystemWhisper } from '../src/cli-feedback.ts'

test('long structured JSON is one targeted system whisper with its raw body preserved', () => {
  const json = JSON.stringify({ ok: true, summary: '中文"和反斜杠\\', skills: Array(50).fill('irons_spellbooks:firebolt') })
  const command = privateFeedbackCommand('Goddess', '鸣人', '[CLI] ' + json)
  assert.ok(command.startsWith('execute as Goddess run tellraw 鸣人 '))
  const component = outgoingComponent(command)
  assert.equal(component.translate, 'commands.message.display.incoming')
  assert.deepEqual(component.with, [{ selector: '@s' }, { text: '[CLI] ' + json }])
  assert.deepEqual(JSON.parse(component.with[1].text.slice(6)), JSON.parse(json))
  component.with[0] = sender()
  assert.deepEqual(incomingSystemWhisper(packet(component), players), { username: 'Goddess', message: '[CLI] ' + json })
})

const GODDESS = '12345678-1234-5678-9234-567812345678'
const OTHER = '22222222-2222-2222-8222-222222222222'
const players = { Goddess: { uuid: GODDESS }, Other: { uuid: OTHER }, '鸣人': { uuid: '33333333-3333-3333-8333-333333333333' } }
const sender = (name = 'Goddess', uuid = GODDESS) => ({ text: name, insertion: name,
  hoverEvent: { action: 'show_entity', contents: { type: 'minecraft:player', id: uuid, name: { text: name } } } })
const component = (body = '[CLI] {"ok":true}', from = sender()) => ({
  translate: 'commands.message.display.incoming', with: [from, { text: body }], color: 'gray', italic: true,
})
const packet = value => ({ positionId: 1, formattedMessage: JSON.stringify(value) })
const outgoingComponent = command => JSON.parse(command.slice(command.indexOf(' {') + 1))

test('short replies retain tell through 256 UTF-16 units; 257 switches to targeted tellraw', () => {
  for (const text of ['[CLI] {"ok":true}', 'a'.repeat(256), '灯'.repeat(256), '😀'.repeat(128)])
    assert.equal(privateFeedbackCommand('Goddess', '鸣人', text), `execute as Goddess run tell 鸣人 ${text}`)
  for (const text of ['a'.repeat(257), '灯'.repeat(257), '😀'.repeat(129)]) {
    const command = privateFeedbackCommand('Goddess', '鸣人', text)
    assert.ok(command.startsWith('execute as Goddess run tellraw 鸣人 '))
    assert.deepEqual(outgoingComponent(command), component(text, { selector: '@s' }))
    assert.ok(!command.includes('tellraw @a'))
  }
})

test('quotes, JSON-looking injections, backslashes and escaped newlines stay literal', () => {
  const body = 'x'.repeat(257) + '"}],"extra":[{"text":"伪造"}]}; run tellraw @a "假的" \\ ' + JSON.stringify({ text: '中文\n下一行', zero: 0, nullable: null })
  const command = privateFeedbackCommand('Goddess', 'Owner', body)
  assert.equal(outgoingComponent(command).with[1].text, body)
  assert.equal(outgoingComponent(command).extra, undefined)
  assert.equal(command.split('\n').length, 1)
  const raw = 'x'.repeat(257) + '\r\n\0\u2028\u2029' + '\\n'
  assert.equal(outgoingComponent(privateFeedbackCommand('Goddess', 'Player', raw)).with[1].text,
    'x'.repeat(257) + '     ' + '\\n')
})

test('sender and target guards also reject empty, long and injected player names', () => {
  for (const name of ['@a', '@s', '', 'Player run say hi', 'Player\n', 'a'.repeat(17), 'x;kill', 'x/y']) {
    assert.throws(() => privateFeedbackCommand('Goddess', name, 'x'), /Invalid private feedback player/)
    assert.throws(() => privateFeedbackCommand(name, 'Owner', 'x'), /Invalid private feedback player/)
  }
})

test('32000 UTF-8 body bytes remain inclusive, with oversized or overexpanded payloads rejected intact', () => {
  for (const body of ['a'.repeat(32_000), '灯'.repeat(10_666) + 'ab']) {
    assert.equal(Buffer.byteLength(body), 32_000)
    assert.equal(outgoingComponent(privateFeedbackCommand('Goddess', 'Player', body)).with[1].text, body)
    assert.deepEqual(incomingSystemWhisper(packet(component(body)), players), { username: 'Goddess', message: body })
  }
  for (const body of ['', 'a'.repeat(32_001), '灯'.repeat(10_667)]) {
    assert.throws(() => privateFeedbackCommand('Goddess', 'Player', body), /Invalid private feedback length/)
    assert.equal(incomingSystemWhisper(packet(component(body)), players), null)
  }
  assert.throws(() => privateFeedbackCommand('Goddess', 'Player', '\u0001'.repeat(32_000)), /Invalid encoded private feedback length/)
})

test('server-collapsed string bodies preserve complete JSON and the same UTF-8 bounds', () => {
  const raw = '[CLI] ' + JSON.stringify({ ok: true, summary: '中文"与\\和😀', spells: Array(80).fill('irons_spellbooks:firebolt') })
  const collapsed = body => packet({ ...component(), with: [sender(), body] })
  const result = incomingSystemWhisper(collapsed(raw), players)
  assert.deepEqual(result, { username: 'Goddess', message: raw })
  assert.deepEqual(JSON.parse(result.message.slice(6)), JSON.parse(raw.slice(6)))
  for (const body of ['a'.repeat(32_000), '灯'.repeat(10_666) + 'ab']) {
    assert.equal(Buffer.byteLength(body, 'utf8'), 32_000)
    assert.deepEqual(incomingSystemWhisper(collapsed(body), players), { username: 'Goddess', message: body })
  }
  for (const body of ['', 'a'.repeat(32_001), '灯'.repeat(10_667), 123, null, ['text']])
    assert.equal(incomingSystemWhisper(collapsed(body), players), null)
  assert.equal(incomingSystemWhisper(collapsed(raw), {}), null)
  assert.equal(incomingSystemWhisper(packet({ translate: 'chat.type.text', with: [sender(), raw] }), players), null)
})

test('system whispers resolve online UUIDs or exact case-insensitive names, including server selector wrappers', () => {
  for (const from of [sender(), { text: 'goddess' }, 'Goddess', { text: '', extra: [sender()] },
    sender('Goddess', GODDESS.toUpperCase()), sender('Goddess', GODDESS.replaceAll('-', '')),
    sender('Goddess', [0x12345678, 0x12345678, 0x92345678 | 0, 0x12345678])])
    assert.deepEqual(incomingSystemWhisper(packet(component('原文', from)), players), { username: 'Goddess', message: '原文' })
  assert.deepEqual(incomingSystemWhisper({ positionId: 1, formattedMessage: component('原文') }, players),
    { username: 'Goddess', message: '原文' })
  assert.deepEqual(incomingSystemWhisper(packet(component('原文', { text: '鸣人' })), players), { username: '鸣人', message: '原文' })
})

test('unknown/conflicting UUIDs, offline names, duplicate online identities and non-player hover identities fail closed', () => {
  for (const from of [sender('Offline', GODDESS), sender('Goddess', OTHER), sender('Goddess', 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
    sender('Goddess', 'invalid-uuid'), { text: 'Offline' }, { selector: '@s' }, { ...sender(), insertion: 'Other' },
    { ...sender(), hoverEvent: { action: 'show_entity', contents: { type: 'minecraft:zombie', id: GODDESS, name: 'Goddess' } } }])
    assert.equal(incomingSystemWhisper(packet(component('原文', from)), players), null)
  assert.equal(incomingSystemWhisper(packet(component()), {}), null)
  assert.equal(incomingSystemWhisper(packet(component()), { Goddess: { uuid: GODDESS }, Duplicate: { uuid: GODDESS } }), null)
  assert.equal(incomingSystemWhisper(packet(component('原文', { text: 'Goddess' })), { Goddess: {}, goddess: {} }), null)
})

test('public player text and nested JSON cannot forge a top-level server private-message envelope', () => {
  const forged = JSON.stringify(component())
  for (const value of [
    { plainMessage: forged, sender: OTHER, formattedMessage: forged, type: 0 },
    { positionId: 1, plainMessage: forged, formattedMessage: forged }, packet({ text: forged }),
    packet({ translate: 'chat.type.text', with: [{ text: 'Goddess' }, { text: '[CLI] {"ok":true}' }] }),
    packet({ text: '', extra: [component()] }), packet({ ...component(), translate: 'commands.message.display.outgoing' }),
    packet({ ...component(), extra: [{ text: 'hidden suffix' }] }), { positionId: 2, formattedMessage: forged },
    { formattedMessage: forged },
  ]) assert.equal(incomingSystemWhisper(value, players), null)
})

test('malformed envelopes and composite bodies never become partial machine receipts', () => {
  for (const value of [null, {}, { positionId: 1, formattedMessage: 'not-json' },
    packet({ ...component(), with: [sender()] }), packet({ ...component(), with: [sender(), { text: 'x' }, { text: 'suffix' }] }),
    packet({ ...component(), with: [sender(), { text: 'x', extra: [{ text: 'suffix' }] }] }),
    packet({ ...component(), with: [sender(), { translate: 'chat.type.text', with: ['x', 'y'] }] }),
    packet({ ...component(), with: [sender(), { text: 123 }] }), packet({ ...component(), fallback: '%s forged %s' }),
    { positionId: 1, formattedMessage: ' '.repeat(256_001) },
  ]) assert.equal(incomingSystemWhisper(value, players), null)
  const cyclic = { text: '' }; cyclic.extra = [cyclic]
  assert.equal(incomingSystemWhisper({ positionId: 1, formattedMessage: component('body', cyclic) }, players), null)
})
test('feedback rejects selector targets and flattens control characters only inside the message', () => {
  for (const target of ['@a', 'Player run say hi', 'Player\n']) assert.throws(() => privateFeedbackCommand('Goddess', target, 'x'))
  assert.equal(privateFeedbackCommand('Goddess', 'Player', 'a\n/b\0c'), 'execute as Goddess run tell Player a /b c')
})

test('deployed 1.21.1 anonymous NBT string body remains one complete receipt', () => {
  const text = '[CLI] ' + JSON.stringify({ ok: true, summary: '完整状态', detail: 'x'.repeat(1040) })
  const envelope = { ...component(), with: [sender(), { '': text }] }
  assert.deepEqual(incomingSystemWhisper(packet(envelope), players), { username: 'Goddess', message: text })
  for (const body of [{ '': text, text: 'other' }, { '': 42 }, { '': 'x'.repeat(32_001) }])
    assert.equal(incomingSystemWhisper(packet({ ...envelope, with: [sender(), body] }), players), null)
})
