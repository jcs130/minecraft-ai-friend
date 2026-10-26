import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9-]{36}$/;
async function json(file,limit=1024*1024){const stat=await fs.stat(file);if(stat.size>limit)throw Error('APPEARANCE_FILE_LIMIT');return JSON.parse(await fs.readFile(file,'utf8'));}
export class ObservationAppearanceSource {
  constructor({config,decodeBundle,fetcher=fetch,now=Date.now,exportBundle}){
    Object.assign(this,{config,decodeBundle,fetcher,now,exportBundle});this.assets=new Map();this.bindings=new Map();this.failed=new Map();this.inFlight=new Map();this.size=0;this.state=null;this.stateAt=0;
  }
  binding({uuid,entityId}){const b=this.bindings.get(uuid);return b?.entityId===entityId&&this.now()-b.checkedAt<15000?b.value:null;}
  read(hash){return SHA.test(hash??'')?this.assets.get(hash):null;}
  store(bundle){
    const bytes=Buffer.from(JSON.stringify(bundle));if(bytes.length>8*1024*1024)throw Error('APPEARANCE_BUNDLE_LIMIT');
    const hash=sha(bytes);
    if(!this.assets.has(hash)){
      while(this.assets.size>=32||this.size+bytes.length>32*1024*1024){const key=this.assets.keys().next().value;this.size-=this.assets.get(key).length;this.assets.delete(key);}
      this.assets.set(hash,bytes);this.size+=bytes.length;
    }
    return {bundleSha256:hash,bytes:bytes.length};
  }
  forPlayer(player){
    const uuid=player?.uuid?.toLowerCase();
    if(this.inFlight.has(uuid))return this.inFlight.get(uuid);
    const task=this.updatePlayer(player).finally(()=>this.inFlight.delete(uuid));this.inFlight.set(uuid,task);return task;
  }
  async updatePlayer(player){
    const uuid=player?.uuid?.toLowerCase(),entityId=player?.entityId;
    if(!UUID.test(uuid??'')||!Number.isSafeInteger(entityId))return;
    let value={schemaVersion:1,source:'paper_server_appearance',playerUuid:uuid,entityId,available:false,reason:'SERVER_APPEARANCE_UNAVAILABLE'};
    const previous=this.bindings.get(uuid);
    if(previous?.entityId===entityId&&this.now()-previous.checkedAt<1000)return;
    try{
      if(!this.state||this.now()-this.stateAt>=1000){this.state=await json(this.config.stateFile);this.stateAt=this.now();}
      const state=this.state,row=state.players?.find(r=>r.playerUuid?.toLowerCase()===uuid);
      if(state.source!=='freesia_worker'||!Number.isFinite(state.writtenAt)||this.now()-state.writtenAt>15000||state.writtenAt>this.now()+1000)throw Error('SERVER_APPEARANCE_STATE_STALE');
      if(row?.available===true){
        if(row.entityId!==entityId||row.webAvailable!==true||row.ysmVersion!=='2.4.1'||row.protocolVersion!=='2.4.0'||row.jarSha256!==this.config.ysmJarSha256||!SHA.test(row.assetSha256??'')||!Number.isInteger(row.assetBytes)||row.assetBytes<1||row.assetBytes>2*1024*1024||!/^[-a-zA-Z0-9_]{1,96}$/.test(row.modelId??''))throw Error('SERVER_APPEARANCE_BODY_OR_SOURCE_MISMATCH');
        // Reuse immutable resource references, never the previous body's
        // UUID/entityId/authority. Reconnects and respawns get a new entityId.
        let asset=previous?.value&&{bundleSha256:previous.value.bundleSha256,bytes:previous.value.bytes,assetSha256:previous.value.assetSha256};
        if(asset?.assetSha256!==row.assetSha256||!this.assets.has(asset?.bundleSha256)){
          if(this.now()-(this.failed.get(row.assetSha256)??-Infinity)<5000)throw Error('SERVER_APPEARANCE_RETRY_PENDING');
          try{
            const compressed=this.exportBundle?await this.exportBundle(row):
              (await run(this.config.java,['-cp',this.config.exporterClasspath,'org.afuhome.appearance.ExportAppearance',this.config.publicModelRoot,row.modelId,row.assetSha256],{encoding:'buffer',maxBuffer:2*1024*1024+1024,timeout:10000,windowsHide:true})).stdout;
            if(compressed.length!==row.assetBytes)throw Error('SERVER_APPEARANCE_SIZE_MISMATCH');
            const bundle=this.decodeBundle(compressed,row.assetSha256);
            if(bundle.modelId!==row.modelId||!bundle.textures?.[row.texture])throw Error('SERVER_APPEARANCE_MODEL_MISMATCH');
            asset={...this.store(bundle),assetSha256:row.assetSha256};
          }catch(error){this.failed.set(row.assetSha256,this.now());throw error;}
        }
        value={...value,...asset,available:true,reason:null,kind:'ysm',modelId:row.modelId,texture:row.texture,ysmVersion:row.ysmVersion,stateEpoch:state.epoch,authority:row.stateAuthority??'freesia_worker'};
      }else{
        // A real UUID's configured skin is an independent authoritative source,
        // not a guessed YSM folder or a replacement default Steve texture.
        const binding=await json(path.join(this.config.skinsRestorerRoot,'players',uuid+'.player'),16384);
        if(binding.uniqueId?.toLowerCase()!==uuid||binding.skinIdentifier?.type!=='CUSTOM'||!/^[-a-zA-Z0-9_]{1,96}$/.test(binding.skinIdentifier.identifier??''))throw Error('SERVER_SKIN_BINDING_UNAVAILABLE');
        const skin=await json(path.join(this.config.skinsRestorerRoot,'skins',binding.skinIdentifier.identifier+'.customskin'),65536);
        const profile=JSON.parse(Buffer.from(skin.value,'base64').toString('utf8')),selected=profile.textures?.SKIN;
        const match=/^https?:\/\/textures\.minecraft\.net\/texture\/([a-f0-9]{64})$/.exec(selected?.url??'');
        if(!match)throw Error('SERVER_SKIN_URL_INVALID');
        const model=selected.metadata?.model==='slim'?'slim':'wide',identity=match[1]+':'+model;
        let asset=previous?.value&&{bundleSha256:previous.value.bundleSha256,bytes:previous.value.bytes,skinIdentity:previous.value.skinIdentity};
        if(asset?.skinIdentity!==identity||!this.assets.has(asset?.bundleSha256)){
          const response=await this.fetcher('https://textures.minecraft.net/texture/'+match[1],{redirect:'error',signal:AbortSignal.timeout(8000)});
          if(!response.ok)throw Error('SERVER_SKIN_DOWNLOAD_FAILED');
          let n=0;const chunks=[];for await(const chunk of response.body){n+=chunk.length;if(n>512*1024)throw Error('SERVER_SKIN_SIZE_LIMIT');chunks.push(chunk);}
          const png=Buffer.concat(chunks);
          if(png.length<33||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('SERVER_SKIN_PNG_INVALID');
          const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
          if(width!==64||![32,64].includes(height))throw Error('SERVER_SKIN_DIMENSIONS_UNSUPPORTED');
          const bundle={schemaVersion:1,format:'minecraft-skin-original',skin:{base64:png.toString('base64'),sha256:sha(png),width,height,model,label:binding.skinIdentifier.identifier}};
          asset={...this.store(bundle),skinIdentity:identity};
        }
        value={...value,...asset,available:true,reason:null,kind:'skin',modelId:binding.skinIdentifier.identifier,texture:model,authority:'skinsrestorer_uuid_binding',ysmReason:row?.reason??'YSM_WORKER_STATE_UNAVAILABLE'};
      }
    }catch(error){value.reason=/^(SERVER_|YSM_)/.test(error.message)?error.message:'SERVER_APPEARANCE_UNAVAILABLE';}
    this.bindings.set(uuid,{entityId,checkedAt:this.now(),value});
  }
}
