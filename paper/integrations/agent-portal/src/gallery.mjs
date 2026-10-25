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
  constructor(config) { this.root = path.resolve(config.serverDir, 'plugins', 'ImageFrame', 'data'); this.journal = path.resolve(config.serverDir, 'plugins', 'AgentFriend', 'photo-journal.json'); this.cache = new Map(); this.last = []; this.offset=0; this.manifest=null; }
  async read() {
    let journal;
    try {
      if ((await fs.stat(this.journal)).size > 8 * 1024 * 1024) return this.last;
      journal = JSON.parse((await fs.readFile(this.journal, 'utf8')).replace(/^\uFEFF/, ''));
    } catch { return this.last; }
    const all=Object.values(journal.players || {}).flatMap(player => Object.values(player.photos || {}));
    const works = all
      .filter(photo => photo.published === true && UUID.test(photo.id || '') && Number.isSafeInteger(photo.imageIndex) && photo.imageIndex >= 0)
      .sort((a, b) => b.capturedAt - a.capturedAt);
    if(works.length>10000)return this.last;
    this.manifest={complete:true,publishedIds:[...new Set(works.map(row=>row.id))],withdrawnIds:[...new Set(all.filter(row=>row.published===false&&UUID.test(row.id||'')).map(row=>row.id))]};
    // The complete publication list distinguishes withdrawal from a bounded
    // metadata batch. Rotate batches so old works do not fall out at item 51.
    if(this.offset>=works.length)this.offset=0;
    const batch=works.slice(this.offset,this.offset+50);this.offset+=batch.length;
    const result = [], root = await fs.realpath(this.root).catch(() => null);
    if (!root) return this.last;
    for (const photo of batch) {
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
    store.db.exec(`CREATE TABLE IF NOT EXISTS gallery_catalog(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,visible INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS gallery_visible_created ON gallery_catalog(visible,json_extract(metadata,'$.capturedAt') DESC);
      CREATE TABLE IF NOT EXISTS gallery_originals(sha256 TEXT PRIMARY KEY,png BLOB NOT NULL,received_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO gallery_originals SELECT sha256,png,received_at FROM gallery_images;`);
  }
  refreshCatalog() {
    const snapshot=this.source?.read(), value=snapshot?.value;
    if(value&&this.catalogSequence!==snapshot.sequence){
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        const ids=new Set(value.photoManifest?.publishedIds??(value.photos||[]).map(row=>row.id));
        const withdrawn=new Set(value.photoManifest?.withdrawnIds||[]);
        for(const row of value.photos||[])this.store.db.prepare('INSERT OR REPLACE INTO gallery_catalog VALUES(?,?,1,?)').run(row.id,JSON.stringify(row),Date.now());
        const update=this.store.db.prepare('UPDATE gallery_catalog SET visible=? WHERE id=?');
        for(const row of this.store.db.prepare('SELECT id,visible FROM gallery_catalog').all()){
          if(ids.has(row.id)&&!row.visible)update.run(1,row.id);
          else if(!ids.has(row.id)&&row.visible&&(!value.photoManifest||withdrawn.has(row.id)))update.run(0,row.id);
        }
        this.store.db.exec('COMMIT');this.catalogSequence=snapshot.sequence;
      }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    }
  }
  catalog() { this.refreshCatalog(); return this.store.db.prepare("SELECT metadata FROM gallery_catalog WHERE visible=1 ORDER BY json_extract(metadata,'$.capturedAt') DESC,id").all().map(row=>JSON.parse(row.metadata)); }
  published(id) { this.refreshCatalog(); const row=this.store.db.prepare('SELECT metadata FROM gallery_catalog WHERE id=? AND visible=1').get(id);return row?JSON.parse(row.metadata):null; }
  list({page=1,limit=24,author=''}={}) {
    if(!Number.isInteger(page)||page<1||page>50000||!Number.isInteger(limit)||limit<1||limit>50||author&&!playerNameValid(author))throw fail(400,'INVALID_PAGE','照片页码或作者无效');
    this.refreshCatalog();
    return this.store.db.prepare("SELECT c.metadata FROM gallery_catalog c JOIN gallery_images i ON i.id=c.id AND i.sha256=json_extract(c.metadata,'$.sha256') WHERE c.visible=1 AND (?='' OR json_extract(c.metadata,'$.author')=? COLLATE NOCASE) ORDER BY json_extract(c.metadata,'$.capturedAt') DESC,c.id LIMIT ? OFFSET ?").all(author,author,limit,(page-1)*limit).map(row=>JSON.parse(row.metadata)).map(({sha256,bytes,...row})=>({...row,imageUrl:`/api/v1/gallery/${row.id}/image?rev=${sha256.slice(0,16)}`}));
  }
  page(query={}) {
    const photos=this.list(query),author=query.author||'';
    const total=this.store.db.prepare("SELECT count(*) AS n FROM gallery_catalog c JOIN gallery_images i ON i.id=c.id AND i.sha256=json_extract(c.metadata,'$.sha256') WHERE c.visible=1 AND (?='' OR json_extract(c.metadata,'$.author')=? COLLATE NOCASE)").get(author,author).n;
    return {photos,total,page:query.page||1,pages:Math.max(1,Math.ceil(total/(query.limit||24))),source:'published-game-photography'};
  }
  accept(id, bytes) {
    const photo = this.published(id);
    if (!photo) throw fail(404, 'PHOTO_NOT_PUBLISHED', '照片尚未在游戏内发布');
    if (bytes.length !== photo.bytes || bytes.length > MAX_PHOTO_BYTES || sha(bytes) !== photo.sha256) throw fail(400, 'PHOTO_DIGEST', '照片与已发布目录不一致');
    const dimensions = pngSize(bytes);
    if (dimensions.width !== photo.width || dimensions.height !== photo.height) throw fail(400, 'PHOTO_SIZE', '照片尺寸与目录不一致');
    this.store.db.prepare('INSERT OR REPLACE INTO gallery_images VALUES(?,?,?,?)').run(id, photo.sha256, bytes, Date.now());
    // Immutable originals survive disappearance from a short gameplay ledger.
    // Withdrawal only closes public reads; it never deletes the recovery copy.
    this.store.db.prepare('INSERT OR IGNORE INTO gallery_originals VALUES(?,?,?)').run(photo.sha256,bytes,Date.now());
    return { accepted: true, id };
  }
  image(id) {
    const photo = this.published(id);
    const row = photo && this.store.db.prepare('SELECT sha256,png FROM gallery_images WHERE id=? AND sha256=?').get(id, photo.sha256);
    if (!row) throw fail(404, 'PHOTO_NOT_FOUND', '这张照片尚未同步或已撤展');
    return { bytes: Buffer.from(row.png), sha256: row.sha256 };
  }
}
