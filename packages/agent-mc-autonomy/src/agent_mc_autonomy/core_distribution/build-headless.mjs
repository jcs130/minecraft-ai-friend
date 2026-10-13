// Compile the pinned core without its unrelated Java 1.20.6 viewer distribution.
// This is a N.E.K.O headless build, not the upstream release artifact.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(process.argv[2]);
const require = createRequire(join(root, 'package.json'));
const { transform } = await import(pathToFileURL(require.resolve('esbuild')));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(path) {
  const entries = (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'en'));
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(join(path,e.name)) : [join(path,e.name)]))).flat();
}
const sources = ['core','src/client','src/contracts','src/runtime','src/mcp/server.ts','src/mcp/stdio.ts',
  'src/index.ts','src/extension.ts','src/chat-provenance.ts','src/collect-contract.ts','src/mounted-look.ts',
  'src/vehicle-state.ts','src/railway.ts','src/blueprint-railway.ts','bridges/performance'];
const sourceFiles = [], files = [];
for (const source of sources) {
  for (const path of source.includes('.') ? [join(root,source)] : await walk(join(root,source))) {
    const name = relative(root,path).replaceAll('\\','/'), bytes = await readFile(path);
    // Native Fabric 1.20.6 mods and a redundant inherited license copy are not runtime assets.
    // The package LICENSE retains the supplied MIT notices; third-party types retain theirs.
    if (name.startsWith('core/native-chat-filter/') || name === 'core/LICENSE-Cortico.txt') continue;
    sourceFiles.push({file:name,sha256:digest(bytes)});
    if (/\.d\.[cm]?ts$/.test(path)) continue;
    let target = join(root,'dist/runtime',name), emitted = bytes;
    if (/\.(ts|mts)$/.test(path)) {
      target = target.replace(/\.mts$/,'.mjs').replace(/\.ts$/,'.js');
      const result = await transform(bytes.toString('utf8'),{loader:'ts',format:'esm',target:'node22',sourcefile:name});
      emitted = Buffer.from(result.code.replace(/(['"])([^'"\r\n]*?)\.ts\1/g,'$1$2.js$1').replace(/(['"])([^'"\r\n]*?)\.mts\1/g,'$1$2.mjs$1'));
    }
    await mkdir(dirname(target),{recursive:true}); await writeFile(target,emitted);
    files.push({file:relative(root,target).replaceAll('\\','/'),sha256:digest(emitted)});
  }
}
await writeFile(join(root,'dist/neko-headless.json'),JSON.stringify({
  schema:'neko-headless/v1',sourceRevision:'7889ce261a2309d94400b739c6198468d8271d83',
  protocol:'agent-mc/v1',minecraftVersion:'1.21.1',bundledViewer:false,
  patches:JSON.parse(await readFile(new URL('./source.json',import.meta.url),'utf8')).patches,
  sourceFiles,files,
},null,2)+'\n');
console.log(`Headless core compiled: ${files.length} files; no viewer, server or model started.`);
