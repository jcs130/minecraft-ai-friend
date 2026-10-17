import { McapWriter } from '@mcap/core';
import * as flatbuffers from 'flatbuffers';
import { open, mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
import { GameplayRecord as Frame, GameplayRecordT } from './generated/agent-mc-learning/gameplay-record.js';
import { ObservationT } from './generated/agent-mc-learning/observation.js';
import { ItemCountT } from './generated/agent-mc-learning/item-count.js';
import { IntentT } from './generated/agent-mc-learning/intent.js';
import { EffectT } from './generated/agent-mc-learning/effect.js';
import { AssessmentT } from './generated/agent-mc-learning/assessment.js';
import { SignalT } from './generated/agent-mc-learning/signal.js';
import { DecisionT } from './generated/agent-mc-learning/decision.js';
import { CandidateT } from './generated/agent-mc-learning/candidate.js';
import { PolicyT } from './generated/agent-mc-learning/policy.js';
import { normalizePolicyEvidence } from '../../core/policy-evidence.ts';
import { GAMEPLAY_PROTOCOL, sanitizeGameObservation, type GameObservation, type GameplayRecord } from './assessment.ts';
import { AgentConnectionLease } from '../client/connection-lease.ts';
const hash=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
const compress=(zlib as unknown as {zstdCompressSync?:(data:Uint8Array)=>Uint8Array}).zstdCompressSync;
const observation=(value:GameObservation|null)=>{const o=sanitizeGameObservation(value);return o?Object.assign(new ObservationT(),o,{ position:o.position??[],velocity:o.velocity??[],
  inventoryKnown:o.inventory!==null,inventory:Object.entries(o.inventory??{}).map(([name,count])=>new ItemCountT(name,count)),
  voxels:o.voxels??[],stateIds:o.stateIds??[],controls:o.controls??[],controlsKnown:o.controlsKnown===true }):null;};
export function encodeGameplay(record:GameplayRecord):Uint8Array {
  const frame=Object.assign(new GameplayRecordT(),record,{
    intents:record.intents.map(x=>Object.assign(new IntentT(),x)),effects:record.effects.map(x=>Object.assign(new EffectT(),x,{at:x.at??[]})),
    before:observation(record.before),after:observation(record.after),observation:observation(record.observation),
    assessment:Object.assign(new AssessmentT(),record.assessment,{signals:record.assessment.signals.map(x=>new SignalT(x.name,x.value))}),
    decision:record.decision?Object.assign(new DecisionT(),record.decision,{candidates:record.decision.candidates.map(x=>new CandidateT(x.id,x.ready,x.probability))}):null,
    policy:record.policy?Object.assign(new PolicyT(),normalizePolicyEvidence(record.policy)):null });
  const builder=new flatbuffers.Builder(4096);builder.finish(frame.pack(builder),'MCL1');return builder.asUint8Array();
}
export function decodeGameplay(bytes:Uint8Array):GameplayRecord {
  const buffer=new flatbuffers.ByteBuffer(bytes);
  if(!Frame.bufferHasIdentifier(buffer))throw Error('Not an Agent MC gameplay FlatBuffer');
  const row=Frame.getRootAsGameplayRecord(buffer).unpack() as any;
  for(const key of ['before','after','observation'])if(row[key]) {
    row[key].inventory=row[key].inventoryKnown?Object.fromEntries(row[key].inventory.map((x:any)=>[x.name,x.count])):null;
    delete row[key].inventoryKnown;
    if(row[key].position.length!==3)row[key].position=null;
    if(row[key].velocity.length!==3)row[key].velocity=null;
  }
  row.intents=row.intents.map((value:any)=>Object.fromEntries(Object.entries(value).filter(([key,v]:[string,any])=>v!==null&&(!['at','toward'].includes(key)||v.length===3))));
  row.effects=row.effects.map((value:any)=>({...value,at:value.at.length===3?value.at:null}));
  return row;
}
export type ArchiveOptions={directory:string;scopeKey:string;segmentMs?:number;maxRecords?:number;maxBytes?:number};
/** Serial MCAP writer. Only sealed segments/committed manifests are training inputs. */
export class GameplayArchive {
  private directory:string;
  // Reuse the core's process lease in this separate, recorder-only directory. It owns no game connection.
  private lease?:AgentConnectionLease;
  private ready=false;
  private file?:FileHandle;
  private writer?:McapWriter;
  private partial='';
  private channels=new Map<string,number>();
  private position=0n;
  private started=0;
  private count=0;
  private accepted=0;
  private segmentCursors:Record<string,string>={};
  private committed:Record<string,string>={};
  private latest:Record<string,string>={};
  private chain:Promise<unknown>=Promise.resolve();
  private pending=0;
  private closed=false;
  private opening=false;
  private totalBytes=0;
  private labels:Record<string,number>={};
  private segmentLabels:Record<string,number>={};
  private failed=false;
  constructor(private readonly options:ArchiveOptions) {
    if(!/^[a-f0-9]{64}$/.test(options.scopeKey))throw Error('Explicit game scope hash required');
    if(options.segmentMs!==undefined&&(!Number.isInteger(options.segmentMs)||options.segmentMs<1000||options.segmentMs>3600000))throw Error('segmentMs must be 1000..3600000');
    if(options.maxRecords!==undefined&&(!Number.isInteger(options.maxRecords)||options.maxRecords<1||options.maxRecords>10000))throw Error('maxRecords must be 1..10000');
    if(options.maxBytes!==undefined&&(!Number.isSafeInteger(options.maxBytes)||options.maxBytes<1024*1024))throw Error('Archive byte budget must be at least 1 MiB');
    this.directory=resolve(options.directory);
  }
  async start() {
    if(this.opening||this.closed)throw Error('Archive is a single-use recorder');this.opening=true;
    await mkdir(this.directory,{recursive:true});
    const marker=join(this.directory,'archive-owner.json'),files=await readdir(this.directory);
    if(files.length){const owner=JSON.parse(await readFile(marker,'utf8').catch(()=>{throw Error('Refusing existing non-archive directory');}));
      if(owner.protocol!==GAMEPLAY_PROTOCOL||owner.scopeKey!==this.options.scopeKey)throw Error('Archive game identity mismatch');}
    else await writeFile(marker,JSON.stringify({protocol:GAMEPLAY_PROTOCOL,scopeKey:this.options.scopeKey}),{flag:'wx'});
    this.lease=new AgentConnectionLease(this.directory,`recorder-${randomUUID()}`);this.lease.acquire();
    for(const name of files.filter(x=>x.endsWith('.manifest.json')).sort()){
      const m=JSON.parse(await readFile(join(this.directory,name),'utf8'));
      if(m.protocol!==GAMEPLAY_PROTOCOL||m.scopeKey!==this.options.scopeKey||m.sealed!==true)throw Error('Invalid committed archive manifest');
      const path=join(this.directory,name.replace(/\.manifest\.json$/,'.mcap'));
      const bytes=await readFile(path);if(hash(bytes)!==m.sha256)throw Error('Sealed MCAP integrity mismatch');
      Object.assign(this.committed,m.cursors);this.accepted+=m.records;
      for(const [key,value]of Object.entries(m.labels))this.labels[key]=(this.labels[key]??0)+Number(value);
    }
    this.latest={...this.committed};
    for(const name of await readdir(this.directory))this.totalBytes+=(await stat(join(this.directory,name))).size;
    this.ready=true;
  }
  cursor(sourceId:string){return this.latest[sourceId]??null;}
  status(){return {protocol:GAMEPLAY_PROTOCOL,records:this.accepted,pendingRecords:this.count,pendingWrites:this.pending,
    labels:{...this.labels},archiveBytes:this.totalBytes,budgetBytes:this.options.maxBytes??2*1024**3,closed:this.closed,storageFailed:this.failed,compression:compress?'zstd':'none'};}
  private async begin() {
    const name=`${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${randomUUID()}`;
    this.partial=join(this.directory,name+'.mcap.partial');this.file=await open(this.partial,'wx',0o600);this.position=0n;
    this.writer=new McapWriter({writable:{position:()=>this.position,write:async bytes=>{
      let offset=0;while(offset<bytes.length){const result=await this.file!.write(bytes,offset,bytes.length-offset);if(!result.bytesWritten)throw Error('MCAP write made no progress');offset+=result.bytesWritten;this.position+=BigInt(result.bytesWritten);}
    }},useChunks:true,chunkSize:64*1024,...(compress?{compressChunk:(data:Uint8Array)=>({compression:'zstd',compressedData:compress(data)})}:{})});
    await this.writer.start({profile:GAMEPLAY_PROTOCOL,library:'agent-mc-world passive gameplay learning'});
    const schema=await this.writer.registerSchema({name:'AgentMcLearning.GameplayRecord',encoding:'flatbuffer',data:await readFile(new URL('./schema/gameplay.bfbs',import.meta.url))});
    for(const topic of ['/gameplay/experience','/gameplay/observation','/gameplay/environment','/gameplay/policy-shadow'])this.channels.set(topic,await this.writer.registerChannel({topic,schemaId:schema,messageEncoding:'flatbuffer',metadata:new Map([
      ['authority','observations-and-review-signals-not-causal-proof'],['scope_key',this.options.scopeKey],['training','deduplicate-by-sourceId-and-revision; no automatic adoption'],
      ['world_truth','client-loaded-cells-only; independent-server-truth-unavailable'],['clock','Unix observation time; not game tick'],
    ])}));
    this.count=0;this.segmentCursors={};this.segmentLabels={};this.started=Date.now();
  }
  append(row:GameplayRecord):Promise<boolean> {
    if(!this.ready||this.closed)return Promise.reject(Error('Archive is not open'));
    if(this.pending>=512)return Promise.reject(Error('Archive backpressure limit; source cursor not advanced'));
    this.pending++;
    const operation=this.chain.then(async()=>{
      if(this.failed)throw Error('Archive storage is stopped after a write failure; uncommitted data retained');
      if(row.protocol!==GAMEPLAY_PROTOCOL||row.scopeKey!==this.options.scopeKey)throw Error('Archive record scope mismatch');
      if(this.totalBytes>= (this.options.maxBytes??2*1024**3))throw Error('Archive storage budget reached; existing data retained');
      const track=row.kind==='operation'||row.kind==='decision';
      if(track&&this.latest[row.sourceId]===row.revision)return false;
      if(!this.writer)await this.begin();
      const data=encodeGameplay(row);if(data.length>256000)throw Error('Gameplay record size limit');
      const topic=row.kind==='environment'?'/gameplay/environment':row.kind==='observation'?'/gameplay/observation':row.kind==='policy-shadow'?'/gameplay/policy-shadow':'/gameplay/experience';
      await this.writer!.addMessage({channelId:this.channels.get(topic)!,sequence:this.count,logTime:BigInt(Date.now())*1000000n,
        publishTime:BigInt(Date.parse(row.updatedAt))*1000000n,data});
      const label=`${row.kind}:${row.assessment.label}`;
      this.count++;this.accepted++;this.labels[label]=(this.labels[label]??0)+1;
      this.segmentLabels[label]=(this.segmentLabels[label]??0)+1;
      if(track)this.latest[row.sourceId]=this.segmentCursors[row.sourceId]=row.revision;
      if(this.count>=(this.options.maxRecords??256)||Date.now()-this.started>=(this.options.segmentMs??60000))await this.seal();
      return true;
    }).catch(error=>{this.failed=true;throw error;});
    this.chain=operation.catch(()=>{});return operation.finally(()=>this.pending--);
  }
  private async seal() {
    if(!this.writer)return;
    await this.writer.end();await this.file!.sync();await this.file!.close();this.file=undefined;this.writer=undefined;
    const sealed=this.partial.replace(/\.partial$/,'');await rename(this.partial,sealed);
    const bytes=await readFile(sealed);this.totalBytes+=bytes.length;
    const manifest={protocol:GAMEPLAY_PROTOCOL,scopeKey:this.options.scopeKey,sealed:true,sha256:hash(bytes),records:this.count,
      cursors:this.segmentCursors,labels:this.segmentLabels,at:new Date().toISOString(),automaticTraining:false};
    const target=sealed.replace(/\.mcap$/,'.manifest.json'),tmp=target+'.partial';
    await writeFile(tmp,JSON.stringify(manifest),{flag:'wx',mode:0o600});await rename(tmp,target);
    Object.assign(this.committed,this.segmentCursors);this.count=0;this.segmentCursors={};this.channels.clear();
  }
  flush():Promise<void>{const op=this.chain.then(()=>this.failed?undefined:this.seal()).catch(error=>{this.failed=true;throw error;});this.chain=op.catch(()=>{});return op;}
  async close(){if(this.closed)return;this.closed=true;try{await this.flush();}finally{
    if(this.file){await this.file.close();this.file=undefined;}
    this.lease?.release();this.lease=undefined;
  }}
}
