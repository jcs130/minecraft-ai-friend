import { readdir, readFile, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist/runtime');
if (resolve(output) !== join(root, 'dist', 'runtime')) throw new Error('Invalid runtime output path');
// Remove only this build's generated subtree so moved modules cannot survive in a later package.
await rm(output, {recursive:true,force:true});
export const digest = data => createHash('sha256').update(data).digest('hex');
const walk = async path => (await Promise.all((await readdir(path, { withFileTypes: true })).map(async e =>
  e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)]))).flat();
const sources = ['core', 'src/client', 'src/contracts', 'src/runtime', 'src/mcp/server.ts', 'src/mcp/stdio.ts',
  'src/index.ts', 'src/extension.ts', 'src/chat-provenance.ts', 'src/collect-contract.ts', 'src/mounted-look.ts', 'src/vehicle-state.ts',
  'src/railway.ts', 'src/blueprint-railway.ts', 'bridges/performance'];
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
const lock = JSON.parse(await readFile(join(root, 'release-sources.json'), 'utf8'));
const archive = join(root, lock.viewer.artifact);
if (digest(await readFile(archive)) !== lock.viewer.sha256) throw new Error('Viewer artifact hash mismatch');
await mkdir(join(root, 'dist'), { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', join(root, 'dist')], { stdio: 'inherit' });
// Emitted config URLs remain valid when SDK and child processes run from dist/runtime.
await cp(join(root, 'dist/viewer'), join(output, 'dist/viewer'), { recursive: true });
await cp(join(root, 'dist/client-console'), join(output, 'dist/client-console'), { recursive: true });
for (const directory of ['dist/viewer','dist/client-console','dist/monitor','dist/runtime/dist/viewer','dist/runtime/dist/client-console'])
  for (const path of await walk(join(root,directory))) files.push({file:relative(root,path).replaceAll('\\','/'),sha256:digest(await readFile(path))});
await writeFile(join(root, 'dist/build.json'), JSON.stringify({ schema: 'agent-mc-build/v1', protocol: 'agent-mc/v1',
  core: 'owned-source', sourceFiles, files, viewer: lock.viewer }, null, 2) + '\n');
console.log(`Independent runtime: ${files.length} files. No framework checkout, patch step or network used.`);
