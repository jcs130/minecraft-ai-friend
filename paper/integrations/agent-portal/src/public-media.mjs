import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadBaseUrl, skillMirrorUrl } from './download-mirror.mjs';
import reviewedMedia from './public-media-assets.json' with { type: 'json' };

const types = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export function publicMediaOrigin(config) {
  if (!config.publicMedia?.objectStorage) return null;
  const base = downloadBaseUrl(config.downloads?.baseUrl);
  return base ? new URL(base).origin : null;
}
export function publicMedia(config) {
  const result = {};
  for (const key of ['video', 'poster', 'character', 'portrait']) {
    const name = config.publicMedia?.[key], extension = typeof name === 'string' ? path.extname(name).toLowerCase() : '';
    if (typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,110}$/.test(name) && (key === 'video' ? ['.mp4', '.webm'].includes(extension) : ['.png', '.jpg', '.jpeg', '.webp'].includes(extension))) result[key] = '/media/' + name;
  }
  const link = config.publicMedia?.videoLink;
  if (typeof link === 'string') {
    try {
      const url = new URL(link);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
        && (url.hostname === 'b23.tv' && /^\/[a-zA-Z0-9]{4,16}\/?$/.test(url.pathname)
          || url.hostname === 'www.bilibili.com' && /^\/video\/BV[a-zA-Z0-9]{10}\/?$/.test(url.pathname))) result.videoLink = url.href;
    } catch { /* External promotional links are an explicit platform allowlist. */ }
  }
  if (result.videoLink && typeof config.publicMedia?.videoTitle === 'string') result.videoTitle = config.publicMedia.videoTitle.slice(0, 180);
  if (typeof config.publicMedia?.credit === 'string') result.credit = config.publicMedia.credit.slice(0, 300);
  return result;
}

// Administrator-selected promotional files only. This is not an upload, URL
// fetcher, or a file browser, and cannot expose the adjacent account database.
export async function servePublicMedia(req, res, pathname, config) {
  const name = pathname.slice('/media/'.length);
  const configured = publicMedia(config);
  if (!['GET', 'HEAD'].includes(req.method) || !['video', 'poster', 'character', 'portrait'].some(key => configured[key] === pathname) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,110}$/.test(name)) return false;
  const release = config.publicMedia?.objectStorage && reviewedMedia.find(row => row.filename === name);
  const mirror = release && skillMirrorUrl(config, release);
  if (mirror) {
    res.writeHead(307, { Location: mirror, 'Content-Length': '0', 'Cache-Control': 'public, max-age=86400',
      'Referrer-Policy': 'no-referrer', 'X-Checksum-Sha256': release.sha256 });
    res.end(); return true;
  }
  const root = await fs.realpath(path.join(config.dataDir, 'media')).catch(() => null);
  const filename = root && await fs.realpath(path.join(root, name)).catch(() => null);
  if (!filename || path.dirname(filename) !== root) return false;
  const handle = await fs.open(filename, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 256 * 1024 * 1024) return false;
    let start = 0, end = stat.size - 1, partial = false;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (range && (range[1] || range[2])) {
        if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; }
        else { start = Math.max(0, stat.size - Number(range[2])); }
        partial = true;
      }
      if (!partial || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0 || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return true; }
    }
    res.writeHead(partial ? 206 : 200, { 'Content-Type': types[path.extname(name).toLowerCase()], 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400', ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
    if (req.method === 'HEAD') { res.end(); return true; }
    const stream = handle.createReadStream({ start, end, autoClose: false });
    await new Promise(resolve => { stream.on('error', () => { res.destroy(); resolve(); }); res.on('close', () => { stream.destroy(); resolve(); }); res.on('finish', resolve); stream.pipe(res); });
    return true;
  } finally { await handle.close(); }
}
