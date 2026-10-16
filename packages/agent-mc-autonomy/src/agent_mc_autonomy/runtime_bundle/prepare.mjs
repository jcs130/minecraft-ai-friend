// Offline preparation only. No dependencies, network, subprocess, host or game startup.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let root = path.dirname(fileURLToPath(import.meta.url));
const checked = new Set();
let realRoot = fs.realpathSync(root);
const fail = code => { throw Error(`runtime_bundle_${code}: unpack the complete matching package and run prepare.cmd again`); };
const read = (file, limit = 32 * 1024 * 1024) => {
  const stat = fs.statSync(file); if (stat.size > limit) fail('metadata_too_large');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('metadata_invalid');
  return value;
};
const safe = name => {
  if (typeof name !== 'string' || !name || name.length > 1024) fail('path_invalid');
  for (const part of name.split('/')) if (!part || ['.', '..'].includes(part) || /[. ]$/.test(part)
      || /[\\:*?"<>|\x00-\x1f]/.test(part) || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i.test(part)) fail('path_invalid');
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (checked.has(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) fail('link_forbidden');
    const rel = path.relative(realRoot, fs.realpathSync(current));
    if (rel.startsWith('..') || path.isAbsolute(rel)) fail('path_escape');
    checked.add(current);
  }
  return current;
};
const fileHash = file => {
  const fd = fs.openSync(file, 'r'), digest = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return digest.digest('hex');
};

function verify(requireRunningNode = true) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== '22.22.1') fail('platform_or_node_version');
  if (fs.lstatSync(root).isSymbolicLink()) fail('link_forbidden');
  const manifest = read(safe('runtime-manifest.json'), 65536);
  if (manifest.schema !== 'agent-mc-runtime-bundle/v1' || manifest.platform !== 'win32' || manifest.architecture !== 'x64'
      || !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(manifest.id)) fail('manifest_incompatible');
  const { node, core, viewer, resources, inventory, browser } = manifest;
  if (inventory.path !== 'runtime-files.json' || !/^[a-f0-9]{64}$/.test(inventory.sha256)
      || fileHash(safe(inventory.path)) !== inventory.sha256) fail('inventory_hash_mismatch');
  const files = read(safe(inventory.path));
  if (Object.keys(files).length !== inventory.files) fail('inventory_invalid');
  const pin = read(safe('source.json'));
  if (node.version !== '22.22.1' || core.version !== pin.version || core.sourceRevision !== pin.source_revision
      || viewer.sourceRevision !== pin.external_viewer.source_revision || viewer.sourceSha256 !== pin.external_viewer.source_receipt.sourceSha256
      || node.sha256 !== pin.offline_node.executable_sha256
      || browser.sha256 !== pin.offline_browser.executable_sha256 || browser.revision !== pin.offline_browser.revision
      || browser.version !== pin.offline_browser.browserVersion || browser.playwrightVersion !== '1.63.0'
      || resources.minecraftVersion !== '1.21.1' || resources.registrySha256 !== '55893d269459e1e05387903c77b2db877d7cece875ed31a5a6a2f965822ea546') fail('source_mismatch');
  const sourcePin = pin.external_viewer.source_inventory;
  if (sourcePin.file !== 'viewer-source.json' || fileHash(safe(sourcePin.file)) !== sourcePin.sha256) fail('viewer_source_pin_mismatch');
  const sourceMap = read(safe(sourcePin.file), 128 * 1024);
  if (sourceMap.schema !== 'agent-mc-viewer-source/v1' || sourceMap.sourceRevision !== viewer.sourceRevision
      || Object.keys(sourceMap.files).length !== sourcePin.files || sourcePin.files < 1 || sourcePin.files > 2000) fail('viewer_source_pin_mismatch');
  const prefix = path.posix.dirname(viewer.directory) + '/';
  const projection = Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith(prefix)
    && !name.slice(prefix.length).split('/').slice(0, -1).includes('node_modules')).map(([name, row]) => [name.slice(prefix.length), row]));
  if (Object.keys(projection).length !== sourcePin.files || Object.entries(sourceMap.files).some(([name, row]) =>
    projection[name]?.bytes !== row.bytes || projection[name]?.sha256 !== row.sha256)) fail('viewer_source_mismatch');
  if (!files || Array.isArray(files) || Object.keys(files).length < 1 || Object.keys(files).length > 100000) fail('inventory_invalid');
  const names = new Set(); let total = 0;
  for (const [name, row] of Object.entries(files)) {
    if (names.has(name.toLowerCase()) || ['runtime-manifest.json', 'runtime-files.json'].includes(name.toLowerCase())) fail('path_collision');
    names.add(name.toLowerCase());
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 512 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(row.sha256)) fail('inventory_invalid');
    total += row.bytes; if (total > 8 * 1024 ** 3) fail('inventory_too_large');
    const file = safe(name), stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== row.bytes || fileHash(file) !== row.sha256) fail('file_hash_mismatch');
  }
  const required = [node.path, browser.path, browser.license, core.directory + '/package.json', viewer.directory + '/package.json',
    viewer.directory + '/tools/native-world-preview-host.mjs', resources.catalog, resources.appearanceCatalog,
    resources.assetDirectory + '/registry/block-states.jsonl', resources.assetDirectory + '/public/sounds/manifest.json',
    resources.assetDirectory + '/native-assets.json',
    'prepare.cmd', 'prepare.mjs', 'source.json', 'viewer-source.json', ...manifest.licenses];
  if (!manifest.licenses.length || required.some(name => !Object.hasOwn(files, name)) || files[node.path].sha256 !== node.sha256
      || files[browser.path].sha256 !== browser.sha256
      || requireRunningNode && fs.realpathSync(safe(node.path)).toLowerCase() !== fs.realpathSync(process.execPath).toLowerCase()) fail('required_input_missing');
  const seen = new Set();
  function walk(directory) {
    for (const row of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.relative(root, path.join(directory, row.name)).split(path.sep).join('/');
      safe(name);
      if (seen.has(name.toLowerCase())) fail('path_collision'); seen.add(name.toLowerCase());
      if (seen.size > 300000) fail('inventory_too_large');
      if (row.isDirectory()) walk(path.join(directory, row.name));
      else if (!row.isFile() || !['runtime-manifest.json', 'runtime-files.json'].includes(name) && !Object.hasOwn(files, name)) fail('unlisted_file');
    }
  }
  walk(root);
  const catalog = read(safe(resources.catalog), 65536);
  const expected = { schemaVersion: 1, packs: [{ id: 'vanilla-1.21.1', minecraftVersion: '1.21.1', registry: 'vanilla',
    registrySha256: resources.registrySha256, assetDirectory: resources.assetDirectory }] };
  if (JSON.stringify(catalog) !== JSON.stringify(expected) || fileHash(safe(resources.assetDirectory + '/registry/block-states.jsonl')) !== resources.registrySha256) fail('catalog_mismatch');
  for (const [name, sha256] of Object.entries(pin.offline_resources))
    if (files[name]?.sha256 !== sha256) fail('resource_source_mismatch');
  for (const [prefix, table, key] of [
    [resources.assetDirectory, resources.assetDirectory + '/native-assets.json', 'assets'],
    [resources.assetDirectory + '/public/sounds', resources.assetDirectory + '/public/sounds/manifest.json', 'fileMetadata'],
    [path.posix.dirname(resources.appearanceCatalog), resources.appearanceCatalog, 'assets'],
  ]) {
    const rows = read(safe(table))[key];
    if (!rows || Array.isArray(rows) || Object.keys(rows).length > 100000) fail('resource_inventory_invalid');
    for (const [name, row] of Object.entries(rows)) {
      const relative = prefix + '/' + name; safe(relative);
      if (files[relative]?.sha256 !== row.sha256 || files[relative]?.bytes !== row.bytes) fail('resource_inventory_incomplete');
    }
  }
  // The immutable inventory includes both the pinned receipts and all their members.
  const coreRoot = core.directory + '/node_modules/agent-mc-world/';
  const packageInfo = read(safe(coreRoot + 'package.json'));
  if (packageInfo.name !== pin.name || packageInfo.version !== pin.version) fail('core_version_mismatch');
  for (const [name, sha] of Object.entries(pin.verification)) if (fileHash(safe(coreRoot + name)) !== sha) fail('core_build_mismatch');
  for (const receipt of [read(safe(coreRoot + 'dist/build.json'))]) {
    if (receipt.schema !== 'agent-mc-build/v1' || receipt.viewer.included !== false) fail('core_build_mismatch');
    for (const row of [...receipt.files, ...receipt.sourceFiles]) if (fileHash(safe(coreRoot + row.file)) !== row.sha256) fail('core_build_mismatch');
  }
  for (const row of read(safe(coreRoot + 'dist/types/manifest.json')).files)
    if (fileHash(safe(coreRoot + 'dist/types/' + row.file)) !== row.sha256) fail('core_build_mismatch');
  return { manifest, catalog, files, manifestSha256: fileHash(safe('runtime-manifest.json')) };
}

function prepare() {
  if (process.argv.length > 2) fail('unexpected_arguments');
  console.log('Verifying the offline payload...');
  const { manifest, catalog, files, manifestSha256 } = verify();
  if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) fail('localappdata_unavailable');
  const namespace = path.join(process.env.LOCALAPPDATA, 'AgentMCWorld');
  const installation = path.join(namespace, 'installations', manifest.id + '-' + manifestSha256);
  const installedRoot = path.join(installation, 'runtime');
  const catalogPath = path.join(installation, 'viewer-catalog.json');
  catalog.packs[0].assetDirectory = path.resolve(installedRoot, manifest.resources.assetDirectory);
  const registration = { schema: 'agent-mc-runtime-registration/v1', root: installedRoot, manifestSha256, catalog: catalogPath };
  for (const directory of [process.env.LOCALAPPDATA, namespace, path.join(namespace, 'installations')]) {
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) fail('registration_link_forbidden');
    fs.mkdirSync(directory, { recursive: true });
  }
  const records = { 'viewer-catalog.json': catalog, 'registration.json': registration };
  const selectRoot = target => { root = target; realRoot = fs.realpathSync(root); checked.clear(); };
  if (!fs.existsSync(installation)) {
    // An interrupted copy leaves only its uniquely owned stage; the old pointer stays valid.
    const stage = path.join(namespace, 'installations', '.stage-' + manifest.id + '-' + randomUUID());
    const stagedRoot = path.join(stage, 'runtime');
    fs.mkdirSync(stagedRoot, { recursive: true });
    const names = [...Object.keys(files), 'runtime-files.json', 'runtime-manifest.json'];
    console.log(`Installing ${names.length} files into the local runtime cache...`);
    for (const [index, name] of names.entries()) {
      const source = safe(name), destination = path.join(stagedRoot, ...name.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      if ((index + 1) % 10000 === 0) console.log(`Copied ${index + 1}/${names.length} files`);
    }
    selectRoot(stagedRoot);
    console.log('Verifying the installed copy...');
    if (verify(false).manifestSha256 !== manifestSha256) fail('manifest_hash_mismatch');
    for (const [name, value] of Object.entries(records))
      fs.writeFileSync(path.join(stage, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(stage, installation);
  } else {
    if (fs.lstatSync(installation).isSymbolicLink()) fail('registration_link_forbidden');
    selectRoot(installedRoot);
    if (verify(false).manifestSha256 !== manifestSha256) fail('manifest_hash_mismatch');
    for (const [name, value] of Object.entries(records)) {
      const target = path.join(installation, name);
      if (fs.lstatSync(target).isSymbolicLink()) fail('registration_link_forbidden');
      if (fs.readFileSync(target, 'utf8') !== JSON.stringify(value, null, 2) + '\n') fail('registration_conflict');
    }
  }
  const pointer = path.join(namespace, 'current.json'), bytes = JSON.stringify(registration, null, 2) + '\n';
  if (fs.existsSync(pointer) && fs.lstatSync(pointer).isSymbolicLink()) fail('registration_link_forbidden');
  if (fs.existsSync(pointer) && fs.readFileSync(pointer, 'utf8') === bytes) return;
  const temporary = path.join(namespace, '.current-' + randomUUID() + '.tmp');
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, pointer); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

try { prepare(); console.log('Offline runtime verified and prepared. No application was started.'); }
catch (error) { console.error(error.message?.startsWith('runtime_bundle_') ? error.message : 'runtime_bundle_preparation_failed: check complete extraction and local folder permissions'); process.exitCode = 1; }
