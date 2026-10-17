/** Passive subscriber to an explicitly selected local viewer; no input/control emits. */
import { io, type Socket } from 'socket.io-client';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Vec3 } from 'vec3';
import { experienceHash } from '../../core/operation-experience.ts';
import { GAMEPLAY_PROTOCOL, sanitizeGameObservation, type GameplayRecord } from './assessment.ts';
import { GameplayArchive } from './archive.ts';
const require=createRequire(import.meta.url);
export type ViewerObserverOptions={url:string;expectedUsername:string;expectedUuid:string;sampleMs?:number;worldCells?:boolean;
  connectionRead?:{url:string;method?:'GET'|'POST';expectedAddress:string}};
export class ViewerGameplayObserver {
  private socket?:Socket;
  private timer?:ReturnType<typeof setInterval>;
  private retry?:ReturnType<typeof setTimeout>;
  private stopped=false;
  private busy=false;
  private version:string|null=null;
  private dimension:string|null=null;
  private avatar:any=null;
  private receivedAt=0;
  private connectedAt=0;
  private actorMatched=false;
  private scopeConfirmed=false;
  private epoch=randomUUID();
  private sequence=0;
  private chunks=new Map<string,any>();
  private Chunk:any;
  private reconnects=0;
  private failures=0;
  private samples=0;
  private bindingAt=0;
  private bindingRead=false;
  private identityTimer?:ReturnType<typeof setInterval>;
  constructor(private readonly options:ViewerObserverOptions,private readonly scopeKey:string,private readonly archive:GameplayArchive){
    const url=new URL(options.url);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||!['','/'].includes(url.pathname))throw Error('Select one explicit localhost viewer URL');
    if(!/^[\w.-]{1,64}$/.test(options.expectedUsername)||!/^[a-f0-9-]{32,36}$/i.test(options.expectedUuid))throw Error('Actual viewer player identity required');
    if(options.sampleMs!==undefined&&(!Number.isInteger(options.sampleMs)||options.sampleMs<100||options.sampleMs>10000))throw Error('Viewer sampleMs must be 100..10000');
    if(options.connectionRead){const identity=new URL(options.connectionRead.url);
      if(identity.protocol!=='http:'||identity.hostname!=='127.0.0.1'||identity.username||identity.password||identity.search||!/(?:\/state|\.state|\/status)$/.test(identity.pathname)
        ||!['GET','POST'].includes(options.connectionRead.method??'GET')||!/^[\w.:[\]-]+:\d+$/.test(options.connectionRead.expectedAddress))throw Error('Configure one explicit read-only local connection-state endpoint');}
  }
  status(){return {connected:this.socket?.connected??false,actorMatched:this.actorMatched,scopeConfirmed:this.scopeConfirmed,
    samples:this.samples,sourceAgeMs:this.receivedAt?Date.now()-this.receivedAt:null,loadedColumns:this.chunks.size,failures:this.failures,reconnects:this.reconnects,
    bindingSource:this.options.connectionRead?'host-connection-state-and-viewer-identity':'same-scope-live-operation',bindingAgeMs:this.bindingAt?Date.now()-this.bindingAt:null,
    exactControlsKnown:false,serverTruthKnown:false,motorImitationReady:false};}
  confirmScope(row:GameplayRecord){
    const state=row.after??row.before,p=this.avatar?.entity?.pos;
    if(row.kind==='operation'&&row.scopeKey===this.scopeKey&&this.actorMatched&&Date.parse(row.updatedAt)>=this.connectedAt&&state&&state.dimension===this.dimension
      &&state.position&&p&&Date.now()-Date.parse(state.at)<5000&&Math.hypot(state.position[0]-p.x,state.position[1]-p.y,state.position[2]-p.z)<16)this.scopeConfirmed=true;
  }
  start(){if(this.timer||this.stopped)throw Error('Viewer observer is single use');this.timer=setInterval(()=>{void this.sample();},this.options.sampleMs??500);
    if(this.options.connectionRead)this.identityTimer=setInterval(()=>{void this.refreshBinding();},15000);void this.connect();}
  private reset(){this.avatar=null;this.chunks.clear();this.actorMatched=false;this.scopeConfirmed=false;this.bindingAt=0;this.version=null;this.dimension=null;this.epoch=randomUUID();this.sequence=0;}
  private async refreshBinding(){
    const check=this.options.connectionRead;if(!check||this.bindingRead||this.stopped||!this.socket?.connected)return;this.bindingRead=true;
    try{const method=check.method??'GET';const response=await fetch(check.url,{method,signal:AbortSignal.timeout(4000),
      ...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{"args":[]}'}:{})});
      if(!response.ok)throw Error('Connection read unavailable');const value=await response.json() as any;
      const address=value.address??(typeof value.server?.host==='string'&&Number.isInteger(value.server?.port)?`${value.server.host}:${value.server.port}`:null);
      const live=value.reachable===true||['connected','ready'].includes(value.connection?.phase);
      const actual=value.server?.actualVersion;if(address!==check.expectedAddress||!live||(actual&&actual!==this.version)){
        this.bindingAt=0;this.scopeConfirmed=false;return;}
      if(value.server?.username&&value.server.username!==this.options.expectedUsername){this.bindingAt=0;this.scopeConfirmed=false;return;}
      this.bindingAt=Date.now();this.scopeConfirmed=this.actorMatched;
    }catch{this.failures++;if(Date.now()-this.bindingAt>30000)this.scopeConfirmed=false;}finally{this.bindingRead=false;}
  }
  private async connect(){
    if(this.stopped)return;
    try{
      const response=await fetch(new URL('/healthz',this.options.url),{signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw Error('Viewer unavailable');
      const info=await response.json() as any;
      if(info.ok!==true||info.version!=='1.21.1'||!Number.isInteger(info.viewers)||info.viewers>=info.maxSessions)throw Error('Viewer unavailable/busy or incompatible');
      if(this.stopped)return;
      this.reset();this.connectedAt=Date.now();
      const socket=this.socket=io(this.options.url,{transports:['websocket'],reconnection:false,timeout:4000,
        query:this.options.worldCells===false?{overlay:'1'}:{},extraHeaders:{Origin:new URL(this.options.url).origin}});
      socket.on('version',value=>{if(value!=='1.21.1')socket.disconnect();else{this.version=value;this.Chunk=require('prismarine-chunk')(value);}});
      socket.on('biome',value=>{if(typeof value?.dimension==='string'&&/^[\w:./-]{1,120}$/.test(value.dimension)){
        if(this.dimension&&this.dimension!==value.dimension){this.chunks.clear();this.avatar=null;this.scopeConfirmed=false;}
        this.dimension=value.dimension;
      }});
      socket.on('playerEntity',entity=>this.match(entity));
      socket.on('avatarState',value=>{
        if(!this.match(value?.entity))return;const at=value?.capturedAt;
        if(typeof at!=='number'||!Number.isFinite(at)||Date.now()-at>2000||at>Date.now()+1000)return;
        this.avatar=value;this.receivedAt=Date.now();
      });
      socket.once('connect',()=>{void this.refreshBinding();});
      socket.on('loadChunk',value=>{
        const p=this.avatar?.entity?.pos;if(!p||!this.Chunk||typeof value?.chunk!=='string'||value.chunk.length>4*1024*1024||!Number.isInteger(value.x)||!Number.isInteger(value.z))return;
        if(Math.abs(Math.floor(p.x/16)-value.x/16)>1||Math.abs(Math.floor(p.z/16)-value.z/16)>1)return;
        try{this.chunks.set(`${value.x/16},${value.z/16}`,this.Chunk.fromJson(value.chunk));
          for(const key of this.chunks.keys()){const [x,z]=key.split(',').map(Number);if(Math.abs(x-Math.floor(p.x/16))>1||Math.abs(z-Math.floor(p.z/16))>1)this.chunks.delete(key);}}
        catch{this.failures++;}
      });
      socket.on('unloadChunk',v=>this.chunks.delete(`${v?.x/16},${v?.z/16}`));
      socket.on('blockUpdate',v=>{const p=v?.pos;if(!p||![p.x,p.y,p.z,v.stateId].every(Number.isInteger))return;
        try{this.chunks.get(`${Math.floor(p.x/16)},${Math.floor(p.z/16)}`)?.setBlockStateId(new Vec3((p.x%16+16)%16,p.y,(p.z%16+16)%16),v.stateId);}catch{this.failures++;}});
      socket.on('viewerReset',()=>socket.disconnect());
      socket.on('viewerBusy',()=>socket.disconnect());
      socket.once('disconnect',()=>{this.reset();this.schedule();});
      socket.once('connect_error',()=>{socket.disconnect();this.reset();this.schedule();});
    }catch{this.failures++;this.schedule();}
  }
  private match(entity:any):boolean {
    const valid=entity?.isSelf===true&&entity.username===this.options.expectedUsername&&typeof entity.uuid==='string'
      &&entity.uuid.replaceAll('-','').toLowerCase()===this.options.expectedUuid.replaceAll('-','').toLowerCase();
    if(!valid){this.actorMatched=false;this.scopeConfirmed=false;this.avatar=null;this.chunks.clear();return false;}
    this.actorMatched=true;if(this.options.connectionRead&&this.bindingAt&&Date.now()-this.bindingAt<=30000)this.scopeConfirmed=true;return true;
  }
  private schedule(){if(this.stopped||this.retry)return;this.reconnects++;this.retry=setTimeout(()=>{this.retry=undefined;void this.connect();},15000);}
  private async sample(){
    if(this.options.connectionRead&&Date.now()-this.bindingAt>30000)this.scopeConfirmed=false;
    if(this.busy||this.stopped||!this.socket?.connected||this.version!=='1.21.1'||!this.dimension||!this.scopeConfirmed||!this.actorMatched||!this.avatar||Date.now()-this.receivedAt>2000)return;
    this.busy=true;
    try{
      const v=this.avatar,p=v.entity.pos,inventory:Record<string,number>=Object.create(null);
      if(!p||![p.x,p.y,p.z].every(x=>typeof x==='number'&&Number.isFinite(x)))return;
      for(const item of Array.isArray(v.inventory)?v.inventory:[])if(item&&typeof item.name==='string'&&/^[\w:./-]{1,120}$/.test(item.name)&&!['__proto__','constructor','prototype'].includes(item.name)&&Number.isSafeInteger(item.count)&&item.count>=0)inventory[item.name]=(inventory[item.name]??0)+item.count;
      const voxels:number[]=[],stateIds:number[]=[];
      for(let x=-3;x<=3;x++)for(let y=-2;y<=2;y++)for(let z=-3;z<=3;z++){
        const wx=Math.floor(p.x)+x,wy=Math.floor(p.y)+y,wz=Math.floor(p.z)+z;
        const column=this.chunks.get(`${Math.floor(wx/16)},${Math.floor(wz/16)}`);
        let block:any;try{block=column?.getBlock(new Vec3((wx%16+16)%16,wy,(wz%16+16)%16));}catch{block=null;}
        voxels.push(block?1|(block.shapes?.length?2:0)|(block.name==='lava'?4:0)|(['lava','water'].includes(block.name)?8:0):0);stateIds.push(block?.stateId??-1);
      }
      const observation=sanitizeGameObservation({at:new Date(v.capturedAt).toISOString(),dimension:this.dimension,position:p,velocity:v.velocity,yaw:v.entity.yaw,
        onGround:typeof v.onGround==='boolean'?v.onGround:null,health:v.health,food:v.food,oxygen:v.oxygen,inventory:Array.isArray(v.inventory)?inventory:null,
        voxels,controls:[...(v.sprinting===true?['sprint']:[]),...(v.sneaking===true?['sneak']:[])],controlsKnown:false,coverage:'viewer-client-local-voxels',
        receivedAt:new Date(this.receivedAt).toISOString(),worldAt:new Date().toISOString()});
      if(!observation)return;
      const id=experienceHash([this.scopeKey,this.epoch,++this.sequence,observation.at]);
      const record:GameplayRecord={protocol:GAMEPLAY_PROTOCOL,id,sourceId:id,revision:id,scopeKey:this.scopeKey,run:`viewer-${this.epoch}`,
        at:observation.at,updatedAt:observation.at,kind:'observation',tool:null,operations:[],intents:[],controller:'unknown',sessionId:null,decisionId:null,methodId:null,
        methodRevision:null,memoryRefs:[],phase:null,terminal:null,dispatch:null,elapsedMs:null,before:null,after:null,observation,
        assessment:{label:'unknown',reasons:['passive-state-not-an-expert-action-label'],signals:[],trainingUse:'context-only',goalVerified:false},sourceHash:id,previousRevision:null,
        boundary:this.options.connectionRead?'configured-server-status-plus-pinned-viewer-identity':'same-scope-live-operation-confirmed',executionId:null,effects:[],decision:null,requestId:null};
      await this.archive.append(record);
      const environment=sanitizeGameObservation({at:observation.worldAt,dimension:this.dimension,position:p,health:null,food:null,inventory:null,stateIds,coverage:'client-loaded-only-not-independent-server-truth',receivedAt:observation.receivedAt});
      await this.archive.append({...record,id:experienceHash([id,'environment']),kind:'environment',at:environment!.at,updatedAt:environment!.at,observation:environment});this.samples++;
    }catch{this.failures++;}finally{this.busy=false;}
  }
  async stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);if(this.identityTimer)clearInterval(this.identityTimer);if(this.retry)clearTimeout(this.retry);this.socket?.disconnect();while(this.busy||this.bindingRead)await new Promise(done=>setTimeout(done,10));this.reset();}
}
