import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = new URL('../', import.meta.url);
const packed = process.argv.includes('--packed');
const manifest = JSON.parse(await readFile(new URL('dist/build.json', root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Source builds verify every input and both generated copies. Installed npm
// consumers also verify every declared source input, alongside the shipped
// runtime, without requiring an omitted third-party build archive.
const shipped = manifest.files.filter(entry => /^dist\/(?:runtime\/|monitor\/)/.test(entry.file));
for (const entry of packed ? [...shipped, ...manifest.sourceFiles] : [...manifest.sourceFiles, ...manifest.files]) {
  if (entry.file.includes('..') || entry.file.startsWith('/')) throw new Error('Invalid build path');
  if (hash(await readFile(new URL(entry.file, root))) !== entry.sha256) throw new Error('Build differs from source: ' + entry.file);
}
const sources=JSON.parse(await readFile(new URL('release-sources.json',root),'utf8'));
if (!packed && manifest.viewer.included !== false) {
  if(hash(await readFile(new URL(sources.viewer.artifact,root)))!==sources.viewer.sha256)throw new Error('Viewer input hash mismatch');
} else if (manifest.viewer.included === false && manifest.files.some(entry => /^dist\/(?:runtime\/dist\/)?(?:viewer|client-console|monitor)\//.test(entry.file))) {
  throw new Error('Viewer assets leaked into an engine-only build');
}
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (pkg.dependencies?.cortico || pkg.devDependencies?.cortico || pkg.cortico) throw new Error('Default package must be host-independent');
if (Object.keys(pkg.exports).some(key => /cortico/i.test(key)) || manifest.files.some(entry => /adapters\/(?:cortico|minecraft)/i.test(entry.file)))
  throw new Error('Host adapter leaked into the independent core distribution');
// A declared public entry must ship both its runtime and declarations. Source
// manifests alone cannot detect a newly declared entry omitted by build inputs.
for (const [name,entry] of Object.entries(pkg.exports)) {
  for (const target of typeof entry==='string'?[entry]:Object.values(entry)) {
    if(typeof target!=='string'||!target.startsWith('./')||target.includes('..'))throw new Error('Invalid public entry '+name);
    try{await readFile(new URL(target,root));}catch{throw new Error('Missing public entry '+name+': '+target);}
  }
}
// A server/host package must consume the core; the inverse would make the
// standalone client depend on an adapter checkout again. Check shipped modules.
for (const entry of manifest.files.filter(e => /^dist\/runtime\/(?:core|src)\/.*\.(?:js|mjs)$/.test(e.file))) {
  const code = await readFile(new URL(entry.file, root), 'utf8');
  if (/(?:from\s*|import\s*\(\s*|import\s*)['"](?:agent-mc-qiandengji|cortico(?:-world-[^/'"]+)?|dsh-minecraft-agent|neko)(?:\/|['"])/i.test(code))
    throw new Error('Reverse adapter dependency in core: ' + entry.file);
  if (entry.file.startsWith('dist/runtime/core/') && /['"][^'"]*src\/decisions\//.test(code))
    throw new Error('Game process must not import host decision services: ' + entry.file);
}
const declarations = JSON.parse(await readFile(new URL('dist/types/manifest.json', root), 'utf8'));
for (const entry of declarations.files) {
  const bytes = await readFile(new URL('dist/types/' + entry.file, root));
  if (hash(bytes) !== entry.sha256 || /(?:from|import)\s*\(?\s*['"](?:cortico|neko)(?:\/|['"])/i.test(bytes.toString()))
    throw new Error('Public declaration dependency/hash violation: ' + entry.file);
}
const sdk = await import(new URL(pkg.exports['.'].default, root));
if (typeof sdk.MinecraftAgentClient !== 'function' || sdk.PROTOCOL !== 'agent-mc/v1' || 'MC' in sdk)
  throw new Error('The default export must be the neutral SDK');
console.log(packed ? 'Complete packed runtime, public declarations and default entry verified.' : 'Source, runtime, public declarations and default entry verified.');
