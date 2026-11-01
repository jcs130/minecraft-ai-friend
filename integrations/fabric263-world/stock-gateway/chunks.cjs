'use strict'

class ChunkProjection {
  constructor (req, registry, vanilla, projection, dimension, maxColumns = 196) {
    this.NativeChunk = req('prismarine-chunk')(registry)
    this.VanillaChunk = req('prismarine-chunk')(vanilla)
    this.projection = projection
    this.dimension = dimension
    this.maxColumns = maxColumns
    this.columns = new Map()
  }

  project (packet) {
    const native = new this.NativeChunk(this.dimension)
    native.load(packet.chunkData)
    const view = new this.VanillaChunk(this.dimension)
    // Biomes use the actual dynamic registry sent during configuration.
    view.biomes = native.biomes
    view.sections = native.sections.map(section => {
      const palette = section.data.palette || (Number.isInteger(section.data.value) ? [section.data.value] : null)
      if (palette) {
        return this.VanillaChunk.section.fromLocalPalette({
          data: section.data.data, palette: palette.map(id => this.projection.block(id).stateId),
          noSizePrefix: true, hasFluidCount: true
        })
      }
      const target = new this.VanillaChunk.section({ noSizePrefix: true, hasFluidCount: true, maxBitsPerBlock: view.maxBitsPerBlock })
      for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        target.set({ x, y, z }, this.projection.block(section.get({ x, y, z })).stateId)
      }
      return target
    })
    const key = packet.x + ',' + packet.z
    this.columns.delete(key)
    this.columns.set(key, { column: native, observedAt: new Date().toISOString() })
    while (this.columns.size > this.maxColumns) this.columns.delete(this.columns.keys().next().value)
    // Native block entity program/state is available through native queries;
    // arbitrary native NBT is never misrepresented as a vanilla block entity.
    const vanillaEntities = packet.blockEntities.filter(row => {
      const name = this.projection.native.fabricRegistries?.['minecraft:block_entity_type']
      const key = name && Object.entries(name).find(([, id]) => id === row.type)?.[0]
      return key?.startsWith('minecraft:')
    })
    return { ...packet, chunkData: view.dump(), blockEntities: vanillaEntities }
  }

  update (position, stateId) {
    const row = this.columns.get(Math.floor(position.x / 16) + ',' + Math.floor(position.z / 16))
    if (row) {
      row.column.setBlockStateId({ x: position.x & 15, y: position.y, z: position.z & 15 }, stateId)
      row.observedAt = new Date().toISOString()
    }
  }

  at (position) {
    if (position.y < this.dimension.minY || position.y >= this.dimension.minY + this.dimension.worldHeight) return null
    const row = this.columns.get(Math.floor(position.x / 16) + ',' + Math.floor(position.z / 16))
    if (!row) return null
    const stateId = row.column.getBlockStateId({ x: position.x & 15, y: position.y, z: position.z & 15 })
    return { ...this.projection.states.get(stateId), observedAt: row.observedAt,
      projection: this.projection.block(stateId), position: { ...position } }
  }

}

module.exports = { ChunkProjection }
