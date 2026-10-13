import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('dist/build.json', root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const entry of [...manifest.sourceFiles, ...manifest.files]) {
  if (entry.file.includes('..') || entry.file.startsWith('/')) throw new Error('Invalid build path');
  if (hash(await readFile(new URL(entry.file, root))) !== entry.sha256) throw new Error('Build differs from source: ' + entry.file);
}
const sources=JSON.parse(await readFile(new URL('release-sources.json',root),'utf8'));
if(hash(await readFile(new URL(sources.viewer.artifact,root)))!==sources.viewer.sha256)throw new Error('Viewer input hash mismatch');
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (pkg.dependencies?.cortico || pkg.devDependencies?.cortico || pkg.cortico) throw new Error('Default package must be host-independent');
if (Object.keys(pkg.exports).some(key => /cortico/i.test(key)) || manifest.files.some(entry => /adapters\/(?:cortico|minecraft)/i.test(entry.file)))
  throw new Error('Host adapter leaked into the independent core distribution');
const declarations = JSON.parse(await readFile(new URL('dist/types/manifest.json', root), 'utf8'));
for (const entry of declarations.files) {
  const bytes = await readFile(new URL('dist/types/' + entry.file, root));
  if (hash(bytes) !== entry.sha256 || /(?:from|import)\s*\(?\s*['"](?:cortico|neko)(?:\/|['"])/i.test(bytes.toString()))
    throw new Error('Public declaration dependency/hash violation: ' + entry.file);
}
const sdk = await import(new URL(pkg.exports['.'].default, root));
if (typeof sdk.MinecraftAgentClient !== 'function' || sdk.PROTOCOL !== 'agent-mc/v1' || 'MC' in sdk)
  throw new Error('The default export must be the neutral SDK');
console.log('Source, runtime, public declarations and default entry verified.');
