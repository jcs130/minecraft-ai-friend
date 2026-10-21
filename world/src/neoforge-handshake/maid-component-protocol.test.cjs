'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const nbt = require('prismarine-nbt')
const data = require('minecraft-data')('1.21.1')
const { createBackendComponentProtocol, vanillaProjection } = require('./component-protocol.cjs')
const registry = new Map(Object.entries(data.protocol.types.SlotComponentType[1].mappings)
  .map(([id, name]) => ['minecraft:' + name, Number(id)]))
registry.set('touhou_little_maid:maid_info', 120)
const protocol = createBackendComponentProtocol(registry)

test('captured maid compound decodes without consuming the following inventory slot', () => {
  // Independent CustomData wire: root type COMPOUND, with no root name.
  const saved = { type: 'compound', name: '', value: {
    ModelId: { type: 'string', value: 'touhou_little_maid:hakurei_reimu' },
    Owner: { type: 'intArray', value: [1, -2, 3, -4] },
    UUID: { type: 'intArray', value: [-5, 6, -7, 8] },
    Health: { type: 'float', value: 18 },
    Inventory: { type: 'list', value: { type: 'compound', value: [
      { Slot: { type: 'byte', value: 2 }, id: { type: 'string', value: 'minecraft:apple' }, count: { type: 'int', value: 4 } }
    ] } }
  } }
  const named = nbt.writeUncompressed(saved, 'big')
  const compound = Buffer.concat([named.subarray(0, 1), named.subarray(3)])
  const raw = Buffer.concat([
    // window_items, window 3, state 8, two stacks; native item 100, component 120.
    Buffer.from([0x13, 3, 8, 2, 1, 100, 1, 0, 120]), compound,
    Buffer.from([2, 1, 0, 0, 0]) // two stone, then empty carried stack.
  ])
  const parsed = protocol.parsePacketBuffer('packet', raw)
  assert.equal(parsed.metadata.size, raw.length)
  const item = parsed.data.params.items[0]
  assert.equal(item.components[0].type, 'touhou_little_maid:maid_info')
  assert.equal(nbt.simplify(item.components[0].data).ModelId, saved.value.ModelId.value)
  assert.deepEqual(nbt.simplify(item.components[0].data).Owner, [1, -2, 3, -4])
  assert.equal(parsed.data.params.items[1].itemCount, 2)
  assert.equal(parsed.data.params.items[1].itemId, 1)
  assert.equal(parsed.data.params.carriedItem.itemCount, 0)
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), raw)
  assert.deepEqual(vanillaProjection(parsed.data).params.items[0].components, [])
  assert.equal(item.components.length, 1)
  assert.throws(() => protocol.parsePacketBuffer('packet', raw.subarray(0, raw.length - 8)))
})
