'use strict'

// Server-side presentation only. Authoritative stacks and block states are never
// replaced in the backend world. Carrier IDs are not reverse-mapped into items.
const stateKey = (name, props) => JSON.stringify([name, Object.entries(props).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, String(v)])])
const shapeKey = (boxes, occludes) => JSON.stringify([occludes, boxes])
const text = value => ({ type: 'compound', value: { text: { type: 'string', value } } })
const empty = () => ({ itemCount: 0 })
const SAFE_COMPONENTS = new Set(['custom_data', 'custom_name', 'item_name', 'lore', 'max_stack_size',
  'max_damage', 'damage', 'unbreakable', 'rarity', 'enchantments', 'stored_enchantments', 'repair_cost',
  'enchantment_glint_override', 'food', 'consumable', 'use_cooldown', 'potion_contents',
  'potion_duration_scale', 'profile', 'dyed_color', 'attribute_modifiers', 'tooltip_display'])

class Projection {
  constructor (native, vanilla, req) {
    this.native = native
    this.vanilla = vanilla
    this.items = new Map(native.items.map(row => [row.id, row]))
    this.states = new Map(native.states.map(row => [row.id, row]))
    this.entities = new Map(native.entities.map(row => [row.id, row]))
    this.blockMap = new Map()
    this.entityMap = new Map()
    this.itemMap = new Map()
    this.counters = { exactBlocks: 0, shapeCarriers: 0, unknownCollision: 0 }
    const Block = req('prismarine-block')(vanilla)
    const byState = new Map()
    const byShape = new Map()
    for (const block of vanilla.blocksArray) {
      for (let id = block.minStateId; id <= block.maxStateId; id++) {
        const state = Block.fromStateId(id)
        byState.set(stateKey('minecraft:' + block.name, state.getProperties()), id)
        if (Array.isArray(state.shapes) && !['air', 'cave_air', 'void_air', 'water', 'lava'].includes(block.name)) {
          const key = shapeKey(state.shapes, !block.transparent)
          if (!byShape.has(key)) byShape.set(key, id)
        }
      }
    }
    for (const name of ['short_grass', 'glass', 'stone']) {
      const block = vanilla.blocksByName[name]
      if (block) byShape.set(shapeKey(Block.fromStateId(block.defaultState).shapes, !block.transparent), block.defaultState)
    }
    const barrier = vanilla.blocksByName.barrier.defaultState
    for (const row of native.states) {
      let state = byState.get(stateKey(row.name, row.properties))
      let status = 'same_vanilla_identity'
      if (state === undefined) {
        state = row.shapeAvailable ? byShape.get(shapeKey(row.collisionShapes, row.canOcclude)) : undefined
        status = state === undefined ? 'unknown_conservative_carrier' : 'matching_static_shape_carrier'
      }
      if (state === undefined) state = barrier
      this.blockMap.set(row.id, { stateId: state, status,
        collision: status === 'same_vanilla_identity' ? 'vanilla_semantics' : status === 'matching_static_shape_carrier' ? 'static_shape_only' : 'unknown' })
      this.counters[status === 'same_vanilla_identity' ? 'exactBlocks' : status === 'matching_static_shape_carrier' ? 'shapeCarriers' : 'unknownCollision']++
    }
    for (const row of native.items) {
      const name = row.name.replace(/^minecraft:/, '')
      const actualVanilla = row.name.startsWith('minecraft:') && vanilla.itemsByName[name]
      const carrier = actualVanilla || (row.food ? vanilla.itemsByName.bread : vanilla.itemsByName.paper)
      if (!carrier) throw new Error('missing_vanilla_item_carrier')
      this.itemMap.set(row.id, { id: carrier.id, name: carrier.name, exact: !!actualVanilla })
    }
    for (const row of native.entities) {
      const actualVanilla = row.name.startsWith('minecraft:') && vanilla.entitiesByName[row.name.slice(10)]
      const carrier = actualVanilla || vanilla.entitiesByName.armor_stand
      this.entityMap.set(row.id, { id: carrier.id, name: carrier.name, exact: !!actualVanilla })
    }
  }

  block (stateId) {
    const row = this.blockMap.get(stateId)
    if (!row) throw new Error('unknown_native_block_state:' + stateId)
    return row
  }

  slotInfo (slot) {
    if (!slot?.itemCount) return null
    const row = this.items.get(slot.itemId)
    if (!row) throw new Error('unknown_native_item:' + slot.itemId)
    const carrier = this.itemMap.get(slot.itemId)
    return { nativeId: row.name, nativeType: row.id, count: slot.itemCount, translationKey: row.translationKey,
      food: row.food || null, foodSource: 'registry_default',
      componentsArePacketOverrides: true, defaultComponents: null,
      carrier: { protocol: '26.3', intermediateType: carrier.id, intermediateName: carrier.name, exactNativeIdentity: carrier.exact, finalClientType: null },
      components: (slot.components || []).map(component => ({ type: component.type, data: jsonValue(component.data) })),
      removedComponents: slot.removeComponents || [] }
  }

  slot (slot) {
    if (!slot?.itemCount) return empty()
    if (!Number.isSafeInteger(slot.itemCount) || slot.itemCount < 1 || slot.itemCount > 2147483647) throw new Error('invalid_native_stack_count')
    const row = this.items.get(slot.itemId)
    const carrier = this.itemMap.get(slot.itemId)
    if (!row || !carrier) throw new Error('unknown_native_item:' + slot.itemId)
    const canProject = component => SAFE_COMPONENTS.has(component.type) && (component.type !== 'attribute_modifiers' ||
      (Array.isArray(component.data) && component.data.every(modifier => Number.isInteger(modifier.typeId) && modifier.typeId >= 0 && modifier.typeId < this.vanilla.attributesArray.length)))
    const components = (slot.components || []).filter(canProject).map(component => ({ ...component }))
    const omitted = (slot.components || []).filter(component => !canProject(component)).map(component => component.type)
    const metadata = { type: 'compound', value: {
      id: { type: 'string', value: row.name }, native_type: { type: 'int', value: row.id },
      carrier: { type: 'string', value: 'minecraft:' + carrier.name },
      carrier_protocol: { type: 'string', value: '26.3' },
      exact_identity: { type: 'byte', value: carrier.exact ? 1 : 0 },
      omitted_components: { type: 'list', value: { type: 'string', value: omitted } }
    } }
    const previousData = components.find(component => component.type === 'custom_data')
    if (previousData && previousData.data?.type !== 'compound') throw new Error('unsupported_custom_data_shape')
    const nativeData = { type: 'compound', value: { ...previousData?.data?.value, maw_native: metadata } }
    const dataIndex = components.findIndex(component => component.type === 'custom_data')
    if (dataIndex >= 0) components.splice(dataIndex, 1)
    components.push({ type: 'custom_data', data: nativeData })
    if (!carrier.exact) {
      const name = components.find(component => component.type === 'custom_name')
      if (!name) components.push({ type: 'custom_name', data: text(row.name) })
      const loreIndex = components.findIndex(component => component.type === 'lore')
      const oldLore = loreIndex >= 0 ? components.splice(loreIndex, 1)[0].data : []
      components.push({ type: 'lore', data: [...oldLore.slice(0, 24), text('原生物品 ' + row.name), text('载体 minecraft:' + carrier.name + '；真实能力用 /agent 查询')] })
    }
    const supported = new Set(Object.values(this.vanilla.protocol.types.SlotComponentType[1].mappings))
    const removed = (slot.removeComponents || []).filter(component => supported.has(component.type) && !['custom_name', 'custom_data', 'lore'].includes(component.type))
    return { ...slot, itemId: carrier.id, components, addedComponentCount: components.length,
      removeComponents: removed, removedComponentCount: removed.length }
  }

  menu (layout) {
    const own = layout.inventoryStart
    if (!Number.isInteger(own) || own < 1 || own > 54 || layout.inventoryEnd !== own + 36 || layout.slotCount !== own + 36) {
      throw new Error('native_menu_not_projectable_as_standard_inventory')
    }
    const carrierOwn = Math.ceil(own / 9) * 9
    const rows = carrierOwn / 9
    return { ...layout, own, carrierOwn, carrierTotal: carrierOwn + 36,
      // Fixed vanilla 26.3 generic_9x1 .. generic_9x6 menu IDs.
      carrierType: rows - 1,
      toNativeSlot: slot => {
        if (slot === -999) return slot
        if (!Number.isInteger(slot) || slot < 0 || slot >= carrierOwn + 36 || (slot >= own && slot < carrierOwn)) throw new Error('padding_or_invalid_menu_slot')
        return slot >= carrierOwn ? slot - carrierOwn + own : slot
      },
      toCarrierSlot: slot => slot >= own ? slot - own + carrierOwn : slot }
  }
}

function jsonValue (value) {
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { bytes: value.length }
  if (Array.isArray(value)) return value.map(jsonValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]))
  return value
}

module.exports = { Projection, stateKey, shapeKey, text, empty, jsonValue }
