/** Bounded static viewer assets, including single-range OGG streams. */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
  '.vrm': 'model/gltf-binary', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.zip': 'application/zip',
};

export function viewerByteRange(range: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export async function serveViewerAsset(res: ServerResponse, root: string, relative: string,
  cacheControl = 'public, max-age=3600', range?: string): Promise<boolean> {
  const file = path.resolve(root, relative);
  const extension = path.extname(file).toLowerCase();
  if (!file.startsWith(path.resolve(root) + path.sep) || !MIME[extension]) return false;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > MAX_ASSET_BYTES) return false;
  const ranged = extension === '.ogg';
  const headers = { 'content-type': MIME[extension], 'cache-control': cacheControl,
    'x-content-type-options': 'nosniff', ...(ranged ? { 'accept-ranges': 'bytes' } : {}) };
  if (ranged && range !== undefined) {
    const selected = viewerByteRange(range, info.size);
    if (!selected) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}`, 'content-length': 0 });
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, 'content-length': selected.end - selected.start + 1,
      'content-range': `bytes ${selected.start}-${selected.end}/${info.size}` });
    createReadStream(file, selected).on('error', error => res.destroy(error)).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': info.size });
  createReadStream(file).on('error', error => res.destroy(error)).pipe(res);
  return true;
}
