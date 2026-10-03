'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const mcData = require('minecraft-data')('1.21.1')
const mc = require('minecraft-protocol')
const { registryFromTsv, createBackendComponentProtocol, vanillaProjection, isItemPacket, disconnectComponent } = require('./component-protocol.cjs')
const vanilla = mcData.protocol.types.SlotComponentType[1].mappings
const registry = new Map(Object.entries(vanilla).map(([id, name]) => ['minecraft:' + name, Number(id)]))
registry.set('touhou_little_maid:init_maid_owner', 86)
registry.set('patchouli:book', 88)
registry.set('test:unsupported', 89)
const protocol = createBackendComponentProtocol(registry)
const empty = { itemCount: 0 }
const stack = (itemId, components) => ({ itemCount: 1, itemId, addedComponentCount: components.length, removedComponentCount: 0, components, removeComponents: [] })
const owner = '600c9882-ac6c-4620-a5c8-2ec6588aa3b9'
const maid = stack(1400, [{ type: 'touhou_little_maid:init_maid_owner', data: owner }])
const book = stack(1401, [{ type: 'patchouli:book', data: 'touhou_little_maid:memorizable_gensokyo' }])

test('decodes native UUID and guidebook components without changing the vanilla protocol', async () => {
  const packet = { name: 'window_items', params: { windowId: 0, stateId: 7, items: [maid, book, empty], carriedItem: empty } }
  const buffer = protocol.createPacketBuffer('packet', packet)
  assert.equal(isItemPacket(buffer), true)
  const parsed = protocol.parsePacketBuffer('packet', buffer)
  assert.equal(parsed.metadata.size, buffer.length)
  assert.equal(parsed.data.params.items[0].components[0].data, owner)
  assert.equal(parsed.data.params.items[1].components[0].data, 'touhou_little_maid:memorizable_gensokyo')
  assert.equal(Object.hasOwn(mcData.protocol.types.SlotComponentType[1].mappings, '86'), false)
  const projected = vanillaProjection(parsed.data)
  assert.equal(projected.params.items[0].addedComponentCount, 0)
  assert.equal(projected.params.items[0].itemCount, 1)
  assert.equal(parsed.data.params.items[0].components.length, 1)
  const serializer = mc.createSerializer({ state: 'play', isServer: true, version: '1.21.1' })
  const parser = mc.createDeserializer({ state: 'play', isServer: false, version: '1.21.1' })
  const result = new Promise((resolve, reject) => { parser.once('data', resolve); parser.once('error', reject); serializer.once('error', reject) })
  serializer.pipe(parser)
  serializer.end(projected)
  const front = await result
  assert.equal(front.data.params.items[0].itemCount, 1)
  assert.equal(front.data.params.items[0].components.length, 0)
})

test('recursively projects nested container stacks while preserving names and component removals', () => {
  const name = { type: 'custom_name', data: { type: 'string', value: '女仆召唤道具' } }
  const container = stack(1, [{ type: 'container', data: { items: [maid] } }, name])
  container.removeComponents = [{ type: 'patchouli:book' }, { type: 'lore' }]
  container.removedComponentCount = 2
  const front = vanillaProjection(container)
  assert.equal(front.components[0].data.items[0].components.length, 0)
  assert.deepEqual(front.components[1], name)
  assert.equal(front.removedComponentCount, 1)
  assert.deepEqual(front.removeComponents, [{ type: 'lore' }])
  assert.equal(container.components[0].data.items[0].components.length, 1)
})

test('an unsupported native codec explicitly fails instead of consuming a neighbouring stack', () => {
  const packet = { name: 'set_slot', params: { windowId: 0, stateId: 1, slot: 36, item: empty } }
  const emptyPacket = protocol.createPacketBuffer('packet', packet)
  const buffer = Buffer.concat([emptyPacket.subarray(0, -1), Buffer.from([1, 1, 1, 0, 89, 123])])
  assert.throws(() => protocol.parsePacketBuffer('packet', buffer), /UNSUPPORTED_NATIVE_ITEM_COMPONENT/)
})

test('does not route mod command trees or regular keepalive packets through the item decoder', () => {
  assert.equal(isItemPacket(Buffer.from([0x11])), false)
  assert.equal(isItemPacket(Buffer.from([0x26])), false)
})

test('registry export rejects duplicate IDs, missing vanilla types and malformed rows', () => {
  assert.throws(() => registryFromTsv('minecraft:custom_data\t0\npatchouli:book\t0'), /INVALID/)
  assert.throws(() => registryFromTsv('patchouli:book\tbad'), /INVALID/)
  assert.throws(() => createBackendComponentProtocol(new Map()), /MISSING_VANILLA/)
  assert.equal(registryFromTsv('patchouli:book\t88').get('patchouli:book'), 88)
})

test('the explicit incompatibility reason remains readable NBT in play and configuration', async () => {
  for (const [state, name] of [['play', 'kick_disconnect'], ['configuration', 'disconnect']]) {
    const message = '模组物品协议尚未适配，无法安全同步背包'
    const serializer = mc.createSerializer({ state, isServer: true, version: '1.21.1' })
    const parser = mc.createDeserializer({ state, isServer: false, version: '1.21.1' })
    const result = new Promise((resolve, reject) => { parser.once('data', resolve); parser.once('error', reject); serializer.once('error', reject) })
    serializer.pipe(parser)
    serializer.end({ name, params: { reason: disconnectComponent(message) } })
    assert.equal((await result).data.params.reason.value.text.value, message)
  }
})
