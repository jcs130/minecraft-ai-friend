'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync } = require('node:child_process')
const data = require('minecraft-data')('1.21.1')

test('public mapping generator emits exact item reverse identities despite colliding display proxies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fom-idmap-test-'))
  try {
    for (const key of ['blocks', 'items']) fs.writeFileSync(path.join(root, key + '.json'), JSON.stringify(Object.values(data[key])))
    const dump = path.join(root, 'dump'); fs.mkdirSync(dump)
    fs.writeFileSync(path.join(dump, 'blocks.tsv'), 'minecraft:air\t0\t1\n')
    fs.writeFileSync(path.join(dump, 'items.tsv'), 'minecraft:paper\t700\ntest:unknown_thing\t' + data.itemsByName.paper.id + '\n')
    fs.writeFileSync(path.join(dump, 'block-states.jsonl'), JSON.stringify({ stateId: 0, name: 'minecraft:air', properties: {} }) + '\n')
    const output = path.join(root, 'result.json')
    execFileSync(process.execPath, [path.join(__dirname, 'build-idmap.cjs')], { windowsHide: true,
      env: { ...process.env, MINECRAFT_DATA_DIR: root, IDMAP_DUMP_DIR: dump, IDMAP_OUTPUT_FILE: output } })
    const result = JSON.parse(fs.readFileSync(output, 'utf8'))
    assert.equal(result.items[700], data.itemsByName.paper.id)
    assert.equal(result.items[data.itemsByName.paper.id], data.itemsByName.paper.id)
    assert.equal(result.reverseVanillaItems[data.itemsByName.paper.id], 700)
    assert.deepEqual(result.reverseVanillaStates, { 0: 0 })
  } finally {
    // Only the directory created by this test, verified under the temp root.
    assert.equal(path.dirname(root), os.tmpdir())
    fs.rmSync(root, { recursive: true })
  }
})
