import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { readViewerInput } from '../scripts/viewer-input.mjs';

it('builds without optional viewer, but never accepts a corrupt archive as a release input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-viewer-input-')), file = join(dir, 'viewer.tgz');
  try {
    expect(await readViewerInput(file, 'no-file')).toMatchObject({ included: false });
    await expect(readViewerInput(file, 'no-file', { required: true })).rejects.toThrow();
    writeFileSync(file, 'fixture');
    await expect(readViewerInput(file, 'wrong')).rejects.toThrow();
    const hash = createHash('sha256').update('fixture').digest('hex');
    expect(await readViewerInput(file, hash)).toMatchObject({ included: true });
    expect(await readViewerInput(file, hash, { disabled: true })).toMatchObject({ included: false });
    await expect(readViewerInput(file, hash, { disabled: true, required: true })).rejects.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
