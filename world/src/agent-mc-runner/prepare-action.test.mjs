import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareAction } from './prepare-action.mjs'
const schema = properties => ({ type: 'object', properties, additionalProperties: true })
const snapshot = () => ({ ok: true, status: 'alive', menu: { windowId: 0, carried: null, selectedHotbarSlot: 2,
  slots: Array.from({ length: 46 }, (_, i) => i === 38 ? { id: 'minecraft:stone_pickaxe', count: 1, snbt: '{exact:"tool components"}' } : null) } })
test('opaque slot components are copied from the actual body without changing explicit comparison values', async () => {
  const call = async name => name === 'mc_help' ? { available: true, readOnly: false, parameters: schema({ hotbarSlot: { type: 'integer' }, expectedSnbt: { type: 'string' } }) } : snapshot()
  const base = { operation: 'inventory.selectHotbar', args: { hotbarSlot: 2 }, actionId: 'a', call, execute: () => assert.fail('no preflight mutation needed') }
  assert.equal((await prepareAction(base)).args.expectedSnbt, '{exact:"tool components"}')
  assert.equal((await prepareAction({ ...base, args: { hotbarSlot: 2, expectedSnbt: 'caller condition' } })).args.expectedSnbt, 'caller condition')
})
test('world preflight uses visible native block properties and never replaces the requested block type', async () => {
  let aimed = 0
  const call = async (name) => name === 'mc_help' ? { available: true, readOnly: false,
    parameters: schema({ expectedProperties: { type: 'object', properties: {}, additionalProperties: true }, expectedHotbarSlot: { type: 'integer' }, expectedHeldSnbt: { type: 'string' } }) } : name === 'mc_state' ? snapshot() : { ok: true, state: { status: 'allow_likely' } }
  const base = { operation: 'world.dig', args: { position: { x: 1, y: 64, z: 1 }, expectedBlockId: 'minecraft:stone' }, actionId: 'dig-a', call,
    execute: async () => { aimed++; return { ok: true, result: { position: { x: 1, y: 64, z: 1 }, block: { id: 'minecraft:stone', properties: { real: 'yes' } } } } } }
  const ready = await prepareAction(base)
  assert.equal(ready.ok, true); assert.deepEqual(ready.args.expectedProperties, { real: 'yes' }); assert.equal(ready.args.expectedHotbarSlot, 2)
  const mismatch = await prepareAction({ ...base, args: { ...base.args, expectedBlockId: 'minecraft:diamond_ore' } })
  assert.equal(mismatch.code, 'action_visible_target_mismatch'); assert.equal(mismatch.intendedActionDispatched, false); assert.equal(aimed, 2)
})
test('protection denial and a carried cursor stop preflight before digging, placing or losing an item', async () => {
  const base = { operation: 'world.dig', args: { position: { x: 1, y: 64, z: 1 }, expectedBlockId: 'minecraft:stone' }, actionId: 'denied', execute: () => assert.fail('must not dispatch'),
    call: async name => name === 'mc_help' ? { available: true, parameters: schema({}) } : name === 'mc_state' ? snapshot() : { ok: true, state: { status: 'deny' } } }
  assert.equal((await prepareAction(base)).code, 'action_protection_not_allowed')
  const carried = snapshot(); carried.menu.windowId = 5; carried.menu.carried = { id: 'minecraft:diamond', count: 1 }
  assert.equal((await prepareAction({ ...base, call: async name => name === 'mc_state' ? carried : { parameters: schema({}) } })).code, 'clear_cursor_before_action')
})

test('one entry routes discovered native reads and explicit read envelopes without dispatching a mutation', async () => {
  const calls = []
  const call = async (name, args) => { calls.push({ name, args }); return { available: true, readOnly: true, parameters: schema({ outputId: { type: 'string' } }) } }
  const base = { operation: 'native.recipes', args: { outputId: 'minecraft:wooden_pickaxe' }, actionId: 'r', call, execute: () => assert.fail('read is not an action') }
  const result = await prepareAction(base)
  assert.deepEqual(result.read, { tool: 'mc_read', args: { operation: base.operation, args: base.args } })
  assert.equal(calls.length, 1)
  const wrapped = await prepareAction({ ...base, operation: 'mc_read', args: { operation: 'native.recipes', args: {} } })
  assert.deepEqual(wrapped.read, { tool: 'mc_read', args: { operation: 'native.recipes', args: {} } })
  assert.equal(calls.length, 1)
})
