import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, link, stat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Build-time JavaScript helper has no SDK declaration surface.
import { copyViewerAssets } from '../scripts/copy-viewer-assets.mjs';

it('materializes hard-linked asset aliases independently of omitted source paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'viewer-package-assets-'));
  try {
    const source = join(root, 'source'), target = join(root, 'package'), omitted = join(root, 'omitted.ogg');
    await mkdir(source);
    await writeFile(omitted, 'original audio fixture');
    await link(omitted, join(source, 'first.ogg'));
    await link(omitted, join(source, 'second.ogg'));
    await copyViewerAssets(source, target);
    const files = await Promise.all([omitted, join(target, 'first.ogg'), join(target, 'second.ogg')].map(path => stat(path, { bigint: true })));
    expect(new Set(files.map(file => file.ino)).size).toBe(3);
    await writeFile(join(target, 'first.ogg'), 'modified copy');
    expect(await readFile(omitted, 'utf8')).toBe('original audio fixture');
    expect(await readFile(join(target, 'second.ogg'), 'utf8')).toBe('original audio fixture');
  } finally { await rm(root, { recursive: true, force: true }); }
});
