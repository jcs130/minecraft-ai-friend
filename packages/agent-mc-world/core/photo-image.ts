import type { PhotoImage } from '../src/contracts/photography.ts';
/** Reject mislabeled error pages; do not save HTML/JSON as an image. */
export function imageMime(bytes: Uint8Array): string {
  const b = Buffer.from(bytes);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Image response is not PNG, JPEG or WebP');
}
export function validatePhotoImage(image: PhotoImage, max = 10 * 1024 * 1024): void {
  if (!image.bytes.length || image.bytes.length > max) throw new Error('Image exceeds the configured input/output byte limit');
  if (imageMime(image.bytes) !== image.mime) throw new Error('Image MIME does not match its bytes');
}

export const PHOTOGRAPHY_DEFAULTS: import('../src/contracts/photography.ts').PhotographyConfig = {
  voxel: { rendererSource: '', assetPack: '', threeModule: '', radius: 24, below: 8, above: 24,
    cameraOffset: [3, 3.1, 4], surfaceStyle: 'original', geometryStyle: 'original', allowDocumentedApproximations: false },
};
