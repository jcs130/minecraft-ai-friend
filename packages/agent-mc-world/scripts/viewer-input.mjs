import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Only missing optional input may be skipped. A present but mismatched
 * archive still fails verification; no downloads or checksum rewriting. */
export async function readViewerInput(file, sha256, { required = false, disabled = false } = {}) {
  if (required && disabled) throw new Error('Conflicting viewer build options');
  if (disabled) return { included: false, reason: 'explicitly disabled' };
  let bytes;
  try { bytes = await readFile(file); }
  catch (error) {
    if (error.code !== 'ENOENT' || required) throw error;
    return { included: false, reason: 'locked archive is absent; run scripts/prepare-viewer.mjs to enable it' };
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Viewer artifact hash mismatch');
  return { included: true };
}
