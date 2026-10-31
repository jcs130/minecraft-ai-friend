import {expect,it} from 'vitest';
import type {Bot} from 'mineflayer';
import {causalNeeds,sampleEffect,observedEffect,type SkillCall,type EffectSample,type StepOutcome} from '../src/client/index.ts';
import {causalNeeds as nativeNeeds} from '../core/executor.ts';
import {sampleEffect as nativeSample,observedEffect as nativeEffect} from '../core/observed-effect.ts';

it('public retained-body ports reuse the core implementation without inferring speech intent',()=>{
  expect(causalNeeds).toBe(nativeNeeds);expect(sampleEffect).toBe(nativeSample);expect(observedEffect).toBe(nativeEffect);
  const calls:SkillCall[]=[{skill:'pickup',item:'bread'},{skill:'toss',item:'bread',count:2},
    {skill:'chat',text:'fixture',needs:[2]},{skill:'chat',text:'independent help',needs:[]}];
  expect(causalNeeds(calls,1,null)).toEqual([{step:1,items:['bread']}]);
  expect(causalNeeds(calls,2,null)).toEqual([]);expect(calls[2].needs).toEqual([2]);
  expect(causalNeeds(calls,3,null)).toEqual([]);expect(calls[3].needs).toEqual([]);
  const outcome:StepOutcome='noop';expect(outcome).toBe('noop');
});

it('retained-body inventory readiness preserves unknown observations instead of false zero progress',()=>{
  const bot={entity:{position:{x:1,y:64,z:1}},currentWindow:null,
    inventory:{items:()=>[{name:'bread',count:2}]},blockAt:()=>null} as unknown as Bot;
  const before:EffectSample=sampleEffect(bot,null);
  expect(before.inventory).toEqual({bread:2});
  const incomplete=sampleEffect(bot,null,{inventoryReady:false});expect(incomplete.inventory).toBeNull();
  expect(observedEffect('pickup','overworld',null,before,incomplete).status).toBe('unknown');
  expect(observedEffect('pickup','overworld',null,before,before)).toMatchObject({status:'unchanged',goalVerified:false});
});
