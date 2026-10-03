'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { placeNativeHeld } = require('./native-block-client.cjs')

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
