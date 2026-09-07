import test from 'node:test'
import assert from 'node:assert/strict'
import { queryNativeProgression, parseNativeProgressionReceipt, nativeProgressionLines } from '../src/native-progression.ts'

const player = 'Probe123'
const actorUuid = '93aa72d1-27e7-4f5b-8a4f-c8e7d0542574'
const row = (id, extra = {}) => ({ id: `puffish_skills:${id}`, available: true,
  level: 6, experience: 157, points_total: 8, points_spent: 5, points_left: 3, ...extra })
const receipt = (categories = [row('combat'), row('mining', { level: 0, experience: 0, points_total: 0, points_spent: 0, points_left: 0 })], extra = {}) =>
  'QD_SPELL_JSON ' + JSON.stringify({ schema: 1, engine: 'irons_spellbooks', action: 'progression', ok: true, actor: player, actorUuid, categories, ...extra })

test('valid actual-shaped receipt distinguishes total, spent and available points, and valid zero', async () => {
  const sent = []
  const result = await queryNativeProgression({ send: async cmd => { sent.push(cmd); return receipt() } }, player)
  assert.deepEqual(sent, ['qdspell progression Probe123'])
  assert.equal(result.ok, true)
  assert.equal(result.categories[0].points_left, 3)
  assert.equal(result.categories[0].points_total, 8)
  assert.equal(result.categories[1].experience, 0)
  assert(nativeProgressionLines(result)[0].includes('可用技能点 3'))
})

test('failed or absent data stays null and never becomes zero', async () => {
  for (const raw of ['', 'Unknown or incomplete command', 'Probe123 has 100 points in category puffish_skills:combat', receipt([], { ok: false, code: 'player_offline' }), receipt([])]) {
    const result = parseNativeProgressionReceipt(raw, player)
    assert.equal(result.ok, false)
    assert(result.categories.every(row => row.level === null && row.experience === null && row.points_left === null))
  }
  let calls = 0
  const result = await queryNativeProgression({ send: async () => { calls++; throw Error('offline') } }, player)
  assert.equal(calls, 1)
  assert.equal(result.code, 'transport_error')
})

test('correlation rejects wrong player, duplicate envelope, malformed and ambiguous category', () => {
  assert.equal(parseNativeProgressionReceipt(receipt(undefined, { actor: 'Other123' }), player).code, 'receipt_mismatch')
  assert.equal(parseNativeProgressionReceipt(receipt(undefined, { action: 'status' }), player).code, 'receipt_mismatch')
  assert.equal(parseNativeProgressionReceipt(receipt() + '\n' + receipt(), player).code, 'ambiguous_receipt')
  assert.equal(parseNativeProgressionReceipt('QD_SPELL_JSON {broken', player).code, 'invalid_receipt')
  assert.equal(parseNativeProgressionReceipt(receipt([row('combat'), row('combat')]), player).categories[0].code, 'duplicate_category')
})

test('metrics are integers and total is not silently substituted for remaining', () => {
  for (const extra of [{ experience: '157' }, { level: null }, { points_left: 8 }, { points_total: Infinity }, { level: -1 }]) {
    const result = parseNativeProgressionReceipt(receipt([row('combat', extra)]), player)
    assert.equal(result.categories[0].available, false)
    assert.equal(result.categories[0].points_left, null)
  }
  const deficit = parseNativeProgressionReceipt(receipt([row('combat', { points_total: 3, points_spent: 5, points_left: -2 })]), player, ['combat'])
  assert.equal(deficit.ok, true)
  assert.equal(deficit.categories[0].points_left, -2, 'Preserve a real native point deficit instead of clamping it')
  const capped = parseNativeProgressionReceipt(receipt([row('combat', { points_total: 100, points_spent: 5, points_left: 15 })]), player, ['combat'])
  assert.equal(capped.ok, true)
  assert.equal(capped.categories[0].points_left, 15, 'Respect the native spentPointsLimit instead of recomputing left as 95')
})

test('invalid targets and categories never reach RCON; requested IDs preserve category identity', async () => {
  const rcon = { send: async () => { throw Error('Must not be called') } }
  for (const username of ['@a', 'Probe123\nkill @e', '', 'a'.repeat(17)])
    assert.equal((await queryNativeProgression(rcon, username)).code, 'invalid_request')
  assert.equal((await queryNativeProgression(rcon, player, ['combat', 'puffish_skills:combat'])).code, 'invalid_request')
  assert.equal((await queryNativeProgression(rcon, player, ['combat set 999'])).code, 'invalid_request')
  const result = parseNativeProgressionReceipt(receipt([row('mining')]), player, ['mining'])
  assert.equal(result.categories[0].id, 'puffish_skills:mining')
  assert.equal(result.ok, true)
})

test('points-only categories preserve actual points without fabricating an experience level', () => {
  const result = parseNativeProgressionReceipt(receipt([row('exchange', { available: false, code: 'no_experience', level: null, experience: null })]), player, ['exchange'])
  assert.equal(result.ok, true)
  assert.equal(result.categories[0].level, null)
  assert.equal(result.categories[0].experience, null)
  assert.equal(result.categories[0].points_left, 3)
  assert(nativeProgressionLines(result)[0].includes('未启用等级/经验'))
})

test('UUID targets are correlated by actorUuid, never a duplicated display/login name', async () => {
  const sent = []
  const result = await queryNativeProgression({ send: async command => { sent.push(command); return receipt() } }, actorUuid)
  assert.equal(result.ok, true)
  assert.deepEqual(sent, [`qdspell progression ${actorUuid}`])
  assert.equal(parseNativeProgressionReceipt(receipt(), actorUuid.toUpperCase()).ok, true)
  assert.equal(parseNativeProgressionReceipt(receipt(undefined, { actorUuid: '93aa72d1-27e7-4f5b-8a4f-c8e7d0542575' }), actorUuid).code, 'receipt_mismatch')
  assert.equal(parseNativeProgressionReceipt(receipt(undefined, { actorUuid: null }), actorUuid).code, 'receipt_mismatch')
  assert.equal(parseNativeProgressionReceipt(receipt(undefined, { actor: actorUuid, actorUuid: null }), actorUuid).code, 'receipt_mismatch')
  assert.equal((await queryNativeProgression({ send: async () => { throw Error('Must not be called') } }, actorUuid + '\nkill @e')).code, 'invalid_request')
})
