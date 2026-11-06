import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { ObservationWorker,observationPacketDecoder,observationPacketNames } from '../worker.mjs';

// Optional because the renderer is a separate repository. Point this at its
// frozen renderer-src directory to exercise the real PaperObservedPlayer.
const rendererRoot=process.env.WORLD_OBSERVER_RENDERER_ROOT;
test('actual renderer separates decoder failures from later scene event failures',{
 skip:!rendererRoot?'WORLD_OBSERVER_RENDERER_ROOT is not configured':false
},async()=>{
 assert.ok(path.isAbsolute(rendererRoot));
 const {PaperObservedPlayer}=await import(pathToFileURL(path.join(rendererRoot,'host/paper-observation.mjs')));
 const {NativeWorldState}=await import(pathToFileURL(path.join(rendererRoot,'tools/native-world-host.mjs')));
 const require=createRequire(import.meta.url),protocol=require('minecraft-protocol'),registry=require('minecraft-data')('1.21.1');
 const opts={version:'1.21.1',state:'play',isServer:false,noErrorLogging:true};
 const serializer=protocol.createSerializer({...opts,isServer:true});
 const good=serializer.createPacketBuffer({name:'entity_metadata',params:{entityId:1,metadata:[{key:0,type:'string',value:'x'.repeat(36)}]}});
 const bad=Buffer.from(good);bad[4]=38;
 async function run({downstream,worldCatches=false}){
  const decoder=observationPacketDecoder({play:protocol.createDeserializer(opts)},observationPacketNames(registry));
  const uuid='11111111-1111-3111-8111-111111111111',generation='22222222-2222-3222-8222-222222222222',now=100000;
  const job={id:'a'.repeat(32),lease:randomUUID(),playerUuid:uuid,playerName:'Synthetic',scope:'scene',publisherToken:'pub_'+'a'.repeat(43),expiresAt:new Date(now+8000).toISOString()};
  const player={uuid,name:'Synthetic',entityId:1,position:{x:1,y:64,z:2},velocity:{x:0,y:0,z:0},yawDegrees:0,pitchDegrees:0,eyeHeight:1.62,
   world:{uuid:generation,name:'minecraft:overworld',minY:-64,height:384},gameTime:1,dayTime:1,health:20,food:20,selectedHotbarSlot:0};
  const worker=new ObservationWorker({config:{portalOrigin:'https://example.test',observerOrigin:'http://127.0.0.1:1234'},registry,packetDecoder:decoder,now:()=>now,
   prepared:{attach(){
    const observed=new PaperObservedPlayer({playerUuid:uuid,name:'Synthetic',registry,registrySha256:'a'.repeat(64),decodePacket:(bytes,state)=>decoder.decode(bytes,state),scope:'scene'});
    if(downstream)observed.events.on('packet',packet=>{if(packet.name==='entity_metadata')throw Object.assign(Error('PRIVATE_SCENE_CONTENT'),{name:'PartialReadError'});});
    const world=worldCatches?new NativeWorldState({states:new Map(),registrySha256:'a'.repeat(64),resolveDimension:p=>({name:p.name,minY:p.minY,height:p.height}),simplifyNBT:x=>x}):null;
    if(world){world.handleEntity=()=>{throw Object.assign(Error('PRIVATE_SCENE_CONTENT'),{name:'PartialReadError'});};observed.events.on('packet',packet=>world.handle(packet));}
    return{listen:async()=>{},close:async()=>observed.close(),ingest:row=>observed.ingest(row),host:{world,status:()=>({viewer:{loadedColumns:0,reason:world?.error},identity:{confirmed:false}})}};
   }},fetcher:async(url,opts)=>url.pathname.includes('world-view')?Response.json({jobs:[job]}):Response.json({schemaVersion:1,minecraftVersion:'1.21.1',targets:[{
    available:true,uuid,generation,lease:JSON.parse(opts.body).targets[0].lease,player,configurationPackets:[],packets:[{sequence:1,data:(downstream||worldCatches?good:bad).toString('base64')}]
   }]})});
  await worker.step();const result=worker.status().lastFailure;await worker.close();return result;
 }
 const decode=await run({downstream:false});assert.equal(decode.phase,'packet_decode');assert.equal(decode.packet.name,'entity_metadata');assert.equal(decode.packet.position.readerStartByte,4);
 const scene=await run({downstream:true});assert.equal(scene.phase,'scene_ingest');assert.equal(scene.packet,null);assert.equal(scene.lastDecodedPacket.name,'entity_metadata');
 const caught=await run({downstream:false,worldCatches:true});assert.equal(caught.phase,'renderer_unavailable_during_ingest');assert.equal(caught.type,'PartialReadError');
 assert.equal(caught.packet,null);assert.equal(caught.lastDecodedPacket.name,'entity_metadata');
 assert.ok(!JSON.stringify({decode,scene,caught}).includes('PRIVATE_SCENE_CONTENT'));
});
