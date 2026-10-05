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

test('accepts exactly one fenced plan and a bounded native role anchor, preserving the complete schema checks', () => {
  // Reduced from the completed native result: JSON fence, blank line, role
  // day/summary/anchor. Keep the structure without private prompt or inventory.
  const plan = { goal: '检查状态', reason: '按真实回执决定下一步', actions: [{ type: 'close_menu' }, { type: 'inspect' }] }
  const json = JSON.stringify(plan), fence = '```json\n' + json + '\n```'
  assert.deepEqual(parsePlan(fence + '\n\n⟧ 第37天夜晚｜关闭菜单→检查状态｜锚点：检查真实状态 ⟧'), plan)
  assert.deepEqual(parsePlan(' \n' + fence + '\n⟧ ' + 'x'.repeat(252) + ' ⟧\n '), plan, '256-character full anchor is the maximum')
  assert.deepEqual(parsePlan(fence), plan)
  assert.deepEqual(parsePlan('```\n' + json + '\n```'), plan, 'original untagged fence remains supported')
  assert.deepEqual(parsePlan(json), plan)
  const wrapped = body => '```json\n' + JSON.stringify(body) + '\n```\n⟧ 检查状态 ⟧'
  assert.throws(() => parsePlan(wrapped({ ...plan, reason: undefined })), /SCHEMA/)
  assert.throws(() => parsePlan(wrapped({ ...plan, actions: [{ type: 'command' }] })), /ACTION/)
  assert.throws(() => parsePlan(wrapped({ ...plan, actions: [{ type: 'navigate', position: { x: .5, y: 64, z: 0 } }] })), /POSITION/)
  assert.throws(() => parsePlan(wrapped({ ...plan, actions: Array(9).fill({ type: 'inspect' }) })), /SCHEMA/)
})

test('never selects a plan from multiple JSON objects, repeated fences, or arbitrary trailing narration', () => {
  const json = '{"goal":"状态","reason":"","actions":[{"type":"inspect"}]}'
  const second = '{"goal":"其他","reason":"","actions":[{"type":"wait","seconds":1}]}'
  const fence = '```json\n' + json + '\n```'
  for (const text of [json + '\n' + second, json + '\n' + json, '```json\n' + json + '\n' + second + '\n```',
    fence + '\n' + second, fence + '\n' + fence, fence + '\n```json\n' + second + '\n```',
    fence + '\n计划已完成', '先执行这个计划\n' + fence, fence + '\n⟧ 状态 ⟧\n' + second,
    fence + '\n⟧ 状态 ⟧\n' + fence, json + '\n⟧ 状态 ⟧']) assert.throws(() => parsePlan(text))
})

test('malformed or malicious role anchors cannot carry extra output through the fence boundary', () => {
  const fence = '```json\n{"goal":"状态","reason":"","actions":[{"type":"inspect"}]}\n```'
  for (const anchor of ['⟧ ' + 'x'.repeat(253) + ' ⟧', '⟧  ⟧', '⟧状态 ⟧', '⟧ 状态⟧',
    '⟧ 状态\n继续 ⟧', '⟧ 状态\r继续 ⟧', '⟧ 状态\u2028继续 ⟧', '⟧ 状态\u2029继续 ⟧',
    '⟧ {"actions":[]} ⟧', '⟧ [状态] ⟧', '⟧ `状态` ⟧', '⟧ 状态 ```json ⟧',
    '⟧ 状态 ⟧ ⟧ 另一个 ⟧', '⟧ 状态 ⟧额外说明', '额外说明⟧ 状态 ⟧'])
    assert.throws(() => parsePlan(fence + '\n' + anchor), /WRAPPER_INVALID/)
})
test('does not disclose buried ores behind a solid surface', () => {
  const states = new Map([[0, { name: 'minecraft:air', properties: {} }], [1, { name: 'minecraft:stone', properties: {} }], [2, { name: 'minecraft:diamond_ore', properties: {} }]])
  const world = { states, stateIdAt: p => p.z === -2 ? 1 : p.z < -2 ? 2 : 0 }
  const surfaces = visibleSurfaces(world, { x: 0.5, y: 64, z: 0.5 })
  assert(surfaces.some(s => s.id === 'minecraft:stone'))
  assert(!surfaces.some(s => s.id === 'minecraft:diamond_ore'))
  for (const surface of surfaces) {
    assert.equal(surface.aimSource, 'first_native_voxel_sample_not_server_ray_hit')
    assert.equal(surface.aimOffset.length, 3); assert.ok(surface.aimOffset.every(value => value >= 0 && value <= 1))
  }
})
