import minecraftData from 'minecraft-data';
import { afterEach, expect, it, vi } from 'vitest';
import { suppressSpeciesThreat, noteNativeAggressor } from '../core/entity-threat.ts';
import type { FactBot, FactEntity } from '../core/animal-state.ts';

// Synthetic metadata at actual registry offsets; no live NPC flags were captured.
function rig(version='1.21.11', name='creeper') {
  const bot: FactBot = {registry:minecraftData(version)};
  const entity: FactEntity = {id:7,name,metadata:[]};
  const set=(key:string,value:unknown)=>{const keys=bot.registry!.entitiesByName![name]!.metadataKeys!;
    const i=keys.indexOf(key);if(i<0)throw Error(key);entity.metadata![i]=value;};
  return {bot,entity,set};
}
afterEach(()=>vi.useRealTimers());
it.each(['1.20.6','1.21.1','1.21.11'])('never treats a name, stillness or no-gravity alone as NPC proof (%s)',version=>{
  const r=rig(version);r.set('custom_name',{type:'string',value:'任意名字'});r.set('no_gravity',true);
  expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
  r.set('mob_flags',0);expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
  r.set('mob_flags',1);expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(true);
  r.set('custom_name',undefined);expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
});
it.each(['aggressive','ignited','swelling'])('retains a known %s threat even on a named no-AI body',signal=>{
  const r=rig();r.set('custom_name',{type:'string',value:'危险展示'});r.set('mob_flags',1);
  if(signal==='aggressive')r.set('mob_flags',5);
  if(signal==='ignited')r.set('is_ignited',true);
  if(signal==='swelling')r.set('swell_dir',1);
  expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
});
it('leaves a neutral enderman alone but preserves native aggression and provocation',()=>{
  const r=rig('1.21.11','enderman');expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(true);
  r.set('creepy',true);expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
  r.set('creepy',false);expect(suppressSpeciesThreat(r.bot,r.entity,true)).toBe(false);
});
it('bounds native-damage overrides and does not transfer them to reused IDs',()=>{
  vi.useFakeTimers();const r=rig();r.set('custom_name',{type:'string',value:'守卫'});r.set('mob_flags',1);
  noteNativeAggressor(r.bot,r.entity);expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
  expect(suppressSpeciesThreat(r.bot,{...r.entity})).toBe(true);
  vi.advanceTimersByTime(30_001);expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(true);
});

import { potentialCreeperOnly } from '../core/entity-threat.ts';
it('distinguishes distant potential Creepers from close, approaching, charged, ignited or proven aggressors without using names',()=>{
 const r=rig();const b=r.bot as any,e=r.entity as any;b.entity={position:{x:0,y:64,z:0}};e.position={x:8.3,y:64,z:0};e.velocity={x:0,y:0,z:0};
 expect(potentialCreeperOnly(b,e)).toBe(true);const v=e.velocity;delete e.velocity;expect(potentialCreeperOnly(b,e)).toBe(false);e.velocity=v;e.position.x=7.9;expect(potentialCreeperOnly(b,e)).toBe(false);
 e.position.x=8.3;e.velocity.x=-.2;expect(potentialCreeperOnly(b,e)).toBe(false);e.velocity.x=0;
 r.set('is_powered',true);expect(potentialCreeperOnly(b,e)).toBe(false);r.set('is_powered',false);
 r.set('is_ignited',true);expect(potentialCreeperOnly(b,e)).toBe(false);r.set('is_ignited',false);
 r.set('swell_dir',1);expect(potentialCreeperOnly(b,e)).toBe(false);r.set('swell_dir',-1);
 expect(potentialCreeperOnly(b,e,true)).toBe(false);noteNativeAggressor(b,e);expect(potentialCreeperOnly(b,e)).toBe(false);
});
