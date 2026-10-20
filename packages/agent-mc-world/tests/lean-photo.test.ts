import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { viewerPhotoPage } from '../core/viewer-photo-page.mjs';
it('keeps the lean photo page camera-specific and rejects unsupported modes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lean-photo-'));
  try {
    await mkdir(join(dir, 'public')); await writeFile(join(dir, 'public/index.html'), '<html><head></head><body><canvas id="viewer-canvas"></canvas><div>HUD</div><script src="/index.js"></script></body></html>');
    for (const mode of ['first', 'third', '3dview'] as const) {
      const html = await viewerPhotoPage(dir, mode); expect(html).toContain(`data-view-mode="${mode}"`);
      expect(html).toContain(':not(#viewer-canvas)'); expect(html).not.toContain('corti-speech-bubble');
    }
    await expect(viewerPhotoPage(dir, 'other' as any)).rejects.toThrow('PHOTO_VIEW_MODE_INVALID');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
