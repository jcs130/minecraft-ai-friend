'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')
const v8 = require('node:v8')
const { vanillaProjection } = require('./component-protocol.cjs')
const KEY = 'maw_bedrock_view'
const PACKETS = new Set(['window_items', 'set_slot', 'entity_equipment', 'trade_list', 'world_particles', 'entity_metadata'])
const clone = value => Buffer.isBuffer(value) ? Buffer.from(value)
  : Array.isArray(value) ? value.map(clone)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value

// A display marker is never a new server item. The exact native component
// patch is retained per connection and recovered on inventory replies. Never
// reverse a many-to-one paper/stone mapping to guess a native mod ItemStack.
class BedrockItems {
  constructor (catalog = { schemaVersion: 1, items: [] }) {
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.items)) throw Error('INVALID_BEDROCK_ITEM_CATALOG')
    this.items = new Map(); this.tokens = new Map(); this.variants = new Map()
    this.stats = { nativeItemsProjected: 0, exactStacksRestored: 0, registryVerified: false }
    for (const row of catalog.items) {
      if (!Number.isInteger(row.nativeId) || this.items.has(row.nativeId) ||
          !Number.isInteger(row.customModelData) || row.customModelData < 8000000 || row.customModelData >= 2 ** 24 ||
          !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(row.nativeItem) || typeof row.displayName !== 'string') {
        throw Error('INVALID_BEDROCK_ITEM_DEFINITION')
      }
      this.items.set(row.nativeId, row)
    }
  }

  static load (path) { return new BedrockItems(path ? JSON.parse(fs.readFileSync(path, 'utf8')) : undefined) }

  verifyRegistry (registry) {
    for (const [id, row] of this.items) {
      if (registry.get(id) !== row.nativeItem) throw Error('BEDROCK_ITEM_CATALOG_REGISTRY_MISMATCH')
    }
    this.stats.registryVerified = true
  }

  outgoing (name, native) {
    if (!PACKETS.has(name)) return native
    const visit = value => {
      if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) return value
      if (Array.isArray(value)) return value.map(visit)
      if (Number.isInteger(value.itemCount) && value.itemCount > 0 && Number.isInteger(value.itemId)) {
        const original = clone(value)
        // Count is mutable during split/merge; native type and the full native
        // component patch define a variant. The real server validates counts.
        const fingerprint = crypto.createHash('sha256').update(v8.serialize({ ...original, itemCount: 0 })).digest('hex')
        let token = this.variants.get(fingerprint)
        if (!token) {
          if (this.tokens.size >= 8192) throw Error('BEDROCK_STACK_CACHE_FULL_RECONNECT')
          token = crypto.randomBytes(16).toString('hex')
          this.variants.set(fingerprint, token)
          this.tokens.set(token, original)
        }
        const projected = vanillaProjection(value)
        const components = projected.components || []
        let custom = components.find(c => c.type === 'custom_data')
        if (!custom) {
          custom = { type: 'custom_data', data: { type: 'compound', value: {} } }
          components.push(custom)
        }
        if (custom.data?.type !== 'compound' || !custom.data.value || KEY in custom.data.value) {
          throw Error('BEDROCK_STACK_TOKEN_NAMESPACE_CONFLICT')
        }
        custom.data.value[KEY] = { type: 'string', value: token }
        const item = this.items.get(value.itemId)
        if (item) {
          const index = components.findIndex(c => c.type === 'custom_model_data')
          if (index >= 0) components.splice(index, 1)
          components.push({ type: 'custom_model_data', data: item.customModelData })
          if (!components.some(c => c.type === 'custom_name' || c.type === 'item_name')) {
            components.push({ type: 'item_name', data: { type: 'string', value: item.displayName } })
          }
          this.stats.nativeItemsProjected++
        }
        projected.components = components
        projected.addedComponentCount = components.length
        // The display patch owns these values even if the native patch removed
        // them. The original removals will be recovered from our snapshot.
        projected.removeComponents = (projected.removeComponents || []).filter(type =>
          !components.some(c => c.type === type))
        projected.removedComponentCount = projected.removeComponents.length
        return projected
      }
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
    }
    return vanillaProjection(visit(native))
  }

  incoming (name, packet) {
    if (name === 'set_creative_slot') throw Error('BEDROCK_CREATIVE_NATIVE_ITEMS_UNSUPPORTED')
    if (name !== 'window_click') return packet
    const restore = value => {
      if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) return value
      if (Array.isArray(value)) return value.map(restore)
      if (Number.isInteger(value.itemCount)) {
        if (value.itemCount === 0) return { itemCount: 0 }
        if (value.itemCount < 0 || value.itemCount > 99) throw Error('INVALID_BEDROCK_STACK_COUNT')
        const component = value.components?.find(c => c.type === 'custom_data')
        const token = component?.data?.value?.[KEY]?.value
        const original = this.tokens.get(token)
        if (!original) throw Error('BEDROCK_NATIVE_STACK_IDENTITY_UNAVAILABLE')
        this.stats.exactStacksRestored++
        // Ignore client modifications to the patch, rather than accepting
        // invented native components or overwriting source items with proxies.
        return { ...clone(original), itemCount: value.itemCount }
      }
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, restore(child)]))
    }
    return restore(packet)
  }
}

module.exports = { BedrockItems, KEY }
