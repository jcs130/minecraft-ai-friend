const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanLevel, prepare } = require('./prepare-map.cjs');
const fixture = () => ({ type: 'compound', value: { Data: { type: 'compound', value: {
  DataVersion: { type: 'int', value: 3955 }, Player: { type: 'compound', value: { id: 'foreign' } },
  GameRules: { type: 'compound', value: { doDaylightCycle: { type: 'string', value: 'false' } } }
} } } });
test('rejects unconverted worlds before writing', () => {
  const root = fixture(); root.value.Data.value.DataVersion.value = 1343;
  assert.throws(() => cleanLevel(root), /isolated Paper/);
});
test('removes embedded owner, keeps author rules, uses verified town spawn', () => {
  const data = cleanLevel(fixture()).value.Data.value;
  assert.equal(data.Player, undefined);
  assert.deepEqual([data.SpawnX.value, data.SpawnY.value, data.SpawnZ.value], [-583, 69, 934]);
  assert.equal(data.GameRules.value.keepInventory.value, 'true');
  assert.equal(data.GameRules.value.spawnChunkRadius.value, '0');
  assert.equal(data.GameRules.value.doDaylightCycle.value, 'false');
});
test('never overwrites an existing world', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aincrad-test-'));
  try { await assert.rejects(prepare(tmp + '-source', tmp, {}), /Destination exists/); }
  finally { fs.rmdirSync(tmp); }
});
