import test from 'node:test';
import assert from 'node:assert/strict';
import {publicSpectatorPresentation,publicSpectatorEvent} from '../src/viewer/spectator-public.mjs';

const playerUuid='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const skills=()=>({schemaVersion:1,source:'server_rpg_snapshot',playerUuid,keepInventory:true,
  rpg:{available:true,backend:'vortex',combat:'knight',className:'骑士',level:3,xp:12,nextLevelXp:200,skillPoints:2,
    economy:{available:true,balance:30},talents:{available:true,points:1},party:{available:true,inParty:false,members:[]}},
  mana:{current:5,max:20},abilities:[{id:'mycli:fortify',name:'坚守',level:1,manaCost:3,cooldownMs:8000,cooldownRemainingMs:0}]});
const presentation=s=>({schemaVersion:1,playerUuid,skills:s,nativeMenu:{private:true},agentPlayback:{private:true},modOperations:[{private:true}]});

test('public native RPG keeps real class, level, mana, points and skills',()=>{
  const out=publicSpectatorPresentation(presentation(skills()));
  assert.equal(out.skills.rpg.className,'骑士');assert.equal(out.skills.rpg.skillPoints,2);
  assert.equal(out.skills.mana.current,5);assert.equal(out.skills.abilities[0].id,'mycli:fortify');assert.equal(out.skills.keepInventory,true);
});
test('generic Agent skill/internal data is not a public RPG snapshot',()=>{
  assert.equal(publicSpectatorPresentation(presentation({schemaVersion:1,playerUuid,source:'agent_debug',skills:[{name:'internal-method'}]})).skills,null);
});
test('cross-role snapshot is refused',()=>{
  assert.equal(publicSpectatorPresentation(presentation({...skills(),playerUuid:other})).skills,null);
});
test('untyped secrets and Agent private fields are not forwarded',()=>{
  const data=skills();data.password='not-a-real-secret';data.rpg.apiKey='not-a-real-key';data.abilities[0].authorization='not-a-real-bearer';
  const out=publicSpectatorPresentation(presentation(data));
  assert.equal(JSON.stringify(out).includes('not-a-real-'),false);assert.equal(out.nativeMenu,null);assert.equal(out.agentPlayback,null);assert.deepEqual(out.modOperations,[]);
});
test('malformed and oversized RPG arrays remain bounded',()=>{
  const data=skills();data.abilities=Array(1000).fill(data.abilities[0]);data.rpg.party.members=Array(1000).fill(other);
  const out=publicSpectatorPresentation(presentation(data));assert.equal(out.skills.abilities.length,64);assert.equal(out.skills.rpg.party.members.length,8);
});
test('public motion/SSE uses the same checked RPG projection',()=>{
  const out=publicSpectatorEvent({type:'motion',presentation:presentation(skills())});assert.equal(out.presentation.skills.rpg.level,3);
});
