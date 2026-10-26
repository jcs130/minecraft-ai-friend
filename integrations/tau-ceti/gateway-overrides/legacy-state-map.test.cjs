'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { matchVanillaStates } = require('./exact-state-map.cjs')

test('matches block identity and full properties despite reordered native state IDs', () => {
  const vanilla = [
    { stateId: 10, name: 'minecraft:oak_stairs', properties: { facing: 'west', half: 'top', waterlogged: false } },
    { stateId: 11, name: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'bottom', waterlogged: false } }
  ]
  const native = [
    { stateId: 900, name: 'minecraft:oak_stairs', properties: { half: 'bottom', waterlogged: 'false', facing: 'east' } },
    { stateId: 901, name: 'minecraft:oak_stairs', properties: { half: 'top', facing: 'west', waterlogged: 'false' } }
  ]
  assert.deepEqual(matchVanillaStates(native, vanilla), { states: { 900: 11, 901: 10 }, reverseVanillaStates: { 10: 901, 11: 900 }, additionalNames: [] })
})

test('new vanilla properties fail instead of collapsing to an unrelated state', () => {
  assert.throws(() => matchVanillaStates([{ stateId: 99, name: 'minecraft:note_block', properties: { instrument: 'mod_flute' } }],
    [{ stateId: 1, name: 'minecraft:note_block', properties: { instrument: 'harp' } }]), /VANILLA_STATE_NOT_REPRESENTABLE/)
})

test('non-vanilla display mappings cannot overwrite the real vanilla reverse entry', () => {
  const result = matchVanillaStates([{ stateId: 33, name: 'minecraft:stone', properties: {} },
    { stateId: 34, name: 'create:shaft', properties: { axis: 'x' } }], [{ stateId: 1, name: 'minecraft:stone', properties: {} }])
  assert.deepEqual(result.reverseVanillaStates, { 1: 33 })
})

test('backported minecraft namespace blocks keep explicit approximate mappings', () => {
  const result = matchVanillaStates([{ stateId: 99, name: 'minecraft:pale_oak_leaves', properties: {} }],
    [{ stateId: 1, name: 'minecraft:stone', properties: {} }])
  assert.deepEqual(result, { states: {}, reverseVanillaStates: {}, additionalNames: ['minecraft:pale_oak_leaves'] })
})
