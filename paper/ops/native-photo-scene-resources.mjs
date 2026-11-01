import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {gzipSync} from 'node:zlib';
const sha=b=>createHash('sha256').update(b).digest('hex'),SHA=/^[a-f0-9]{64}$/;
export async function saveSceneResource(directory,bytes,name){
  if(!path.isAbsolute(directory)||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>128*1024*1024||typeof name!=='string'||name.length>256||/[\\/\u0000-\u001f]/.test(name))throw Error('PHOTO_SCENE_RESOURCE');
  const hash=sha(bytes);await fs.mkdir(directory,{recursive:true});const root=await fs.realpath(directory),target=path.join(root,hash);
  try{const current=await fs.readFile(target);if(sha(current)!==hash)throw Error('PHOTO_SCENE_RESOURCE_CONFLICT');}
  catch(error){if(error.code!=='ENOENT')throw error;const temporary=target+'.'+randomUUID()+'.writing';try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});try{await fs.link(temporary,target);}catch(e){if(e.code!=='EEXIST'||sha(await fs.readFile(target))!==hash)throw e;}}finally{await fs.unlink(temporary);}}
  return{name,sha256:hash,bytes:bytes.length,key:hash,storage:'content-addressed-private'};
}
export function createNativeSceneResources({stateFile,modelRoot,assetsDirectory,runtimeManifestFile,now=Date.now}){
  if(![stateFile,modelRoot,assetsDirectory,runtimeManifestFile].every(path.isAbsolute))throw Error('PHOTO_SCENE_RESOURCE_CONFIGURATION');
  return async frame=>{
    const manifest=JSON.parse(await fs.readFile(runtimeManifestFile,'utf8'));if(manifest.schema!=='mc-camera-resources/v1'||!Array.isArray(manifest.resources)||manifest.resources.length>40)throw Error('PHOTO_SCENE_RUNTIME_MANIFEST');
    const resources=manifest.resources.map(row=>{if(!SHA.test(row.sha256??'')||row.key!==row.sha256||row.storage!=='content-addressed-private')throw Error('PHOTO_SCENE_RUNTIME_MANIFEST');return row;}),bindings=[];
    const root=await fs.realpath(modelRoot),state=JSON.parse(await fs.readFile(stateFile,'utf8'));
    if(state.source!=='ysm_native_backend'||!Number.isFinite(state.writtenAt)||now()-state.writtenAt>5000||state.writtenAt>now()+1000)throw Error('PHOTO_SCENE_APPEARANCE_STALE');
    for(const actor of [frame.self,...frame.entities]){
      if(actor.name!=='minecraft:player')continue;
      const row=state.players.find(r=>r.playerUuid===actor.uuid&&r.entityId===actor.id&&r.available===true);if(!row)continue;
      const binding=Object.fromEntries(['playerUuid','entityId','modelId','texture','ysmVersion','jarSha256','animation','stateStatus'].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
      const id=row.modelId;if(typeof id!=='string'||id.length>96||!/^[-\p{L}\p{N}_./]+$/u.test(id)||id.includes('..')||id.startsWith('/'))throw Error('PHOTO_SCENE_MODEL_ID');
      const target=await fs.realpath(path.join(root,id)).catch(()=>null);
      if(target){
        const relative=path.relative(root,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('PHOTO_SCENE_MODEL_PATH');const stat=await fs.stat(target);let bytes,name;
        if(stat.isFile()&&id.endsWith('.ysm')){bytes=await fs.readFile(target);name=path.basename(id);}
        else if(stat.isDirectory()){
          const files={},allowed=new Set(['ysm.json']);let total=0;
          const definition=JSON.parse(await fs.readFile(path.join(target,'ysm.json'),'utf8'));
          function references(value,depth=0){if(depth>12)throw Error('PHOTO_SCENE_MODEL_SIZE');if(typeof value==='string'&&/[.](?:json|png|mcmeta|ogg)$/i.test(value)){if(value.startsWith('/')||/[\\:]/.test(value)||value.split('/').includes('..'))throw Error('PHOTO_SCENE_MODEL_PATH');allowed.add(value);}else if(value&&typeof value==='object')for(const child of Object.values(value))references(child,depth+1);}
          references(definition.files);if(allowed.size>128)throw Error('PHOTO_SCENE_MODEL_SIZE');
          for(const key of [...allowed].sort()){
            const file=await fs.realpath(path.join(target,key)),relative=path.relative(target,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('PHOTO_SCENE_MODEL_PATH');
            const s=await fs.stat(file);total+=s.size;if(!s.isFile()||total>8*1024*1024)throw Error('PHOTO_SCENE_MODEL_SIZE');const raw=await fs.readFile(file);files[key]={sha256:sha(raw),bytes:raw.length,base64:raw.toString('base64')};
          }
          bytes=gzipSync(Buffer.from(JSON.stringify({schema:'mc-model-source/v1',modelId:id,files})));name=id.replaceAll('/','_')+'.mcmodel.gz';
        }
        if(bytes){const resource=await saveSceneResource(assetsDirectory,bytes,name);if(!resources.some(r=>r.sha256===resource.sha256))resources.push(resource);binding.resourceSha256=resource.sha256;}
      }
      binding.resourceAvailable=!!binding.resourceSha256||id==='default';bindings.push(binding);
    }
    return{bindings,resources};
  };
}
