'use strict'

// Opt-in boundary for a Java version translator. The ordinary Agent/native
// viewer connection keeps the original packets. RegistrySnapshot wire format
// is verified against NeoForge 21.1.248's actual FrozenRegistryPayload codec.
const mcData = require('minecraft-data')('1.21.1')
const attrType = mcData.protocol.play.toClient.types.packet_entity_update_attributes[1][1].type[1].type[1][0].type[1].mappings
const attrIds = new Map(Object.entries(attrType).map(([id, name]) => [name, Number(id)]))
const attrNames = new Set(Object.values(attrType))
const vanilla = {
  'minecraft:block': mcData.blocksByName,
  'minecraft:item': mcData.itemsByName,
  'minecraft:entity_type': mcData.entitiesByName
}

function frozenRegistry (buffer) {
  let offset = 0
  const integer = () => {
    let value = 0
    for (let n = 0; n < 5; n++) {
      if (offset >= buffer.length) throw Error('TRUNCATED_REGISTRY_VARINT')
      const byte = buffer[offset++]; value += (byte & 127) * 2 ** (7 * n)
      if (!(byte & 128)) return value
    }
    throw Error('REGISTRY_VARINT_TOO_LONG')
  }
  const string = () => {
    const size = integer()
    if (size > 32767 || offset + size > buffer.length) throw Error('INVALID_REGISTRY_STRING')
    const result = buffer.toString('utf8', offset, offset + size); offset += size
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(result)) throw Error('INVALID_REGISTRY_RESOURCE')
    return result
  }
  const count = () => {
    const value = integer()
    if (value > 500000 || value > buffer.length) throw Error('REGISTRY_TOO_LARGE')
    return value
  }
  if (!Buffer.isBuffer(buffer) || buffer.length > 8 * 1024 * 1024) throw Error('INVALID_REGISTRY_BUFFER')
  const name = string(); const ids = new Map()
  for (let n = count(); n > 0; n--) {
    const id = integer(); const key = string()
    if (ids.has(id)) throw Error('DUPLICATE_REGISTRY_ID')
    ids.set(id, key)
  }
  for (let n = count(); n > 0; n--) { string(); string() }
  if (offset !== buffer.length) throw Error('TRAILING_REGISTRY_BYTES')
  return { name, ids }
}

class BedrockProjection {
  constructor (models = null) {
    this.models = models
    this.registries = new Map(); this.hiddenEntities = new Set(); this.recipesSent = false
    this.stats = { registries: 0, tagEntriesOmitted: 0, attributesOmitted: 0, entitiesOmitted: 0 }
  }

  learn (data) {
    const registry = frozenRegistry(data)
    this.registries.set(registry.name, registry.ids); this.stats.registries++
  }

  vanillaId (registry, id) {
    const name = this.registries.get(registry)?.get(id)
    if (!name?.startsWith('minecraft:')) return null
    return vanilla[registry]?.[name.slice(10)]?.id ?? null
  }

  project (name, params) {
    if (params === null || typeof params !== 'object') return { params }
    const model = this.models?.project(name, params, this.registries.get('minecraft:entity_type'))
    if (model !== undefined) return model
    if (name === 'tags') {
      return { params: { ...params, tags: params.tags.map(row => vanilla[row.tagType] ? ({
        ...row, tags: row.tags.map(tag => ({ ...tag, entries: [...new Set(tag.entries.flatMap(id => {
          const mapped = this.vanillaId(row.tagType, id)
          if (mapped === null) { this.stats.tagEntriesOmitted++; return [] }
          return [mapped]
        }))] }))
      }) : row) } }
    }
    if (name === 'entity_update_attributes') {
      const registry = this.registries.get('minecraft:attribute')
      const properties = params.properties.flatMap(property => {
        const raw = attrIds.get(property.key) ?? (/^\d+$/.test(String(property.key)) ? Number(property.key) : null)
        const nativeName = registry?.get(raw)?.replace(/^minecraft:/, '')
        if (!attrNames.has(nativeName)) { this.stats.attributesOmitted++; return [] }
        return [{ ...property, key: nativeName }]
      })
      if (this.hiddenEntities.has(params.entityId)) return null
      return { params: { ...params, properties } }
    }
    if (name === 'spawn_entity') {
      const mapped = this.vanillaId('minecraft:entity_type', params.type)
      if (mapped === null) {
        this.hiddenEntities.add(params.entityId); this.stats.entitiesOmitted++; return null
      }
      this.hiddenEntities.delete(params.entityId)
      return { params: { ...params, type: mapped } }
    }
    if (this.hiddenEntities.has(params.entityId)) return null
    if (name === 'entity_destroy') {
      const entityIds = params.entityIds.filter(id => !this.hiddenEntities.delete(id))
      return { params: { ...params, entityIds } }
    }
    if (name === 'unlock_recipes') {
      // The mod recipe serializer stream was deliberately not decoded by the
      // existing gate. Declare an honest empty catalog before book updates;
      // do not let ViaVersion mistake undisclosed native recipes for valid ones.
      const before = this.recipesSent ? [] : [{ name: 'declare_recipes', params: { recipes: [] } }]
      this.recipesSent = true
      return { before, params: { ...params, recipes1: [], recipes2: params.action === 0 ? [] : undefined } }
    }
    return { params }
  }
}

module.exports = { BedrockProjection, frozenRegistry }
