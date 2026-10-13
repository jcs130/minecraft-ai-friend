import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHostRuntime } from './build-host-runtime.ts';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = JSON.parse(await readFile(join(root, 'release-sources.json'), 'utf8')) as {
  cortico: { repository: string; commit: string; patches?: string[] };
  viewer: { repository: string; commit: string; assetPack: string; preset: string | null };
};

function sourceRoot(variable: string, fallback: string, expected: string): string {
  const directory = resolve(process.env[variable] || join(root, '.sources', fallback));
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
  if (actual !== expected) throw new Error(`${variable}: expected ${expected}, got ${actual}`);
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src', 'scripts', 'tools', 'packages'],
    { cwd: directory, stdio: 'pipe' });
  return directory;
}

async function buildEngine(): Promise<void> {
  const coreRoot = sourceRoot('CORTICO_SOURCE_DIR', 'cortico', sources.cortico.commit);
  const viewerRoot = sourceRoot('MC_VISUAL_CONSOLE_DIR', 'viewer', sources.viewer.commit);
  const planner = await import(pathToFileURL(join(coreRoot, 'scripts/publish-worlds.ts')).href) as {
    planWorldPackage: (id: string) => { sources: Map<string, string>; externals: string[]; problems: string[] };
  };
  const plan = planner.planWorldPackage('minecraft');
  if (plan.problems.length) throw new Error(plan.problems.join('\n'));
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const name of plan.externals) {
    if (!manifest.dependencies[name]) throw new Error(`Missing engine dependency: ${name}`);
  }
  const engineRoot = join(root, 'engine');
  const source = join(coreRoot, 'src/worlds/minecraft');
  await rm(engineRoot, { recursive: true, force: true });
  await cp(source, engineRoot, { recursive: true });
  for (const [relative, contents] of plan.sources) {
    const target = join(engineRoot, relative);
    await mkdir(dirname(target), { recursive: true });
    let rewritten = contents
      .replaceAll('cortico/protocol/typed-decision.ts', './support/typed-decision.ts')
      .replaceAll('cortico/core/types.ts', './support/host-contract.ts');
    if (relative === 'definition.ts') rewritten = rewritten.replace(
      'WorldDefinition<MinecraftConfigSection> =',
      'WorldDefinition<MinecraftConfigSection> & { exclusiveResource: string } =');
    await writeFile(target, rewritten);
  }
  await mkdir(join(engineRoot, 'support'), { recursive: true });
  await cp(join(root, 'src/client/contracts.ts'), join(engineRoot, 'support/host-contract.ts'));
  await cp(join(coreRoot, 'src/protocol/typed-decision.ts'), join(engineRoot, 'support/typed-decision.ts'));
  const consoleRoot = join(engineRoot, 'console');
  for (const file of await readdir(consoleRoot)) {
    if (!file.endsWith('.ts')) continue;
    const path = join(consoleRoot, file);
    await writeFile(path, (await readFile(path, 'utf8'))
      .replaceAll('../../../web/shared/client-panel.ts', 'cortico/web/shared/client-panel.ts'));
  }
  await cp(join(coreRoot, 'LICENSE'), join(engineRoot, 'LICENSE-Cortico.txt'));
  const patches = [];
  for (const file of sources.cortico.patches ?? []) {
    const patch = await readFile(join(root, file));
    execFileSync('git', ['apply', '--check', '--directory=engine', file], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['apply', '--directory=engine', file], { cwd: root, stdio: 'pipe' });
    patches.push({ file, sha256: createHash('sha256').update(patch).digest('hex') });
  }
  await buildHostRuntime(root, coreRoot);
  const hostRuntime = await Promise.all(['runtime.mjs', 'runtime.d.mts', 'child-process.ts', 'host-contract.ts'].map(async file => ({
    file, sha256: createHash('sha256').update(await readFile(join(engineRoot, 'support', file))).digest('hex'),
  })));
  const viewerFiles = [];
  await cp(join(root, 'src/viewer-photo-page.d.mts'), join(engineRoot, 'viewer-photo-page.d.mts'));
  for (const file of ['viewer-content.mjs', 'viewer-content.d.mts', 'text-display.mjs',
    'viewer-appearance.mjs', 'viewer-appearance.d.mts', 'viewer-ysm-assets.mjs', 'viewer-ysm-motion.mjs',
    'viewer-observer.mjs', 'viewer-observer.d.mts',
    'viewer-photo-page.mjs', 'viewer-page-assets.mjs']) {
    const bytes = await readFile(join(viewerRoot, 'packages/modern-viewer/renderer-src/host', file));
    await writeFile(join(engineRoot, file), bytes);
    viewerFiles.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  // Bundle the shared host and its protocol together; preserve source identities
  // without rewriting imports or copying browser source into this client's SDK.
  const agentSource = join(viewerRoot, 'packages/modern-viewer/renderer-src/host/viewer-agent.mjs');
  const agent = await build({ entryPoints: [agentSource], bundle: true, platform: 'node',
    format: 'esm', target: 'node22', write: false, metafile: true });
  const agentBytes = agent.outputFiles[0].contents;
  await writeFile(join(engineRoot, 'viewer-agent.mjs'), agentBytes);
  viewerFiles.push({ file: 'viewer-agent.mjs', sha256: createHash('sha256').update(agentBytes).digest('hex') });
  const agentTypes = await readFile(join(root, 'src/viewer-agent.d.mts'));
  await writeFile(join(engineRoot, 'viewer-agent.d.mts'), agentTypes);
  viewerFiles.push({ file: 'viewer-agent.d.mts', sha256: createHash('sha256').update(agentTypes).digest('hex') });
  const agentSources = await Promise.all(Object.keys(agent.metafile!.inputs).map(async file => ({
    file: relative(viewerRoot, resolve(file)).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(await readFile(resolve(file))).digest('hex'),
  })));
  await writeFile(join(engineRoot, 'source.json'), JSON.stringify({ ...sources.cortico, patches, hostRuntime,
    viewerContent: { commit: sources.viewer.commit, files: viewerFiles, agentSources },
  }, null, 2) + '\n');
  console.log(`Engine: ${sources.cortico.commit}`);
}

async function buildViewer(): Promise<void> {
  const viewerRoot = sourceRoot('MC_VISUAL_CONSOLE_DIR', 'viewer', sources.viewer.commit);
  const preparer = await import(pathToFileURL(join(viewerRoot, 'tools/prepare-viewer-assets.mjs')).href) as {
    prepareAssetPack: (options: { id: string; outputDirectory: string; preset: string | null }) => Promise<unknown>;
  };
  const outputDirectory = join(root, 'dist/viewer');
  await preparer.prepareAssetPack({ id: sources.viewer.assetPack, outputDirectory, preset: sources.viewer.preset });
  await cp(join(viewerRoot, 'LICENSE'), join(outputDirectory, 'LICENSE-mc-visual-console.txt'));
  const client = await readFile(join(outputDirectory, 'viewer-client.json'));
  await writeFile(join(outputDirectory, 'source.json'), JSON.stringify({ ...sources.viewer,
    viewerClientManifestSha256: createHash('sha256').update(client).digest('hex'),
  }, null, 2) + '\n');
  await buildMonitor(viewerRoot);
  await buildClientConsole(viewerRoot);
  console.log(`Viewer: ${sources.viewer.commit}`);
}

async function buildClientConsole(viewerRoot: string): Promise<void> {
  const source = join(viewerRoot, 'tools/client-console'), target = join(root, 'dist/client-console');
  await mkdir(target, { recursive: true });
  const files = [];
  for (const file of ['index.html', 'console.css', 'console.js', 'README.md']) {
    const bytes = await readFile(join(source, file));
    await writeFile(join(target, file), bytes);
    files.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(target, 'source.json'), JSON.stringify({ repository: sources.viewer.repository,
    commit: sources.viewer.commit, files }, null, 2) + '\n');
}

async function buildMonitor(viewerRoot: string): Promise<void> {
  const source = join(viewerRoot, 'tools/model-status-overlay');
  const target = join(root, 'dist/monitor');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const files = ['server.py', 'metrics.py', 'brain.py', 'connections.py', 'harness.py',
    'test_server.py', 'test_metrics.py', 'test_brain.py', 'test_connections.py', 'test_harness.py', 'test_engine_metadata.py',
    'overlay.config.example.json', 'README.md', 'BRAIN-METRICS.md', 'METRICS-CONTRACT.md', 'HARNESS-METRICS.md',
    'qa.mjs', 'start.ps1', ...((await readdir(join(source, 'public'))).map(file => `public/${file}`))];
  const hashes = [];
  for (const file of files) {
    const bytes = await readFile(join(source, file));
    await mkdir(dirname(join(target, file)), { recursive: true });
    await writeFile(join(target, file), bytes);
    hashes.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(target, 'source.json'), JSON.stringify({ repository: sources.viewer.repository,
    commit: sources.viewer.commit, files: hashes }, null, 2) + '\n');
}

const stage = process.argv[2] || 'all';
if (!['engine', 'viewer', 'all'].includes(stage)) throw new Error('Expected engine, viewer or all');
if (stage !== 'viewer') await buildEngine();
if (stage !== 'engine') await buildViewer();
