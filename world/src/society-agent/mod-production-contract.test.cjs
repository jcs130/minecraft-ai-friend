'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { parsePlan } = require('./plan.cjs')
const { actionIsReadOnly } = require('./action-policy.cjs')
const { agentToolCatalog } = require('./tool-catalog.cjs')
const parse = action => parsePlan(JSON.stringify({ goal: '原生制作', reason: '依据真实菜单', actions: [action] }))

test('Domum selection is a native mutation; discoveries are reads and cannot override captured state', () => {
  for (const action of [
    { type: 'domum', operation: 'state' },
    { type: 'domum', operation: 'choices', args: { groupId: 'domum_ornamentum:panel', offset: 12, limit: 24 } },
    { type: 'domum', operation: 'select', args: { selection: 'group', groupId: 'domum_ornamentum:panel' } },
    { type: 'domum', operation: 'select', args: { selection: 'variant', groupId: 'domum_ornamentum:panel', variantIndex: 3, choiceSnbt: '{id:"domum_ornamentum:panel",count:1}' } }
  ]) {
    assert.equal(parse(action).actions.length, 1)
    assert.equal(actionIsReadOnly(action), action.operation !== 'select')
  }
  const action = { type: 'domum', operation: 'select', args: { selection: 'variant', groupId: 'domum_ornamentum:panel', variantIndex: 0, choiceSnbt: '{}' } }
  for (const patch of [{ state: {} }, { groupId: 'guessed' }, { variantIndex: -1 }, { variantIndex: 4096 }, { choiceSnbt: '' }, { choiceSnbt: '界'.repeat(3000) }, { playerUuid: 'other' }]) {
    assert.throws(() => parse({ ...action, args: { ...action.args, ...patch } }), /DOMUM/)
  }
  assert.throws(() => parse({ type: 'domum', operation: 'select', args: { selection: 'group', groupId: 'domum_ornamentum:panel', variantIndex: 0 } }), /DOMUM/)
  assert.throws(() => parse({ type: 'domum', operation: 'choices', args: { groupId: 'domum_ornamentum:panel', limit: 25 } }), /DOMUM/)
  assert.match(agentToolCatalog('domum').tool.description, /不生成成品/)
})

test('collision binds a complete native state and never claims navigation integration', () => {
  const action = { type: 'collision', position: { x: 1, y: 64, z: 2 }, expectedBlockId: 'minecraft:oak_slab', expectedProperties: { type: 'bottom', waterlogged: 'false' }, aimOffset: [.5, .2, .5] }
  assert.equal(parse(action).actions.length, 1)
  assert.equal(actionIsReadOnly(action), true)
  for (const patch of [{ expectedBlockId: 'slab' }, { expectedProperties: undefined }, { expectedProperties: [] }, { expectedProperties: { type: false } }, { dimension: 'unknown' }, { aimOffset: [.5, 1.1, .5] }]) {
    assert.throws(() => parse({ ...action, ...patch }), /COLLISION|OFFSET/)
  }
  assert.match(agentToolCatalog('collision').tool.description, /尚未接入Mineflayer物理或寻路/)
})
