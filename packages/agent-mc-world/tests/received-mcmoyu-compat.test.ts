import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { signTextSnapshot } from '../core/sign-read.ts';
import { configureNpcThreatPolicy, noteNativeAggressor, npcThreatAnchorsError, suppressSpeciesThreat } from '../core/entity-threat.ts';
import { installWorldIdentity } from '../core/world-scope.ts';

// Actual received decoded payloads, NOT raw wire bytes. Only the native-world
// test envelope below is synthetic; it must not be reported as a live world capture.
const captured=JSON.parse(readFileSync(new URL('./fixtures/mcmoyu-1.21.11-received.json',import.meta.url),'utf8'));
function rig(){
  const raw=captured.entities.find((e:any)=>e.type==='creeper');
  const entity={...structuredClone(raw),name:raw.type,position:new Vec3(raw.position.x,raw.position.y,raw.position.z)};
  const bot=Object.assign(new EventEmitter(),{_client:new EventEmitter(),registry:minecraftData('1.21.11'),game:{dimension:'overworld'}}) as unknown as Bot;
  const dispose=installWorldIdentity(bot);
  const anchor={server:'example.invalid:25565',world:'test:npc_world',uuid:entity.uuid,type:'creeper',position:{...raw.position},radius:0.25};
  configureNpcThreatPolicy(bot,'example.invalid:25565',()=>[anchor]);
  return {bot,entity,anchor,dispose,world:(name='test:npc_world')=>bot._client.emit('login',{worldState:{name}})};
}
afterEach(()=>vi.useRealTimers());
it('records the exact live-creeper evidence gap instead of inventing a NoAI flag',()=>{
  const r=rig();expect(r.entity.metadata[15]).toBeUndefined();
  expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);r.dispose();
});
it.each(captured.signs)('renders received 1.21.11 sign NBT without object coercion at $position',sign=>{
  const result=signTextSnapshot({name:sign.name,entity:sign.entity} as never);
  expect(result?.front).toBe(sign.text.front);expect(result?.front).not.toContain('[object Object]');
  expect(result?.back).toBe('');
});
it('requires an explicitly known native world before applying an exact operator anchor',()=>{
  const r=rig();expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
  r.world();expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(true);
  r.world('test:other_world');expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);r.dispose();
});
it.each(['server','uuid','type','position'] as const)('does not broaden a configured exception across %s',key=>{
  const r=rig();r.world();
  if(key==='server')r.anchor.server='other.invalid:25565';
  if(key==='uuid')r.anchor.uuid='00000000-0000-0000-0000-000000000000';
  if(key==='type')r.anchor.type='zombie';
  if(key==='position')r.entity.position.x+=0.26;
  expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);r.dispose();
});
it('native damage and ignition override an exact configured display identity',()=>{
  vi.useFakeTimers();const r=rig();r.world();
  expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(true);
  r.entity.metadata[18]=true;expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
  r.entity.metadata[18]=false;noteNativeAggressor(r.bot,r.entity);
  expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
  expect(suppressSpeciesThreat(r.bot,r.entity,true)).toBe(false);r.dispose();
});
it('rejects broad or invalid operator exceptions instead of accepting a name-based safety bypass',()=>{
  const r=rig();
  expect(npcThreatAnchorsError([r.anchor])).toBeNull();
  for(const patch of [{radius:2},{radius:0},{uuid:'*'},{world:'overworld'},{server:'*'},{type:'*'},{position:{x:NaN,y:0,z:0}}]){
    expect(npcThreatAnchorsError([{...r.anchor,...patch}])).not.toBeNull();
  }
  expect(npcThreatAnchorsError(Array.from({length:17},()=>r.anchor))).not.toBeNull();r.dispose();
});

// The native world key is now genuinely observed. Only the event envelope is reconstructed.
it('replays the received session-only anchor against the observed native world identity',()=>{
  const live=JSON.parse(readFileSync(new URL('./fixtures/mcmoyu-followup-observations.json',import.meta.url),'utf8'));
  const r=rig();configureNpcThreatPolicy(r.bot,live.explicitAnchor.server,()=>[live.explicitAnchor]);
  expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);
  r.world(live.world.key);expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(true);
  expect(live.suppressionAfterExplicitAnchor.find((e:any)=>e.uuid===r.entity.uuid).suppressed).toBe(true);
  noteNativeAggressor(r.bot,r.entity);expect(suppressSpeciesThreat(r.bot,r.entity)).toBe(false);r.dispose();
});
