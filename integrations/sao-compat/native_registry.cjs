'use strict'
const fs = require('node:fs')
const path = require('node:path')
const value = text => text === 'true' ? true : text === 'false' ? false : /^-?\d+$/.test(text) ? Number(text) : text
const nativeName = name => name.startsWith('minecraft:') ? name.slice(10) : name
const fullCube = [[0, 0, 0, 1, 1, 1]]
function jsonLines (file, callback) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line.trim()) callback(JSON.parse(line))
}
function properties (rows) {
  const keys = Object.keys(rows[0].properties)
  return keys.map(name => {
    const values = [...new Set(rows.map(r => r.properties[name]))].map(value)
    const run = rows.findIndex(r => r.properties[name] !== rows[0].properties[name])
    return { name, type: 'enum', values, num_values: values.length, run: run < 0 ? rows.length : run }
  }).sort((a, b) => b.run - a.run || a.name.localeCompare(b.name)).map(({ run, ...rest }) => rest)
}
function validateProduct (rows, props) {
  if (rows.length !== props.reduce((n, p) => n * p.num_values, 1)) throw new Error('non_cartesian_native_states')
  rows.forEach((row, offset) => {
    if (row.id !== rows[0].id + offset) throw new Error('non_contiguous_native_states')
    let data = offset
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i]
      if (p.values[data % p.num_values] !== value(row.properties[p.name])) throw new Error(`native_state_order_mismatch:${row.name}:${p.name}`)
      data = Math.floor(data / p.num_values)
    }
  })
}
function applyNativeRegistry (registry, root) {
  const processState = JSON.parse(fs.readFileSync(path.join(root, 'lab-process.json')))
  const base = path.join(root, 'server/maw-sao/registry')
  const meta = JSON.parse(fs.readFileSync(path.join(base, 'current.json')))
  if (meta.minecraft !== '1.20.1' || processState.phase !== 'ready' || processState.pid !== meta.processId ||
      !/^[a-f0-9-]{36}$/.test(meta.serverEpoch)) throw new Error('stale_or_unready_native_registry')
  const directory = path.join(base, meta.serverEpoch)
  const oldBlocks = registry.blocksByName, oldItems = registry.itemsByName, oldEntities = registry.entitiesByName
  registry.blocks = {}; registry.blocksByName = {}; registry.blocksByStateId = {}; registry.blocksArray = []
  registry.items = {}; registry.itemsByName = {}; registry.itemsArray = []
  registry.entities = {}; registry.entitiesByName = {}; registry.entitiesArray = []
  const collision = { blocks: {}, shapes: [] }, shapesByJson = new Map(), groups = new Map()
  const shapeId = boxes => {
    const key = JSON.stringify(boxes)
    if (!shapesByJson.has(key)) { shapesByJson.set(key, collision.shapes.length); collision.shapes.push(boxes) }
    return shapesByJson.get(key)
  }
  let count = 0, unknownShapes = 0
  jsonLines(path.join(directory, 'states.jsonl'), row => {
    if (!Number.isInteger(row.id) || !Number.isInteger(row.blockId) || !row.name || registry.blocksByStateId[row.id]) throw new Error('invalid_native_state')
    if (!groups.has(row.blockId)) groups.set(row.blockId, [])
    groups.get(row.blockId).push(row); count++
    // Reserve the ID now to detect duplicate source rows.
    registry.blocksByStateId[row.id] = true
  })
  for (const [id, rows] of groups) {
    rows.sort((a, b) => a.id - b.id)
    const first = rows[0], name = nativeName(first.name), template = oldBlocks[name]
    const states = properties(rows); validateProduct(rows, states)
    const available = rows.every(r => r.shapeAvailable)
    const knownEmpty = available && rows.every(r => r.collisionShapes.length === 0)
    const block = { ...(template || {}), id, name, nativeId: first.name,
      displayName: template?.displayName || first.name, minStateId: first.id,
      maxStateId: rows.at(-1).id, defaultState: first.defaultStateId, states,
      hardness: first.hardness ?? -1, diggable: first.hardness !== null && first.hardness >= 0,
      boundingBox: knownEmpty ? 'empty' : 'block', transparent: !first.canOcclude,
      shapeStatus: available ? 'static_empty_world_context' : 'unknown_requires_live_context',
      material: template?.material || 'unknown', drops: [], harvestTools: {} }
    collision.blocks[name] = rows.map(r => {
      if (!r.shapeAvailable) unknownShapes++
      // Conservative physics only; the exposed status continues to say unknown.
      return shapeId(r.shapeAvailable ? r.collisionShapes : fullCube)
    })
    registry.blocks[id] = block; registry.blocksByName[name] = block; registry.blocksArray.push(block)
    for (const r of rows) registry.blocksByStateId[r.id] = block
  }
  let itemCount = 0
  jsonLines(path.join(directory, 'items.jsonl'), row => {
    const name = nativeName(row.name), template = oldItems[name]
    if (registry.items[row.id]) throw new Error('duplicate_native_item_id')
    const item = { ...(template || {}), id: row.id, name, nativeId: row.name,
      displayName: template?.displayName || row.name, stackSize: row.stackSize, translationKey: row.descriptionId }
    registry.items[row.id] = item; registry.itemsByName[name] = item; registry.itemsArray.push(item); itemCount++
  })
  let entityCount = 0
  jsonLines(path.join(directory, 'entities.jsonl'), row => {
    const name = nativeName(row.name), template = oldEntities?.[name]
    if (registry.entities[row.id]) throw new Error('duplicate_native_entity_id')
    const entity = { ...(template || {}), id: row.id, internalId: row.id, name, nativeId: row.name,
      displayName: template?.displayName || row.name, category: row.category,
      type: template?.type || 'other', width: row.width ?? template?.width, height: row.height ?? template?.height }
    registry.entities[row.id] = entity; registry.entitiesByName[name] = entity; registry.entitiesArray.push(entity); entityCount++
  })
  if (count !== meta.states || itemCount !== meta.items || entityCount !== meta.entities) throw new Error('native_registry_count_mismatch')
  registry.blockCollisionShapes = collision
  const result = { ...meta, blocks: groups.size, unknownShapes, nativeIdsPreserved: true, allStatePropertiesVerified: true }
  registry.mawNativeRegistry = result
  return result
}
module.exports = { applyNativeRegistry, properties, validateProduct }
