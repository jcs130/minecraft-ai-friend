import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {ObservationAppearanceSource} from './appearance-source.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const failureStages=new Set(['authority','sample','scene','publisher']);
const structuralFrames=new Set(['worker.mjs','paper-observation.mjs','compiler.js','serializer.js','protodef.js','numeric.js','varint.js','utils.js','minecraft.js','nbt.js','structures.js','conditional.js']);
const failureCodes=new Set([
  'OBSERVATION_RESPONSE_LIMIT','OBSERVER_DUPLICATE_TARGET','OBSERVER_GRANT_EXPIRED','OBSERVER_JOBS_INVALID','OBSERVER_JOB_INVALID','OBSERVER_RECEIPT_INVALID','OBSERVER_SCENE_UNAVAILABLE',
  'PAPER_INVENTORY_INVALID','PAPER_ITEM_COMPONENTS_UNAVAILABLE','PAPER_OBSERVATION_CLOSED','PAPER_OBSERVATION_CONFIGURATION','PAPER_OBSERVATION_IDENTITY_OR_STATE',
  'PAPER_OBSERVATION_PACKET_INVALID','PAPER_OBSERVATION_PACKET_LIMIT','PAPER_OBSERVATION_PACKET_NOT_ALLOWED','PAPER_OBSERVATION_READ_ONLY',
  'PAPER_OBSERVATION_REGISTRIES_MISSING','PAPER_OBSERVATION_SEQUENCE','PAPER_OBSERVATION_TICK_REGRESSED',
  'NATIVE_BIOME_REGISTRY_EMPTY','NATIVE_BIOME_REGISTRY_INCOMPLETE','NATIVE_BIOME_REGISTRY_INVALID','NATIVE_CHUNK_TRAILING_DATA',
  'NATIVE_DROPPED_ITEM_COMPONENTS_UNAVAILABLE','NATIVE_DROPPED_ITEM_REGISTRY_UNAVAILABLE','NATIVE_DROPPED_ITEM_SLOT_UNAVAILABLE','NATIVE_EFFECT_RESOLVER_INVALID',
  'NATIVE_ENTITY_ANGLE_INVALID','NATIVE_ENTITY_ATTRIBUTES_INVALID','NATIVE_ENTITY_BOUNDS_INVALID','NATIVE_ENTITY_COLLECT_INVALID','NATIVE_ENTITY_CUE_INVALID',
  'NATIVE_ENTITY_DATA_BUDGET_EXCEEDED','NATIVE_ENTITY_DELTA_INVALID','NATIVE_ENTITY_DESTROY_INVALID','NATIVE_ENTITY_EFFECT_BUDGET_EXCEEDED','NATIVE_ENTITY_EFFECT_INVALID',
  'NATIVE_ENTITY_EQUIPMENT_BUDGET_EXCEEDED','NATIVE_ENTITY_EQUIPMENT_INVALID','NATIVE_ENTITY_GROUND_INVALID','NATIVE_ENTITY_HURT_ANIMATION_INVALID',
  'NATIVE_ENTITY_METADATA_BUDGET_EXCEEDED','NATIVE_ENTITY_METADATA_INVALID','NATIVE_ENTITY_POSITION_INVALID','NATIVE_ENTITY_REGISTRY_CONFIG_INVALID',
  'NATIVE_ENTITY_REGISTRY_EMPTY','NATIVE_ENTITY_REGISTRY_HASH_MISMATCH','NATIVE_ENTITY_REGISTRY_INVALID','NATIVE_ENTITY_REGISTRY_UNAVAILABLE',
  'NATIVE_ENTITY_SCALE_INVALID','NATIVE_ENTITY_SNAPSHOT_BUDGET_EXCEEDED','NATIVE_ENTITY_SPAWN_INVALID','NATIVE_ENTITY_TOTAL_DATA_BUDGET_EXCEEDED',
  'NATIVE_ENTITY_TRACKING_BUDGET_EXCEEDED','NATIVE_ENTITY_VELOCITY_INVALID','NATIVE_EXPERIENCE_REGISTRY_UNAVAILABLE','NATIVE_EXPERIENCE_SPAWN_INVALID',
  'NATIVE_GLOBAL_PALETTE_COUNT_INVALID','NATIVE_GLOBAL_PALETTE_LENGTH_INVALID','NATIVE_GLOBAL_PALETTE_WIDTH_MISMATCH','NATIVE_GLOBAL_PALETTE_WIDTH_UNSUPPORTED',
  'NATIVE_ITEM_RESOLVER_INVALID','NATIVE_LONG_UNSAFE_NUMBER','NATIVE_MAID_ANIMATION_INVALID','NATIVE_WORLD_BLOCK_ENTITY_POSITION_INVALID','NATIVE_WORLD_BLOCK_INVALID',
  'NATIVE_WORLD_BLOCK_RECORD_INVALID','NATIVE_WORLD_CHUNK_INVALID','NATIVE_WORLD_DIMENSION_UNAVAILABLE','NATIVE_WORLD_HOST_CLOSED',
  'NATIVE_WORLD_PACKET_SEQUENCE_OR_REGISTRY_MISMATCH','NATIVE_WORLD_REGISTRY_EMPTY','NATIVE_WORLD_REGISTRY_HASH_MISMATCH','NATIVE_WORLD_REGISTRY_INVALID',
  'NATIVE_WORLD_SNAPSHOT_BUDGET_EXCEEDED','NATIVE_WORLD_STATE_UNREGISTERED','NATIVE_WORLD_TIME_INVALID','NATIVE_WORLD_VIEW_BOUNDS_INVALID',
  'SPECTATOR_ACK_TIMEOUT','SPECTATOR_BODY_LIMIT','SPECTATOR_PORTAL_URL_INVALID','SPECTATOR_PROTOCOL','SPECTATOR_PROTOCOL_REJECTED',
  'SPECTATOR_PUBLISHER_CANCELLED','SPECTATOR_PUBLISHER_CLOSED','SPECTATOR_PUBLISHER_CONFIGURATION','SPECTATOR_PUBLISHER_READY_TIMEOUT',
  'SPECTATOR_REQUEST_CANCELLED','SPECTATOR_REQUEST_REJECTED','SPECTATOR_SOURCE_MUST_BE_LOOPBACK','SPECTATOR_SOURCE_NOT_READY',
  'SPECTATOR_SOURCE_STATUS_LIMIT','SPECTATOR_SOURCE_STATUS_UNAVAILABLE','SPECTATOR_SOURCE_UNAVAILABLE','SPECTATOR_TRANSPORT_CLOSED','SPECTATOR_TRANSPORT_ERROR',
  'ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT'
]);
export function observationFailure(stage,error,now=Date.now()) {
  if(!failureStages.has(stage))throw Error('OBSERVER_FAILURE_STAGE');
  const type=['Error','TypeError','RangeError','SyntaxError','TimeoutError','AbortError','PartialReadError'].includes(error?.name)?error.name:'Error';
  const code=value=>typeof value==='string'&&(failureCodes.has(value)||/^OBSERVATION_HTTP_[1-5][0-9]{2}$/.test(value))?value:null;
  const result={stage,reason:code(error?.message)||(type==='TimeoutError'?'OBSERVER_REQUEST_TIMEOUT':'OBSERVER_EXCEPTION'),
    type,cause:code(error?.cause?.code),sceneReason:code(error?.sceneReason),at:new Date(now).toISOString()};
  if(type==='PartialReadError'){
    // Structural locations only: never retain the error message, directories,
    // URLs, packet contents or arbitrary stack text in an operational status.
    result.frames=String(error?.stack??'').split('\n').slice(1,9).flatMap(line=>{
      const frame=[...line.matchAll(/\b([A-Za-z0-9_$-]{1,64}\.(?:mjs|cjs|js|ts)):(\d{1,7}):(\d{1,6})\b/g)].at(-1);
      return frame&&structuralFrames.has(frame[1])?[{file:frame[1],line:Number(frame[2]),column:Number(frame[3])}]:[];
    }).slice(0,6);
  }
  return result;
}
// Names are from the installed, version-pinned protocol schema, never from
// error text, decoded player fields, or a caller-supplied packet payload.
export function observationPacketNames(registry){
  const names={};
  for(const state of ['play','configuration']){
    const packet=registry?.protocol?.[state]?.toClient?.types?.packet;
    const mappings=packet?.[1]?.find?.(field=>field.name==='name')?.type?.[1]?.mappings;
    names[state]={};
    for(const [id,name] of Object.entries(mappings??{})){
      const number=Number(id);
      if(Number.isSafeInteger(number)&&number>=0&&/^[a-z][a-z0-9_]{0,63}$/.test(name))names[state][number]=name;
    }
  }
  return names;
}

// The compiled ProtoDef reader does not expose an error field or byte offset.
// On failure only, repeat this already received, bounded packet in memory while
// wrapping the compiled readers synchronously. No bytes or error text escape.
// The recorded offset is the start of the innermost failing reader on replay,
// not necessarily the cursor where a variable-length reader ran out of data.
function replayPosition(parser,bytes,original){
  const unavailable=replay=>({replay,reader:null,readerStartByte:null,readerPath:[]});
  if(!Buffer.isBuffer(bytes)||bytes.length>2*1024*1024)return unavailable('size_limit');
  const ctx=parser?.proto?.readCtx;
  if(!ctx||typeof ctx!=='object')return unavailable('unsupported');
  const changes=[],caught=new WeakMap(),budgetExceeded={};let calls=0,started=0;
  try{
    for(const [name,reader] of Object.entries(ctx)){
      if(typeof reader!=='function'||!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))continue;
      const descriptor=Object.getOwnPropertyDescriptor(ctx,name);
      if(!descriptor?.writable)continue;
      ctx[name]=function(buffer,offset,...args){
        // Best-effort CPU bound on the diagnostic replay only. A single native
        // reader cannot be preempted, so this is not a hard wall-clock limit.
        if(++calls>100000||(calls%256===0&&performance.now()-started>25))throw budgetExceeded;
        try{return reader.call(this,buffer,offset,...args);}
        catch(error){
          if(error&&(typeof error==='object'||typeof error==='function')){
            let position=caught.get(error);
            if(!position){
              let absolute=null;
              if(Buffer.isBuffer(buffer)&&buffer.buffer===bytes.buffer&&buffer.byteOffset>=bytes.byteOffset
                &&buffer.byteOffset+buffer.length<=bytes.byteOffset+bytes.length&&Number.isSafeInteger(offset)&&offset>=0){
                const candidate=buffer.byteOffset-bytes.byteOffset+offset;
                if(candidate<=2*1024*1024)absolute=candidate;
              }
              position={reader:name,readerStartByte:absolute,readerPath:[]};caught.set(error,position);
            }
            if(position.readerPath.length<8)position.readerPath.push(name);
          }
          throw error;
        }
      };
      changes.push([name,descriptor]);
    }
    if(!changes.length)return unavailable('unsupported');
    started=performance.now();
    try{parser.parsePacketBuffer(bytes);return unavailable('not_reproduced');}
    catch(error){
      if(error===budgetExceeded)return unavailable('budget_limit');
      if(error?.name!==original?.name||!!error?.partialReadError!==!!original?.partialReadError)return unavailable('different_error');
      const position=error&&(typeof error==='object'||typeof error==='function')?caught.get(error):null;
      return position?{replay:'reproduced',...position}:unavailable('no_reader');
    }
  }catch{return unavailable('diagnostic_error');}
  finally{for(const [name,descriptor] of changes)Object.defineProperty(ctx,name,descriptor);}
}

export function observationPacketDecoder(parsers,names={}){
  let context=null,lastDecoded=null,sequence=0;const failures=new WeakMap();
  const copy=value=>value&&{...value};
  return {reset(){context=null;lastDecoded=null;sequence++;},context(){return copy(context);},lastDecoded(){return copy(lastDecoded);},
    failure(error){
      const record=error&&(typeof error==='object'||typeof error==='function')?failures.get(error):null;
      return record?.sequence===sequence?structuredClone(record.diagnostic):null;
    },decode(bytes,state){
    // Each decode invalidates an earlier caught/suppressed error. Only the
    // precise error object escaping the current call can be blamed on it.
    const currentSequence=++sequence;
    let id=0,shift=0,complete=false;
    for(let i=0;i<Math.min(5,bytes.length);i++){const n=bytes[i];id+=(n&127)*2**shift;if(!(n&128)){complete=true;break;}shift+=7;}
    const packetId=complete&&Number.isSafeInteger(id)&&id<=0x7fffffff?id:null;
    context={state:['play','configuration'].includes(state)?state:'unknown',bytes:bytes.length,packetId};
    if(packetId!==null&&/^[a-z][a-z0-9_]{0,63}$/.test(names[state]?.[packetId]??''))context.name=names[state][packetId];
    try{
      const decoded=parsers[state].parsePacketBuffer(bytes),packet=decoded.data;
      if(Number.isSafeInteger(decoded.metadata?.size)&&decoded.metadata.size>=0&&decoded.metadata.size<=bytes.length)context.consumedBytes=decoded.metadata.size;
      lastDecoded=copy(context);return packet;
    }catch(error){
      if(error&&(typeof error==='object'||typeof error==='function')){
        let position;
        try{position=replayPosition(parsers[state],bytes,error);}
        catch{position={replay:'diagnostic_error',reader:null,readerStartByte:null,readerPath:[]};}
        failures.set(error,{sequence:currentSequence,diagnostic:{...context,position}});
      }
      throw error;
    }
  }};
}
export function validateWorkerConfig(c) {
  for(const k of ['rendererRoot','assetDirectory','observerKeyFile','portalTokenFile'])if(!path.isAbsolute(c[k]??''))throw Error('OBSERVER_LOCAL_CONFIGURATION');
  const local=new URL(c.observerOrigin),portal=new URL(c.portalOrigin);
  if(local.protocol!=='http:'||local.hostname!=='127.0.0.1'||local.pathname!=='/'||local.username||local.password||local.search||local.hash)throw Error('OBSERVER_LOOPBACK_REQUIRED');
  if(portal.protocol!=='https:'&&!(portal.protocol==='http:'&&portal.hostname==='127.0.0.1')||portal.pathname!=='/'||portal.username||portal.password||portal.search||portal.hash)throw Error('OBSERVER_PORTAL_CONFIGURATION');
  if(c.sampleIntervalMs!==undefined&&(!Number.isInteger(c.sampleIntervalMs)||c.sampleIntervalMs<50||c.sampleIntervalMs>1000))throw Error('OBSERVER_SAMPLE_INTERVAL_INVALID');
  if(c.terrainDeltas!==undefined&&typeof c.terrainDeltas!=='boolean')throw Error('OBSERVER_TERRAIN_DELTAS_INVALID');
  return {...c,sampleIntervalMs:c.sampleIntervalMs??50,observerOrigin:local.origin,portalOrigin:portal.origin};
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
  constructor({config,prepared,registry,decodePacket,simplifyNBT,startPublisher,appearanceSource=null,maidSource=null,packetDecoder=null,protocolInfo=null,fetcher=fetch,now=Date.now,log=()=>{}}) {
    Object.assign(this,{config,prepared,registry,decodePacket,simplifyNBT,startPublisher,appearanceSource,maidSource,packetDecoder,protocolInfo,fetcher,now,log});
    this.sources=new Map();this.lastPortalAt=0;this.lastPoll=0;this.lastLog=null;this.closed=false;
    this.sampleIntervalMs=config.sampleIntervalMs??50;this.authorityInFlight=null;this.sampleInFlight=null;
    this.lastSampleAt=null;this.sampleCount=0;this.sampleDurationMs=null;this.lifecycle=new AbortController();
    this.lastFailure=null;this.diagnosticKey=randomBytes(32);
  }
  report(reason){if(reason!==this.lastLog){this.log(reason);this.lastLog=reason;}}
  generationRef(value){return typeof value==='string'&&UUID.test(value)?createHmac('sha256',this.diagnosticKey).update(value.toLowerCase()).digest('hex').slice(0,24):null;}
  observeRendererFailures(source){
    let world,original,own;
    try{world=source.view?.host?.world;original=world?.unavailable;if(typeof original!=='function')return;own=Object.getOwnPropertyDescriptor(world,'unavailable');}
    catch{return;}
    const worker=this;
    function wrapped(error,...args){
      // The shared renderer catches some conversion errors internally and
      // keeps only error.message. Capture its structural type before that loss.
      // Never retain the error object or a packet from another active source.
      try{
        if(!this.error&&!source.rendererFailure){
          const active=source.activeReceipt;
          source.rendererFailure={failure:observationFailure('scene',error,worker.now()),
            phase:active?'renderer_unavailable_during_ingest':'renderer_unavailable_async',
            generation:active?active.generation:source.generation,previousGeneration:active?active.previousGeneration:source.generation,
            lastDecodedPacket:active?(worker.packetDecoder?.lastDecoded?.()??null):null};
        }
      }catch{} // Diagnostics must never replace the renderer's original behavior.
      return Reflect.apply(original,this,[error,...args]);
    }
    try{
      world.unavailable=wrapped;
      if(world.unavailable!==wrapped)return;
      source.restoreUnavailable=()=>{if(world.unavailable===wrapped){if(own)Object.defineProperty(world,'unavailable',own);else delete world.unavailable;}};
    }catch{} // A different renderer contract simply has no captured exception.
  }
  recordFailure(stage,error,scene=null){
    const reported=observationFailure(stage,error,this.now()),captured=stage==='scene'&&scene?.phase==='scene_unavailable'?scene.source.rendererFailure:null;
    this.lastFailure=captured?{...captured.failure,sceneReason:reported.sceneReason,reportedAt:reported.at}:reported;
    if(stage==='scene'&&scene){
      const packet=captured?null:(this.packetDecoder?.failure?.(error)??null);
      this.lastFailure.phase=captured?.phase??(packet?'packet_decode':scene.phase);
      this.lastFailure.protocol=this.protocolInfo;
      const asyncCapture=captured?.phase==='renderer_unavailable_async',generation=captured?captured.generation:scene.generation;
      this.lastFailure.target={sourceRef:scene.source.diagnosticRef,generationRef:this.generationRef(generation),generationBasis:asyncCapture?'last_accepted':'receipt',
        receiptGenerationRef:asyncCapture?null:this.generationRef(generation),previousGenerationRef:this.generationRef(captured?captured.previousGeneration:scene.previousGeneration)};
      this.lastFailure.packet=packet;
      this.lastFailure.lastDecodedPacket=captured?captured.lastDecodedPacket:(packet?null:(this.packetDecoder?.lastDecoded?.()??null));
    }
    this.log('OBSERVER_FAILURE '+JSON.stringify(this.lastFailure));
  }
  nextSampleDelayMs(){return Math.max(0,this.sampleIntervalMs-(this.now()-(this.lastSampleAt??this.now())));}
  status(){return {schemaVersion:1,errorDiagnosticsVersion:2,readOnly:true,closed:this.closed,lastFailure:this.lastFailure,sampling:{intervalMs:this.sampleIntervalMs,requests:this.sampleCount,
    lastSampleAt:this.lastSampleAt,lastDurationMs:this.sampleDurationMs,authorityPending:!!this.authorityInFlight},sources:[...this.sources.values()].map(source=>{
    const host=source.view.host.status(),coverage=host.viewer?.terrain?.coverage;
    const appearance=this.appearanceSource?.binding({uuid:source.job.playerUuid,entityId:host.identity?.entityId});
    return {playerUuid:source.job.playerUuid,...source.publisher?.state?.(),terrain:coverage?{renderBlocks:coverage.renderBlocks,occludedBlocks:coverage.occludedBlocks,surfaceHiddenBlocks:coverage.surfaceHiddenBlocks,snapshotBuildMs:host.viewer.terrain.snapshotBuildMs,maxSliceMs:host.viewer.terrain.scan?.maxSliceMs}:null,
      appearance:appearance?{available:appearance.available,kind:appearance.kind,modelId:appearance.modelId,reason:appearance.reason}:null};
  })};}
  async request(origin,route,token,body,maxBytes,timeoutMs=5000){
    return readBoundedJSON(await this.fetcher(new URL(route,origin),{method:'POST',redirect:'error',signal:AbortSignal.any([this.lifecycle.signal,AbortSignal.timeout(timeoutMs)]),
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}),maxBytes);
  }
  async retire(id){const source=this.sources.get(id);if(!source)return;this.sources.delete(id);source.publisherAbort?.abort();source.publisher?.close();try{source.restoreUnavailable?.();}catch{}await source.view.close();}
  async refreshAuthority() {
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
            await view.listen();if(this.closed){await view.close();return;}source={job,view,localLease:randomUUID(),diagnosticRef:randomBytes(12).toString('hex'),after:0,generation:null,publisher:null};this.observeRendererFailures(source);this.sources.set(job.id,source);
          }
          source.job=job;
        }
        for(const id of [...this.sources.keys()])if(!seen.has(id))await this.retire(id);
        this.lastPortalAt=this.now();this.report('观战授权已连接。');
      }catch(error){if(!this.closed){this.recordFailure('authority',error);this.report('观战授权暂不可用，停止过期画面。');}}
  }
  ensurePublisher(source) {
    if(source.publisher||source.publisherPending)return;
    source.publisherAbort=new AbortController();
    source.publisherPending=Promise.resolve().then(()=>{
      if(this.closed||this.sources.get(source.job.id)!==source)return null;
      return this.startPublisher({sourceUrl:source.view.url,portalUrl:this.config.portalOrigin,channelId:source.job.id,
        token:source.job.publisherToken,signal:source.publisherAbort.signal});
    }).then(publisher=>{
      if(!publisher)return;
      if(this.closed||this.sources.get(source.job.id)!==source){publisher.close();return;}
      source.publisher=publisher;
      const ended=receipt=>{if(source.publisher===publisher){source.publisher=null;if(!this.closed&&this.sources.get(source.job.id)===source&&!source.publisherAbort.signal.aborted)this.recordFailure('publisher',Error(publisher.state?.().lastError||receipt?.reason||'SPECTATOR_TRANSPORT_CLOSED'));}};
      void publisher.done.then(ended,ended);
    }).catch(async(error)=>{
      if(this.sources.get(source.job.id)===source){this.recordFailure('publisher',error);await this.retire(source.job.id);this.report('观战发布暂不可用，等待重新接通。');}
    }).finally(()=>{source.publisherPending=null;});
  }
  async step() {
    if(this.closed)return;
    if(!this.authorityInFlight&&this.now()-this.lastPoll>=2500){
      this.lastPoll=this.now();
      this.authorityInFlight=this.refreshAuthority().finally(()=>{this.authorityInFlight=null;});
      // Startup may wait for its first grant; an existing scene never waits
      // for a cloud round trip or another scene's publisher handshake.
      if(!this.sources.size)await this.authorityInFlight;
    }
    if(this.closed)return;
    if(this.now()-this.lastPortalAt>8000){for(const id of [...this.sources.keys()])await this.retire(id);return;}
    for(const [id,source] of this.sources)if(Date.parse(source.job.expiresAt)<=this.now())await this.retire(id);
    if(this.sampleInFlight)return this.sampleInFlight;
    if(this.lastSampleAt!==null&&this.now()-this.lastSampleAt<this.sampleIntervalMs)return;
    this.lastSampleAt=this.now();
    this.sampleInFlight=this.sampleSources().finally(()=>{this.sampleInFlight=null;});
    return this.sampleInFlight;
  }
  async sampleSources() {
    const active=[...this.sources.values()];
    const targets=active.map(s=>({uuid:s.job.playerUuid,lease:s.localLease,after:s.after,generation:s.generation,scope:s.job.scope}));
    if(!targets.length)return;
    // This implementation has one channel per UUID. Duplicates indicate an
    // inconsistent job manifest rather than a reason to reset a live source.
    if(new Set(targets.map(t=>t.uuid)).size!==targets.length)throw Error('OBSERVER_DUPLICATE_TARGET');
    const started=performance.now();
    try{
      this.sampleCount++;
      // This is an acknowledged, read-only packet query, never a gameplay action.
      // Retry one transient read using the SAME lease/cursor within the original
      // five-second budget. A failed read must not force a full model/world reload.
      const deadline=performance.now()+5000;let reply;
      for(let attempt=0;attempt<2;attempt++){
        const remaining=Math.min(deadline-performance.now(),...active.map(s=>Date.parse(s.job.expiresAt)-this.now()));
        if(remaining<=0)throw Error('OBSERVER_GRANT_EXPIRED');
        try{reply=await this.request(this.config.observerOrigin,'/v1/poll',this.config.observerKey,{schemaVersion:1,targets},12*1024*1024,Math.max(1,Math.floor(Math.min(2500,remaining))));break;}
        catch(error){
          const transient=error?.name==='TimeoutError'||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT'].includes(error?.cause?.code);
          if(attempt||!transient||this.closed)throw error;
          this.recordFailure('sample',error);
        }
      }
      if(this.closed)return;
      if(reply.schemaVersion!==1||reply.minecraftVersion!=='1.21.1'||!Array.isArray(reply.targets)||reply.targets.length>4)throw Error('OBSERVER_RECEIPT_INVALID');
      for(const source of active){
        // A concurrent permission refresh may have replaced this exact source.
        // Its delayed reply must neither update nor retire the replacement.
        if(this.sources.get(source.job.id)!==source)continue;
        if(Date.parse(source.job.expiresAt)<=this.now()){await this.retire(source.job.id);continue;}
        const row=reply.targets.find(r=>r.uuid===source.job.playerUuid);
        if(!row?.available||row.lease!==source.localLease){await this.retire(source.job.id);continue;}
        let phase='scene_prepare_appearance';const previousGeneration=source.generation;
        try{
          this.packetDecoder?.reset();
          // Model conversion/download must never delay world, inventory or pose.
          if(this.appearanceSource)void this.appearanceSource.forPlayer(row.player).catch(()=>{});
          phase='scene_prepare_maid';
          if(this.maidSource)void this.maidSource.prepare(row.player?.nativeMaids?.rows).catch(()=>{});
          phase='scene_ingest';
          source.activeReceipt={generation:row.generation,previousGeneration};
          try{({after:source.after,generation:source.generation}=source.view.ingest(row));}finally{source.activeReceipt=null;}
          phase='scene_status';
          const status=source.view.host.status();
          if(status.viewer.reason){phase='scene_unavailable';throw Object.assign(Error('OBSERVER_SCENE_UNAVAILABLE'),{sceneReason:status.viewer.reason});}
          phase='scene_publisher';
          if(status.viewer.loadedColumns>=9&&status.identity.confirmed)this.ensurePublisher(source);
        }catch(error){this.recordFailure('scene',error,{phase,source,generation:row.generation,previousGeneration});await this.retire(source.job.id);this.report('观战场景需要重新加载，旧画面已停止。');}
      }
    }catch(error){for(const source of active)if(this.sources.get(source.job.id)===source)await this.retire(source.job.id);if(!this.closed){this.recordFailure('sample',error);this.report('游戏场景暂不可用，等待服务恢复。');}}
    finally{this.sampleDurationMs=Math.round((performance.now()-started)*100)/100;}
  }
  async close(){if(this.closed)return;this.closed=true;this.lifecycle.abort();for(const id of [...this.sources.keys()])await this.retire(id);}
}

export async function createObservationWorker(input,options={}) {
  const config=validateWorkerConfig(input);
  config.observerKey=(await fs.readFile(config.observerKeyFile,'utf8')).trim();config.portalToken=(await fs.readFile(config.portalTokenFile,'utf8')).trim();
  if(!/^[A-Za-z0-9_-]{43}$/.test(config.observerKey)||!/^obs_[A-Za-z0-9_-]{43}$/.test(config.portalToken))throw Error('OBSERVER_CREDENTIAL_FILE_INVALID');
  const moduleAt=relative=>import(pathToFileURL(path.join(config.rendererRoot,relative)).href);
  const [{preparePaperObservation},{startSpectatorPublisher}]=await Promise.all([moduleAt('host/paper-observation.mjs'),moduleAt('host/spectator-publisher.mjs')]);
  const require=createRequire(import.meta.url),protocol=require('minecraft-protocol'),registry=require('minecraft-data')('1.21.1'),nbt=require('prismarine-nbt');
  // Resolve schema and dependency versions exactly as minecraft-protocol does,
  // even if a deployment has a nested transitive minecraft-data installation.
  const protocolRequire=createRequire(require.resolve('minecraft-protocol')),decoderRegistry=protocolRequire('minecraft-data')('1.21.1');
  const safeVersion=value=>typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[A-Za-z0-9.-]{1,40})?$/.test(value)?value:null;
  const protocolInfo={minecraftVersion:'1.21.1',direction:'clientbound',protocolVersion:Number.isSafeInteger(decoderRegistry?.version?.version)?decoderRegistry.version.version:null,
    minecraftProtocol:safeVersion(require('minecraft-protocol/package.json').version),minecraftData:safeVersion(protocolRequire('minecraft-data/package.json').version),
    protodef:safeVersion(protocolRequire('protodef/package.json').version)};
  const parsers=Object.fromEntries(['play','configuration'].map(state=>[state,protocol.createDeserializer({version:'1.21.1',state,isServer:false,noErrorLogging:true})]));
  const packetDecoder=observationPacketDecoder(parsers,observationPacketNames(decoderRegistry));
  const appearanceSource=config.appearance?new ObservationAppearanceSource({config:config.appearance,decodeBundle:(await moduleAt('host/viewer-ysm-assets.mjs')).decodeYsmBundle}):null;
  const maidSource=config.maidAppearance?await (await moduleAt('host/maid-appearance-source.mjs')).createMaidAppearanceSource(config.maidAppearance):null;
  const prepared=await preparePaperObservation({assetDirectory:config.assetDirectory,port:0,surfaceCulling:config.surfaceCulling===true,terrainDeltas:config.terrainDeltas===true,appearanceSource,maidSource,
    serverItemCatalogFile:config.serverItemCatalogFile,serverItemCatalogSha256:config.serverItemCatalogSha256,bundledAppearanceCatalogFile:config.bundledAppearanceCatalogFile||''});
  return new ObservationWorker({config,prepared,registry,appearanceSource,maidSource,simplifyNBT:nbt.simplify,
    decodePacket:(bytes,state)=>packetDecoder.decode(bytes,state),packetDecoder,protocolInfo,startPublisher:startSpectatorPublisher,...options});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=process.argv[2];if(!path.isAbsolute(file||''))throw Error('Use an absolute private observer configuration file');
  const worker=await createObservationWorker(JSON.parse(await fs.readFile(file,'utf8')),{log:text=>console.log(text)});
  let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;void worker.close();});
  try{while(!stopping){await worker.step();await new Promise(resolve=>setTimeout(resolve,worker.nextSampleDelayMs()));}}
  finally{await worker.close();}
}
