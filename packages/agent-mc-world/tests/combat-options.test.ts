import { expect,it } from 'vitest';
import { combatMayTakeTask,diverseCombatOptions } from '../core/combat-options.ts';
import type { CombatCandidate } from '../core/combat-decision-types.ts';

it('offers a cast alongside movement rather than filling the model menu with eight directions',()=>{
  const steps:CombatCandidate[]=Array.from({length:8},(_,i)=>({id:'step_'+i,kind:'step',intent:'side',destination:[i/8,64,0]}));
  const cast:CombatCandidate={id:'bolt',kind:'cast',spell:'starbolt',manaCost:4,ruleId:'bolt',intent:'ranged hit'};
  const retreat:CombatCandidate={id:'retreat',kind:'retreat',intent:'withdraw'};
  expect(diverseCombatOptions([...steps,retreat,cast],2)).toEqual([cast,steps[0]]);
  expect(diverseCombatOptions([...steps,retreat,cast],4)).toEqual([cast,steps[0],retreat,steps[1]]);
  expect(diverseCombatOptions([retreat],4)).toEqual([retreat]);
});
it('permits proactive combat to borrow continuous follow, but never construction, scripts, holds or pending work',()=>{
  const queue:any={running:{skill:'follow',followTarget:'Ally'},waiting:[],hold:null};
  expect(combatMayTakeTask(queue)).toBe(true);
  for(const running of [{skill:'build'},{label:'跟随 Ally'}, {skill:'follow'}])
    expect(combatMayTakeTask({...queue,running})).toBe(false);
  expect(combatMayTakeTask({...queue,hold:'downed'})).toBe(false);
  expect(combatMayTakeTask({...queue,waiting:[{id:2,label:'eat'}]})).toBe(false);
});
