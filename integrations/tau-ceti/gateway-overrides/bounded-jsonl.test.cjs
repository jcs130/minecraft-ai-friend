const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createHash } = require('node:crypto')
const { lines, fileHash } = require('./bounded-jsonl.cjs')
const { exactStateMap } = require('./exact-state-map.cjs')

function fixture (body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tau-jsonl-')), file = path.join(dir, 'rows.jsonl')
  fs.writeFileSync(file, body)
  try { fn(file) } finally { fs.unlinkSync(file); fs.rmdirSync(dir) }
}
test('preserves UTF-8, CRLF and final row across byte boundaries', () => {
  fixture('开始🌍\r\nsecond\n末尾', file => assert.deepEqual([...lines(file, { chunkBytes: 3 })], ['开始🌍', 'second', '末尾']))
})
test('oversized row fails explicitly and does not truncate', () => {
  fixture('ok\n123456789\n', file => assert.throws(() => [...lines(file, { chunkBytes: 3, maxLineBytes: 8 })], /LINE_BUDGET/))
})
test('streaming hash is byte-exact', () => {
  const bytes = Buffer.from('开始🌍\r\nsecond\n末尾')
  fixture(bytes, file => assert.equal(fileHash(file), createHash('sha256').update(bytes).digest('hex')))
})
test('maps exact vanilla states while ignoring foreign names and preserving unknown names', () => {
  const rows = [{ stateId: 9000, name: 'mod:stone', properties: {} },
    { stateId: 9001, name: 'minecraft:stone', properties: {} },
    { stateId: 9002, name: 'minecraft:newer_block', properties: {} }]
  fixture(rows.map(JSON.stringify).join('\n'), file => {
    const result = exactStateMap(file, [{ name: 'stone', minStateId: 1, maxStateId: 1 }], { fromStateId: () => ({ getProperties: () => ({}) }) })
    assert.deepEqual(result.states, { 9001: 1 }); assert.deepEqual(result.reverseVanillaStates, { 1: 9001 })
    assert.deepEqual(result.additionalNames, ['minecraft:newer_block'])
  })
})
test('invalid vanilla state remains an error', () => {
  fixture('{"stateId":9,"name":"minecraft:stone","properties":{"invalid":"true"}}', file => {
    assert.throws(() => exactStateMap(file, [{ name: 'stone', minStateId: 1, maxStateId: 1 }], { fromStateId: () => ({ getProperties: () => ({}) }) }), /NOT_REPRESENTABLE/)
  })
})
test('explicit extension mode marks non-representable properties; never labels them exact', () => {
  fixture('{"stateId":9,"name":"minecraft:note_block","properties":{"instrument":"mod_instrument"}}', file => {
    const result = exactStateMap(file, [{ name: 'note_block', minStateId: 1, maxStateId: 1 }],
      { fromStateId: () => ({ getProperties: () => ({ instrument: 'harp' }) }) }, { reportExtendedStates: true })
    assert.deepEqual(result.states, {}); assert.deepEqual(result.reverseVanillaStates, {})
    assert.equal(result.unrepresentableStates[0].stateId, 9)
    assert.equal(result.unrepresentableStates[0].exactVanillaState, null)
    assert.equal(result.unrepresentableStates[0].properties.instrument, 'mod_instrument')
  })
})
