import { expect,it } from 'vitest';
import pathfinder from 'mineflayer-pathfinder';
import { GoalBlock,GoalNear } from '../core/method-goals.mjs';
import { navigationGoal } from '../core/navigation-goal.ts';
import { translateJavaLegacy } from '../src/client/java-legacy.ts';
import { compactNativeActionEvent,compactNativeState } from '../src/client/native-evidence.ts';

it('matches actual Mineflayer goal floor and 3D acceptance across the worker JSON boundary',()=>{
  for(const Constructor of [GoalBlock,GoalNear])for(const at of [[2.9,64.5,3.1],[-.1,-63.01,-2.9]]){
    const goal=new Constructor(...at,2),native=Constructor===GoalBlock?new pathfinder.goals.GoalBlock(...at):new pathfinder.goals.GoalNear(...at,2);
    expect(navigationGoal(JSON.parse(JSON.stringify(goal)))).toEqual({x:native.x,y:native.y,z:native.z,range:Constructor===GoalNear?2:0});
    for(let dx=-3;dx<=3;dx++)for(let dy=-3;dy<=3;dy++)for(let dz=-3;dz<=3;dz++){
      const point={x:native.x+dx,y:native.y+dy,z:native.z+dz};expect(goal.isEnd(point)).toBe(native.isEnd(point as never));
    }
  }
});
it('rejects unsupported goals and unbounded data before any body admission',()=>{
  for(const value of [null,[],{x:0,y:64},{x:0,y:64,z:.5},{x:0,y:64,z:0,rangeSq:'4'},{x:0,y:64,z:0,rangeSq:-1},{x:0,y:64,z:0,rangeSq:NaN},{x:0,y:64,z:0,rangeSq:2},{x:0,y:64,z:0,rangeSq:289},{x:30_000_001,y:0,z:0},{x:0,y:64,z:0,custom:'callback'}])expect(()=>navigationGoal(value)).toThrow();
  expect(()=>new GoalNear(0,64,0,.5)).toThrow();expect(()=>new GoalBlock(Infinity,0,0)).toThrow();
});
it('translates one legacy goto with the same exact/near acceptance and current dimension precondition',()=>{
  const state:any={navigationCapability:'agent-mc-navigation/v1',dimension:'minecraft:overworld'};
  const command={action_id:'original',steps:[{skill:'goto',at:[-.1,64.9,2.1],exact:true,walkOnly:true,dimension:'overworld'}]};
  expect(translateJavaLegacy(command,state)).toMatchObject({action_id:'original',operation:'navigate',input:{goal:{x:-1,y:64,z:2},timeoutMs:60_000}});
  expect(translateJavaLegacy({steps:[{skill:'goto',at:[1,64,2]}]},state).input.goal).toMatchObject({rangeSq:1});
  for(const step of [{skill:'goto',at:[1,2]},{skill:'goto',at:['~',64,0]},{skill:'goto',at:[0,64,0],dimension:'the_nether'},{skill:'goto',at:[0,64,0],walkOnly:false},{skill:'goto',at:[0,64,0],dryRun:true}])expect(()=>translateJavaLegacy({steps:[step]},state)).toThrow();
  expect(()=>translateJavaLegacy(command,{} as any)).toThrow('does not advertise');
});
it('keeps measured navigation evidence in both compact state and terminal events',()=>{
  const navigation={protocol:'agent-mc-navigation/v1',phase:'blocked',feet:[1,64,2],goal:{x:3,y:64,z:2,range:0},onGround:true,reason:'No measured progress',cleanupPending:false};
  const state={navigationCapability:'agent-mc-navigation/v1',navigation};
  expect(compactNativeState(state)).toMatchObject(state);expect(compactNativeActionEvent(state).navigation).toEqual(navigation);
});
