import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { createViewerBlockMapping, loadViewerBlockMapping } from '../src/viewer-state-map.mts'
import { remapSerializedPaletteContainer, remapSerializedViewerChunk } from '../src/mc-modern-viewer.mts'
const require = createRequire(import.meta.url), canonical = require('minecraft-data')('1.21.1')
const mapPath = new URL('../../vendor/modern-viewer/mod-assets/vanilla-state-map.json', import.meta.url)
const registryPath = new URL('../../server/world-data/block-registry.json', import.meta.url)
const registryBytes = fs.readFileSync(registryPath), registry = JSON.parse(registryBytes), mapping = JSON.parse(fs.readFileSync(mapPath))
const registrySha = createHash('sha256').update(registryBytes).digest('hex')
const create = value => createViewerBlockMapping(value, registry, registrySha, canonical, mapping.canonicalBlocksSha256)

test('actual server vanilla IDs are translated once by properties; modern mod IDs remain exact', () => {
  const adapter = create(mapping)
  assert.equal(adapter.normalize(1838), 1688) // Actual white bed shifted after expanded note-block instruments.
  assert.equal(canonical.blocksByStateId[adapter.normalize(1838)].name, 'white_bed')
  assert.equal(adapter.normalize(0), 0)
  const stairs = mapping.serverModRanges.find(row => row.name.includes('stair'))
  assert.equal(adapter.normalize(stairs.minStateId), stairs.minStateId)
  assert.equal(canonical.blocksByStateId[adapter.normalize(stairs.minStateId, 'compat')].name, 'oak_stairs')
  assert.equal(adapter.health.vanillaStates, 26834)
  assert.throws(() => adapter.normalize(999999), /unregistered/)
  assert.equal(loadViewerBlockMapping(mapPath, registryPath, canonical).ready, true)
})
test('registry/hash mismatch, duplicate IDs, wrong-block targets and missing ranges cannot silently render', () => {
  for (const alter of [value => { value.registrySha256 = '0'.repeat(64) }, value => { value.canonicalBlocksSha256 = '0'.repeat(64) },
    value => { value.mappings.push(value.mappings[0]) }, value => { value.mappings[1838][1] = 1 },
    value => { value.serverModRanges.pop() }, value => { value.mappings.pop() }]) {
    const value = structuredClone(mapping); alter(value); assert.throws(() => create(value))
  }
  assert.equal(loadViewerBlockMapping('/missing-map', registryPath, canonical).ready, false)
})
test('single and indirect section palettes translate once without touching light/biome containers', () => {
  const adapter = create(mapping), normalize = value => adapter.normalize(value)
  const single = JSON.stringify({ type: 'single', value: 1838 })
  assert.equal(JSON.parse(remapSerializedPaletteContainer(single, normalize)).value, 1688)
  const original = JSON.stringify({ minY: -64, worldHeight: 384, biomes: [1838], skyLightSections: [1838],
    sections: [JSON.stringify({ data: JSON.stringify({ type: 'indirect', palette: [0, 1838], data: 'unchanged-index-bits' }) })] })
  const out = JSON.parse(remapSerializedViewerChunk(original, normalize))
  assert.deepEqual(JSON.parse(JSON.parse(out.sections[0]).data).palette, [0, 1688])
  assert.deepEqual(out.biomes, [1838]); assert.deepEqual(out.skyLightSections, [1838])
  assert.ok(original.includes('1838'))
})
test('global direct palette round-trips all 4096 blocks with real prismarine chunk decoding', () => {
  const BitArray = require('prismarine-chunk/src/pc/common/BitArrayNoSpan'), Chunk = require('prismarine-chunk')('1.21.1')
  const adapter = create(mapping), chunk = new Chunk({ minY: -64, worldHeight: 384 })
  const source = Array.from({ length: 4096 }, (_, index) => index), bits = BitArray.fromArray(source, 17)
  source[4095] = mapping.serverModRanges[0].minStateId; bits.set(4095, source[4095])
  const root = JSON.parse(chunk.toJson()); root.sections[4] = JSON.stringify({ solidBlockCount: 4095, data: JSON.stringify({ type: 'direct', data: bits.toJson() }) })
  const original = JSON.stringify(root), out = remapSerializedViewerChunk(original, value => adapter.normalize(value))
  const decoded = Chunk.fromJson(out)
  for (let i = 0; i < 4096; i++) assert.equal(decoded.getBlockStateId({ x: i & 15, y: i >> 8, z: (i >> 4) & 15 }), adapter.normalize(source[i]))
  assert.equal(JSON.parse(JSON.parse(JSON.parse(out).sections[4]).data).type, 'indirect')
  assert.equal(root.sections[4], JSON.parse(original).sections[4])
})
