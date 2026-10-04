'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { parsePlan, visibleSurfaces, unknownOutcome, gameJSON } = require('./plan.cjs')
test('native long time stays precise in observations and ledgers', () => {
  assert.deepEqual(JSON.parse(gameJSON({ time: { age: 9007199254740993n, day: 1234n } })), { time: { age: '9007199254740993', day: '1234' } })
})
test('native returned unknown outcomes pause just like thrown timeouts', () => {
  for (const result of [{ outcomeUnknown: true }, { outcomeKnown: false }, { outcome: 'unknown' }, { ok: false, code: 'native_click_outcome_unknown' }]) assert(unknownOutcome(result))
  assert(!unknownOutcome({ ok: false, code: 'insufficient_ingredients' }))
  assert(!unknownOutcome({ ok: true, effectVerified: false }))
})
test('accepts bounded JSON actions but no command/code execution', () => {
  assert.equal(parsePlan('```json\n{"goal":"wood","reason":"visible tree","actions":[{"type":"gather","position":{"x":3,"y":64,"z":1}}]}\n```').actions.length, 1)
  for (const type of ['eval', 'command', 'teleport', 'give']) assert.throws(() => parsePlan(JSON.stringify({ goal: 'x', reason: '', actions: [{ type }] })), /ACTION/)
  assert.throws(() => parsePlan(JSON.stringify({ goal: 'x', reason: '', actions: [{ type: 'navigate', position: { x: 0.5, y: 64, z: 0 } }] })), /POSITION/)
  assert.throws(() => parsePlan(JSON.stringify({ goal: 'x', reason: '', actions: Array(9).fill({ type: 'inspect' }) })), /SCHEMA/)
})
test('accepts unambiguous action spelling and rejects conflicting action identity', () => {
  assert.equal(parsePlan('{"goal":"x","reason":"","actions":[{"action":"inspect"}]}').actions[0].type, 'inspect')
  assert.throws(() => parsePlan('{"goal":"x","reason":"","actions":[{"type":"inspect","action":"dig"}]}'), /AMBIGUOUS/)
})
test('does not disclose buried ores behind a solid surface', () => {
  const states = new Map([[0, { name: 'minecraft:air', properties: {} }], [1, { name: 'minecraft:stone', properties: {} }], [2, { name: 'minecraft:diamond_ore', properties: {} }]])
  const world = { states, stateIdAt: p => p.z === -2 ? 1 : p.z < -2 ? 2 : 0 }
  const surfaces = visibleSurfaces(world, { x: 0.5, y: 64, z: 0.5 })
  assert(surfaces.some(s => s.id === 'minecraft:stone'))
  assert(!surfaces.some(s => s.id === 'minecraft:diamond_ore'))
})
