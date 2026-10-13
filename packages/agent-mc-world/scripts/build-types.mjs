import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist/types');
if (output !== join(root, 'dist', 'types')) throw new Error('Invalid declaration output path');
// Run in a release checkout, as with the engine/viewer build.
await rm(output, { recursive: true, force: true });
const entries = ['src/index.ts', 'src/extension.ts', 'src/client/index.ts', 'src/client/contracts.ts', 'src/contracts/index.ts', 'src/mcp/server.ts', 'src/mcp/stdio.ts', 'bridges/performance/relay.d.mts'];
const program = ts.createProgram(entries.map(path => join(root, path)), {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true, esModuleInterop: true, skipLibCheck: true, allowImportingTsExtensions: true,
  declaration: true, emitDeclarationOnly: true, rootDir: root, outDir: output,
  types: ['node'],
});
const errors = [...program.getOptionsDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
  .filter(d => d.category === ts.DiagnosticCategory.Error);
if (errors.length) throw new Error(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
// Emit only the public declaration graph. Private implementation imports must
// not make SDK consumers type-check the full Mineflayer execution engine.
const options = program.getCompilerOptions(), host = ts.createCompilerHost(options);
// Native extension declarations are isolated from invalid upstream ambient declarations.
// These are pinned declaration-only copies, with licenses and source hashes; no runtime patching.
const nativeRoot = join(root, 'vendor/native-types');
const nativeManifest = JSON.parse(await readFile(join(nativeRoot, 'manifest.json'), 'utf8'));
const nativeTarget = (resolved) => {
  const file = resolved.replaceAll('\\', '/');
  const candidates = nativeManifest.files.filter(entry => file.endsWith('/node_modules/' + entry.package + '/' + entry.path));
  if (!candidates.length) return undefined;
  let directory = dirname(resolved);
  while (directory !== dirname(directory) && !existsSync(join(directory, 'package.json'))) directory = dirname(directory);
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const match = candidates.find(entry => entry.package === pkg.name && entry.version === pkg.version);
  if (!match) throw new Error('Native declaration version not audited: ' + pkg.name + '@' + pkg.version);
  return match;
};
for (const entry of nativeManifest.files) {
  const bytes = await readFile(join(nativeRoot, entry.file));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Native declaration hash: ' + entry.file);
}
await cp(nativeRoot, join(output, 'native'), { recursive: true });
const pending = entries.map(file => join(root, file));
pending.push(join(root, 'core/pathfinder-lib.d.ts'));
const visited = new Set();
while (pending.length) {
  const path = resolve(pending.shift());
  if (visited.has(path)) continue;
  visited.add(path);
  const emitted = [];
  if (/\.d\.(?:ts|mts)$/.test(path)) {
    emitted.push({ file: join(output, path.slice(root.length + 1)), text: await readFile(path, 'utf8') });
  } else {
    const source = program.getSourceFile(path);
    if (!source) throw new Error('Declaration source missing: ' + path);
    const result = program.emit(source, (file, text) => emitted.push({ file, text }));
    if (result.emitSkipped || result.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error))
      throw new Error('Public declaration emit failed: ' + path + '\n'
        + result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  }
  for (const { file, text } of emitted) {
    await mkdir(dirname(file), { recursive: true });
    const relocated = text.replace(/(['"])([^'"\r\n]+)\1/g, (all, quote, spec) => {
      const resolved = ts.resolveModuleName(spec, path, options, host).resolvedModule?.resolvedFileName;
      const native = resolved && nativeTarget(resolved);
      if (!native) return all;
      let target = relative(dirname(file), join(output, 'native', native.file)).replaceAll('\\', '/').replace(/\.d\.ts$/, '.js');
      if (!target.startsWith('.')) target = './' + target;
      return quote + target + quote;
    });
    await writeFile(file, relocated.replace(/(['"])([^'"\r\n]*?)\.ts\1/g, '$1$2.js$1').replace(/(['"])([^'"\r\n]*?)\.mts\1/g, '$1$2.mjs$1'));
    for (const imported of ts.preProcessFile(text, true).importedFiles) {
      const dependency = ts.resolveModuleName(imported.fileName, path, options, host).resolvedModule?.resolvedFileName;
      if (dependency) {
        const within = relative(root, dependency).replaceAll('\\', '/');
        if (!within.startsWith('../') && !isAbsolute(within) && !within.startsWith('node_modules/')) pending.push(dependency);
      }
    }
  }
}
const files = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files.push({ file: path.slice(output.length + 1).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
}
await collect(output);
await writeFile(join(output, 'manifest.json'), JSON.stringify({ schema: 'agent-mc-world-types/v1',
  typescript: ts.version, files }, null, 2) + '\n');
console.log(`Public declarations: ${files.length} files`);
