import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { checkSkinBytes } from './client-skins.ts';

export interface LocalPlayerSkin { bytes: Uint8Array; model: 'classic' | 'slim' }
/** Explicit local display override, not a server-side skin change. No remote URL or path is accepted. */
export function configuredPlayerSkin(input: LocalPlayerSkin) {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length > 256 * 1024) throw new Error('Skin PNG exceeds 256 KiB');
  if (!['classic','slim'].includes(input.model)) throw new Error('Unknown skin arm model');
  const dimensions = checkSkinBytes(input.bytes);
  if ('error' in dimensions) throw new Error(dimensions.error);
  try { const png = PNG.sync.read(Buffer.from(input.bytes));
    if (png.width !== dimensions.width || png.height !== dimensions.height) throw new Error();
  } catch { throw new Error('Skin PNG cannot be decoded'); }
  const bytes = Buffer.from(input.bytes), sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256, ...dimensions, skinUrl: `/agent-skin/${sha256}.png`, skinModel: input.model,
    skinSource: 'local-viewer-override' as const };
}
