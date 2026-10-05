'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const mcData = require('minecraft-data')('1.21.1')
const mc = require('minecraft-protocol')
const NativeViewer = require('./native-viewer-packet.cjs')
const { createBackendComponentProtocol, vanillaProjection } = require('./component-protocol.cjs')
const { domumNativeTypes, MAX_ENTRIES } = require('./native-domum-codec.cjs')

const registry = (id = 64) => new Map([
  ...Object.entries(mcData.protocol.types.SlotComponentType[1].mappings).map(([id, name]) => ['minecraft:' + name, Number(id)]),
  ['domum_ornamentum:texture_data', id]
])
const protocol = createBackendComponentProtocol(registry())
// Actual private QA wire failure 2026-10-05 08:52:36 UTC, set_slot 52 bytes.
// The fixture contains only packet/window/slot IDs and material/block state;
// no player identity, chat, credentials or profile texture is copied here.
const raw = Buffer.from('150205000204dc0d020040011a6d696e6563726166743a626c6f636b2f6f616b5f706c616e6b730f350104747970650466756c6c', 'hex')
const expected = { entries: [{ componentId: 'minecraft:block/oak_planks', blockRegistryId: 15 }] }
const read = domumNativeTypes.Read.mawDomumTextureDataCodec[1]
const write = domumNativeTypes.Write.mawDomumTextureDataCodec[1]
const size = domumNativeTypes.SizeOf.mawDomumTextureDataCodec[1]
function texture (value) {
  const buffer = Buffer.alloc(size(value)); assert.equal(write(value, buffer, 0), buffer.length)
  return buffer
}

test('real native Domum set_slot decodes exact texture map and the following vanilla component', () => {
  const original = Buffer.from(raw), parsed = protocol.parsePacketBuffer('packet', raw)
  assert.equal(raw.length, 52); assert.equal(parsed.metadata.size, raw.length)
  assert.equal(parsed.data.name, 'set_slot')
  assert.equal(parsed.data.params.windowId, 2); assert.equal(parsed.data.params.stateId, 5); assert.equal(parsed.data.params.slot, 2)
  assert.equal(parsed.data.params.item.itemCount, 4); assert.equal(parsed.data.params.item.itemId, 1756)
  assert.deepEqual(parsed.data.params.item.components, [
    { type: 'domum_ornamentum:texture_data', data: expected },
    { type: 'block_state', data: { properties: [{ property: 'type', value: 'full' }] } }
  ])
  assert.deepEqual(raw, original); assert.deepEqual(parsed.buffer, original); assert.deepEqual(parsed.fullBuffer, original)
  assert.deepEqual(protocol.createPacketBuffer('packet', parsed.data), original)
})

test('original native mirror preserves full Domum map while vanilla connection omits only the mod component', async () => {
  const parsed = protocol.parsePacketBuffer('packet', raw), hash = 'b'.repeat(64)
  const envelope = NativeViewer.decodeNativePacket(NativeViewer.encodeNativePacket(parsed.data.name, parsed.data.params, hash, 1), hash)
  assert.deepEqual(envelope.params.item.components[0].data, expected)
  assert.deepEqual(protocol.createPacketBuffer('packet', { name: envelope.name, params: envelope.params }), raw)
  const front = vanillaProjection(parsed.data)
  assert.equal(front.params.item.addedComponentCount, 1)
  assert.equal(front.params.item.itemCount, 4)
  assert.deepEqual(front.params.item.components, [parsed.data.params.item.components[1]])
  assert.equal(parsed.data.params.item.addedComponentCount, 2)
  const serializer = mc.createSerializer({ state: 'play', isServer: true, version: '1.21.1' })
  const parser = mc.createDeserializer({ state: 'play', isServer: false, version: '1.21.1' })
  const done = new Promise((resolve, reject) => {
    parser.once('data', resolve); parser.once('error', reject); serializer.once('error', reject)
  })
  serializer.pipe(parser); serializer.end(front)
  const decoded = await done
  assert.deepEqual(decoded.data.params.item.components, front.params.item.components)
  assert.equal(decoded.data.params.item.itemCount, 4)
})

test('Domum map supports empty and multiple real-resource entries with full registry VarInts', () => {
  for (const value of [{ entries: [] }, { entries: [
    { componentId: 'domum_ornamentum:block/frame/oak', blockRegistryId: 16384 },
    { componentId: 'minecraft:block/birch_planks', blockRegistryId: 2147483647 }
  ] }]) {
    const encoded = texture(value), result = read(Buffer.concat([Buffer.from([42, 42]), encoded, Buffer.from([53])]), 2)
    assert.deepEqual(result.value, value); assert.equal(result.size, encoded.length)
    assert.deepEqual(texture(result.value), encoded)
  }
})

test('actual component registry ID determines Domum codec; no hardcoded network ID', () => {
  const changed = createBackendComponentProtocol(registry(440)), data = protocol.parsePacketBuffer('packet', raw).data
  const encoded = changed.createPacketBuffer('packet', data)
  assert.notDeepEqual(encoded, raw)
  const decoded = changed.parsePacketBuffer('packet', encoded)
  assert.equal(decoded.metadata.size, encoded.length)
  assert.deepEqual(decoded.data.params.item.components[0].data, expected)
  assert.equal(Object.hasOwn(mcData.protocol.types.SlotComponentType[1].mappings, '64'), false)
})

test('window zero and nested container Domum stacks preserve native fields and unrelated items', () => {
  const item = protocol.parsePacketBuffer('packet', raw).data.params.item
  const nested = { itemCount: 1, itemId: 1, addedComponentCount: 1, removedComponentCount: 0,
    components: [{ type: 'container', data: { contents: [item] } }], removeComponents: [] }
  const packet = { name: 'window_items', params: { windowId: 0, stateId: 9, items: [nested, item, { itemCount: 0 }], carriedItem: item } }
  const bytes = protocol.createPacketBuffer('packet', packet), decoded = protocol.parsePacketBuffer('packet', bytes)
  assert.equal(decoded.metadata.size, bytes.length); assert.deepEqual(protocol.createPacketBuffer('packet', decoded.data), bytes)
  const projected = vanillaProjection(decoded.data)
  assert.equal(projected.params.windowId, 0)
  assert.equal(projected.params.items[0].components[0].data.contents[0].components.length, 1)
  assert.equal(projected.params.carriedItem.components.length, 1)
  assert.deepEqual(decoded.data.params.items[0].components[0].data.contents[0].components[0].data, expected)
})

test('truncated, malformed, duplicate and over-budget Domum payloads fail before neighbouring fields', () => {
  const encoded = texture(expected)
  for (let end = 0; end < encoded.length; end++) assert.throws(() => read(encoded.subarray(0, end), 0), /TRUNCATED_DOMUM_COMPONENT/)
  for (const bytes of [Buffer.from([0x80, 0]), Buffer.from([0xff, 0xff, 0xff, 0xff, 0x7f]), Buffer.from([1, 1, 0xff, 0])]) {
    assert.throws(() => read(bytes, 0), /INVALID_DOMUM/)
  }
  assert.throws(() => read(Buffer.from([0x81, 2]), 0), /UNSUPPORTED_DOMUM_TEXTURE_ENTRY_COUNT/)
  const entry = encoded.subarray(1)
  assert.throws(() => read(Buffer.concat([Buffer.from([2]), entry, entry]), 0), /DUPLICATE_TEXTURE_COMPONENT/)
  assert.throws(() => texture({ entries: Array(MAX_ENTRIES + 1).fill(expected.entries[0]) }), /ENTRY_COUNT/)
  for (const blockRegistryId of [-1, 1.5, 2147483648]) assert.throws(() => texture({ entries: [{ ...expected.entries[0], blockRegistryId }] }), /INVALID_DOMUM_VARINT/)
  assert.throws(() => texture({ entries: [{ componentId: 'minecraft:BLOCK/oak', blockRegistryId: 15 }] }), /INVALID_DOMUM_RESOURCE/)
})

test('unimplemented mod component still fails instead of silently skipping an unknown codec', () => {
  const map = registry(); map.set('test:unknown', 440)
  const unsupported = createBackendComponentProtocol(map)
  // Replace component 64 with VarInt 440. Its bytes must never be consumed as
  // texture_data merely because it follows the same native stack header.
  const unknown = Buffer.concat([raw.subarray(0, 10), Buffer.from([0xb8, 3]), raw.subarray(11)])
  assert.throws(() => unsupported.parsePacketBuffer('packet', unknown), /UNSUPPORTED_NATIVE_ITEM_COMPONENT/)
})
