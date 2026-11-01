import {createHash,randomUUID} from 'node:crypto';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SCENE_SCHEMA='mc-photo-scene/v1';
export const MAX_SCENE_RAW_BYTES=64*1024*1024,MAX_SCENE_BYTES=32*1024*1024;
const zip=promisify(gzip),unzip=promisify(gunzip),UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,SHA=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,reason)=>{if(!ok)throw Error('PHOTO_SCENE_'+reason);};
const finite=v=>typeof v==='number'&&Number.isFinite(v),integer=v=>Number.isSafeInteger(v);
const position=v=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n)&&Math.abs(n)<=3e7);
const text=(v,n=256)=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u001f]/.test(v);
const namespace=v=>text(v,160)&&/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(v);
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(v??{},k)).map(k=>[k,v[k]]));
const json=object=>Buffer.from(JSON.stringify(object));
function safeKeys(value,depth=0){
  need(depth<=24,'DATA_DEPTH');if(!value||typeof value!=='object')return;
  for(const [key,child]of Object.entries(value)){
    need(!/^(?:__proto__|prototype|constructor|password|clientSecret|accessKeySecret|apiKey|authorization|token|nonce|uploadId|uploadBase|endpoint)$/i.test(key),'PRIVATE_FIELD');
    safeKeys(child,depth+1);
  }
}
function entity(value){
  need(value&&integer(value.id)&&UUID.test(value.uuid??'')&&namespace(value.name)&&position(value.position),'ENTITY');
  const out=pick(value,['id','uuid','name','username','position','yaw','pitch','headYaw','width','height','eyeHeight','pose','onGround','sneaking','sprinting','burning','velocity','hurtTime','swingProgress','usingItem','skinResource','skinModel']);
  need(out.username===undefined||text(out.username),'ENTITY_NAME');
  for(const k of ['yaw','pitch','headYaw','width','height','eyeHeight','hurtTime','swingProgress'])need(out[k]===undefined||finite(out[k]),'ENTITY_NUMBER');
  if(value.equipment!==undefined){need(Array.isArray(value.equipment)&&value.equipment.length<=8,'EQUIPMENT');out.equipment=value.equipment.map(row=>{if(row===null)return null;need(namespace(row?.name)&&integer(row.count)&&row.count>0&&row.count<=999&&text(row.displayName),'EQUIPMENT');return pick(row,['name','count','displayName']);});}
  return out;
}
function registry(value){
  need(Array.isArray(value?.blocks)&&value.blocks.length>0&&value.blocks.length<=100000&&Array.isArray(value.biomes)&&value.biomes.length>0&&value.biomes.length<=4096,'REGISTRY');
  const ids=new Set(),biomes=new Set();
  const blocks=value.blocks.map(row=>{need(integer(row.id)&&row.id>=0&&!ids.has(row.id)&&namespace(row.name)&&row.properties&&typeof row.properties==='object'&&!Array.isArray(row.properties)&&Object.keys(row.properties).length<=64,'BLOCK_STATE');ids.add(row.id);for(const [k,v]of Object.entries(row.properties))need(/^[a-z0-9_]{1,96}$/.test(k)&&text(v,128),'BLOCK_PROPERTY');return pick(row,['id','name','properties']);});
  const biomeRows=value.biomes.map(row=>{need(integer(row.id)&&row.id>=0&&!biomes.has(row.id)&&namespace(row.name),'BIOME');biomes.add(row.id);return pick(row,['id','name','colors','grassSample']);});
  return {blocks,biomes:biomeRows};
}
function column(value){
  need(integer(value.x)&&integer(value.z)&&Math.abs(value.x)<=1875000&&Math.abs(value.z)<=1875000&&integer(value.revision)&&value.revision>=0,'COLUMN');
  need(integer(value.minY)&&value.minY%16===0&&integer(value.height)&&value.height>=16&&value.height<=1024&&value.height%16===0,'COLUMN_HEIGHT');
  need(typeof value.sections==='string'&&value.sections.length<=3*1024*1024&&/^[A-Za-z0-9+/]*={0,2}$/.test(value.sections),'COLUMN_DATA');
  for(const k of ['skyLight','blockLight'])need(Array.isArray(value[k])&&value[k].length===value.height/16&&value[k].every(s=>typeof s==='string'&&s.length<=2732&&/^[A-Za-z0-9+/]+={0,2}$/.test(s)&&Buffer.from(s,'base64').length===2048),'COLUMN_LIGHT');
  return pick(value,['x','z','revision','minY','height','sections','skyLight','blockLight','blockEntitiesAvailable','sampledAt']);
}
function sameObservation(value,identity,epoch){
  need(value?.protocol==='agent-mc-visual/v1'&&['1.20.6','1.21.1'].includes(value.minecraftVersion)&&value.uuid===identity.uuid&&value.server===identity.server&&UUID.test(value.epoch??'')&&finite(value.sampledAt),'IDENTITY');
  need(epoch===undefined||value.epoch===epoch,'EPOCH_CHANGED');
}
function validatePayload(payload){
  safeKeys(payload);need(payload?.schema===SCENE_SCHEMA,'SCHEMA');need(payload&&UUID.test(payload.photo?.id??'')&&UUID.test(payload.photo?.owner??'')&&UUID.test(payload.photo?.worldUuid??'')&&SHA.test(payload.photo?.imageSha256??'')&&['first','third','top'].includes(payload.photo?.mode),'PHOTO');
  need(['width','height'].every(k=>integer(payload.photo[k])&&payload.photo[k]>=1&&payload.photo[k]<=4096),'PHOTO_DIMENSIONS');
  need(finite(payload.source?.startedAt)&&finite(payload.source?.completedAt)&&payload.source.completedAt>=payload.source.startedAt&&payload.source.completedAt-payload.source.startedAt<=120000,'TIME');
  need(payload.source?.protocol==='agent-mc-visual/v1'&&['1.20.6','1.21.1'].includes(payload.source.minecraftVersion)&&UUID.test(payload.source.rendererUuid??'')&&UUID.test(payload.source.epoch??''),'SOURCE');
  need(namespace(payload.frame?.dimension)&&position(payload.frame?.self?.position)&&Array.isArray(payload.frame.entities)&&payload.frame.entities.length<=256,'FRAME');
  entity(payload.frame.self);for(const row of payload.frame.entities)entity(row);registry(payload.registry);
  need(Array.isArray(payload.chunks)&&payload.chunks.length>0&&payload.chunks.length<=81,'CHUNKS');const seen=new Set();
  for(const raw of payload.chunks){const c=column(raw),key=c.x+','+c.z;need(!seen.has(key),'DUPLICATE_COLUMN');seen.add(key);}
  need(Array.isArray(payload.appearances)&&payload.appearances.length<=64&&Array.isArray(payload.resources)&&payload.resources.length<=64,'RESOURCES');
  for(const resource of payload.resources){
    need(SHA.test(resource.sha256??'')&&integer(resource.bytes)&&resource.bytes>0&&resource.bytes<=512*1024*1024&&text(resource.name,256)&&!/[\\/]/.test(resource.name),'RESOURCE');
    if(resource.base64!==undefined){need(typeof resource.base64==='string'&&resource.base64.length<=12*1024*1024,'RESOURCE');const bytes=Buffer.from(resource.base64,'base64');need(bytes.length===resource.bytes&&sha(bytes)===resource.sha256,'RESOURCE_HASH');}
    else need(resource.storage==='content-addressed-private'&&resource.key===resource.sha256,'RESOURCE_REFERENCE');
  }
  need(payload.camera&&position(payload.camera.position)&&finite(payload.camera.yawRadians)&&finite(payload.camera.pitchRadians),'CAMERA');
  if(payload.camera.projectionMatrix!==null)need(Array.isArray(payload.camera.projectionMatrix)&&payload.camera.projectionMatrix.length===16&&payload.camera.projectionMatrix.every(finite),'PROJECTION');
  need(payload.coverage&&integer(payload.coverage.requestedRadius)&&payload.coverage.requestedRadius>=0&&payload.coverage.requestedRadius<=4&&payload.coverage.saved===payload.chunks.length&&Array.isArray(payload.coverage.missingColumns)&&Array.isArray(payload.coverage.changedColumns)&&payload.coverage.missingColumns.length<=81&&payload.coverage.changedColumns.length<=81&&payload.coverage.completeSceneParityVerified===false,'COVERAGE');
  need(Array.isArray(payload.limitations)&&payload.limitations.length<=16&&payload.limitations.every(s=>text(s,512)),'LIMITATIONS');
  return payload;
}
export async function encodeSceneArchive(payload){
  validatePayload(payload);const bytes=json(payload);need(bytes.length<=MAX_SCENE_RAW_BYTES,'RAW_LIMIT');
  const compressed=await zip(bytes,{level:6});need(compressed.length<=MAX_SCENE_BYTES,'COMPRESSED_LIMIT');
  return {bytes:compressed,metadata:{schema:SCENE_SCHEMA,id:payload.photo.id,owner:payload.photo.owner,sourceImageSha256:payload.photo.imageSha256,sha256:sha(compressed),bytes:compressed.length,rawBytes:bytes.length,capturedAt:new Date(payload.source.startedAt).toISOString(),columns:payload.chunks.length,entities:payload.frame.entities.length,state:payload.coverage.missingColumns.length||payload.coverage.changedColumns.length?'partial':'captured',limitations:payload.limitations}};
}
export async function readSceneArchive(bytes,{expectedSha256,photoId,owner,maxRawBytes=MAX_SCENE_RAW_BYTES}={}){
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_SCENE_BYTES,'COMPRESSED_LIMIT');
  if(expectedSha256)need(SHA.test(expectedSha256)&&sha(bytes)===expectedSha256,'HASH_MISMATCH');
  need(integer(maxRawBytes)&&maxRawBytes>0&&maxRawBytes<=MAX_SCENE_RAW_BYTES,'RAW_LIMIT');
  let raw;try{raw=await unzip(bytes,{maxOutputLength:maxRawBytes});}catch{throw Error('PHOTO_SCENE_GZIP_INVALID');}
  let archive;try{archive=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw Error('PHOTO_SCENE_JSON_INVALID');}
  need(archive?.schema===SCENE_SCHEMA,'SCHEMA');validatePayload(archive);
  if(photoId)need(archive.photo.id===photoId,'PHOTO_MISMATCH');if(owner)need(archive.photo.owner===owner,'OWNER_MISMATCH');return archive;
}
/** Observe only this native client's received world. No login, terrain load,
 * server query, controller claim, body command or model decryption. */
export async function captureNativeScene({rpc,identity,job,image,cameraState,radius=4,guard=()=>{},signal=new AbortController().signal,renew=async()=>{},appearances=async()=>({bindings:[],resources:[]}),now=Date.now}){
  need(typeof rpc==='function'&&UUID.test(identity?.uuid??'')&&typeof identity.server==='string'&&integer(radius)&&radius>=0&&radius<=4,'CONFIGURATION');
  const startedAt=now();const read=async(method,params={})=>{signal.throwIfAborted();guard();await renew();need(now()-startedAt<=90000,'CAPTURE_TIMEOUT');return rpc(method,params);};
  const frame=await read('visual_frame',{radius});sameObservation(frame,identity);need(frame.source==='same_java_client_world'&&Array.isArray(frame.columns)&&frame.columns.length>0&&frame.columns.length<=81,'FRAME');
  need([frame.self,...frame.entities].some(e=>e.uuid===job.owner&&e.id===job.entityId),'SUBJECT_CHANGED');
  const state=await read('visual_registry');sameObservation(state,identity,frame.epoch);
  const chunks=[],missingColumns=[];
  for(const at of frame.columns){try{const c=await read('visual_chunk',{x:at.x,z:at.z,epoch:frame.epoch});sameObservation(c,identity,frame.epoch);chunks.push(column(c));}catch(error){signal.throwIfAborted();guard();if(error.message==='PHOTO_SCENE_EPOCH_CHANGED'||error.message==='PHOTO_SCENE_IDENTITY')throw error;missingColumns.push({x:at.x,z:at.z,reason:'COLUMN_UNAVAILABLE_DURING_CAPTURE'});}}
  const end=await read('visual_frame',{radius});sameObservation(end,identity,frame.epoch);
  const revisions=new Map(end.columns.map(c=>[c.x+','+c.z,c.revision]));
  const changedColumns=chunks.filter(c=>revisions.get(c.x+','+c.z)!==c.revision).map(c=>({x:c.x,z:c.z}));
  const assets=await appearances(frame);guard();signal.throwIfAborted();
  const limitations=['Only the native client’s loaded region is saved; this is not a server-world backup.','Columns and entities have individual observation times; the world is not frozen.','Block-entity contents and complete entity metadata are unavailable in this export.','Encrypted YSM originals remain encrypted and require their original compatible runtime/assets.'];
  if(!Array.isArray(cameraState?.projectionMatrix))limitations.push('The native projection matrix is unavailable; exact field of view and pixel parity cannot be reconstructed.');
  const payload={schema:SCENE_SCHEMA,photo:{id:job.job,owner:job.owner,worldUuid:job.world,mode:job.mode,imageSha256:image.sha256,width:image.width,height:image.height},source:{protocol:frame.protocol,minecraftVersion:frame.minecraftVersion,rendererUuid:identity.uuid,epoch:frame.epoch,startedAt,completedAt:now(),source:'same_native_camera_client'},
    camera:{position:[job.x,job.y+1.62,job.z],yawRadians:job.yaw,pitchRadians:job.pitch,projectionMatrix:Array.isArray(cameraState?.projectionMatrix)?cameraState.projectionMatrix:null,nativeInstance:cameraState?.instanceId??null},
    frame:{dimension:frame.dimension,sampledAt:frame.sampledAt,time:frame.time,raining:frame.raining,thunder:frame.thunder,self:entity(frame.self),entities:frame.entities.map(entity),entitiesTruncated:frame.entitiesTruncated===true},registry:registry(state.registry),chunks,
    coverage:{requestedRadius:radius,loadedAtStart:frame.columns.length,saved:chunks.length,missingColumns,changedColumns,blockEntitiesAvailable:false,entityMetadataComplete:false,completeSceneParityVerified:false},appearances:assets.bindings??[],resources:assets.resources??[],limitations};
  return encodeSceneArchive(payload);
}
export async function storeSceneArchive(directory,result){
  need(path.isAbsolute(directory)&&UUID.test(result?.metadata?.id??'')&&SHA.test(result.metadata.sha256??'')&&sha(result.bytes)===result.metadata.sha256,'STORE');
  await fs.mkdir(directory,{recursive:true});const root=await fs.realpath(directory),file=path.join(root,result.metadata.id+'.mcscene.gz'),metadata=path.join(root,result.metadata.id+'.json');
  // Link a fully flushed temporary file into its immutable name. Readers never
  // see an unfinished archive, including after an interrupted process.
  const immutable=async(target,bytes)=>{
    const temporary=target+'.'+randomUUID()+'.writing';let handle;
    try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
      try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;need((await fs.readFile(target)).equals(bytes),'STORE_CONFLICT');}
    }finally{await handle?.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  };
  await immutable(file,result.bytes);await immutable(metadata,json(result.metadata));
  return result.metadata;
}
