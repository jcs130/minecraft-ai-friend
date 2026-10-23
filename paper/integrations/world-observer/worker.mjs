import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateWorkerConfig(c) {
  for(const k of ['rendererRoot','assetDirectory','observerKeyFile','portalTokenFile'])if(!path.isAbsolute(c[k]??''))throw Error('OBSERVER_LOCAL_CONFIGURATION');
  const local=new URL(c.observerOrigin),portal=new URL(c.portalOrigin);
  if(local.protocol!=='http:'||local.hostname!=='127.0.0.1'||local.pathname!=='/'||local.username||local.password||local.search||local.hash)throw Error('OBSERVER_LOOPBACK_REQUIRED');
  if(portal.protocol!=='https:'&&!(portal.protocol==='http:'&&portal.hostname==='127.0.0.1')||portal.pathname!=='/'||portal.username||portal.password||portal.search||portal.hash)throw Error('OBSERVER_PORTAL_CONFIGURATION');
  return {...c,observerOrigin:local.origin,portalOrigin:portal.origin};
}
export async function readBoundedJSON(response,maxBytes) {
  if(!response.ok)throw Error('OBSERVATION_HTTP_'+response.status);
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw Error('OBSERVATION_RESPONSE_LIMIT');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Controls only observation hosts and their outbound publishers. No createBot,
 * login, command, RCON or gameplay action exists in this service. */
export class ObservationWorker {
  constructor({config,prepared,registry,decodePacket,simplifyNBT,startPublisher,fetcher=fetch,now=Date.now,log=()=>{}}) {
    Object.assign(this,{config,prepared,registry,decodePacket,simplifyNBT,startPublisher,fetcher,now,log});
    this.sources=new Map();this.lastPortalAt=0;this.lastPoll=0;this.lastLog=null;this.closed=false;
  }
  report(reason){if(reason!==this.lastLog){this.log(reason);this.lastLog=reason;}}
  async request(origin,route,token,body,maxBytes){
    return readBoundedJSON(await this.fetcher(new URL(route,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}),maxBytes);
  }
  async retire(id){const source=this.sources.get(id);if(!source)return;this.sources.delete(id);source.publisher?.close();await source.view.close();}
  async step() {
    if(this.closed)return;
    if(this.now()-this.lastPoll>=2500){
      this.lastPoll=this.now();
      try{
        const reply=await this.request(this.config.portalOrigin,'/api/v1/internal/world-view/poll',this.config.portalToken,{},32768);
        if(this.closed)return;
        if(!Array.isArray(reply.jobs)||reply.jobs.length>4)throw Error('OBSERVER_JOBS_INVALID');
        const seen=new Set();
        for(const job of reply.jobs){
          if(!/^[a-f0-9]{32}$/.test(job.id??'')||!UUID.test(job.playerUuid??'')||!UUID.test(job.lease??'')||!/^\.?[A-Za-z0-9_]{1,16}$/.test(job.playerName??'')
            ||!/^pub_[A-Za-z0-9_-]{43}$/.test(job.publisherToken??'')||!['owner','scene'].includes(job.scope)||!Number.isFinite(Date.parse(job.expiresAt))
            ||Date.parse(job.expiresAt)<=this.now()||Date.parse(job.expiresAt)>this.now()+15000||seen.has(job.id))throw Error('OBSERVER_JOB_INVALID');
          seen.add(job.id);
          let source=this.sources.get(job.id);
          if(source&&(source.job.lease!==job.lease||source.job.playerUuid!==job.playerUuid||source.job.scope!==job.scope||source.job.publisherToken!==job.publisherToken)){await this.retire(job.id);source=null;}
          if(!source){
            const view=this.prepared.attach({playerUuid:job.playerUuid,name:job.playerName,registry:this.registry,decodePacket:this.decodePacket,simplifyNBT:this.simplifyNBT,scope:job.scope});
            await view.listen();if(this.closed){await view.close();return;}source={job,view,localLease:randomUUID(),after:0,generation:null,publisher:null};this.sources.set(job.id,source);
          }
          source.job=job;
        }
        for(const id of [...this.sources.keys()])if(!seen.has(id))await this.retire(id);
        this.lastPortalAt=this.now();this.report('观战授权已连接。');
      }catch(error){this.report('观战授权暂不可用，停止过期画面。');}
    }
    if(this.now()-this.lastPortalAt>8000){for(const id of [...this.sources.keys()])await this.retire(id);return;}
    const targets=[...this.sources.values()].map(s=>({uuid:s.job.playerUuid,lease:s.localLease,after:s.after,generation:s.generation}));
    if(!targets.length)return;
    // This implementation has one channel per UUID. Duplicates indicate an
    // inconsistent job manifest rather than a reason to reset a live source.
    if(new Set(targets.map(t=>t.uuid)).size!==targets.length)throw Error('OBSERVER_DUPLICATE_TARGET');
    try{
      const reply=await this.request(this.config.observerOrigin,'/v1/poll',this.config.observerKey,{schemaVersion:1,targets},12*1024*1024);
      if(this.closed)return;
      if(reply.schemaVersion!==1||reply.minecraftVersion!=='1.21.1'||!Array.isArray(reply.targets)||reply.targets.length>4)throw Error('OBSERVER_RECEIPT_INVALID');
      for(const source of [...this.sources.values()]){
        const row=reply.targets.find(r=>r.uuid===source.job.playerUuid);
        if(!row?.available||row.lease!==source.localLease){await this.retire(source.job.id);continue;}
        try{
          ({after:source.after,generation:source.generation}=source.view.ingest(row));
          const status=source.view.host.status();
          if(status.viewer.reason)throw Error('OBSERVER_SCENE_UNAVAILABLE');
          if(!source.publisher&&status.viewer.loadedColumns>=9&&status.identity.confirmed){
            const publisher=await this.startPublisher({sourceUrl:source.view.url,portalUrl:this.config.portalOrigin,channelId:source.job.id,token:source.job.publisherToken});
            if(this.closed||this.sources.get(source.job.id)!==source){publisher.close();return;}
            source.publisher=publisher;
            void publisher.done.then(()=>{if(source.publisher===publisher)source.publisher=null;});
          }
        }catch(error){await this.retire(source.job.id);this.report('观战场景需要重新加载，旧画面已停止。');}
      }
    }catch(error){for(const id of [...this.sources.keys()])await this.retire(id);this.report('游戏场景暂不可用，等待服务恢复。');}
  }
  async close(){if(this.closed)return;this.closed=true;for(const id of [...this.sources.keys()])await this.retire(id);}
}

export async function createObservationWorker(input,options={}) {
  const config=validateWorkerConfig(input);
  config.observerKey=(await fs.readFile(config.observerKeyFile,'utf8')).trim();config.portalToken=(await fs.readFile(config.portalTokenFile,'utf8')).trim();
  if(!/^[A-Za-z0-9_-]{43}$/.test(config.observerKey)||!/^obs_[A-Za-z0-9_-]{43}$/.test(config.portalToken))throw Error('OBSERVER_CREDENTIAL_FILE_INVALID');
  const moduleAt=relative=>import(pathToFileURL(path.join(config.rendererRoot,relative)).href);
  const [{preparePaperObservation},{startSpectatorPublisher}]=await Promise.all([moduleAt('host/paper-observation.mjs'),moduleAt('host/spectator-publisher.mjs')]);
  const require=createRequire(import.meta.url),protocol=require('minecraft-protocol'),registry=require('minecraft-data')('1.21.1'),nbt=require('prismarine-nbt');
  const parsers=Object.fromEntries(['play','configuration'].map(state=>[state,protocol.createDeserializer({version:'1.21.1',state,isServer:false,noErrorLogging:true})]));
  const prepared=await preparePaperObservation({assetDirectory:config.assetDirectory,port:0,
    serverItemCatalogFile:config.serverItemCatalogFile,serverItemCatalogSha256:config.serverItemCatalogSha256,bundledAppearanceCatalogFile:config.bundledAppearanceCatalogFile||''});
  return new ObservationWorker({config,prepared,registry,simplifyNBT:nbt.simplify,
    decodePacket:(bytes,state)=>parsers[state].parsePacketBuffer(bytes).data,startPublisher:startSpectatorPublisher,...options});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=process.argv[2];if(!path.isAbsolute(file||''))throw Error('Use an absolute private observer configuration file');
  const worker=await createObservationWorker(JSON.parse(await fs.readFile(file,'utf8')),{log:text=>console.log(text)});
  let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;void worker.close();});
  try{while(!stopping){await worker.step();await new Promise(resolve=>setTimeout(resolve,200));}}
  finally{await worker.close();}
}
