import { readdir, readFile, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { readViewerInput } from './viewer-input.mjs';
import { copyViewerAssets } from './copy-viewer-assets.mjs';
import { deferViewerAudio } from './defer-viewer-audio.mjs';
import {shareViewerAssets} from '../core/viewer-shared-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist/runtime');
if (resolve(output) !== join(root, 'dist', 'runtime')) throw new Error('Invalid runtime output path');
// Remove only this build's generated subtree so moved modules cannot survive in a later package.
await rm(output, {recursive:true,force:true});
export const digest = data => createHash('sha256').update(data).digest('hex');
const walk = async path => (await Promise.all((await readdir(path, { withFileTypes: true })).map(async e =>
  e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)]))).flat();
const sources = ['core', 'src/decisions', 'src/motor', 'src/learning', 'src/client', 'src/contracts', 'src/runtime', 'src/mcp/server.ts', 'src/mcp/stdio.ts',
  'src/index.ts', 'src/context.ts', 'src/observations.ts', 'src/extension.ts', 'src/tactics.ts', 'src/server-tools.ts', 'src/equipment-access.ts', 'src/chat-provenance.ts', 'src/collect-contract.ts', 'src/mounted-look.ts', 'src/vehicle-state.ts',
  'src/railway.ts', 'src/blueprint-railway.ts', 'bridges/performance', 'bridges/harness2/worker.py', 'bridges/harness2/requirements.txt', 'training/worker.ts'];
const inputs = [];
for (const source of sources) {
  const path = join(root, source);
  inputs.push(...(source.includes('.') ? [path] : await walk(path)));
}
const files = [], sourceFiles = [];
for (const path of inputs) {
  const name = relative(root, path).replaceAll('\\', '/');
  const bytes = await readFile(path);
  sourceFiles.push({ file: name, sha256: digest(bytes) });
  if (/\.d\.[cm]?ts$/.test(path)) continue;
  let target = join(output, name), emitted = bytes;
  if (/\.(?:ts|mts)$/.test(path)) {
    target = target.replace(/\.mts$/, '.mjs').replace(/\.ts$/, '.js');
    const result = await transform(bytes.toString('utf8'), { loader: 'ts', format: 'esm', target: 'node22', sourcefile: name });
    // Relative module URLs, worker URLs and file imports keep the same directory graph after emission.
    emitted = Buffer.from(result.code.replace(/(['"])([^'"\r\n]*?)\.ts\1/g, '$1$2.js$1').replace(/(['"])([^'"\r\n]*?)\.mts\1/g, '$1$2.mjs$1'));
  }
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, emitted);
  files.push({ file: relative(root, target).replaceAll('\\', '/'), sha256: digest(emitted) });
}
// Training remains source-shipped; hash only declared inputs, excluding runs, environments and local tools.
for (const source of ['training/runner.py', 'training/trajectory.py', 'training/gym_env.py', 'training/ppo.py', 'training/test_ppo.py', 'training/test_trajectory.py', 'training/export_gameplay.py', 'training/test_export_gameplay.py',
  'training/requirements.txt', 'training/schema', 'training/generated']) {
  const path = join(root, source);
  const declared = source.includes('.') ? [path] : (await walk(path)).filter(file => !file.includes('__pycache__') && !file.endsWith('.pyc'));
  for (const file of declared) sourceFiles.push({ file: relative(root, file).replaceAll('\\', '/'), sha256: digest(await readFile(file)) });
}
const lock = JSON.parse(await readFile(join(root, 'release-sources.json'), 'utf8'));
const archive = join(root, lock.viewer.artifact);
const viewerInput = await readViewerInput(archive, lock.viewer.sha256, {
  required: process.argv.includes('--require-viewer'), disabled: process.argv.includes('--without-viewer'),
});
if (!viewerInput.included) console.warn('Viewer skipped: ' + viewerInput.reason + '. Engine and SDK remain available.');
await mkdir(join(root, 'dist'), { recursive: true });
// Only generated asset trees: stale monitor captures and bytecode are never release inputs.
for (const name of ['viewer', 'client-console', 'monitor']) {
  const generated = resolve(root, 'dist', name);
  if (generated !== join(root, 'dist', name)) throw new Error('Invalid asset output path');
  await rm(generated, { recursive: true, force: true });
}
if (viewerInput.included) {
execFileSync('tar', ['-xzf', archive, '-C', join(root, 'dist'),
  '--exclude=__pycache__', '--exclude=*.pyc', '--exclude=monitor/outputs',
  '--exclude=.gitignore', '--exclude=.npmignore'], { stdio: 'inherit' });
if (process.argv.includes('--deferred-audio')) viewerInput.audio = await deferViewerAudio(join(root, 'dist/viewer'), lock.viewer.sha256);
// Emitted config URLs remain valid when SDK and child processes run from dist/runtime.
await copyViewerAssets(join(root, 'dist/viewer'), join(output, 'dist/viewer'));
viewerInput.sharedAssets=await shareViewerAssets(join(output,'dist/viewer'),{generated:true});
await cp(join(root, 'dist/client-console'), join(output, 'dist/client-console'), { recursive: true });
for (const directory of ['dist/viewer','dist/client-console','dist/monitor','dist/runtime/dist/viewer','dist/runtime/dist/client-console'])
  for (const path of await walk(join(root,directory))) files.push({file:relative(root,path).replaceAll('\\','/'),sha256:digest(await readFile(path))});
}
await writeFile(join(root, 'dist/build.json'), JSON.stringify({ schema: 'agent-mc-build/v1', protocol: 'agent-mc/v1',
  core: 'owned-source', sourceFiles, files, viewer: { ...lock.viewer, ...viewerInput } }, null, 2) + '\n');
console.log(`Independent runtime: ${files.length} files. No framework checkout, patch step or network used.`);
