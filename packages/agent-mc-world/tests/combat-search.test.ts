import { expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import type { Battlefield } from '../core/battlefield.ts';
import { combatSearchCandidates } from '../core/combat-search.ts';
import { combatRequest } from '../src/decisions/combat-request.ts';

function rig(){
  const bot={entity:{id:1,position:new Vec3(0,64,0),onGround:true},
    blockAt:(p:Vec3)=>({name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty',
      shapes:p.y<64?[[0,0,0,1,1,1]]:[],getProperties:()=>({})})} as unknown as Bot;
  const field:Battlefield={sampledAtMs:1000,connectionGeneration:1,dimension:'overworld',
    self:{entityId:1,position:[0,64,0],food:17,scoreboardTeam:null,health:{current:34,max:55,source:'native',updatedAtMs:900}},
    action:{fighting:false,emergency:false,taskId:null,step:null},actors:[],omitted:0,server:null,
    clues:[{source:'sound-packet',kind:'怪物声',direction:'东',distance:'中距离（约4–12格）',heardAt:900,expiresAt:8900,origin:[0,64,0]}]};
  return {bot,field};
}
it('offers nonattacking checked short searches from coarse real sound bearings, without inventing target coordinates',()=>{
  const {bot,field}=rig(),choices=combatSearchCandidates(bot,field,true,true);
  expect(choices).toHaveLength(5);expect(choices[0]).toMatchObject({kind:'search',source:'sound-packet'});
  expect(choices[0].kind==='search'&&choices[0].destination[0]).toBeCloseTo(1.2);
  expect(choices[0].kind==='search'&&choices[0].destination[2]).toBeCloseTo(0);
  expect(choices.every(c=>!('targetId' in c))).toBe(true);
  const projected=combatRequest({battlefield:field,tacticRevision:1,mana:null,skills:[],candidates:choices,omittedCandidates:0});
  expect(projected.state.battlefield.clues).toEqual([{source:'sound-packet',kind:'怪物声',direction:'东',distance:'中距离（约4–12格）',ageMs:100}]);
  expect(JSON.stringify(projected.state.battlefield.clues)).not.toContain('position');
});
it('uses recorded last-seen location, never an occluded tracked entity current position',()=>{
  const {bot,field}=rig();
  field.clues=[{source:'last-seen',key:'known-witch',position:[0,64,-5],seenAt:900,expiresAt:8900}];
  field.actors=[{entityId:7,uuid:'known-witch',type:'witch',name:null,relation:'hostile',relationSource:'hostile-type',
    health:{current:null,max:null,source:'unknown',updatedAtMs:null},scoreboardTeam:null,position:[40,64,0],distance:40,lineOfSight:false,targetEntityId:null}];
  const choices=combatSearchCandidates(bot,field,true,true);
  expect(choices[0].kind==='search'&&choices[0].destination[2]).toBeCloseTo(-1.2);
  expect(choices[0].kind==='search'&&choices[0].destination[0]).toBeCloseTo(0);
});
it('prefers last-seen evidence to ambient sound and can sidestep parallel to a wall',()=>{
  const {bot,field}=rig();
  field.self.position=[.5,64,.5];bot.entity.position=new Vec3(.5,64,.5);
  field.clues!.push({source:'last-seen',key:'blaze',position:[5,64,.5],seenAt:900,expiresAt:30900});
  const floor=bot.blockAt;
  bot.blockAt=(p:any)=>p.x>=1&&p.y>=64?{name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]],getProperties:()=>({})} as any:floor(p);
  const choices=combatSearchCandidates(bot,field,true,true);
  expect(choices.length).toBeGreaterThan(0);
  expect(choices.every(c=>c.kind==='search'&&c.source==='last-seen'&&Math.abs(c.destination[0]-.5)<.01)).toBe(true);
});
it('preserves body ownership, clue expiry, real visible threats, unknown ground and danger boundaries',()=>{
  const {bot,field}=rig();
  expect(combatSearchCandidates(bot,field,false,true)).toEqual([]);
  expect(combatSearchCandidates(bot,field,true,false)).toEqual([]);
  expect(combatSearchCandidates(bot,{...field,action:{...field.action,emergency:true}},true,true)).toEqual([]);
  expect(combatSearchCandidates(bot,{...field,sampledAtMs:9000},true,true)).toEqual([]);
  expect(combatSearchCandidates(bot,{...field,clues:[]},true,true)).toEqual([]);
  expect(combatSearchCandidates(bot,{...field,self:{...field.self,position:[3,64,0]}},true,true)).toEqual([]);
  bot.blockAt=()=>null;expect(combatSearchCandidates(bot,field,true,true)).toEqual([]);
});
it('offers exploration from an attested remaining count without guessing an enemy position',()=>{
  const {bot,field}=rig();field.clues=[];
  field.searchObjective={key:'room:4',remaining:1,observedAtMs:900,expiresAtMs:5000};
  const candidates=combatSearchCandidates(bot,field,true,true);
  expect(candidates).toHaveLength(4);expect(candidates.every(c=>c.kind==='search'&&c.source==='objective'&&!('targetId' in c))).toBe(true);
  const input=combatRequest({battlefield:field,tacticRevision:1,mana:null,skills:[],candidates,omittedCandidates:0});
  expect(input.state.battlefield.searchObjective).toEqual({key:'room:4',remaining:1,ageMs:100});
  expect(combatSearchCandidates(bot,{...field,sampledAtMs:5000},true,true)).toEqual([]);
  expect(combatSearchCandidates(bot,{...field,searchObjective:{...field.searchObjective,remaining:0}},true,true)).toEqual([]);
  bot.blockAt=()=>null;expect(combatSearchCandidates(bot,field,true,true)).toEqual([]);
});
