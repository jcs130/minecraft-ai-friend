import test from 'node:test'
import assert from 'node:assert/strict'
import { incomingWhisper } from '../src/incoming-whisper.ts'

const players = { QDIronsProbe: { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, '鸣人': { uuid: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' } }
const formats = { 2: { name: 'minecraft:msg_command_incoming', formatString: '%s whispers to you: %s' }, 0: { name: 'minecraft:chat', formatString: '<%s> %s' } }
test('profileless private chat extracts component body and the actual online username', () => {
  const packet = { type: { chatType: 2 }, senderName: JSON.stringify({ text: 'QDIronsProbe' }), formattedMessage: JSON.stringify({ text: '咏唱：铁魔法：隐身术' }) }
  assert.deepEqual(incomingWhisper(packet, players, formats), { username: 'QDIronsProbe', message: '咏唱：铁魔法：隐身术' })
})
test('signed whisper keeps UUID identity and plain body; Chinese components retain extra text', () => {
  assert.deepEqual(incomingWhisper({ type: 2, sender: players.QDIronsProbe.uuid, plainMessage: 'cast feather_fall' }, players, formats), { username: 'QDIronsProbe', message: 'cast feather_fall' })
  assert.deepEqual(incomingWhisper({ type: 2, senderName: JSON.stringify({ text: '', extra: [{ text: '鸣人' }] }), formattedMessage: JSON.stringify({ text: '咏唱：', extra: [{ text: '羽落' }] }) }, players, formats), { username: '鸣人', message: '咏唱：羽落' })
})
test('public chat cannot masquerade as a whisper and unknown display names cannot select a caster', () => {
  const packet = { type: 0, senderName: JSON.stringify({ text: 'QDIronsProbe' }), plainMessage: '咏唱：羽落' }
  assert.equal(incomingWhisper(packet, players, formats), null)
  assert.equal(incomingWhisper({ ...packet, type: 2, senderName: JSON.stringify({ text: 'UnknownName' }) }, players, formats), null)
  assert.equal(incomingWhisper({ ...packet, type: 2, senderName: 'invalid json' }, players, formats), null)
})
test('server registry incoming format can move to a different numeric ID', () => {
  const packet = { type: { chatType: 7 }, senderName: JSON.stringify({ text: 'QDIronsProbe' }), plainMessage: 'hello' }
  assert.equal(incomingWhisper(packet, players, { 7: formats[2] }).message, 'hello')
  assert.equal(incomingWhisper({ ...packet, type: 2 }, players, { 2: formats[0] }), null)
  assert.equal(incomingWhisper({ ...packet, type: 2 }, players, {}), null)
})
