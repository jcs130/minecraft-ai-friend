'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { BufWriter } = require('./buf.cjs')
const { BedrockProjection, frozenRegistry } = require('./bedrock-projection.cjs')
const data = require('minecraft-data')('1.21.1')

function snapshot (name, rows) {
  const writer = new BufWriter().string(name).varint(rows.length)
  for (const [id, key] of rows) writer.varint(id).string(key)
  return writer.varint(0).finish()
}

test('decode the locked NeoForge registry snapshot and reject incomplete/ambiguous bytes', () => {
  const buffer = snapshot('minecraft:item', [[701, 'minecraft:diamond'], [2, 'test:wand']])
  assert.equal(frozenRegistry(buffer).ids.get(701), 'minecraft:diamond')
  for (const bad of [buffer.subarray(0, buffer.length - 1), Buffer.concat([buffer, Buffer.from([0])]),
    snapshot('minecraft:item', [[1, 'minecraft:stone'], [1, 'minecraft:dirt']]), Buffer.from([255, 255])]) {
    assert.throws(() => frozenRegistry(bad))
  }
})

test('translate tag IDs by actual registry names without changing the native packet', () => {
  const projection = new BedrockProjection()
  projection.learn(snapshot('minecraft:item', [[700, 'minecraft:diamond'], [701, 'test:wand']]))
  const input = { tags: [{ tagType: 'minecraft:item', tags: [{ tagName: 'test:any', entries: [700, 701, 700] }] },
    { tagType: 'minecraft:worldgen/biome', tags: [{ tagName: 'test:biome', entries: [4] }] }] }
  const before = structuredClone(input)
  const output = projection.project('tags', input).params
  assert.deepEqual(output.tags[0].tags[0].entries, [data.itemsByName.diamond.id])
  assert.deepEqual(output.tags[1], input.tags[1]); assert.deepEqual(input, before)
  assert.equal(projection.stats.tagEntriesOmitted, 1)
})

test('restore vanilla attribute names from actual wire IDs and omit unsupported mod attributes', () => {
  const projection = new BedrockProjection()
  projection.learn(snapshot('minecraft:attribute', [[3, 'minecraft:generic.max_health'], [45, 'test:mana']]))
  const input = { entityId: 10, properties: [{ key: 'generic.attack_knockback', value: 22, modifiers: [] },
    { key: '45', value: 100, modifiers: [] }] }
  assert.deepEqual(projection.project('entity_update_attributes', input).params.properties,
    [{ key: 'generic.max_health', value: 22, modifiers: [] }])
  assert.equal(input.properties.length, 2)
})

test('vanilla entity IDs follow registry identity, unavailable mod entities cannot corrupt metadata', () => {
  const projection = new BedrockProjection()
  projection.learn(snapshot('minecraft:entity_type', [[500, 'minecraft:zombie'], [501, 'test:maid']]))
  assert.equal(projection.project('spawn_entity', { entityId: 10, type: 500 }).params.type, data.entitiesByName.zombie.id)
  assert.equal(projection.project('spawn_entity', { entityId: 11, type: 501 }), null)
  assert.equal(projection.project('entity_metadata', { entityId: 11, metadata: [] }), null)
  assert.deepEqual(projection.project('entity_destroy', { entityIds: [10, 11] }).params.entityIds, [10])
  assert.equal(projection.hiddenEntities.size, 0)
})

test('unknown native recipes get an empty declared catalog before book updates, once per session', () => {
  const projection = new BedrockProjection()
  const first = projection.project('unlock_recipes', { action: 0, recipes1: ['mod:recipe'], recipes2: ['minecraft:recipe'] })
  assert.deepEqual(first.before, [{ name: 'declare_recipes', params: { recipes: [] } }])
  assert.deepEqual(first.params.recipes1, []); assert.deepEqual(first.params.recipes2, [])
  assert.deepEqual(projection.project('unlock_recipes', { action: 1, recipes1: ['mod:recipe'] }).before, [])
})

test('empty bundle delimiters keep their wire shape and cannot crash the gateway', () => {
  const projection = new BedrockProjection()
  assert.deepEqual(projection.project('bundle_delimiter', undefined), { params: undefined })
})
