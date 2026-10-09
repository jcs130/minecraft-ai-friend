'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { EventEmitter } = require('node:events')
const { attachConstructionClient } = require('./construction-client.cjs')
const owner = '11111111-2222-3333-8444-555555555555'
const other = 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee'
function fixture () {
  const packets = [], support = new Vec3(1, 64, 0)
  const state = { playerUuid: owner, menuType: 'minecraft:inventory', selectedHotbarSlot: 0, carried: null, slots: Array(46).fill(null) }
  state.slots[36] = { id: 'create:white_sail', count: 2, snbt: '{id:"create:white_sail",count:2}' }
  let placed = false, consume = true
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(3, 64, 0) }, setQuickBarSlot: () => {}, lookAt: async () => {}, waitForTicks: async () => {},
    blockAt: pos => ({ position: pos, name: pos.equals(support) || placed ? 'stone' : 'air' }),
    _client: { uuid: owner, write (name, body) {
      packets.push({ name, body })
      if (name === 'held_item_slot') state.selectedHotbarSlot = body.slotId
      if (name === 'block_place') {
        placed = true
        if (consume) state.slots[36] = { id: 'create:white_sail', count: 1, snbt: '{id:"create:white_sail",count:1}' }
      }
    } } })
  const world = { lookAtBlock: async block => ({ ok: true, position: block.position,
    block: block.position.y === 64 ? { id: 'minecraft:stone', properties: {} } : { id: 'create:white_sail', properties: { facing: 'south' } } }) }
  const menu = { current: () => state }
  const client = attachConstructionClient(bot, menu, world)
  const args = { referencePosition: support, face: { x: 0, y: 1, z: 0 }, referenceBlockId: 'minecraft:stone', referenceProperties: {},
    hotbarSlot: 0, itemId: 'create:white_sail', blockId: 'create:white_sail', expectedSnbt: state.slots[36].snbt }
  return { client, bot, world, state, packets, args, noConsumption: () => { consume = false } }
}
test('construction cannot use another player native inventory', async () => {
  const f = fixture(); f.state.playerUuid = other
  assert.equal((await f.client.place(f.args)).ok, false)
  assert.equal(f.packets.length, 0)
})

test('default look verifies a visible lower surface when the centre is occluded; explicit aims stay explicit', async () => {
  const f = fixture(), offsets = [], ticks = []
  f.bot.waitForTicks = async count => { ticks.push(count) }
  f.world.lookAtBlock = async (block, offset) => {
    offsets.push(offset)
    return offset[1] === 0.1 ? { ok: true, position: block.position } : { ok: false, code: 'different_visible_block' }
  }
  const visible = await f.client.lookAt({ position: f.args.referencePosition })
  assert.equal(visible.ok, true); assert.deepEqual(visible.aimOffsetUsed, [0.5, 0.1, 0.5]); assert.equal(visible.raycastAttempts, 2)
  assert.deepEqual(ticks, [2])
  offsets.length = 0
  assert.equal((await f.client.lookAt({ position: f.args.referencePosition, aimOffset: [0.5, 0.5, 0.5] })).ok, false)
  assert.equal(offsets.length, 1); assert.equal(f.packets.length, 0)
})

test('blocked surfaces stay unavailable and transport errors do not cause further look attempts', async () => {
  const f = fixture(); let calls = 0
  f.world.lookAtBlock = async () => { calls++; return { ok: false, code: 'different_visible_block' } }
  const blocked = await f.client.lookAt({ position: f.args.referencePosition })
  assert.equal(blocked.ok, false); assert.equal(calls, 7); assert.match(blocked.hint, /occluded/)
  calls = 0; f.world.lookAtBlock = async () => { calls++; throw Error('connection ended') }
  assert.equal((await f.client.lookAt({ position: f.args.referencePosition })).code, 'native_look_not_observed')
  assert.equal(calls, 1)
})

test('an empty requested voxel does not masquerade as an occluded solid target or trigger seven aim attempts', async () => {
  const f = fixture(); let queries = 0
  f.bot.blockAt = position => ({ position, name: 'air' })
  f.world.lookAtBlock = async () => { queries++; return { ok: false, code: 'different_visible_block',
    position: { x: 1, y: 63, z: 0 }, block: { id: 'minecraft:cobblestone' } } }
  const receipt = await f.client.lookAt({ position: f.args.referencePosition })
  assert.equal(queries, 1); assert.equal(receipt.ok, false)
  assert.equal(receipt.block.id, 'minecraft:cobblestone'); assert.equal(receipt.position.y, 63)
  assert.equal(receipt.requestedVoxel.nativeBlockVerified, false); assert.match(receipt.hint, /AIR.*no target surface/)
  assert.equal(f.packets.length, 0)
})
test('placement rejects changed full native components before use', async () => {
  const f = fixture(); f.args.expectedSnbt = '{id:"create:white_sail",count:2,components:{test:1}}'
  const result = await f.client.place(f.args)
  assert.equal(result.code, 'native_placement_held_item_changed'); assert.equal(result.outcomeKnown, true)
  assert.equal(f.packets.filter(p => p.name === 'block_place').length, 0)
})
test('placement rejects changed support state before use', async () => {
  const f = fixture(); f.args.referenceProperties = { axis: 'x' }
  const result = await f.client.place(f.args)
  assert.equal(result.code, 'native_placement_reference_changed'); assert.equal(result.outcomeUnknown, false)
  assert.equal(f.packets.filter(p => p.name === 'block_place').length, 0)
})
test('successful native placement requires both world and consumption evidence', async () => {
  const f = fixture(), result = await f.client.place(f.args)
  assert.equal(result.ok, true); assert.equal(result.nativePlacementVerified, true)
  assert.equal(result.itemCountBefore, 2); assert.equal(result.itemCountAfter, 1)
  assert.equal(f.packets.filter(p => p.name === 'block_place').length, 1)
})
test('apparent world success without consumption is unknown and never repeated', async () => {
  const f = fixture(); f.noConsumption()
  const result = await f.client.place(f.args)
  assert.equal(result.ok, false); assert.equal(result.outcomeUnknown, true)
  assert.equal(f.packets.filter(p => p.name === 'block_place').length, 1)
})
test('native selection uses full component CAS rather than the proxy held item', async () => {
  const f = fixture()
  assert.equal((await f.client.select({ hotbarSlot: 0, expectedSnbt: 'proxy' })).code, 'native_selection_item_changed')
  assert.equal(f.packets.length, 0)
  assert.equal((await f.client.select({ hotbarSlot: 0, expectedSnbt: f.state.slots[36].snbt })).ok, true)
})
test('friendly equip moves a real crafting input to the actual empty hotbar and preserves components', async () => {
  const f = fixture(), receipts = []
  f.state.slots[1] = { id: 'minecraft:crafting_table', count: 1, snbt: '{count:1,id:"minecraft:crafting_table",components:{test:7}}' }
  f.state.mayPickup = Array(46).fill(true)
  const original = structuredClone(f.state.slots[1])
  const menu = { current: () => f.state, click: async slot => {
    receipts.push(slot); [f.state.carried, f.state.slots[slot]] = [f.state.slots[slot], f.state.carried]
    return { ok: true, changed: true, requestId: 'click-' + slot }
  } }
  const client = attachConstructionClient(f.bot, menu, f.world)
  const result = await client.equip({ sourceSlot: 1, hotbarSlot: 1, expectedId: 'minecraft:crafting_table' })
  assert.equal(result.ok, true); assert.deepEqual(receipts, [1, 37]); assert.equal(f.state.slots[1], null)
  assert.deepEqual(f.state.slots[37], original); assert.equal(f.state.selectedHotbarSlot, 1)
  assert.equal(f.state.carried, null)
  assert.equal((await client.equip({ sourceSlot: 36, hotbarSlot: 1, expectedId: 'create:white_sail' })).code, 'native_equip_hotbar_not_empty')
  assert.deepEqual(receipts, [1, 37])
})
test('friendly placement still internally checks the complete real stack when callers provide only item id', async () => {
  const f = fixture(); delete f.args.expectedSnbt
  const result = await f.client.place(f.args)
  assert.equal(result.ok, true); assert.equal(result.nativePlacementVerified, true)
  assert.equal(f.packets.filter(p => p.name === 'block_place').length, 1)
})
test('a changed tool or native unharvestable block cannot start digging', async () => {
  const f = fixture(); let digs = 0; f.bot.dig = async () => { digs++ }
  f.world.lookAtBlock = async block => ({ ok: true, position: block.position,
    block: { id: 'minecraft:stone', properties: {}, destroySpeed: 1.5, canHarvestWithMainHand: false } })
  const result = await f.client.dig({ position: f.args.referencePosition, expectedBlockId: 'minecraft:stone', expectedProperties: {},
    expectedHotbarSlot: 0, expectedHeldSnbt: f.state.slots[36].snbt })
  assert.equal(result.code, 'native_harvest_tool_required'); assert.equal(digs, 0)
})
test('verified removal does not claim that item drops were collected', async () => {
  const f = fixture(); let removed = false
  f.bot.dig = async () => { removed = true }; f.bot.waitForTicks = async () => {}
  f.bot.blockAt = pos => ({ position: pos, name: removed ? 'air' : 'stone' })
  f.world.lookAtBlock = async block => removed ? { ok: false, code: 'no_visible_block' } :
    { ok: true, position: block.position, block: { id: 'minecraft:stone', properties: {}, destroySpeed: 1.5, canHarvestWithMainHand: true } }
  const result = await f.client.dig({ position: f.args.referencePosition, expectedBlockId: 'minecraft:stone', expectedProperties: {},
    expectedHotbarSlot: 0, expectedHeldSnbt: f.state.slots[36].snbt })
  assert.equal(result.ok, true); assert.equal(result.dropsCollected, false)
})
