import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { expect, it } from 'vitest';
import { suppressSpeciesThreat } from '../core/entity-threat.ts';
import { metaOf } from '../core/animal-state.ts';
const mf=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const live=JSON.parse(readFileSync(new URL('./fixtures/mcmoyu-followup-observations.json',import.meta.url),'utf8'));
const raw=live.entities.find((e:any)=>e.type==='creeper');
function rig(){
  const registry=mf('prismarine-registry')('1.21.11');
  const bot=Object.assign(new EventEmitter(),{registry,version:'1.21.11',supportFeature:registry.supportFeature,
    _client:Object.assign(new EventEmitter(),{write(){},username:'offline-test'})}) as unknown as Bot;
  mf('mineflayer/lib/plugins/entities.js')(bot);bot._client.emit('login',{entityId:1});
  // Reconstructed spawn/metadata envelopes, NOT captured packets or wire.
  const spawn=()=>bot._client.emit('spawn_entity',{entityId:raw.id,objectUUID:raw.uuid,type:registry.entitiesByName.creeper.id,
    ...raw.position,pitch:0,yaw:0,headPitch:0,objectData:0,velocity:{x:0,y:0,z:0}});
  const receivedValues=()=>bot._client.emit('entity_metadata',{entityId:raw.id,metadata:[
    {key:2,type:'optional_component',value:structuredClone(raw.metadata[2])},
    {key:6,type:'pose',value:raw.metadata[6]},{key:9,type:'float',value:raw.metadata[9]}]});
  const parser=mf('minecraft-protocol').createDeserializer({state:'play',isServer:false,version:'1.21.11',noErrorLogging:true});
  const id=Number(Object.entries(registry.protocol.play.toClient.types.packet[1][0].type[1].mappings).find(([,v])=>v==='entity_metadata')![0]);
  function wire(entries:Buffer[]){
    // Independently assembled SYNTHETIC wire; no client encoder/roundtrip fixture.
    const bytes=Buffer.concat([v(id),v(raw.id),...entries,Buffer.from([255])]);
    const decoded=parser.parsePacketBuffer(bytes);expect(decoded.metadata.size).toBe(bytes.length);
    expect(decoded.data.name).toBe('entity_metadata');bot._client.emit(decoded.data.name,decoded.data.params);return decoded.data.params.metadata;
  }
  return {bot,spawn,receivedValues,wire,entity:()=>bot.entities[raw.id]};
}
function v(n:number){const b=[];do{let x=n&127;n>>>=7;if(n)x|=128;b.push(x);}while(n);return Buffer.from(b);}
const byte=(key:number,n:number)=>Buffer.from([key,0,n&255]);
const bool=(key:number,n:boolean)=>Buffer.from([key,8,n?1:0]);
const int=(key:number,n:number)=>Buffer.concat([Buffer.from([key,1]),v(n)]);
it('retains correct 774 metadata indices and incremental values through native parser and Mineflayer',()=>{
  const r=rig();r.spawn();r.receivedValues();
  const parsed=r.wire([byte(0,32),bool(4,true),bool(5,true),byte(15,1),int(16,-1),bool(17,false),bool(18,false)]);
  expect(parsed).toContainEqual({key:15,type:'byte',value:1});
  expect(r.entity()).toMatchObject({uuid:raw.uuid,name:'creeper'});
  expect(metaOf(r.bot,r.entity(),'mob_flags')).toBe(1);expect(metaOf(r.bot,r.entity(),'silent')).toBe(true);
  expect(metaOf(r.bot,r.entity(),'no_gravity')).toBe(true);expect(metaOf(r.bot,r.entity(),'swell_dir')).toBe(-1);
  expect(suppressSpeciesThreat(r.bot,r.entity())).toBe(true);
  const health=Buffer.alloc(6);health[0]=9;health[1]=3;health.writeFloatBE(19,2);r.wire([health]);
  expect(metaOf(r.bot,r.entity(),'health')).toBe(19);expect(metaOf(r.bot,r.entity(),'mob_flags')).toBe(1);
  expect(r.entity().metadata[2]).toEqual(raw.metadata[2]);
});
it('does not promote invisibility, silent, no-gravity or charged appearance into NPC proof',()=>{
  const r=rig();r.spawn();r.receivedValues();
  r.wire([byte(0,32),bool(4,true),bool(5,true),byte(15,0),int(16,-1),bool(17,true),bool(18,false)]);
  expect(suppressSpeciesThreat(r.bot,r.entity())).toBe(false);
  r.wire([byte(15,1),int(16,1)]);expect(suppressSpeciesThreat(r.bot,r.entity())).toBe(false);
  r.wire([int(16,-1),bool(18,true)]);expect(suppressSpeciesThreat(r.bot,r.entity())).toBe(false);
  r.wire([bool(18,false),byte(15,5)]);expect(suppressSpeciesThreat(r.bot,r.entity())).toBe(false);
});
it('does not discard an early metadata value when the reconstructed spawn arrives later',()=>{
  const r=rig();r.receivedValues();r.wire([byte(15,1)]);r.spawn();
  expect(metaOf(r.bot,r.entity(),'mob_flags')).toBe(1);expect(r.entity().metadata[2]).toEqual(raw.metadata[2]);
  expect(suppressSpeciesThreat(r.bot,r.entity())).toBe(true);
});
