'use strict'
const fs = require('node:fs')
const { readStateCatalog } = require('./agent-access/native-world.cjs')
const canonical = x => JSON.stringify(x, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)

// Narrow semantic bindings, then exact static shape + properties. A compatible
// vanilla carrier enables standard openContainer and stair physics; it never
// changes native identity or adds a many-to-one reverse mapping for placement.
function target (id) {
  if (id === 'lootr:lootr_chest') return 'minecraft:chest'
  if (id === 'lootr:lootr_trapped_chest') return 'minecraft:trapped_chest'
  if (id === 'lootr:lootr_barrel') return 'minecraft:barrel'
  if (/^twilightforest:[a-z0-9_]+_stairs$/.test(id)) return 'minecraft:oak_stairs'
  if (/^twilightforest:[a-z0-9_]+_slab$/.test(id)) return 'minecraft:oak_slab'
  return null
}
function improveMap (map, catalog) {
  const signature = row => row.collisionBoxes === null || row.dynamicShape || row.hasOffsetFunction ? null
    : canonical({ properties: row.properties, boxes: row.collisionBoxes, canOcclude: row.canOcclude })
  const vanilla = new Map()
  for (const row of catalog.values()) if (row.name.startsWith('minecraft:')) {
    const key = signature(row); if (key === null) continue
    const rows = vanilla.get(row.name) || new Map(); rows.set(key, row); vanilla.set(row.name, rows)
  }
  const report = { policy: 'explicit_semantic_binding_exact_static_shape_and_properties', updatedStates: 0, unrepresentableStates: 0, bindings: {} }
  const reverse = new Map(Object.entries(map.reverseVanillaStates || {}).map(([id, native]) => [native, Number(id)]))
  for (const row of catalog.values()) {
    const name = target(row.name); if (!name) continue
    const key = signature(row), actual = key === null ? null : vanilla.get(name)?.get(key)
    const vanillaId = actual ? reverse.get(actual.stateId) : undefined
    if (vanillaId === undefined || !Number.isInteger(Number(vanillaId))) { report.unrepresentableStates++; continue }
    map.states[row.stateId] = Number(vanillaId); report.updatedStates++
    report.bindings[row.name] = name
  }
  return report
}
function improveFile (mapFile, stateFile, hash) {
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8')), catalog = readStateCatalog(stateFile, hash)
  const report = improveMap(map, catalog)
  fs.writeFileSync(mapFile, JSON.stringify(map))
  return report
}
module.exports = { improveMap, improveFile, target }
