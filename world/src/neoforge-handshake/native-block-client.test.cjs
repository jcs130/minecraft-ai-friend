'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { placeNativeHeld } = require('./native-block-client.cjs')
const { Vec3 } = require('vec3')

test('a proxy item never authorizes placement of the wrong native item', async () => {
  const packets = []
  const pos = { offset: () => pos }
  const bot = {
    entity: { position: { distanceTo: () => 1 } },
    setQuickBarSlot: () => {},
    _client: { write: (name, body) => packets.push({ name, body }) }
  }
  const menu = { current: () => ({ menuType: 'minecraft:inventory', selectedHotbarSlot: 4,
    slots: Array.from({ length: 46 }, (_, slot) => slot === 40 ? { id: 'minecraft:stone', count: 1 } : null) }) }
  const result = await placeNativeHeld(bot, menu, {}, { hotbarSlot: 4, itemId: 'create:shaft',
    expectedBlockId: 'create:shaft', referenceBlock: { position: pos }, face: { x: 0, y: 1, z: 0 } })
  assert.equal(result.code, 'native_item_not_selected')
  assert.equal(packets.some(packet => packet.name === 'block_place'), false)
})

test('occupied target is not clicked again after an uncertain placement', async () => {
  const packets = []
  const pos = { offset: () => pos }
  const bot = {
    entity: { position: { distanceTo: () => 1 } },
    setQuickBarSlot: () => {},
    blockAt: () => ({ name: 'stone' }),
    _client: { write: (name, body) => packets.push({ name, body }) }
  }
  const menu = { current: () => ({ menuType: 'minecraft:inventory', selectedHotbarSlot: 4,
    slots: Array.from({ length: 46 }, (_, slot) => slot === 40 ? { id: 'create:shaft', count: 1 } : null) }) }
  const result = await placeNativeHeld(bot, menu, {}, { hotbarSlot: 4, itemId: 'create:shaft',
    expectedBlockId: 'create:shaft', referenceBlock: { position: pos }, face: { x: 0, y: 1, z: 0 } })
  assert.equal(result.code, 'destination_not_air')
  assert.equal(packets.some(packet => packet.name === 'block_place'), false)
})

test('thin native block verification aims at its actual shape and sends placement once', async () => {
  const packets = [], support = new Vec3(4, 63, -5), destination = support.offset(0, 1, 0)
  const state = { menuType: 'minecraft:inventory', selectedHotbarSlot: 8, slots: Array(46).fill(null) }
  state.slots[44] = { id: 'farmersdelight:cutting_board', count: 1 }
  const bot = { entity: { position: new Vec3(5, 64, -6) }, setQuickBarSlot: () => {},
    lookAt: async () => {}, blockAt: pos => ({ name: packets.some(p => p.name === 'block_place') ? 'stone' : 'air', position: pos }),
    _client: { write: (name, body) => { packets.push({ name, body }); if (name === 'block_place') state.slots[44] = null } } }
  const calls = []
  const world = { lookAtBlock: async (block, offset) => {
    calls.push({ position: block.position, offset })
    return { ok: true, position: destination, block: { id: 'farmersdelight:cutting_board' } }
  } }
  const result = await placeNativeHeld(bot, { current: () => state }, world, {
    hotbarSlot: 8, itemId: 'farmersdelight:cutting_board', expectedBlockId: 'farmersdelight:cutting_board',
    referenceBlock: { position: support }, face: new Vec3(0, 1, 0), verificationOffset: [0.5, 0.05, 0.5]
  })
  assert.equal(result.ok, true)
  assert.equal(result.itemCountAfter, 0)
  assert.deepEqual(calls, [{ position: destination, offset: [0.5, 0.05, 0.5] }])
  assert.equal(packets.filter(p => p.name === 'block_place').length, 1)
})

test('a workstation opening stops placement verification without using its inventory slots', async () => {
  const packets = [], support = new Vec3(3, 64, -5)
  let state = { menuType: 'minecraft:inventory', selectedHotbarSlot: 8, slots: Array(46).fill(null) }
  state.slots[44] = { id: 'farmersdelight:cutting_board', count: 1 }
  const bot = { entity: { position: new Vec3(4, 64, -6) }, setQuickBarSlot: () => {},
    lookAt: async () => {}, blockAt: pos => ({ name: 'air', position: pos }),
    _client: { write: (name, body) => { packets.push({ name, body }); if (name === 'block_place') state = { menuType: 'minecraft:crafting' } } } }
  const result = await placeNativeHeld(bot, { current: () => state }, { lookAtBlock: async () => { throw Error('should not raycast an opened menu') } }, {
    hotbarSlot: 8, itemId: 'farmersdelight:cutting_board', expectedBlockId: 'farmersdelight:cutting_board',
    referenceBlock: { position: support }, face: new Vec3(0, 1, 0)
  })
  assert.equal(result.code, 'placement_opened_menu')
  assert.equal(result.menuType, 'minecraft:crafting')
  assert.equal(result.retryAutomatically, false)
  assert.equal(packets.filter(p => p.name === 'block_place').length, 1)
})
