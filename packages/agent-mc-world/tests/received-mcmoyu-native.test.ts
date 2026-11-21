import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { installEntityNativeState,entityNativeState } from '../core/entity-native-state.ts';
import { suppressSpeciesThreat,potentialCreeperOnly } from '../core/entity-threat.ts';
const req=createRequire(import.meta.url),registry=req('prismarine-registry')('1.21.11');
const live=JSON.parse(readFileSync(new URL('./fixtures/mcmoyu-t139-native-decoded.json',import.meta.url),'utf8'));
it.each([['wire-1-entity_metadata-3999212.bin',3999212],['wire-2-entity_metadata-3999195.bin',3999195]])('fully consumes actual authenticated target metadata wire %s',(file,id)=>{
 const bytes=readFileSync(new URL('./fixtures/mcmoyu-t139-'+file,import.meta.url));
 const parser=req('minecraft-protocol').createDeserializer({state:'play',isServer:false,version:'1.21.11',noErrorLogging:true});
 const parsed=parser.parsePacketBuffer(bytes);expect(parsed.metadata.size).toBe(bytes.length);
 expect(parsed.data).toMatchObject({name:'entity_metadata',params:{entityId:id,metadata:[{key:6,type:'pose',value:0}]}});
});
it('replays actual decoded NPC chains, preserving UUID team, decoder-labelled attributes and all typed metadata without inventing NoAI or safety',()=>{
 const bot:any=Object.assign(new EventEmitter(),{registry,_client:new EventEmitter(),entities:{},entity:{id:1,position:{x:-15.357273512088728,y:36,z:74.95104908468042}},teamMap:{}});
 const dispose=installEntityNativeState(bot);
 for(const t of live.targets){
  const e:any={id:t.entityId,uuid:t.uuid,name:t.spawn.type,type:'hostile',position:t.spawn.position,velocity:t.spawn.velocity,metadata:[]};bot.entities[e.id]=e;
  // Actual decoded facts inside reconstructed emitter envelopes; NOT actual wire spawn.
  bot._client.emit('spawn_entity',{...t.spawn,...t.spawn.position,type:t.spawn.typeId,objectUUID:t.uuid});
  bot._client.emit('entity_metadata',{entityId:e.id,metadata:t.metadata});for(const m of t.metadata)e.metadata[m.key]=m.value;
  bot._client.emit('entity_update_attributes',{entityId:e.id,properties:t.attributes});
  bot.teamMap[e.uuid]={team:t.team.name,...t.team};
  const state=entityNativeState(bot,e)!;expect(state.presentation).toMatchObject({providerHint:'citizens-compatible-scoreboard'});
  expect(state.team).toMatchObject({collisionRule:'never',nameTagVisibility:'never'});
  expect(state.metadata.map(m=>m.key).sort((a,b)=>a-b)).toEqual([2,6,9]);
  // Preserve the OLD decoded label, not a claim of true scale. Coherence test covers correction.
  expect(state.attributes).toEqual(expect.arrayContaining([expect.objectContaining({key:'generic.scale',value:e.name==='creeper'?.25:0.30000001192092896})]));
  if(e.name==='creeper'){
   expect(suppressSpeciesThreat(bot,e)).toBe(false);expect(potentialCreeperOnly(bot,e)).toBe(true);
   e.position={...bot.entity.position,x:bot.entity.position.x+3};expect(potentialCreeperOnly(bot,e)).toBe(false);
   // Even the actual provider signature is never immunity for a close Creeper.
   expect(suppressSpeciesThreat(bot,e)).toBe(false);
  }
 }
 bot.emit('end');expect(entityNativeState(bot,bot.entities[3999212])?.disconnected).toBe(true);dispose();
});
