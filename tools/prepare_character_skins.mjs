// Preserve the original signed character skins and repair only cosmetic NBT fields.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'world/package.json'));
const nbt = require('prismarine-nbt');
const SOURCE = 'C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/ops/guard-skins';
const DEST = path.join(ROOT, 'server/character-skins');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const definitions = [
  {name:'Kirito', title:'桐人', prefix:'kirito', png:'kirito_726.png', texture:'3daa324a5872bd8dec189ceb2db213e00537facbe588d5b1a7a85d0e34533f6'},
  {name:'Naruto', title:'鸣人', prefix:'naruto', png:'naruto_748.png', texture:'e5fe33c4101093cbd1eb0b961b25b9c3990726f1b7f23f3578dc3f1b6e31b296'},
];
const fail = message => {throw new Error(message);};
function validate(row) {
  const decoded = JSON.parse(Buffer.from(row.value, 'base64').toString('utf8'));
  const url = new URL(decoded.textures.SKIN.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.host !== 'textures.minecraft.net' ||
      url.pathname !== `/texture/${row.texture}`) fail('Character texture differs from the recorded original');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(row.value) || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.signature) ||
      Buffer.from(row.signature, 'base64').length !== 512) fail('Malformed original signed skin property');
  return decoded;
}
function stoppedServer() {
  const text = execFileSync('docker', ['compose', '--project-directory', ROOT, '-f', path.join(ROOT, 'compose.yml'), 'ps', '-a', '--format', 'json'], {cwd:ROOT,encoding:'utf8'}).trim();
  const rows = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const mc = rows.find(row => row.Service === 'mc');
  if (!mc || mc.Project !== 'qiandengji' || !['exited','stopped'].includes(mc.State)) fail('Stop the isolated qiandengji MC service before repairing persisted skins');
}
fs.mkdirSync(DEST, {recursive:true});
const existing = path.join(DEST, 'skins.json');
let records;
if (fs.existsSync(existing)) {
  records = JSON.parse(fs.readFileSync(existing, 'utf8')).skins;
} else {
  records = definitions.map(definition => {
    const value = fs.readFileSync(path.join(SOURCE, `${definition.prefix}_value.txt`), 'utf8').trim();
    const signature = fs.readFileSync(path.join(SOURCE, `${definition.prefix}_sig.txt`), 'utf8').trim();
    const raw = fs.readFileSync(path.join(SOURCE, definition.png));
    if (raw.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || raw.readUInt32BE(16) !== 64 || raw.readUInt32BE(20) !== 64) fail('Expected original 64x64 PNG');
    const record = {...definition, value, signature, pngSha256:sha(raw)};
    validate(record);
    fs.writeFileSync(path.join(DEST, definition.png), raw, {flag:'wx'});
    return record;
  });
  fs.writeFileSync(existing, JSON.stringify({schema_version:1, skins:records}, null, 2)+'\n', {flag:'wx'});
}
if (records.length !== 2 || !definitions.every(def => records.some(row => row.name === def.name && row.texture === def.texture))) fail('Unexpected character catalog');
for (const row of records) {
  const expected = definitions.find(def => def.name === row.name);
  if (row.png !== expected?.png || row.texture !== expected?.texture) fail('Unexpected catalog resource path');
  validate(row);
  if (sha(fs.readFileSync(path.join(DEST, row.png))) !== row.pngSha256) fail('Preserved character PNG changed');
}
const report = {checked_at:new Date().toISOString(), project:'qiandengji', sources_modified:false,
  skins:records.map(({name,title,png,pngSha256,texture}) => ({name,title,png,pngSha256,textureUrl:`https://textures.minecraft.net/texture/${texture}`})),
  registry_repaired:false, signature_crypto_verified:false};
if (process.argv.includes('--restore-registry')) {
  stoppedServer();
  const target = path.join(ROOT, 'server/mc/shadow/data/numen_companions.dat');
  const original = fs.readFileSync(target);
  const parsed = (await nbt.parse(original)).parsed;
  const fixed = structuredClone(parsed);
  const entries = fixed.value?.data?.value?.companions?.value;
  if (!entries || typeof entries !== 'object') fail('Unexpected Numen registry format');
  const changes = [];
  const matched = {Kirito:0,Naruto:0};
  for (const [id, tag] of Object.entries(entries)) {
    const entry = tag.value;
    const skin = records.find(row => row.name === entry?.name?.value);
    if (!skin) continue;
    matched[skin.name]++;
    if (entry.skinValue?.value === skin.value && entry.skinSig?.value === skin.signature) continue;
    entry.skinValue = {type:'string', value:skin.value};
    entry.skinSig = {type:'string', value:skin.signature};
    changes.push({id, name:skin.name});
  }
  if (!matched.Kirito || !matched.Naruto) fail('Expected existing character records are missing; no new identities are created');
  // Undo just the proposed cosmetic fields, then compare every original tag.
  const undo = structuredClone(fixed);
  for (const change of changes) {
    const old = parsed.value.data.value.companions.value[change.id].value;
    const value = undo.value.data.value.companions.value[change.id].value;
    for (const key of ['skinValue','skinSig']) {
      if (key in old) value[key] = old[key]; else delete value[key];
    }
  }
  if (!isDeepStrictEqual(nbt.simplify(undo), nbt.simplify(parsed))) fail('Repair would change non-cosmetic registry state');
  const encoded = gzipSync(nbt.writeUncompressed(fixed, 'big'));
  if (!isDeepStrictEqual(nbt.simplify((await nbt.parse(encoded)).parsed), nbt.simplify(fixed))) fail('NBT serialization changed semantic data');
  if (changes.length) {
    const backups = path.join(ROOT, 'runtime/backups/character-skins');
    fs.mkdirSync(backups, {recursive:true});
    const backup = path.join(backups, `numen_companions-${Date.now()}.dat`);
    fs.writeFileSync(backup, original, {flag:'wx'});
    // Recheck both server state and bytes immediately before the atomic write.
    stoppedServer();
    if (!fs.readFileSync(target).equals(original)) fail('Registry changed while preparing repair');
    fs.writeFileSync(target+'.qiandeng-skins.tmp', encoded, {flag:'wx'});
    fs.renameSync(target+'.qiandeng-skins.tmp', target);
    report.backup = path.relative(ROOT,backup).replaceAll('\\','/');
  }
  report.registry_repaired = true;
  report.records_matched = matched;
  report.records_updated = changes.map(({name})=>name);
  report.only_skin_fields_changed = true;
  report.registry_sha256 = sha(fs.readFileSync(target));
  report.characters_spawned = false;
}
const reportName = process.argv.includes('--restore-registry') ? 'character-skins.json' : 'character-skins-preparation.json';
fs.writeFileSync(path.join(ROOT, 'reports', reportName), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
