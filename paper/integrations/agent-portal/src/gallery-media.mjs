import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';

const fail = (status, reason, message) => Object.assign(Error(message), {status, reason});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function thumbnail(png) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gallery-thumbnail-worker.mjs', import.meta.url), {workerData: png});
    worker.once('message', bytes => resolve(Buffer.from(bytes)));
    worker.once('error', reject);
    worker.once('exit', code => { if (code) reject(Error('PHOTO_PREVIEW_WORKER')); });
  });
}

export class GalleryMedia {
  constructor(gallery, objects) {
    this.gallery=gallery; this.db=gallery.store.db; this.objects=objects;
    this.jobs=new Map(); this.pendingStorage=new Map(); this.retryAt=new Map(); this.active=0; this.waiters=[];
    this.db.exec(`CREATE TABLE IF NOT EXISTS gallery_thumbnails_v1
      (source_sha TEXT PRIMARY KEY, jpeg BLOB NOT NULL, sha TEXT NOT NULL, mirrored INTEGER NOT NULL DEFAULT 0)`);
  }
  photo(id,context) {
    const p=context ? this.gallery.manageable(id,context) : this.gallery.published(id);
    if(!p)throw fail(404,'PHOTO_NOT_FOUND','这张照片尚未同步或已撤展');
    return p;
  }
  async generate(id,source,context) {
    if(this.active>=2)await new Promise(resolve=>this.waiters.push(resolve));
    else this.active++;
    try {
      const original=this.gallery.image(id,context);
      if(original.sha256!==source)throw fail(409,'PHOTO_CHANGED','照片已更新，请刷新相册');
      const jpeg=await thumbnail(original.bytes);
      this.db.prepare('INSERT OR IGNORE INTO gallery_thumbnails_v1(source_sha,jpeg,sha) VALUES(?,?,?)').run(source,jpeg,sha(jpeg));
    } finally {
      const next=this.waiters.shift();
      if(next)next();else this.active--;
    }
  }
  mirror(id,photo,row) {
    const source=photo.sha256;
    if(!this.objects?.publishPhotoMedia || row.mirrored || this.pendingStorage.has(source) || this.pendingStorage.size>=2 || Date.now()<(this.retryAt.get(source)||0))return;
    const task=Promise.resolve().then(async()=>{
      const original=this.gallery.image(id);
      if(original.sha256!==source)return;
      await this.objects.publishPhotoMedia(source, original.bytes, Buffer.from(row.jpeg), row.sha);
      this.db.prepare('UPDATE gallery_thumbnails_v1 SET mirrored=1 WHERE source_sha=? AND sha=?').run(source,row.sha);
      this.retryAt.delete(source);
    }).catch(()=>{this.retryAt.set(source,Date.now()+60000);}).finally(()=>this.pendingStorage.delete(source));
    this.pendingStorage.set(source,task);
  }
  async read(id,kind,context,etag) {
    const photo=this.photo(id,context), source=photo.sha256;
    const lookup=this.db.prepare('SELECT sha,jpeg,mirrored FROM gallery_thumbnails_v1 WHERE source_sha=?');
    let row=lookup.get(source);
    if(!row && kind==='thumbnail') {
      if(!this.jobs.has(source)) {
        if(this.jobs.size>=32)throw fail(503,'PHOTO_PREVIEW_BUSY','缩略图正在生成，请稍后重试');
        this.jobs.set(source,this.generate(id,source,context).finally(()=>this.jobs.delete(source)));
      }
      await this.jobs.get(source);row=lookup.get(source);
    }
    if(this.photo(id,context).sha256!==source)throw fail(409,'PHOTO_CHANGED','照片已更新，请刷新相册');
    const digest=kind==='thumbnail'?row.sha:source;
    if(etag==='"'+digest+'"')return {status:304,digest};
    if(!context&&row) {
      if(row.mirrored && this.objects?.photoLocation) {
        try {
          const url=await this.objects.photoLocation(source,kind);
          if(this.photo(id,null).sha256===source)return {status:307,url,digest};
        } catch { /* Retain the local read path while object storage is unreachable. */ }
        if(this.photo(id,null).sha256!==source)throw fail(409,'PHOTO_CHANGED','照片已更新，请刷新相册');
      } else this.mirror(id,photo,row);
    }
    const bytes=kind==='thumbnail'?Buffer.from(row.jpeg):this.gallery.image(id,context).bytes;
    return {status:200,bytes,digest,type:kind==='thumbnail'?'image/jpeg':'image/png'};
  }
  async drain(){await Promise.allSettled([...this.jobs.values(),...this.pendingStorage.values()]);}
}
