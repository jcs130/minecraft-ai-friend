'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const mc = require('minecraft-protocol')
const { BedrockItems, KEY } = require('./bedrock-items.cjs')
const { createBackendComponentProtocol } = require('./component-protocol.cjs')
const catalog = { schemaVersion: 1, items: [{ nativeId: 4500, nativeItem: 'example:meal',
  displayName: '原模组料理', customModelData: 8004500 }] }
const item = (components = []) => ({ itemCount: 3, itemId: 4500, components,
  addedComponentCount: components.length, removeComponents: [], removedComponentCount: 0 })

test('advancement icons pass through original item identity projection without leaking native component IDs',()=>{
  const adapter=new BedrockItems(catalog),original=item([{type:'example:spell',data:{level:12}}])
  const input={reset:true,advancementMapping:[{key:'example:root',value:{displayData:{icon:original}}}],progressMapping:[]}
  const out=adapter.outgoing('advancements',input),icon=out.advancementMapping[0].value.displayData.icon
  assert(icon.components.some(c=>c.type==='custom_model_data'&&c.data===8004500))
  assert.equal(icon.components.some(c=>c.type.includes(':')),false)
  assert.deepEqual(adapter.incoming('window_click',{cursorItem:icon}).cursorItem,original)
  assert.equal(input.advancementMapping[0].value.displayData.icon.components[0].type,'example:spell')
})

test('native dye-color varints select every book variant and survive the inventory round trip', () => {
  const colors = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']
  const row = { ...catalog.items[0], variantComponent: 'base_color', variantDefault: 'purple',
    variants: Object.fromEntries(colors.map((color, i) => [color, { customModelData: 9000000 + i }])) }
  const adapter = new BedrockItems({ schemaVersion: 1, items: [row] })
  for (const [n, color] of colors.entries()) {
    const original = item([{ type: 'base_color', data: n }, { type: 'ars_nouveau:spell_book', data: { recipe: 'original' } }])
    const out = adapter.outgoing('set_slot', { item: original }).item
    assert.equal(out.components.find(c => c.type === 'custom_model_data').data, row.variants[color].customModelData)
    assert.deepEqual(adapter.incoming('window_click', { cursorItem: out }).cursorItem, original)
  }
  assert.equal(adapter.outgoing('set_slot', { item: item() }).item.components.find(c => c.type === 'custom_model_data').data, row.variants.purple.customModelData)
  assert.throws(() => adapter.outgoing('set_slot', { item: item([{ type: 'base_color', data: 16 }]) }), /VARIANT_UNSUPPORTED/)
  assert.throws(() => new BedrockItems({ schemaVersion: 1, items: [{ ...row, variantDefault: 'ultraviolet' }] }), /VARIANTS/)
  const invalid = structuredClone(row); invalid.variants.black.customModelData = invalid.variants.red.customModelData
  assert.throws(() => new BedrockItems({ schemaVersion: 1, items: [invalid] }), /VARIANT_MARKER/)
})

test('the resource catalog must match this connection actual frozen registry, not only a stale ID map', () => {
  const adapter = new BedrockItems(catalog)
  assert.throws(() => adapter.verifyRegistry(new Map([[4500, 'another:meal']])), /REGISTRY_MISMATCH/)
  adapter.verifyRegistry(new Map([[4500, 'example:meal']]))
  assert.equal(adapter.stats.registryVerified, true)
})

test('Bedrock display is a copy; native data survives split/merge and mod component filtering', () => {
  const adapter = new BedrockItems(catalog)
  const original = item([{ type: 'example:spell', data: { id: 'example:private_spell', level: 12 } },
    { type: 'custom_model_data', data: 123 }, { type: 'custom_data', data: { type: 'compound', value: { owner: { type: 'string', value: 'a' } } } }])
  const before = structuredClone(original)
  const out = adapter.outgoing('set_slot', { windowId: 0, item: original }).item
  assert.deepEqual(original, before)
  assert.equal(out.components.find(c => c.type === 'custom_model_data').data, 8004500)
  assert.equal(out.components.find(c => c.type === 'item_name').data.value, '原模组料理')
  assert.ok(!out.components.some(c => c.type.includes(':')))
  out.itemId = 1091; out.itemCount = 1
  const restored = adapter.incoming('window_click', { cursorItem: out, changedSlots: [{ slot: 9, item: { itemCount: 0 } }] })
  assert.deepEqual(restored.cursorItem, { ...before, itemCount: 1 })
  assert.deepEqual(restored.changedSlots[0].item, { itemCount: 0 })
})

test('different native spell variants receive different identity tokens even with identical visible icon', () => {
  const adapter = new BedrockItems(catalog)
  const native = ['spell_a', 'spell_b'].map(data => item([{ type: 'example:spell', data }]))
  const projected = native.map(i => adapter.outgoing('set_slot', { item: i }).item)
  assert.notEqual(projected[0].components.find(c => c.type === 'custom_data').data.value[KEY].value,
    projected[1].components.find(c => c.type === 'custom_data').data.value[KEY].value)
  projected.forEach((i, n) => assert.deepEqual(adapter.incoming('window_click', { cursorItem: i }).cursorItem, native[n]))
})

test('a foreign/missing token cannot turn a native mod item into paper or forge native components', () => {
  const first = new BedrockItems(catalog); const other = new BedrockItems(catalog)
  const projected = first.outgoing('window_items', { items: [item()] }).items[0]
  assert.throws(() => other.incoming('window_click', { cursorItem: projected }), /IDENTITY_UNAVAILABLE/)
  assert.throws(() => first.incoming('window_click', { cursorItem: item() }), /IDENTITY_UNAVAILABLE/)
  projected.components.push({ type: 'example:forged', data: 'bad' })
  assert.deepEqual(first.incoming('window_click', { cursorItem: projected }).cursorItem, item())
  assert.throws(() => first.incoming('set_creative_slot', { slot: 1, item: projected }), /UNSUPPORTED/)
})

test('all vanilla stacks also preserve actual native IDs, names and opaque byte values', () => {
  const adapter = new BedrockItems(catalog)
  const original = item([{ type: 'custom_name', data: { type: 'string', value: '个人装备' } },
    { type: 'example:bytes', data: Buffer.from([1, 2, 3]) }]); original.itemId = 111
  const projected = adapter.outgoing('set_slot', { item: original }).item
  assert.ok(!projected.components.some(c => c.type === 'custom_model_data'))
  assert.equal(projected.components.find(c => c.type === 'custom_name').data.value, '个人装备')
  assert.deepEqual(adapter.incoming('window_click', { cursorItem: projected }).cursorItem, original)
  assert.deepEqual(adapter.outgoing('update_time', { time: 1 }), { time: 1 })
})

test('custom data token, native name and CMD serialize with the real installed Java 1.21.1 codec', () => {
  const adapter = new BedrockItems(catalog)
  const projected = adapter.outgoing('set_slot', { item: item() }).item
  const serializer = mc.createSerializer({ state: mc.states.PLAY, isServer: true, version: '1.21.1' })
  const deserializer = mc.createDeserializer({ state: mc.states.PLAY, isServer: false, version: '1.21.1' })
  const packet = { name: 'set_slot', params: { windowId: 0, stateId: 1, slot: 36, item: projected } }
  const decoded = deserializer.parsePacketBuffer(serializer.createPacketBuffer(packet)).data.params.item
  assert.deepEqual(adapter.incoming('window_click', { cursorItem: decoded }).cursorItem, item())
})

test('restored mod patches use the backend serverbound codec, not the vanilla component encoder', () => {
  const data = require('minecraft-data')('1.21.1')
  const registry = new Map(Object.entries(data.protocol.types.SlotComponentType[1].mappings)
    .map(([id, name]) => ['minecraft:' + name, Number(id)]))
  registry.set('patchouli:book', 88)
  const codec = createBackendComponentProtocol(registry, null, null, 'toServer')
  const adapter = new BedrockItems(catalog)
  const native = item([{ type: 'patchouli:book', data: 'touhou_little_maid:memorizable_gensokyo' }])
  const displayed = adapter.outgoing('set_slot', { item: native }).item
  const params = adapter.incoming('window_click', { windowId: 0, stateId: 3, slot: 37, mouseButton: 0, mode: 0,
    changedSlots: [{ location: 37, item: { itemCount: 0 } }], cursorItem: displayed })
  const bytes = codec.createPacketBuffer('packet', { name: 'window_click', params })
  const result = codec.parsePacketBuffer('packet', bytes)
  assert.equal(result.metadata.size, bytes.length)
  assert.deepEqual(result.data.params.cursorItem, native)
  assert.equal(result.data.params.changedSlots[0].location, 37)
})
