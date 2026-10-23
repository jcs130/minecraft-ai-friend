import {expect,it} from 'vitest';
import {describeCombatDecision} from '../src/decisions/combat-display.ts';
import type {CombatDecisionFrame} from '../core/combat-decision-types.ts';
const frame={battlefield:{sampledAtMs:1000,action:{targetEntityId:7},actors:[{entityId:7,type:'phantom',relation:'hostile'}]}} as CombatDecisionFrame;
it('does not turn a menu containing hostile observation into a selected or dispatched follow',()=>{
  const view=describeCombatDecision('requested',{frame,candidates:[{kind:'track',targetId:7}]},frame);
  expect(view).toMatchObject({phase:'requested',action:null,target:null,effectVerified:false,goalCompleted:false});
});
it('distinguishes a ranked hostile observation rejected on refresh from accepted dispatch and later world effects',()=>{
  const data={choice:'option_1',candidate:{kind:'track',targetId:7},outcome:'scene-changed',
    application:{attempted:false,dispatched:false,keptCurrent:false,reason:'scene-changed'}};
  const view=describeCombatDecision('result',data,frame);
  expect(view).toMatchObject({phase:'not-applied',action:'track',target:{entityId:7,type:'phantom',relation:'hostile',sampledAtMs:1000}});
  expect(view.text).toContain('未执行：场景变化');expect(view.text).toContain('停火盯防');expect(view.text).toContain('敌对');
  expect(describeCombatDecision('result',{...data,application:{dispatched:true}},frame)).toMatchObject({phase:'dispatched',effectVerified:false,goalCompleted:false});
});
it('leaves absent application and target provenance unknown, and treats keep as continuity only when acknowledged',()=>{
  expect(describeCombatDecision('result',{choice:'option_0',candidate:{kind:'track',targetId:7},outcome:'sent'})).toMatchObject({phase:'unknown',target:{type:null,relation:null,sampledAtMs:null}});
  expect(describeCombatDecision('result',{choice:'keep',outcome:'keep'}).phase).toBe('unknown');
  expect(describeCombatDecision('result',{choice:'keep',application:{keptCurrent:true}},frame)).toMatchObject({phase:'kept',action:'keep',effectVerified:false});
  expect(describeCombatDecision('observation',{application:{dispatched:true},observation:{verified:true,displacement:0}},frame)).toMatchObject({phase:'observed',effectVerified:false,goalCompleted:false});
});
