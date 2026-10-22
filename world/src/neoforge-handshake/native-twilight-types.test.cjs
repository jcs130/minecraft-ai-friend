'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const mcData = require('minecraft-data')('1.21.1')
const { createBackendComponentProtocol, vanillaProjection } = require('./component-protocol.cjs')
const { twilightComponentCodecs, twilightNativeTypes } = require('./native-twilight-types.cjs')
const vanillaFields = mcData.protocol.types.SlotComponent[1][1].type[1].fields
const fields = twilightComponentCodecs(vanillaFields)
const registry = new Map(Object.entries(mcData.protocol.types.SlotComponentType[1].mappings).map(([id, name]) => ['minecraft:' + name, Number(id)]))
Object.keys(fields).forEach((name, index) => registry.set(name, 1000 + index))
const backend = createBackendComponentProtocol(registry)
const empty = { itemCount: 0 }
function stack(components) { return { itemCount: 1, itemId: 1400, addedComponentCount: components.length, removedComponentCount: 0, components, removeComponents: [] } }
test('all 47 audited Twilight components keep the following inventory slot aligned', () => {
  assert.equal(Object.keys(fields).length, 47)
  const special = {
    thrown_projectile: '600c9882-ac6c-4620-a5c8-2ec6588aa3b9', e115_variant: 'middle',
    candelabra_data: { type: 'compound', value: {} }, jar_lid: { type: 'string', value: 'minecraft:oak_planks' },
    ore_scanner: { type: 'compound', value: {} },
    stored_broken_attributes: { attributes: [], showTooltip: true },
    flask_contents: { potion: { customEffects: [] }, doses: 4, breakage: 0, breakable: false },
    skull_candles: { color: 7, count: 3 },
    ore_data: { counts: [{ name: 'minecraft:diamond_ore', count: 200 }], scannedChunk: [0x1234567, 0x89abcdef], scannedBlockCount: 600, universalId: [-1, 0xffffffff] },
    sidestep_cooldown: [0x1234567, 0x89abcdef], item_display: { items: [empty], chosenMapSlot: 0 }
  }
  const components = Object.entries(fields).map(([type, schema]) => ({ type, data: Object.hasOwn(special, type.split(':')[1])
    ? special[type.split(':')[1]] : schema === 'void' ? undefined : schema === 'f32' || schema === 'f64' ? 0.5 : 12 }))
  const packet = { name: 'window_items', params: { windowId: 0, stateId: 77,
    items: [stack(components), stack([{ type: 'custom_name', data: { type: 'string', value: 'following slot' } }])], carriedItem: empty } }
  const bytes = backend.createPacketBuffer('packet', packet), decoded = backend.parsePacketBuffer('packet', bytes)
  assert.equal(decoded.metadata.size, bytes.length)
  const parsed = decoded.data.params.items[0].components
  assert.equal(parsed.length, 47)
  assert.deepEqual(parsed.find(c => c.type === 'twilightforest:sidestep_cooldown').data, special.sidestep_cooldown)
  assert.deepEqual(parsed.find(c => c.type === 'twilightforest:ore_data').data, special.ore_data)
  assert.equal(decoded.data.params.items[1].components[0].data.value, 'following slot')
  assert.equal(vanillaProjection(decoded.data).params.items[0].addedComponentCount, 0)
  assert.equal(decoded.data.params.items[0].addedComponentCount, 47)
})
test('Twilight list allocation counts reject negative, oversized and truncated values', () => {
  const read = twilightNativeTypes.Read.mawTwilightCount[1]
  assert.throws(() => read(Buffer.from([255, 255, 255, 255, 15]), 0), /INVALID_TWILIGHT_COMPONENT_COUNT/)
  assert.throws(() => read(Buffer.from([129, 32]), 0), /INVALID_TWILIGHT_COMPONENT_COUNT/)
  assert.throws(() => read(Buffer.from([128]), 0), /TRUNCATED_TWILIGHT_COMPONENT_COUNT/)
  assert.equal(read(Buffer.from([128, 32]), 0).value, 4096)
})
test('Twilight custom entity serializers preserve registry variants and bounded string lists', () => {
  const serializers = new Map([['twilightforest:tiny_bird_variant', 301], ['twilightforest:dwarf_rabbit_variant', 302],
    ['twilightforest:magic_painting_variant', 303], ['twilightforest:string_list', 304]])
  const protocol = createBackendComponentProtocol(registry, null, serializers)
  const packet = { name: 'entity_metadata', params: { entityId: 4, metadata: [
    { key: 18, type: 'twilightforest:tiny_bird_variant', value: 3 },
    { key: 19, type: 'twilightforest:string_list', value: ['a', 'b'] }
  ] } }
  const bytes = protocol.createPacketBuffer('packet', packet), decoded = protocol.parsePacketBuffer('packet', bytes)
  assert.equal(decoded.metadata.size, bytes.length)
  assert.deepEqual(decoded.data.params.metadata, packet.params.metadata)
  assert.equal(vanillaProjection(decoded.data).params.metadata.length, 0)
})
