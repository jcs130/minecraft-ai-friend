import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import crypto from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, 'world/package.json'));
const Block = require('prismarine-block')('1.21.1');
const mcData = require('minecraft-data')('1.21.1');
const dumpBytes = fs.readFileSync(path.join(root, 'server/mc/block-registry.json'));
const dump = JSON.parse(dumpBytes);
const map = JSON.parse(fs.readFileSync(path.join(root, 'vendor/modern-viewer/mod-assets/vanilla-state-map.json')));
const mapping = new Map(map.mappings);
const fallbacks = new Set(map.fallbacks.map(row => row.serverStateId));
const props = record => Object.fromEntries(Object.entries(record ?? {}).map(([k, v]) => [k, String(v).toLowerCase()]).sort(([a], [b]) => a.localeCompare(b)));

test('actual prismarine-block decodes every mapped state to the same name and properties', () => {
  let exact = 0, fallback = 0;
  for (const row of dump.blockStates) {
    if (!row.block.startsWith('minecraft:')) {
      assert.equal(mapping.has(row.stateId), false);
      continue;
    }
    const target = mapping.get(row.stateId);
    const actual = Block.fromStateId(target, 0);
    assert.equal('minecraft:' + actual.name, row.block, 'wrong block for raw ' + row.stateId);
    if (fallbacks.has(row.stateId)) {
      fallback++;
      assert.equal(actual.name, 'note_block');
      assert.equal(target, mcData.blocksByName.note_block.defaultState);
    } else {
      assert.deepEqual(props(actual.getProperties()), props(row.properties), 'wrong property for raw ' + row.stateId);
      exact++;
    }
  }
  assert.equal(exact, 26684);
  assert.equal(fallback, 150);
});

test('translation is bound to the exact current registry and local canonical definitions', () => {
  assert.equal(map.registrySha256, crypto.createHash('sha256').update(dumpBytes).digest('hex'));
  const canonical = fs.readFileSync(path.join(root, 'world/node_modules/minecraft-data/minecraft-data/data/pc/1.21.1/blocks.json'));
  assert.equal(map.canonicalBlocksSha256, crypto.createHash('sha256').update(canonical).digest('hex'));
  assert.equal(mapping.size, 26834);
  assert.equal(map.serverModRanges.length, 3276);
  assert(map.serverModRanges.every(row => row.minStateId > map.stats.canonicalMaximumStateId));
});
