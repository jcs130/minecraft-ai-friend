import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readSceneArchive,MAX_SCENE_BYTES} from './viewer/photo-scene-archive.mjs';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,SHA=/^[a-f0-9]{64}$/;
const fail=(status,reason,message)=>Object.assign(Error(message),{status,reason});
const hash=b=>createHash('sha256').update(b).digest('hex');
export function sceneDescriptor(value){
  if(value===undefined||value===null)return null;
  if(value.schema!=='mc-photo-scene/v1'||!['captured','partial','unavailable'].includes(value.state))throw fail(400,'PHOTO_SCENE_METADATA','场景存档说明无效');
  if(value.state==='unavailable')return{schema:value.schema,state:value.state,reason:/^PHOTO_(?:SCENE|NATIVE)_[A-Z_]+$/.test(value.reason??'')?value.reason:'PHOTO_SCENE_SAVE_FAILED'};
  if(!SHA.test(value.sha256??'')||!SHA.test(value.sourceImageSha256??'')||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>MAX_SCENE_BYTES||!Number.isSafeInteger(value.columns)||value.columns<1||value.columns>81||!Number.isSafeInteger(value.entities)||value.entities<0||value.entities>256)throw fail(400,'PHOTO_SCENE_METADATA','场景存档说明无效');
  return Object.fromEntries(['schema','state','sha256','sourceImageSha256','bytes','columns','entities'].map(k=>[k,value[k]]));
}
/** An ImageFrame PNG can be re-encoded; bind to the journal's original image
 * digest as well as the server-issued photo ID and real owner UUID. */
export async function readPhotoScene(directory,photo,cache=new Map()){
  if(!directory||!UUID.test(photo?.id??'')||!UUID.test(photo?.authorUuid??''))return null;
  const original=photo.image?.sha256;if(!SHA.test(original??''))return null;
  try{
    const root=await fs.realpath(directory),meta=await fs.realpath(path.join(root,photo.id+'.json'));if(path.dirname(meta)!==root)throw Error('scene metadata path');const metadataStat=await fs.stat(meta);if(!metadataStat.isFile()||metadataStat.size>16384)throw Error('scene metadata limit');
    const file=await fs.realpath(path.join(root,photo.id+'.mcscene.gz')),relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('scene path');const stat=await fs.stat(file);
    const signature=[photo.authorUuid,original,metadataStat.mtimeMs,metadataStat.size,stat.mtimeMs,stat.size].join(':');const old=cache.get(photo.id);if(old?.signature===signature)return old.result;
    const raw=await fs.readFile(meta);
    const value=JSON.parse(raw),descriptor=sceneDescriptor(value);if(value.id!==photo.id||value.owner?.toLowerCase()!==photo.authorUuid.toLowerCase()||value.sourceImageSha256!==original)throw Error('scene photo binding');
    if(!stat.isFile()||stat.size!==descriptor.bytes)throw Error('scene size');
    const bytes=await fs.readFile(file),archive=await readSceneArchive(bytes,{expectedSha256:descriptor.sha256,photoId:photo.id,owner:photo.authorUuid});if(archive.photo.imageSha256!==original)throw Error('scene source image');
    const result={metadata:descriptor,file,resources:archive.resources};if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(photo.id,{signature,result});return result;
  }catch(error){
    if(error.code==='ENOENT'){
      try{const raw=await fs.readFile(path.join(directory,photo.id+'.unavailable.json'));if(raw.length>16384)return null;const value=JSON.parse(raw);if(value.id===photo.id&&value.owner===photo.authorUuid&&value.sourceImageSha256===original)return{metadata:sceneDescriptor(value)};}catch{}
      return null;
    }
    return{metadata:{schema:'mc-photo-scene/v1',state:'unavailable',reason:'PHOTO_SCENE_INTEGRITY_FAILED'}};
  }
}
export class PhotoScenes{
  constructor(store,gallery,objects){this.store=store;this.gallery=gallery;this.objects=objects;store.db.exec('CREATE TABLE IF NOT EXISTS gallery_scenes(id TEXT PRIMARY KEY,owner_uuid TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,source_image_sha256 TEXT NOT NULL,received_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS gallery_scene_resources(photo_id TEXT NOT NULL,sha256 TEXT NOT NULL,name TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(photo_id,sha256))');}
  wanted(photos){return this.objects?(photos??[]).filter(p=>{const r=this.store.db.prepare('SELECT sha256,owner_uuid,source_image_sha256 FROM gallery_scenes WHERE id=?').get(p.id);return ['captured','partial'].includes(p.scene?.state)&&(!r||r.sha256!==p.scene.sha256||r.owner_uuid!==p.authorUuid||r.source_image_sha256!==p.scene.sourceImageSha256);}).map(p=>p.id):[];}
  async accept(id,bytes){
    if(!this.objects)throw fail(503,'PHOTO_SCENE_STORAGE_UNAVAILABLE','场景存档正在准备对象存储，家庭端会保留待补传文件');
    const photo=this.gallery.known(id),metadata=photo?.scene;
    if(!UUID.test(id)||!UUID.test(photo?.authorUuid??'')||!['captured','partial'].includes(metadata?.state))throw fail(404,'PHOTO_SCENE_NOT_FOUND','照片尚无受信任的场景存档');
    if(bytes.length!==metadata.bytes||hash(bytes)!==metadata.sha256)throw fail(400,'PHOTO_SCENE_DIGEST','场景文件与照片目录不一致');
    const archive=await readSceneArchive(bytes,{expectedSha256:metadata.sha256,photoId:id,owner:photo.authorUuid});
    if(archive.photo.imageSha256!==metadata.sourceImageSha256)throw fail(400,'PHOTO_SCENE_BINDING','场景不属于这张照片');
    await this.objects.put('scenes/'+metadata.sha256+'.mcscene.gz',bytes,{sha256:metadata.sha256,contentType:'application/gzip'});
    this.store.db.exec('BEGIN IMMEDIATE');try{
      this.store.db.prepare('INSERT OR REPLACE INTO gallery_scenes VALUES(?,?,?,?,?,?)').run(id,photo.authorUuid,metadata.sha256,bytes.length,metadata.sourceImageSha256,Date.now());
      this.store.db.prepare('DELETE FROM gallery_scene_resources WHERE photo_id=?').run(id);
      const insert=this.store.db.prepare('INSERT OR REPLACE INTO gallery_scene_resources VALUES(?,?,?,?)');for(const r of archive.resources)if(r.storage==='content-addressed-private')insert.run(id,r.sha256,r.name,r.bytes);
      this.store.db.exec('COMMIT');
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    return{accepted:true,id,sha256:metadata.sha256};
  }
  async location(id,context){
    const photo=this.gallery.manageable(id,context),scene=photo.scene,row=this.store.db.prepare('SELECT * FROM gallery_scenes WHERE id=?').get(id);
    if(!this.objects||!scene||!row||row.sha256!==scene.sha256||row.owner_uuid!==photo.authorUuid||row.source_image_sha256!==scene.sourceImageSha256)throw fail(404,'PHOTO_SCENE_PENDING','这张照片的场景未记录或仍在同步');
    return this.objects.download('scenes/'+row.sha256+'.mcscene.gz',id+'.mcscene.gz');
  }
  ready(id,scene){const photo=this.gallery.known(id),row=this.store.db.prepare('SELECT sha256,owner_uuid,source_image_sha256 FROM gallery_scenes WHERE id=?').get(id);return !!scene&&!!row&&row.sha256===scene.sha256&&row.owner_uuid===photo?.authorUuid&&row.source_image_sha256===scene.sourceImageSha256;}
  resource(id,sha256){if(!this.objects||!this.ready(id,this.gallery.known(id)?.scene)||!SHA.test(sha256))throw fail(404,'PHOTO_SCENE_RESOURCE_NOT_FOUND','场景资源尚未同步');const row=this.store.db.prepare('SELECT name,bytes FROM gallery_scene_resources WHERE photo_id=? AND sha256=?').get(id,sha256);if(!row)throw fail(404,'PHOTO_SCENE_RESOURCE_NOT_FOUND','这个资源不属于照片');return row;}
  async uploadResource(id,sha256){const row=this.resource(id,sha256);return this.objects.assetUpload(sha256,row.bytes);}
  async manifest(id,context){
    this.gallery.manageable(id,context);if(!this.ready(id,this.gallery.known(id)?.scene))throw fail(404,'PHOTO_SCENE_PENDING','场景正在同步');
    const rows=this.store.db.prepare('SELECT sha256,name,bytes FROM gallery_scene_resources WHERE photo_id=?').all(id),resources=[];
    for(const r of rows)resources.push({...r,available:await this.objects.assetPresent(r.sha256,r.bytes),url:'/api/v1/gallery/manage/'+id+'/scene/assets/'+r.sha256});
    return{schema:'mc-photo-scene-resources/v1',id,sceneUrl:'/api/v1/gallery/manage/'+id+'/scene',resources};
  }
  async resourceLocation(id,sha256,context){this.gallery.manageable(id,context);const r=this.resource(id,sha256);if(!await this.objects.assetPresent(sha256,r.bytes))throw fail(404,'PHOTO_SCENE_PENDING','资源正在同步');return this.objects.download('assets/'+sha256,sha256+'.bin');}
}
