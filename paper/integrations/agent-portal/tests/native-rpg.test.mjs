import test from 'node:test';import assert from 'node:assert/strict';
import {GameData} from '../src/game-data.mjs';import {publicGrowth} from '../src/world-catalog.mjs';
const uuid='12345678-1234-3234-9234-123456789012';
const profile={playerId:uuid,level:7,experience:1045,metadata:{'rpg.class':'knight',api_key:'never publish',password:'never publish'}};
function game(data=profile){return {config:{serverDir:'isolated'},document:async()=>({data,savedAt:'2026-10-27T00:00:00Z'}),plugin:async()=>({data:{players:{[uuid]:{academy:{grade:4,certificates:{combat_basic:{private:'not copied'}}}}}}})};}
test('native growth uses native level class and independent certificates without metadata',async()=>{
 const r=await GameData.prototype.rpgProfile.call(game(),uuid,{'rpg-backend':'vortex'});
 assert.equal(r.level,7);assert.equal(r.combat,'knight');assert.equal(r.xp,1045);assert.equal(r.academy.grade,4);
 assert(!JSON.stringify(r).includes('never publish'));assert(!JSON.stringify(r).includes('not copied'));
 const growth=publicGrowth({joined:true,fame:17,completed:2},r,r.level);assert.equal(growth.profession,'knight');assert.equal(growth.level,7);assert.equal(growth.certificates,1);assert.equal(growth.gradeIndex,4);
});
test('missing or wrong identity never falls back to an archived native role or vanilla XP',async()=>{
 for(const data of [null,{...profile,playerId:'other'},{...profile,level:-1},{...profile,experience:Infinity}]){
  const r=await GameData.prototype.rpgProfile.call(game(data),uuid,{'rpg-backend':'vortex'});assert.equal(r.available,false);assert.equal(r.level,null);assert.equal(r.combat,'');
 }
 assert.equal(await GameData.prototype.rpgProfile.call(game(),uuid,{}),null);
 assert.equal(await GameData.prototype.rpgProfile.call(game(),'../private',{'rpg-backend':'vortex'}),null);
});
test('six native classes are supported without accepting arbitrary professions',async()=>{
 for(const id of ['knight','mage','ranger','cleric','beastmaster','engineer']){
  const r=await GameData.prototype.rpgProfile.call(game({...profile,metadata:{'rpg.class':id}}),uuid,{'rpg-backend':'vortex'});assert.equal(publicGrowth({},r,1).profession,id);
 }
 const r=await GameData.prototype.rpgProfile.call(game({...profile,metadata:{'rpg.class':'admin'}}),uuid,{'rpg-backend':'vortex'});assert.equal(r.combat,'');
});
