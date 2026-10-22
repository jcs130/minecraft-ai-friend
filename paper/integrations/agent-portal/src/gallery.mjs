import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { UUID } from './game-data.mjs';
import { playerNameValid } from './world-catalog.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function pngSize(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw fail(400, 'PHOTO_FORMAT', '照片需要有效的 PNG 文件');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16777216) throw fail(400, 'PHOTO_SIZE', '照片尺寸超出范围');
  return { width, height };
}
export function validatePhotos(rows = []) {
  if (!Array.isArray(rows) || rows.length > 50) throw fail(400, 'PHOTO_CATALOG', '照片目录超出范围');
  const ids = new Set();
  return rows.map(row => {
    if (!row || !UUID.test(row.id || '') || ids.has(row.id) || !playerNameValid(row.author) || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 160 || typeof row.story !== 'string' || row.story.length > 2000 || !Number.isFinite(Date.parse(row.capturedAt)) || !/^[a-f0-9]{64}$/.test(row.sha256 || '') || !Number.isInteger(row.bytes) || row.bytes < 33 || row.bytes > MAX_PHOTO_BYTES || !Number.isInteger(row.width) || !Number.isInteger(row.height) || row.width < 1 || row.height < 1 || row.width > 4096 || row.height > 4096) throw fail(400, 'PHOTO_CATALOG', '照片目录格式无效');
    ids.add(row.id);
    return Object.fromEntries(['id', 'author', 'title', 'story', 'capturedAt', 'sha256', 'bytes', 'width', 'height'].map(key => [key, row[key]]));
  });
}

// Only the game's explicitly published works enter this reader. Neither local
// upload URLs, coordinates, owner UUIDs nor examination context leave the host.
export class PhotoReader {
  constructor(config) { this.root = path.resolve(config.serverDir, 'plugins', 'ImageFrame', 'data'); this.journal = path.resolve(config.serverDir, 'plugins', 'AgentFriend', 'photo-journal.json'); this.cache = new Map(); this.last = []; }
  async read() {
    let journal;
    try {
      if ((await fs.stat(this.journal)).size > 8 * 1024 * 1024) return this.last;
      journal = JSON.parse((await fs.readFile(this.journal, 'utf8')).replace(/^\uFEFF/, ''));
    } catch { return this.last; }
    const works = Object.values(journal.players || {}).flatMap(player => Object.values(player.photos || {}))
      .filter(photo => photo.published === true && UUID.test(photo.id || '') && Number.isSafeInteger(photo.imageIndex) && photo.imageIndex >= 0)
      .sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 50);
    const result = [], root = await fs.realpath(this.root).catch(() => null);
    if (!root) return this.last;
    for (const photo of works) {
      try {
        const file = await fs.realpath(path.join(root, String(photo.imageIndex), '0.png'));
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > MAX_PHOTO_BYTES) continue;
        let cached = this.cache.get(file);
        if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.bytes !== stat.size) {
          const bytes = await fs.readFile(file);
          cached = { mtimeMs: stat.mtimeMs, bytes: bytes.length, sha256: sha(bytes), ...pngSize(bytes) };
          this.cache.set(file, cached);
        }
        const [metadata] = validatePhotos([{ id: photo.id, author: photo.author, title: String(photo.title || photo.name || '未命名作品').slice(0, 160), story: String(photo.story || '').slice(0, 2000), capturedAt: new Date(photo.capturedAt).toISOString(), ...cached }]);
        result.push({ metadata, file });
      } catch { /* A missing or unfinished image is retried on the next capture. */ }
    }
    const active = new Set(result.map(row => row.file));
    for (const key of this.cache.keys()) if (!active.has(key)) this.cache.delete(key);
    this.last = result; return result;
  }
}

export class Gallery {
  constructor(store, source) {
    this.store = store; this.source = source;
    store.db.exec('CREATE TABLE IF NOT EXISTS gallery_images(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,png BLOB NOT NULL,received_at INTEGER NOT NULL)');
  }
  catalog() { return this.source?.read()?.value.photos || []; }
  list() {
    const images = new Map(this.store.db.prepare('SELECT id,sha256 FROM gallery_images').all().map(row => [row.id, row.sha256]));
    return this.catalog().filter(row => images.get(row.id) === row.sha256).map(({ sha256, bytes, ...row }) => ({ ...row, imageUrl: `/api/v1/gallery/${row.id}/image?rev=${sha256.slice(0, 16)}` }));
  }
  accept(id, bytes) {
    const photo = this.catalog().find(row => row.id === id);
    if (!photo) throw fail(404, 'PHOTO_NOT_PUBLISHED', '照片尚未在游戏内发布');
    if (bytes.length !== photo.bytes || bytes.length > MAX_PHOTO_BYTES || sha(bytes) !== photo.sha256) throw fail(400, 'PHOTO_DIGEST', '照片与已发布目录不一致');
    const dimensions = pngSize(bytes);
    if (dimensions.width !== photo.width || dimensions.height !== photo.height) throw fail(400, 'PHOTO_SIZE', '照片尺寸与目录不一致');
    this.store.db.prepare('INSERT OR REPLACE INTO gallery_images VALUES(?,?,?,?)').run(id, photo.sha256, bytes, Date.now());
    // Keep storage bounded by the published catalog, including withdrawn works.
    const current = new Set(this.catalog().map(row => row.id));
    for (const row of this.store.db.prepare('SELECT id FROM gallery_images').all()) if (!current.has(row.id)) this.store.db.prepare('DELETE FROM gallery_images WHERE id=?').run(row.id);
    return { accepted: true, id };
  }
  image(id) {
    const photo = this.catalog().find(row => row.id === id);
    const row = photo && this.store.db.prepare('SELECT sha256,png FROM gallery_images WHERE id=? AND sha256=?').get(id, photo.sha256);
    if (!row) throw fail(404, 'PHOTO_NOT_FOUND', '这张照片尚未同步或已撤展');
    return { bytes: Buffer.from(row.png), sha256: row.sha256 };
  }
}
