/** Read only saved Anvil block palettes near the known observer parking area.
 * No RCON, world load, entity/NPC access or game connection. Output is a snapshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, 'world/package.json'));
const nbt = require('prismarine-nbt');
const center = { x: -543.5, y: 65, z: 864.5 };
const registry = JSON.parse(fs.readFileSync(path.join(root, 'server/mc/block-registry.json')));
const stateMap = JSON.parse(fs.readFileSync(path.join(root, 'vendor/modern-viewer/mod-assets/vanilla-state-map.json')));
const translations = new Map(stateMap.mappings);
const normalize = props => JSON.stringify(Object.entries(props ?? {}).map(([k, v]) => [k, String(v).toLowerCase()]).sort(([a], [b]) => a.localeCompare(b)));
const stateIds = new Map(registry.blockStates.map(row => [row.block + normalize(row.properties), row.stateId]));
const regions = new Map(), candidates = [];
for (let cx = -36; cx <= -33; cx++) for (let cz = 52; cz <= 55; cz++) {
  const name = `r.${Math.floor(cx / 32)}.${Math.floor(cz / 32)}.mca`;
  if (!regions.has(name)) {
    const file = path.join(root, 'server/mc/shadow/region', name);
    if (!fs.existsSync(file)) continue;
    const before = fs.statSync(file), data = fs.readFileSync(file), after = fs.statSync(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || data.length !== before.size) throw Error('Region changed during read; retry snapshot');
    regions.set(name, { data, sha256: crypto.createHash('sha256').update(data).digest('hex'), modifiedAt: after.mtime.toISOString() });
  }
  const { data } = regions.get(name);
  const index = ((cx & 31) + (cz & 31) * 32) * 4;
  const offset = data.readUIntBE(index, 3) * 4096;
  if (!offset) continue;
  const length = data.readUInt32BE(offset), compression = data[offset + 4];
  if (length < 1 || offset + 4 + length > data.length) throw Error('Invalid region record');
  const encoded = data.subarray(offset + 5, offset + 4 + length);
  const raw = compression === 2 ? zlib.inflateSync(encoded) : compression === 1 ? zlib.gunzipSync(encoded) : compression === 3 ? encoded : null;
  if (!raw) throw Error('Unsupported region compression');
  const chunk = nbt.simplify((await nbt.parse(raw)).parsed);
  if (chunk.xPos !== cx || chunk.zPos !== cz) throw Error('Chunk coordinate mismatch');
  for (const section of chunk.sections ?? []) {
    if (section.Y < 3 || section.Y > 5) continue;
    const palette = section.block_states?.palette;
    if (!palette?.length) continue;
    const selected = new Set(palette.flatMap((item, i) => /planks|wall|roof|stairs|log/.test(item.Name) ? [i] : []));
    if (!selected.size) continue;
    const bits = Math.max(4, Math.ceil(Math.log2(palette.length))), perLong = Math.floor(64 / bits);
    const longs = section.block_states.data?.map(value => BigInt.asUintN(64, BigInt(value.toString())));
    for (let i = 0; i < 4096; i++) {
      const n = palette.length === 1 ? 0 : Number((longs[Math.floor(i / perLong)] >> BigInt((i % perLong) * bits)) & ((1n << BigInt(bits)) - 1n));
      if (!selected.has(n)) continue;
      const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = section.Y * 16 + (i >> 8);
      if (Math.abs(x - center.x) > 30 || Math.abs(z - center.z) > 30 || y < 59 || y > 85) continue;
      const entry = palette[n], properties = entry.Properties ?? {};
      const sid = stateIds.get(entry.Name + normalize(properties));
      if (!Number.isInteger(sid)) throw Error('Saved palette entry absent from current registry');
      candidates.push({ x, y, z, name: entry.Name, properties, rawStateId: sid,
        canonicalStateId: translations.get(sid) ?? sid, distance: Math.hypot(x - center.x, y - center.y, z - center.z), region: name });
    }
  }
}
candidates.sort((a, b) => a.distance - b.distance);
const selected = [], identities = new Set();
for (const row of candidates) {
  if (identities.has(row.name) || row.name.includes('stripped_')) continue;
  identities.add(row.name); selected.push(row);
  if (selected.length === 5) break;
}
for (const row of selected) {
  row.distance = Math.round(row.distance * 10) / 10;
  const suffix = Object.keys(row.properties).length ? '[' + Object.entries(row.properties).map(([k, v]) => `${k}=${v}`).join(',') + ']' : '';
  row.readOnlyVerificationCommand = `execute if block ${row.x} ${row.y} ${row.z} ${row.name}${suffix}`;
}
const report = { schema: 1, generatedAt: new Date().toISOString(), source: 'Saved region snapshot, not live observer memory', center,
  registrySha256: stateMap.registrySha256, regions: [...regions].map(([name, { sha256, modifiedAt }]) => ({ name, sha256, modifiedAt })), samples: selected,
  chunksReadOnly: true, gameConnectionUsed: false, originalWorldModified: false,
  limits: ['Samples may differ from unsaved live changes; verify fixed coordinates before visual comparison',
    'Numeric state IDs are reconstructed from names/properties using the current registry',
    'No named mod roof within this bounded y59..85 sample is not evidence roofs are absent elsewhere'] };
fs.writeFileSync(path.join(root, 'reports/web-scene-palette-samples.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
