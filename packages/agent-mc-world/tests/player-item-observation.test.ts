import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
import {Vec3} from 'vec3';
vi.mock('../core/terrain.ts',async load=>({...await load<typeof import('../core/terrain.ts')>(),canSeeEntity:()=>true}));
import {PlayerObservations,renderPlayerObservation,playerObservationMeta} from '../core/player-observation.ts';
import {entitySnapshot} from '../core/entity-snapshot.ts';
const require=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
function named(version:string,title:string|null){
 const Item=require('prismarine-item')(version),registry=require('minecraft-data')(version);
 return Item.fromNotch({itemCount:1,itemId:registry.itemsByName.player_head.id,addedComponentCount:title?1:0,
  removedComponentCount:0,removeComponents:[],components:title?[{type:'custom_name',data:{type:'string',value:JSON.stringify({text:title})}}]:[]});
}
function scene(item:any){
 const self={id:1,position:new Vec3(0.5,64,0.5),height:1.8};
 const player={id:2,username:'Guest',type:'player',position:new Vec3(1.5,64,0.5),height:1.8,equipment:[item]};
 return {bot:{entity:self,entities:{1:self,2:player},players:{Guest:{username:'Guest',entity:player}},game:{dimension:'overworld'}},player};
}
describe.each(['1.20.6','1.21.1'])('received equipment instance identity %s',version=>{
 it('preserves the actual custom title in a player gesture without replacing its registry id',()=>{
  const {bot,player}=scene(named(version,'大背包')),observations=new PlayerObservations();
  expect(observations.gesture(bot as never,player as never,'wave',()=>false,1000)).toBeNull();
  const fact=observations.gesture(bot as never,player as never,'wave',()=>false,1200)!;
  expect(fact).toMatchObject({handItemName:'player_head',handItemDisplayName:'大背包',motion:'arm_swing'});
  expect(playerObservationMeta(fact)).toMatchObject({kind:'arm_swing',handItemName:'player_head',handItemDisplayName:'大背包'});
  expect(renderPlayerObservation(fact)).toContain('"大背包"');
  expect(renderPlayerObservation(fact)).not.toContain('玩家头');
 });
 it('reports a missing instance title as unknown without inventing a backpack or a head prop',()=>{
  const {bot,player}=scene(named(version,null)),observations=new PlayerObservations();
  observations.gesture(bot as never,player as never,'wave',()=>false,1000);
  const fact=observations.gesture(bot as never,player as never,'wave',()=>false,1200)!;
  expect(fact.handItemDisplayName).toBeNull();
  expect(renderPlayerObservation(fact)).toContain('原版ID：player_head；实例名称未知');
  expect(renderPlayerObservation(fact)).not.toMatch(/大背包|脑袋|玩家头/);
 });
 it('returns detached equipment identity through script snapshots without copying private item data',()=>{
  const item=named(version,'旅行包'),{bot}=scene(item);item.privateClient={credential:'private-sentinel'};
  const snapshot=entitySnapshot(bot as never);
  expect(snapshot.entities[2]?.equipment?.[0]).toEqual({slot:0,name:'player_head',customName:'旅行包',count:1});
  expect(JSON.stringify(snapshot)).not.toContain('private-sentinel');
  bot.entities[2].equipment[0]=named(version,'另一个包');
  expect(snapshot.entities[2]?.equipment?.[0]?.customName).toBe('旅行包');
 });
});
