import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { UUID } from './game-data.mjs';
import { playerNameValid } from './world-catalog.mjs';
import { photoTiles } from './photo-tiles.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
// Match the camera's bounded original PNG budget; catalog pages still carry metadata only.
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
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
    if(row.published!==undefined&&typeof row.published!=='boolean'||row.authorUuid!==undefined&&!UUID.test(row.authorUuid||''))throw fail(400,'PHOTO_CATALOG','照片归属或公开状态无效');
    return {...Object.fromEntries(['id', 'author', 'title', 'story', 'capturedAt', 'sha256', 'bytes', 'width', 'height'].map(key => [key, row[key]])),
      ...(row.published!==undefined?{published:row.published}:{}),...(row.authorUuid?{authorUuid:row.authorUuid.toLowerCase()}:{})};
  });
}

// Preserve every finished photograph. Only the trusted journal's player UUID
// establishes ownership; URLs, coordinates and examination context stay local.
export class PhotoReader {
  constructor(config) { this.root = path.resolve(config.serverDir, 'plugins', 'ImageFrame', 'data'); this.journal = path.resolve(config.serverDir, 'plugins', 'AgentFriend', 'photo-journal.json'); this.archive=path.resolve(config.serverDir,'plugins','AgentFriend','archives','archive.db');this.archived=[];this.cache = new Map();this.mosaics=new Map(); this.last = []; this.offset=0; this.manifest=null; }
  async archivalPhotos(){
    let db;
    try{
      await fs.stat(this.archive);db=new DatabaseSync(this.archive,{readOnly:true});db.exec('PRAGMA busy_timeout=250;PRAGMA query_only=ON;');
      if(db.prepare('PRAGMA user_version').get().user_version!==1)return this.archived;
      const rows=db.prepare("SELECT id,author,author_name,title,metadata,published,created_at FROM archive_entries a WHERE kind='photo' AND version=(SELECT max(b.version) FROM archive_entries b WHERE b.id=a.id) ORDER BY created_at DESC LIMIT 10001").all();
      if(rows.length>10000)return this.archived;
      this.archived=rows.flatMap(row=>{try{const metadata=JSON.parse(row.metadata);return [{id:row.id,author:row.author_name,authorUuid:row.author,title:row.title,story:typeof metadata.story==='string'?metadata.story:'',capturedAt:row.created_at,imageIndex:metadata.imageIndex,published:row.published===1}];}catch{return [];}});
    }catch{/* An unavailable legacy archive must not block current photographs. */}finally{db?.close();}
    return this.archived;
  }
  async read() {
    let journal;
    try {
      if ((await fs.stat(this.journal)).size > 8 * 1024 * 1024) return this.last;
      journal = JSON.parse((await fs.readFile(this.journal, 'utf8')).replace(/^\uFEFF/, ''));
    } catch { if(!(await this.archivalPhotos()).length)return this.last;journal={players:{}}; }
    const current=Object.entries(journal.players || {}).flatMap(([authorUuid,player])=>Object.values(player.photos || {}).map(photo=>({...photo,...(UUID.test(authorUuid)?{authorUuid}:{}),published:photo.published===true})));
    const all=[...new Map([...(await this.archivalPhotos()),...current].map(photo=>[photo.id,photo])).values()];
    const works = all
      .filter(photo => UUID.test(photo.id || '') && Number.isSafeInteger(photo.imageIndex) && photo.imageIndex >= 0)
      .sort((a, b) => b.capturedAt - a.capturedAt);
    if(works.length>10000)return this.last;
    this.manifest={complete:true,allIds:[...new Set(works.map(row=>row.id))],publishedIds:[...new Set(works.filter(row=>row.published).map(row=>row.id))],withdrawnIds:[...new Set(all.filter(row=>row.published===false&&UUID.test(row.id||'')).map(row=>row.id))]};
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
        const original=await photoTiles(root,photo.imageIndex,this.mosaics,MAX_PHOTO_BYTES);
        let cached = this.cache.get(file);
        if(original){cached={bytes:original.length,sha256:sha(original),...pngSize(original)};}
        else if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.bytes !== stat.size) {
          const bytes = await fs.readFile(file);
          cached = { mtimeMs: stat.mtimeMs, bytes: bytes.length, sha256: sha(bytes), ...pngSize(bytes) };
          this.cache.set(file, cached);
        }
        const [metadata] = validatePhotos([{ id: photo.id, author: photo.author, ...(photo.authorUuid?{authorUuid:photo.authorUuid}:{}),published:photo.published, title: String(photo.title || photo.name || '未命名作品').slice(0, 160), story: String(photo.story || '').slice(0, 2000), capturedAt: new Date(photo.capturedAt).toISOString(), ...cached }]);
        result.push({ metadata, file,...(original?{original}:{}) });
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
      CREATE INDEX IF NOT EXISTS gallery_photo_owner ON gallery_catalog(json_extract(metadata,'$.authorUuid'));
      CREATE TABLE IF NOT EXISTS gallery_publication(id TEXT PRIMARY KEY,published INTEGER NOT NULL,owner_id TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS gallery_originals(sha256 TEXT PRIMARY KEY,png BLOB NOT NULL,received_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO gallery_originals SELECT sha256,png,received_at FROM gallery_images;`);
  }
  refreshCatalog() {
    const snapshot=this.source?.read(), value=snapshot?.value;
    if(value&&this.catalogSequence!==snapshot.sequence){
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        const ids=new Set(value.photoManifest?.publishedIds??(value.photos||[]).filter(row=>row.published!==false).map(row=>row.id));
        const withdrawn=new Set(value.photoManifest?.withdrawnIds||[]);
        const decisions=new Map(this.store.db.prepare('SELECT id,published FROM gallery_publication').all().map(row=>[row.id,row.published]));
        for(const row of value.photos||[]){
          const before=this.store.db.prepare('SELECT metadata FROM gallery_catalog WHERE id=?').get(row.id);
          const old=before?JSON.parse(before.metadata):null,record={...row,...(!row.authorUuid&&old?.authorUuid?{authorUuid:old.authorUuid}:{})};
          if(old?.authorUuid&&old.authorUuid!==record.authorUuid){this.store.db.prepare('DELETE FROM gallery_publication WHERE id=?').run(row.id);decisions.delete(row.id);}
          this.store.db.prepare('INSERT OR REPLACE INTO gallery_catalog VALUES(?,?,?,?)').run(row.id,JSON.stringify(record),decisions.get(row.id)??Number(row.published!==false),Date.now());
        }
        const update=this.store.db.prepare('UPDATE gallery_catalog SET visible=? WHERE id=?');
        for(const row of this.store.db.prepare('SELECT id,visible FROM gallery_catalog').all()){
          const decision=decisions.get(row.id);
          if(decision!==undefined){if(row.visible!==decision)update.run(decision,row.id);continue;}
          if(ids.has(row.id)&&!row.visible)update.run(1,row.id);
          else if(!ids.has(row.id)&&row.visible&&(!value.photoManifest||withdrawn.has(row.id)))update.run(0,row.id);
        }
        this.store.db.exec('COMMIT');this.catalogSequence=snapshot.sequence;
      }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    }
  }
  known(id){this.refreshCatalog();const row=this.store.db.prepare('SELECT metadata FROM gallery_catalog WHERE id=?').get(id);return row?JSON.parse(row.metadata):null;}
  managementContext(owner){return {ownerId:owner.id,admin:owner.role==='admin',uuids:new Set(this.store.ownedUuids(owner.id).map(id=>id.toLowerCase()))};}
  manageable(id,context){const row=this.known(id);if(!row||!context||!context.admin&&!context.uuids.has(row.authorUuid))throw fail(404,'PHOTO_NOT_FOUND','照片不存在或不属于你的角色');return row;}
  managed(context,{page=1}={}){
    if(!Number.isInteger(page)||page<1||page>50000)throw fail(400,'INVALID_PAGE','照片页码无效');
    this.refreshCatalog();
    const uuids=[...context.uuids],where=context.admin?'1':uuids.length?`json_extract(c.metadata,'$.authorUuid') IN (${uuids.map(()=>'?').join(',')})`:'0',args=context.admin?[]:uuids;
    const total=this.store.db.prepare('SELECT count(*) AS n FROM gallery_catalog c WHERE '+where).get(...args).n;
    const photos=this.store.db.prepare(`SELECT c.metadata,c.visible,i.id AS ready FROM gallery_catalog c LEFT JOIN gallery_images i ON i.id=c.id AND i.sha256=json_extract(c.metadata,'$.sha256') WHERE ${where} ORDER BY json_extract(c.metadata,'$.capturedAt') DESC,c.id LIMIT 24 OFFSET ?`).all(...args,(page-1)*24).map(row=>{
      const {authorUuid,sha256,bytes,published,...photo}=JSON.parse(row.metadata);return {...photo,published:!!row.visible,imageReady:!!row.ready,imageUrl:row.ready?`/api/v1/gallery/manage/${photo.id}/image?rev=${sha256.slice(0,16)}`:null};
    });return {photos,total,page,pages:Math.max(1,Math.ceil(total/24))};
  }
  publication(id,published,context){
    if(typeof published!=='boolean')throw fail(400,'PHOTO_PUBLICATION','公开状态需要是 true 或 false');
    const photo=this.manageable(id,context);
    if(published&&!this.store.db.prepare('SELECT id FROM gallery_images WHERE id=? AND sha256=?').get(id,photo.sha256))throw fail(409,'PHOTO_PENDING','照片正在上传，完成后再公开');
    this.store.db.exec('BEGIN IMMEDIATE');try{
      this.store.db.prepare('INSERT OR REPLACE INTO gallery_publication VALUES(?,?,?,?)').run(id,Number(published),context.ownerId,Date.now());
      this.store.db.prepare('UPDATE gallery_catalog SET visible=? WHERE id=?').run(Number(published),id);this.store.db.exec('COMMIT');
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    return {id,published,saved:true};
  }
  catalog() { this.refreshCatalog(); return this.store.db.prepare("SELECT metadata FROM gallery_catalog WHERE visible=1 ORDER BY json_extract(metadata,'$.capturedAt') DESC,id").all().map(row=>JSON.parse(row.metadata)); }
  published(id) { this.refreshCatalog(); const row=this.store.db.prepare('SELECT metadata FROM gallery_catalog WHERE id=? AND visible=1').get(id);return row?JSON.parse(row.metadata):null; }
  list({page=1,limit=24,author=''}={}) {
    if(!Number.isInteger(page)||page<1||page>50000||!Number.isInteger(limit)||limit<1||limit>50||author&&!playerNameValid(author))throw fail(400,'INVALID_PAGE','照片页码或作者无效');
    this.refreshCatalog();
    return this.store.db.prepare("SELECT c.metadata FROM gallery_catalog c JOIN gallery_images i ON i.id=c.id AND i.sha256=json_extract(c.metadata,'$.sha256') WHERE c.visible=1 AND (?='' OR json_extract(c.metadata,'$.author')=? COLLATE NOCASE) ORDER BY json_extract(c.metadata,'$.capturedAt') DESC,c.id LIMIT ? OFFSET ?").all(author,author,limit,(page-1)*limit).map(row=>JSON.parse(row.metadata)).map(({sha256,bytes,authorUuid,published,...row})=>({...row,imageUrl:`/api/v1/gallery/${row.id}/image?rev=${sha256.slice(0,16)}`}));
  }
  page(query={}) {
    const photos=this.list(query),author=query.author||'';
    const total=this.store.db.prepare("SELECT count(*) AS n FROM gallery_catalog c JOIN gallery_images i ON i.id=c.id AND i.sha256=json_extract(c.metadata,'$.sha256') WHERE c.visible=1 AND (?='' OR json_extract(c.metadata,'$.author')=? COLLATE NOCASE)").get(author,author).n;
    const snapshot=this.source?.read();
    const pending=this.store.db.prepare("SELECT count(*) AS n FROM gallery_catalog c LEFT JOIN gallery_images i ON i.id=c.id AND i.sha256=json_extract(c.metadata,'$.sha256') WHERE c.visible=1 AND i.id IS NULL").get().n;
    return {photos,total,page:query.page||1,pages:Math.max(1,Math.ceil(total/(query.limit||24))),source:'published-game-photography',
      sync:{available:!!snapshot,stale:snapshot?.stale??true,observedAt:snapshot?.value?.observedAt??null,pendingPublished:pending}};
  }
  accept(id, bytes) {
    const photo = this.known(id);
    if (!photo) throw fail(404, 'PHOTO_NOT_FOUND', '照片尚未进入受信任的同步目录');
    if (bytes.length !== photo.bytes || bytes.length > MAX_PHOTO_BYTES || sha(bytes) !== photo.sha256) throw fail(400, 'PHOTO_DIGEST', '照片与同步目录不一致');
    const dimensions = pngSize(bytes);
    if (dimensions.width !== photo.width || dimensions.height !== photo.height) throw fail(400, 'PHOTO_SIZE', '照片尺寸与目录不一致');
    this.store.db.prepare('INSERT OR REPLACE INTO gallery_images VALUES(?,?,?,?)').run(id, photo.sha256, bytes, Date.now());
    // Immutable originals survive disappearance from a short gameplay ledger.
    // Withdrawal only closes public reads; it never deletes the recovery copy.
    this.store.db.prepare('INSERT OR IGNORE INTO gallery_originals VALUES(?,?,?)').run(photo.sha256,bytes,Date.now());
    return { accepted: true, id };
  }
  image(id,context=null) {
    const photo = context?this.manageable(id,context):this.published(id);
    const row = photo && this.store.db.prepare('SELECT sha256,png FROM gallery_images WHERE id=? AND sha256=?').get(id, photo.sha256);
    if (!row) throw fail(404, 'PHOTO_NOT_FOUND', '这张照片尚未同步或已撤展');
    return { bytes: Buffer.from(row.png), sha256: row.sha256 };
  }
}
