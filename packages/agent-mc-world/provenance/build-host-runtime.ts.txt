import { build } from 'esbuild';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Package the small host utility dependency closure; no Core or Persona is started. */
export async function buildHostRuntime(root: string, coreRoot: string): Promise<void> {
  const utility = (file: string) => JSON.stringify(join(coreRoot, 'src', file).replaceAll('\\', '/'));
  const engine = join(root, 'engine');
  await build({
    stdin: { contents: [
      `export { nowIso, nullLogger } from ${utility('core/util.ts')};`,
      `export { createIpcLogger, emitLogNote, logChildStdio, logLines } from ${utility('core/ipc-logger.ts')};`,
      `export { withAnchors } from ${utility('core/log-context.ts')};`,
      `export { renderTemplate } from ${utility('core/template.ts')};`,
    ].join('\n'), resolveDir: coreRoot, loader: 'ts' },
    outfile: join(engine, 'support/runtime.mjs'), bundle: true, platform: 'node', format: 'esm',
    target: 'node22', legalComments: 'eof',
  });
  await writeFile(join(engine, 'support/runtime.d.mts'), (await readFile(join(root, 'src/runtime/host-runtime.d.mts'), 'utf8'))
    .replaceAll('../client/contracts.ts', './host-contract.ts'));
  await cp(join(root, 'src/runtime/child-process.ts'), join(engine, 'support/child-process.ts'));
  // Rewrite after the patch series, which applies against the pinned upstream import paths.
  for (const file of await readdir(engine)) {
    if (!file.endsWith('.ts')) continue;
    const path = join(engine, file);
    const source = await readFile(path, 'utf8');
    await writeFile(path, source
      .replace(/(from )(['"])cortico\/core\/(?:util|ipc-logger|log-context)\.ts\2/g, '$1\'./support/runtime.mjs\'')
      .replaceAll("from 'cortico/extensions/runtime.ts'", "from './support/child-process.ts'"));
  }
}
