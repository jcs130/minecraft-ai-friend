import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { UUID } from './game-data.mjs';
import { publicDialogueText } from './public-dialogue.mjs';

const fail=(status,reason,message)=>Object.assign(new Error(message),{status,reason});
function safeText(value,max){return typeof value==='string'&&value.length<=max&&publicDialogueText(value.replace(/[\r\n\t]/g,' '),max)!==null;}
export function validateArchiveBatch(batch){
  if(!batch||typeof batch.available!=='boolean'||!Array.isArray(batch.entries)||batch.entries.length>20)throw fail(400,'ARCHIVE_BATCH','档案批次无效');
  const entries=batch.entries.map(row=>{
    if(!UUID.test(row.id||'')||!Number.isInteger(row.version)||row.version<1||!['book','notice'].includes(row.kind)||!safeText(row.author,64)||!safeText(row.title,128)||!safeText(row.body,65536)||!Number.isFinite(Date.parse(row.createdAt))||typeof row.published!=='boolean')throw fail(400,'ARCHIVE_ENTRY','档案内容无效');
    return Object.fromEntries(['id','version','kind','author','title','body','createdAt','published'].map(key=>[key,row[key]]));
  });
  if(Buffer.byteLength(JSON.stringify(entries))>524288)throw fail(400,'ARCHIVE_BATCH','档案批次过大');
  return {available:batch.available,reason:batch.available?null:'GAME_ARCHIVE_UNAVAILABLE',entries};
}

/** Read the real AgentFriend archive without creating a substitute database.
 * A durable acknowledged cursor repairs missed deliveries; version IDs deduplicate.
 * Private metadata/blobs/UUIDs and request/copy bookkeeping never leave home. */
export class ArchiveReader {
  constructor(config,store=null){this.file=path.join(config.serverDir,'plugins/AgentFriend/archives/archive.db');this.cursor=0;this.store=store;this.identity=null;
    try{const saved=JSON.parse(store?.db.prepare('SELECT value FROM settings WHERE key=?').get('archive-sync-cursor')?.value||'null');if(Number.isSafeInteger(saved?.cursor)){this.cursor=saved.cursor;this.identity=saved.identity;}}catch{}}
  acknowledge(){
    if(!this.pending)return;
    this.cursor=this.pending.cursor;this.identity=this.pending.identity;
    this.store?.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('archive-sync-cursor',JSON.stringify(this.pending));
    this.pending=null;
  }
  async read(){
    this.pending=null;
    let db;
    try {
      const stat=await fs.stat(this.file),identity=`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      db=new DatabaseSync(this.file,{readOnly:true});db.exec('PRAGMA busy_timeout=250;PRAGMA query_only=ON;');
      if(db.prepare('PRAGMA user_version').get().user_version!==1)throw Error('SCHEMA');
      let cursor=this.identity===identity?this.cursor:0;
      const max=db.prepare('SELECT max(rowid) AS n FROM archive_entries').get().n||0;if(cursor>max)cursor=0;
      const rows=db.prepare("SELECT rowid AS seq,* FROM archive_entries WHERE rowid>? AND kind IN ('book','notice') ORDER BY rowid LIMIT 20").all(cursor);
      const entries=[];let bytes=0;
      for(const row of rows){
        const entry={id:row.id,version:row.version,kind:row.kind,author:row.author_name,title:row.title,body:row.body,createdAt:new Date(row.created_at).toISOString(),published:row.published===1};
        // A private/newly withdrawn revision is a tombstone, not its secret text.
        if(!entry.published||!safeText(entry.body,65536)||!safeText(entry.title,128)){entry.published=false;entry.title='未公开作品';entry.body='作品已撤展';}
        const size=Buffer.byteLength(JSON.stringify(entry));if(bytes+size>450000)break;
        cursor=row.seq;try {entries.push(validateArchiveBatch({available:true,entries:[entry]}).entries[0]);bytes+=size;}catch{}
      }
      this.pending={cursor,identity};
      return {available:true,entries};
    }catch{return {available:false,reason:'GAME_ARCHIVE_UNAVAILABLE',entries:[]};}
    finally{db?.close();}
  }
}

export class PublicArchives {
  constructor(store){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS public_archive_entries(id TEXT NOT NULL,version INTEGER NOT NULL,kind TEXT NOT NULL,author TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,published INTEGER NOT NULL,PRIMARY KEY(id,version));
    CREATE INDEX IF NOT EXISTS public_archive_author ON public_archive_entries(author,created_at DESC);`);}
  accept(input){
    const batch=validateArchiveBatch(input),db=this.store.db;
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const row of batch.entries)db.prepare('INSERT OR IGNORE INTO public_archive_entries VALUES(?,?,?,?,?,?,?,?)').run(row.id,row.version,row.kind,row.author,row.title,row.body,Date.parse(row.createdAt),row.published?1:0);
      db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('public-archives-source',JSON.stringify({available:batch.available,reason:batch.reason,observedAt:new Date().toISOString()}));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {accepted:true,count:batch.entries.length};
  }
  status(){try{return JSON.parse(this.store.db.prepare('SELECT value FROM settings WHERE key=?').get('public-archives-source')?.value||'null');}catch{return null;}}
  list({author='',kind='all',page=1}={}){
    if(typeof author!=='string'||author.length>64||!['all','book','notice'].includes(kind)||!Number.isInteger(page)||page<1||page>50000)throw fail(400,'INVALID_PAGE','档案筛选条件无效');
    const where="published=1 AND version=(SELECT max(b.version) FROM public_archive_entries b WHERE b.id=a.id) AND (?='' OR author=? COLLATE NOCASE) AND (?='all' OR kind=?)";
    const args=[author,author,kind,kind],db=this.store.db;
    const total=db.prepare('SELECT count(*) AS n FROM public_archive_entries a WHERE '+where).get(...args).n;
    const entries=db.prepare('SELECT id,version,kind,author,title,created_at FROM public_archive_entries a WHERE '+where+' ORDER BY created_at DESC,id LIMIT 20 OFFSET ?').all(...args,(page-1)*20).map(row=>({...row,createdAt:new Date(row.created_at).toISOString(),created_at:undefined}));
    return {entries,page,pages:Math.max(1,Math.ceil(total/20)),total,source:this.status()||{available:false,reason:'GAME_ARCHIVE_UNAVAILABLE'}};
  }
  read(id){
    const row=this.store.db.prepare('SELECT * FROM public_archive_entries WHERE id=? ORDER BY version DESC LIMIT 1').get(id);
    if(!row?.published)throw fail(404,'ARCHIVE_NOT_FOUND','这份作品尚未公开或已撤展');
    return {id:row.id,version:row.version,kind:row.kind,author:row.author,title:row.title,body:row.body,createdAt:new Date(row.created_at).toISOString()};
  }
}
