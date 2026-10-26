/* Prepare an OFFLINE, already converted map. Never merge it into a live world. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createRequire } = require('node:module');

const EXCLUDED = new Set(['playerdata', 'advancements', 'stats', 'session.lock',
  'uid.dat', 'level.dat_old']);
const SPAWN = { x: -583, y: 69, z: 934 };

function cleanLevel(root) {
  const data = root?.value?.Data?.value;
  if (data?.DataVersion?.value !== 3955) throw new Error('Convert in isolated Paper 1.21.1 first');
  delete data.Player;
  data.LevelName = { type: 'string', value: 'aincrad' };
  for (const [axis, value] of Object.entries(SPAWN))
    data['Spawn' + axis.toUpperCase()] = { type: 'int', value };
  const rules = data.GameRules?.value;
  if (!rules) throw new Error('Missing game rules');
  for (const [key, value] of Object.entries({ keepInventory: 'true',
    playersSleepingPercentage: '1', spawnChunkRadius: '0', doMobSpawning: 'true',
    mobGriefing: 'false', doFireTick: 'false' })) rules[key] = { type: 'string', value };
  return root;
}

async function prepare(source, destination, nbt) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (fs.existsSync(destination)) throw new Error('Destination exists: refusing a merge or overwrite');
  if (destination.startsWith(source + path.sep) || source.startsWith(destination + path.sep))
    throw new Error('Source and destination must not contain each other');
  const { parsed } = await nbt.parse(fs.readFileSync(path.join(source, 'level.dat')));
  cleanLevel(parsed); // Validate before creating the new directory.
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false,
    filter: p => p === source || !EXCLUDED.has(path.relative(source, p).split(path.sep)[0]) });
  fs.writeFileSync(path.join(destination, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(parsed)));
  return { status: 'prepared', source, destination, spawn: SPAWN, dataVersion: 3955,
    playerDataImported: false, originalSourceUnchanged: true };
}

module.exports = { cleanLevel, prepare, EXCLUDED, SPAWN };
if (require.main === module) {
  const [source, destination, nbtModule] = process.argv.slice(2);
  if (!source || !destination || !nbtModule) throw new Error('Usage: prepare-map.cjs SOURCE DESTINATION ABSOLUTE_NBT_MODULE');
  prepare(source, destination, createRequire(__filename)(nbtModule))
    .then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
