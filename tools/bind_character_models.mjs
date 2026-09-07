// Offline-only cosmetic YSM attachment binding for the four existing identities.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'world/package.json'));
const nbt = require('prismarine-nbt');
const ATTACHMENTS = 'neoforge:attachments';
const MODEL_KEY = 'yes_steve_model:model_id';
export const ORIGINALS = {
  'd4ac9523-4962-43ed-98c5-19b49e104048': 'Kirito',
  '4b93e0a8-9707-4743-ab53-73bf12fa8797': 'Naruto',
  '4d67319b-938e-420a-9d92-78db0a32601a': 'Kirito',
  'b44590d3-89dd-44ff-978e-c0c2a397f781': 'Naruto',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const demand = (condition, message) => { if (!condition) throw new Error(message); };

export function assertStopped() {
  const ids = execFileSync('docker', ['compose', '--project-directory', ROOT, '-f', path.join(ROOT, 'compose.yml'),
    '-p', 'qiandengji', 'ps', '--all', '-q', 'mc'], { encoding: 'utf8', windowsHide: true }).trim().split(/\s+/).filter(Boolean);
  demand(ids.length === 1, 'Expected exactly one isolated qiandengji mc container');
  const state = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .State}}', ids[0]],
    { encoding: 'utf8', windowsHide: true }));
  demand(state.Running === false && state.Status === 'exited', 'MC must be normally stopped before binding player NBT');
}

function verifyPath(file) {
  const real = fs.realpathSync(file);
  const allowed = fs.realpathSync(path.join(ROOT, 'server/mc/shadow')) + path.sep;
  demand(real.startsWith(allowed), 'NBT target resolves outside this D development world');
  demand(!fs.lstatSync(file).isSymbolicLink(), 'Refusing linked player NBT');
}

export function uuidFromIntArray(array) {
  demand(Array.isArray(array) && array.length === 4 && array.every(Number.isInteger), 'Unexpected player UUID NBT');
  const hex = array.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function bindTag(original, modelId) {
  demand(/^qiandengji_(?:naruto|kirito)$/.test(modelId), 'Unexpected model binding ID');
  demand(original.type === 'compound', 'Player root NBT must be a compound');
  const fixed = structuredClone(original);
  fixed.value[ATTACHMENTS] ||= { type: 'compound', value: {} };
  const attachments = fixed.value[ATTACHMENTS];
  demand(attachments.type === 'compound', 'Unexpected NeoForge attachments type');
  attachments.value[MODEL_KEY] ||= { type: 'compound', value: {} };
  const model = attachments.value[MODEL_KEY];
  demand(model.type === 'compound', 'Unexpected YSM model attachment type');
  model.value.model_id = { type: 'string', value: modelId };
  model.value.select_texture = { type: 'string', value: 'skin' };
  model.value.mandatory = { type: 'byte', value: 1 };
  model.value.disabled = { type: 'byte', value: 0 };
  model.value.molang_storage ||= { type: 'compound', value: {} };
  // Undo the one permitted attachment. The entire typed NBT must then equal input.
  const undo = structuredClone(fixed);
  if (!original.value[ATTACHMENTS]) delete undo.value[ATTACHMENTS];
  else if (!original.value[ATTACHMENTS].value[MODEL_KEY]) delete undo.value[ATTACHMENTS].value[MODEL_KEY];
  else undo.value[ATTACHMENTS].value[MODEL_KEY] = original.value[ATTACHMENTS].value[MODEL_KEY];
  demand(isDeepStrictEqual(undo, original), 'Binding would change unrelated player NBT');
  return fixed;
}

export async function prepareBinding() {
  demand(ROOT.replaceAll('\\', '/').toLowerCase() === 'd:/projects/qiandengji', 'Only the isolated D project is allowed');
  const registryPath = path.join(ROOT, 'server/mc/shadow/data/numen_companions.dat');
  verifyPath(registryPath);
  const registryBytes = fs.readFileSync(registryPath);
  const registry = nbt.simplify((await nbt.parse(registryBytes)).parsed).data?.companions;
  demand(registry && typeof registry === 'object', 'Unexpected Numen registry');
  const matching = Object.entries(registry).filter(([, row]) => ['Naruto', 'Kirito'].includes(row.name));
  demand(matching.length === 4, 'Expected exactly four original character records');
  demand(!Object.values(registry).some(row => /^QD(?:Skin|Model)/.test(row.name)), 'A reserved QA companion remains registered');
  const plans = [];
  for (const [uuid, name] of Object.entries(ORIGINALS)) {
    demand(registry[uuid]?.name === name, 'Original UUID/name mapping changed');
    demand(registry[uuid].skinValue && registry[uuid].skinSig, 'Original signed skin fields are missing');
    const modelId = `qiandengji_${name.toLowerCase()}`;
    const folder = path.join(ROOT, 'server/mc/config/yes_steve_model/custom', modelId);
    const marker = JSON.parse(fs.readFileSync(path.join(folder, '.qiandengji-generated.json'), 'utf8'));
    demand(marker.owner === 'qiandengji.build_game_models.v1' && marker.model === modelId, 'Missing owned native model');
    for (const [relative, expected] of Object.entries(marker.sha256)) {
      const modelFile = path.resolve(folder, relative);
      demand(modelFile.startsWith(folder + path.sep), 'Unsafe model lock path');
      demand(sha(fs.readFileSync(modelFile)) === expected, 'Model file no longer matches its build lock');
    }
    const target = path.join(ROOT, 'server/mc/shadow/playerdata', `${uuid}.dat`);
    verifyPath(target);
    const before = fs.readFileSync(target);
    const parsed = (await nbt.parse(before)).parsed;
    demand(uuidFromIntArray(nbt.simplify(parsed).UUID) === uuid, 'Player file UUID differs from registry identity');
    const fixed = bindTag(parsed, modelId);
    const after = gzipSync(nbt.writeUncompressed(fixed, 'big'));
    const roundTrip = (await nbt.parse(after)).parsed;
    demand(isDeepStrictEqual(nbt.simplify(roundTrip), nbt.simplify(fixed)), 'NBT serialization changed semantic player data');
    const changed = !isDeepStrictEqual(parsed, fixed);
    plans.push({ uuid, name, modelId, target, before, after, changed,
      beforeAttachment: nbt.simplify(parsed)[ATTACHMENTS]?.[MODEL_KEY]?.model_id || null });
  }
  demand(fs.readFileSync(registryPath).equals(registryBytes), 'Registry changed while preparing binding');
  return { registryPath, registryBytes, plans };
}

export async function main(args = process.argv.slice(2)) {
  const apply = args.includes('--apply');
  demand(args.every(value => value === '--apply'), 'Only the --apply flag is supported; default is dry-run');
  if (apply) assertStopped();
  const { registryPath, registryBytes, plans } = await prepareBinding();
  const report = { project: 'qiandengji', at: new Date().toISOString(), mode: apply ? 'apply' : 'dry-run', ok: false,
    scope: 'Only neoforge:attachments / yes_steve_model:model_id in four original UUID player files',
    registryChanged: false, charactersSpawned: false,
    players: plans.map(p => ({ uuid: p.uuid, name: p.name, modelId: p.modelId, textureId: 'skin',
      relativePath: path.relative(ROOT, p.target).replaceAll('\\', '/'), changed: p.changed,
      previousModel: p.beforeAttachment, beforeSha256: sha(p.before), plannedSha256: sha(p.after) })) };
  if (apply && plans.some(p => p.changed)) {
    assertStopped();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backups = path.join(ROOT, 'runtime/backups/character-models', stamp);
    fs.mkdirSync(backups, { recursive: true });
    for (const p of plans) {
      demand(fs.readFileSync(p.target).equals(p.before), 'Player changed since preparation');
      fs.writeFileSync(path.join(backups, `${p.uuid}.dat`), p.before, { flag: 'wx' });
    }
    // Registry is only backed up/read; it is never an output of this tool.
    fs.writeFileSync(path.join(backups, 'numen_companions.dat'), registryBytes, { flag: 'wx' });
    const written = [];
    try {
      for (const p of plans.filter(p => p.changed)) {
        assertStopped();
        demand(fs.readFileSync(registryPath).equals(registryBytes), 'Registry changed before player write');
        demand(fs.readFileSync(p.target).equals(p.before), 'Player changed before atomic write');
        const temp = `${p.target}.qiandeng-models.tmp`;
        fs.writeFileSync(temp, p.after, { flag: 'wx' });
        fs.renameSync(temp, p.target); written.push(p);
        demand(fs.readFileSync(p.target).equals(p.after), 'Written player hash mismatch');
      }
    } catch (error) {
      // Roll back only bytes written by this invocation, only while MC is stopped.
      assertStopped();
      for (const p of written.reverse()) {
        demand(fs.readFileSync(p.target).equals(p.after), 'Refusing rollback over a concurrent player edit');
        const temp = `${p.target}.qiandeng-models-rollback.tmp`;
        fs.writeFileSync(temp, p.before, { flag: 'wx' }); fs.renameSync(temp, p.target);
      }
      throw error;
    }
    report.backupDirectory = path.relative(ROOT, backups).replaceAll('\\', '/');
  }
  demand(fs.readFileSync(registryPath).equals(registryBytes), 'Registry changed unexpectedly');
  report.registrySha256 = sha(registryBytes);
  report.players.forEach((row, index) => { row.currentSha256 = sha(fs.readFileSync(plans[index].target)); });
  report.ok = true;
  const destination = path.join(ROOT, 'reports', apply ? 'character-model-bindings.json' : 'character-model-binding-plan.json');
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, mode: report.mode, players: report.players.map(({ name, modelId, changed }) => ({ name, modelId, changed })), report: destination }) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
