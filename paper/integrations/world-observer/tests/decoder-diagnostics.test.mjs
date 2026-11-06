import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as observer from '../worker.mjs';
const {ObservationWorker,observationPacketDecoder}=observer;

const require=createRequire(import.meta.url);
const protocol=require('minecraft-protocol');
const registry=require('minecraft-data')('1.21.1');
const options={version:'1.21.1',state:'play',isServer:false,noErrorLogging:true};
const serializer=protocol.createSerializer({...options,isServer:true});
const valid=serializer.createPacketBuffer({name:'entity_metadata',params:{entityId:1,metadata:[{key:0,type:'string',value:'x'.repeat(36)}]}});
const malformed=Buffer.from(valid);malformed[4]=38; // Synthetic length exceeds the remaining bytes.
const makeDecoder=()=>observationPacketDecoder({play:protocol.createDeserializer(options)},observer.observationPacketNames?.(registry)??{});

test('1.21.1 packet 88 can be valid or fail at the same 42-byte length',()=>{
 assert.equal(valid.length,42);assert.equal(malformed.length,42);assert.equal(valid[0],88);
 const decoder=makeDecoder();assert.equal(decoder.decode(valid,'play').name,'entity_metadata');
 let error;try{decoder.decode(malformed,'play');}catch(e){error=e;}
 assert.equal(error?.name,'PartialReadError');const failure=decoder.failure?.(error);assert.ok(failure,'the thrown decoder error must have its own diagnostic');
 assert.equal(failure.state,'play');assert.equal(failure.packetId,88);assert.equal(failure.name,'entity_metadata');assert.equal(failure.bytes,42);
 assert.equal(failure.position.replay,'reproduced');assert.equal(failure.position.reader,'string');assert.equal(failure.position.readerStartByte,4);
 assert.ok(failure.position.readerPath.includes('entityMetadataEntry'));
 assert.ok(!JSON.stringify(failure).includes('xxxxxxxx'));
});

test('replay reports a missing terminator at the buffer boundary and restores shared readers',()=>{
 const parser=protocol.createDeserializer(options),original=parser.proto.readCtx.u8,decoder=observationPacketDecoder({play:parser},observer.observationPacketNames(registry));
 let error;try{decoder.decode(valid.subarray(0,-1),'play');}catch(e){error=e;}
 assert.equal(error?.name,'PartialReadError');const position=decoder.failure(error).position;
 assert.equal(position.replay,'reproduced');assert.equal(position.reader,'u8');assert.equal(position.readerStartByte,41);
 assert.equal(parser.proto.readCtx.u8,original);assert.equal(decoder.decode(valid,'play').name,'entity_metadata');
 assert.equal(decoder.failure(error),null,'a later successful decode must invalidate an old failure');
});

test('a replay that does not reproduce cannot invent a position or change the original error',()=>{
 const ctx={packet:()=>{}},originalReader=ctx.packet,original=Object.assign(Error('PRIVATE_CONTENT'),{name:'PartialReadError',partialReadError:true});let calls=0;
 const decoder=observationPacketDecoder({play:{proto:{readCtx:ctx},parsePacketBuffer(){if(++calls===1)throw original;return{data:{name:'ignored',params:{}}};}}});
 assert.throws(()=>decoder.decode(Buffer.from([88]),'play'),e=>e===original);
 assert.deepEqual(decoder.failure(original).position,{replay:'not_reproduced',reader:null,readerStartByte:null,readerPath:[]});
 assert.equal(calls,2);assert.equal(ctx.packet,originalReader);
});

test('oversized input is never retried solely for diagnostics',()=>{
 let calls=0;const error=Object.assign(Error('private'),{name:'PartialReadError'});
 const decoder=observationPacketDecoder({play:{proto:{readCtx:{packet(){}}},parsePacketBuffer(){calls++;throw error;}}});
 assert.throws(()=>decoder.decode(Buffer.alloc(2*1024*1024+1),'play'),e=>e===error);
 assert.equal(calls,1);assert.equal(decoder.failure(error).position.replay,'size_limit');
});

test('a costly diagnostic replay stops at its budget and restores readers',()=>{
 const original=Object.assign(Error('private'),{name:'PartialReadError'});let attempts=0;
 const ctx={leaf(){return 1;},packet(buffer){for(let i=0;i<100001;i++)ctx.leaf(buffer,0);throw original;}};
 const leaf=ctx.leaf,packet=ctx.packet,decoder=observationPacketDecoder({play:{proto:{readCtx:ctx},parsePacketBuffer(bytes){if(++attempts===1)throw original;return ctx.packet(bytes,0);}}});
 assert.throws(()=>decoder.decode(Buffer.from([88]),'play'),e=>e===original);
 assert.equal(decoder.failure(original).position.replay,'budget_limit');assert.equal(ctx.leaf,leaf);assert.equal(ctx.packet,packet);
});

async function sceneFailure({afterDecode=false,atStatus=false,swallowed=false}={}){
 const decoder=makeDecoder(),logs=[],uuid='11111111-1111-3111-8111-111111111111',generation='22222222-2222-3222-8222-222222222222';
 const now=100000,job={id:'a'.repeat(32),lease:randomUUID(),playerUuid:uuid,playerName:'PRIVATE_PLAYER',scope:'scene',publisherToken:'pub_'+'z'.repeat(43),expiresAt:new Date(now+8000).toISOString()};
 const worker=new ObservationWorker({config:{portalOrigin:'https://example.test',observerOrigin:'http://127.0.0.1:1234',portalToken:'PRIVATE_CREDENTIAL',observerKey:'PRIVATE_CREDENTIAL'},
  prepared:{attach(){const world={error:null,unavailable(error){this.error=error.message;}};return{listen:async()=>{},close:async()=>{},ingest(){if(afterDecode||atStatus||swallowed){decoder.decode(valid,'play');if(swallowed){world.unavailable(Object.assign(Error('PRIVATE_PLAYER_DATA'),{name:'PartialReadError'}));return{after:1,generation};}if(!atStatus)throw Object.assign(Error('PRIVATE_PLAYER_DATA'),{name:'PartialReadError'});return{after:1,generation};}return decoder.decode(malformed,'play');},host:{world,status(){if(atStatus)throw Object.assign(Error('PRIVATE_PLAYER_DATA'),{name:'PartialReadError'});return{viewer:{loadedColumns:0,reason:world.error},identity:{confirmed:false}};}}};}},
  registry,decodePacket:(bytes,state)=>decoder.decode(bytes,state),packetDecoder:decoder,simplifyNBT:x=>x,now:()=>now,log:line=>logs.push(line),
  startPublisher:async()=>{throw Error('not called');},fetcher:async(url,opts)=>url.pathname.includes('world-view')?Response.json({jobs:[job]}):Response.json({schemaVersion:1,minecraftVersion:'1.21.1',targets:[{available:true,uuid,lease:JSON.parse(opts.body).targets[0].lease,generation}]})});
 await worker.step();const result=worker.status().lastFailure;await worker.close();return{result,logs,uuid,generation,job};
}

test('direct decoder errors bind the exact packet to the receipt generation without leaking the target',async()=>{
 const {result,logs,uuid,generation,job}=await sceneFailure();
 assert.equal(result.stage,'scene');assert.equal(result.phase,'packet_decode');assert.equal(result.packet.name,'entity_metadata');assert.equal(result.packet.position.readerStartByte,4);
 assert.match(result.target.sourceRef,/^[a-f0-9]{24}$/);assert.match(result.target.receiptGenerationRef,/^[a-f0-9]{24}$/);
 const output=JSON.stringify({result,logs});for(const secret of [uuid,generation,job.lease,job.id,job.playerName,job.publisherToken,'PRIVATE_CREDENTIAL','PRIVATE_PLAYER_DATA','xxxxxxxx'])assert.ok(!output.includes(secret),secret);
});

test('a later scene exception is not attributed to the last successful packet',async()=>{
 const {result}=await sceneFailure({afterDecode:true});assert.equal(result.phase,'scene_ingest');assert.equal(result.type,'PartialReadError');
 assert.equal(result.packet,null);assert.equal(result.lastDecodedPacket.name,'entity_metadata');assert.equal(result.lastDecodedPacket.bytes,42);
});

test('a status exception remains distinct from ingestion and decoder errors',async()=>{
 const {result}=await sceneFailure({atStatus:true});assert.equal(result.phase,'scene_status');assert.equal(result.packet,null);
 assert.equal(result.lastDecodedPacket.name,'entity_metadata');assert.match(result.target.receiptGenerationRef,/^[a-f0-9]{24}$/);
});

test('renderer-caught conversion errors keep their original type and receipt generation',async()=>{
 const {result,logs}=await sceneFailure({swallowed:true});
 assert.equal(result.phase,'renderer_unavailable_during_ingest');assert.equal(result.type,'PartialReadError');
 assert.equal(result.packet,null);assert.equal(result.lastDecodedPacket.name,'entity_metadata');assert.match(result.target.receiptGenerationRef,/^[a-f0-9]{24}$/);
 assert.ok(!JSON.stringify({result,logs}).includes('PRIVATE_PLAYER_DATA'));
});

test('an asynchronous renderer failure never inherits another target’s last packet',async()=>{
 const decoder=makeDecoder(),now=100000,uuid='11111111-1111-3111-8111-111111111111',generation='22222222-2222-3222-8222-222222222222';
 const job={id:'a'.repeat(32),lease:randomUUID(),playerUuid:uuid,playerName:'Synthetic',scope:'scene',publisherToken:'pub_'+'z'.repeat(43),expiresAt:new Date(now+8000).toISOString()};
 const world={error:null,unavailable(error){this.error=error.message;}},original=world.unavailable;
 const worker=new ObservationWorker({config:{portalOrigin:'https://example.test',observerOrigin:'http://127.0.0.1:1234'},registry,packetDecoder:decoder,now:()=>now,
  prepared:{attach:()=>({listen:async()=>{},close:async()=>{},ingest:()=>({after:1,generation}),host:{world,status:()=>({viewer:{reason:world.error,loadedColumns:0},identity:{confirmed:false}})}})},
  fetcher:async(url,opts)=>url.pathname.includes('world-view')?Response.json({jobs:[job]}):Response.json({schemaVersion:1,minecraftVersion:'1.21.1',targets:[{available:true,uuid,generation,lease:JSON.parse(opts.body).targets[0].lease}]})});
 await worker.step();const ref=worker.generationRef(generation);decoder.decode(valid,'play');
 world.unavailable(Object.assign(Error('PRIVATE_ASYNC_ERROR'),{name:'PartialReadError'}));
 await worker.sampleSources();const value=worker.status().lastFailure;
 assert.equal(value.phase,'renderer_unavailable_async');assert.equal(value.type,'PartialReadError');assert.equal(value.lastDecodedPacket,null);
 assert.equal(value.target.generationRef,ref);assert.equal(value.target.generationBasis,'last_accepted');assert.equal(value.target.receiptGenerationRef,null);
 assert.equal(world.unavailable,original,'retirement restores the renderer method');
 assert.ok(!JSON.stringify(value).includes('PRIVATE_ASYNC_ERROR'));await worker.close();
});

test('generation references are process-local, stable for one generation and change for a new one',()=>{
 const makeWorker=()=>new ObservationWorker({config:{},prepared:{},now:()=>0});
 const a=makeWorker(),b=makeWorker(),one='22222222-2222-3222-8222-222222222222',two='33333333-3333-3333-8333-333333333333';
 assert.equal(a.generationRef(one),a.generationRef(one.toUpperCase()));assert.notEqual(a.generationRef(one),a.generationRef(two));
 assert.notEqual(a.generationRef(one),b.generationRef(one));assert.equal(a.generationRef('PRIVATE_PLAYER_DATA'),null);assert.equal(a.generationRef({}),null);
});

test('two targets in one receipt cannot inherit each other’s packet or generation',async()=>{
 const decoder=makeDecoder(),logs=[],now=100000,ids=['11111111-1111-3111-8111-111111111111','44444444-4444-3444-8444-444444444444'];
 const generations=['22222222-2222-3222-8222-222222222222','33333333-3333-3333-8333-333333333333'];
 const worker=new ObservationWorker({config:{observerOrigin:'http://127.0.0.1:1234',observerKey:'private'},prepared:{},registry,packetDecoder:decoder,now:()=>now,log:x=>logs.push(x),
  fetcher:async(_url,opts)=>{const targets=JSON.parse(opts.body).targets;return Response.json({schemaVersion:1,minecraftVersion:'1.21.1',targets:targets.map((t,i)=>({uuid:t.uuid,lease:t.lease,available:true,generation:generations[i]}))});}});
 for(let i=0;i<2;i++){
  const id=String(i).repeat(32),source={job:{id,playerUuid:ids[i],scope:'scene',expiresAt:new Date(now+8000).toISOString()},localLease:randomUUID(),diagnosticRef:String(i).repeat(24),after:0,generation:null,
   view:{close:async()=>{},ingest(){if(i===0)return decoder.decode(malformed,'play');throw Object.assign(Error('private'),{name:'PartialReadError'});}}};worker.sources.set(id,source);
 }
 await worker.sampleSources();const failures=logs.filter(x=>x.startsWith('OBSERVER_FAILURE ')).map(x=>JSON.parse(x.slice('OBSERVER_FAILURE '.length)));
 assert.equal(failures.length,2);assert.equal(failures[0].phase,'packet_decode');assert.equal(failures[0].packet.packetId,88);
 assert.equal(failures[1].phase,'scene_ingest');assert.equal(failures[1].packet,null);assert.equal(failures[1].lastDecodedPacket,null);
 assert.notEqual(failures[0].target.sourceRef,failures[1].target.sourceRef);assert.notEqual(failures[0].target.receiptGenerationRef,failures[1].target.receiptGenerationRef);
 await worker.close();
});

test('offline reproduction emits structure only for synthetic and local-file input',async()=>{
 const script=fileURLToPath(new URL('../reproduce-partial-read.mjs',import.meta.url));
 const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
 const synthetic=run('--synthetic');assert.equal(synthetic.status,0);const result=JSON.parse(synthetic.stdout);
 assert.equal(result.valid.outcome,'decoded');assert.equal(result.valid.packet.consumedBytes,42);
 assert.equal(result.invalid.packet.position.readerStartByte,4);assert.ok(!synthetic.stdout.includes('xxxxxxxx'));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'observer-private-'));
 try{
  const file=path.join(dir,'PRIVATE_FILENAME');await fs.writeFile(file,malformed);
  const local=run('--file',file,'--state','play');assert.equal(local.status,0);assert.equal(JSON.parse(local.stdout).result.type,'PartialReadError');
  assert.ok(!local.stdout.includes('PRIVATE_FILENAME'));assert.ok(!local.stdout.includes('xxxxxxxx'));
  const missing=run('--file',path.join(dir,'PRIVATE_MISSING'),'--state','play');assert.notEqual(missing.status,0);
  assert.match(missing.stderr,/OBSERVER_REPLAY_FAILED\s*$/);assert.ok(!missing.stderr.includes('PRIVATE_MISSING'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('worker startup reports the resolved protocol and decoder dependencies',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'observer-config-'));
 try{
  await fs.mkdir(path.join(dir,'host'));await fs.writeFile(path.join(dir,'observer.key'),'a'.repeat(43));await fs.writeFile(path.join(dir,'portal.key'),'obs_'+'a'.repeat(43));
  await fs.writeFile(path.join(dir,'host/paper-observation.mjs'),'export async function preparePaperObservation(){return {}}');
  await fs.writeFile(path.join(dir,'host/spectator-publisher.mjs'),'export function startSpectatorPublisher(){}');
  const worker=await observer.createObservationWorker({rendererRoot:dir,assetDirectory:dir,observerKeyFile:path.join(dir,'observer.key'),portalTokenFile:path.join(dir,'portal.key'),
   observerOrigin:'http://127.0.0.1:10001',portalOrigin:'http://127.0.0.1:10002'});
  assert.deepEqual(worker.protocolInfo,{minecraftVersion:'1.21.1',direction:'clientbound',protocolVersion:767,minecraftProtocol:'1.66.2',minecraftData:'3.113.2',protodef:'1.19.0'});
  await worker.close();
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
