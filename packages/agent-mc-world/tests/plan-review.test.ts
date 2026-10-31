import { expect, it } from 'vitest';
import { PlanReviewBook } from '../src/client/plan-review.ts';
import { observedEffect } from '../core/observed-effect.ts';
const steps = [{ skill: 'goto', at: [-462,67,-488] }, { skill: 'probe', shape:'box', anchors:[[-468,67,-494],[-456,67,-482]] }];
const unchanged = (skill: string) => observedEffect(skill, 'overworld', null,
 {at:'2026-10-31T12:00:00Z',target:null,inventory:{phantom_membrane:2},position:[0,75,0],window:null},
 {at:'2026-10-31T12:00:01Z',target:null,inventory:{phantom_membrane:2},position:[0,75,0],window:null});
it('reviews mixed completed goto/noop work and does not call another arrival a pickup gain',()=>{
 const b=new PlanReviewBook(),args={steps:[{skill:'goto',at:[0,75,0]},{skill:'pickup',item:'phantom_membrane',needs:[1]}]};
 const outcomes=()=>[{step:1,outcome:'ok',observedEffect:unchanged('goto')},{step:2,outcome:'noop',why:'No matching drops',observedEffect:unchanged('pickup')}];
 for(let i=1;i<=2;i++){call(b,i,args);b.recordEvents([terminal(i,'completed',outcomes())]);}
 expect(b.priority('r')).toMatchObject({count:2,failureKind:'no-observed-effect',observation:'unchanged'});
 expect(b.context('r').episodes[0].failedSteps[0]).toMatchObject({step:2,outcome:'noop',skill:'pickup'});
 const key=b.priority('r')!.key,moved=outcomes();moved[0].observedEffect.status='changed';moved[0].observedEffect.changed.position=true;
 call(b,3,args);b.recordEvents([terminal(3,'completed',moved)]);expect(b.priority('r')).toMatchObject({key,count:3});
 call(b,4,args);b.recordEvents([terminal(4,'completed',[{step:1,outcome:'ok'},{step:2,outcome:'ok'}])]);
 expect(b.priority('r')?.key).toBe(key);
 const gained=outcomes();gained[1].outcome='ok';gained[1].observedEffect.status='changed';gained[1].observedEffect.changed.inventory=true;
 call(b,5,args);b.recordEvents([terminal(5,'completed',gained)]);expect(b.priority('r')).toBeNull();
 expect(b.snapshot()).not.toHaveProperty('adopted');
});
it('independent chat success cannot erase a correlated pickup noop or failed material handoff',()=>{
 const b=new PlanReviewBook(),args={steps:[{skill:'goto',at:[0,75,0]},
  {skill:'pickup',item:'bread'},{skill:'chat',text:'independent statement',needs:[]}]};
 for(let i=1;i<=2;i++){call(b,i,args);b.recordEvents([terminal(i,'completed',[
  {step:1,outcome:'ok',observedEffect:unchanged('goto')},
  {step:2,outcome:'noop',observedEffect:unchanged('pickup')},{step:3,outcome:'ok'}
 ])]);}
 expect(b.priority('r')).toMatchObject({count:2,failureKind:'no-observed-effect',observation:'unchanged'});
 expect(JSON.stringify(b.snapshot())).not.toContain('independent statement');
 const failed=new PlanReviewBook(),handoff={steps:[{skill:'take',item:'bread',at:[0,64,0]},
  {skill:'toss',item:'bread',needs:[1]},{skill:'chat',text:'independent claim'}]};
 for(let i=3;i<=4;i++){call(failed,i,handoff);failed.recordEvents([terminal(i,'blocked',[
  {step:1,outcome:'fail',why:'Not a container',observedEffect:unchanged('take')},
  {step:2,outcome:'skip'},{step:3,outcome:'ok'}
 ])]);}
 expect(failed.priority('r')).toMatchObject({count:2,failureKind:'failed-step'});
});
function call(book: PlanReviewBook, id: number, args: unknown = { steps }, run='r') {
 book.recordCall({ run, name:'mymc_do', args, result:{ structuredContent:{ execution:{kind:'task',id:`epoch:${id}`,phase:'accepted',terminal:false,evidence:{localId:id}}}} });
}
function terminal(id: number, phase='blocked', outcomes: any[]=[{step:1,outcome:'fail',why:'The target cell is occupied; pure walking cannot reach it.'},{step:2,outcome:'ok',why:null}]) {
 return { run:'r', execution:{kind:'task',id:`epoch:${id}`,phase,terminal:true,evidence:{steps:outcomes}} };
}
it('correlates distinct accepted calls, preserves first failed step and ignores queue/key serialization differences',()=>{
 const b=new PlanReviewBook();call(b,1);b.recordEvents([terminal(1)]);
 call(b,2,{queue:'append',steps:[{at:[-462,67,-488],skill:'goto'},{anchors:[[-468,67,-494],[-456,67,-482]],shape:'box',skill:'probe'}]});
 b.recordEvents([terminal(2),terminal(2)]);
 expect(b.priority('r')?.count).toBe(2);expect(b.context('r').episodes[0].original).toEqual({tool:'mymc_queue',arguments:{taskId:2,detail:true}});
 expect(b.context('r').episodes[0].failedSteps[0].why).toContain('occupied');
 expect(JSON.stringify(b.snapshot())).not.toContain('occupied');
 expect(b.priority('different-run')).toBeNull();
});
it('does not let a later successful probe or a completed wrapper erase failed movement',()=>{
 const b=new PlanReviewBook();for(let i=1;i<=2;i++){call(b,i);b.recordEvents([terminal(i,'completed')]);}
 expect(b.priority('r')?.count).toBe(2);expect(b.priority('r')?.observation).toBe('unknown');
});
it('does not classify safety cancellation or measured partial collection progress as a failed-plan loop',()=>{
 const b=new PlanReviewBook();for(let i=1;i<=2;i++){call(b,i);b.recordEvents([terminal(i,'cancelled')]);}
 expect(b.priority('r')).toBeNull();
 for(let i=3;i<=4;i++){call(b,i);b.recordEvents([terminal(i,'partial',[{step:1,outcome:'partial',why:'one log gained',observedEffect:'changed'}])]);}
 expect(b.priority('r')).toBeNull();
});
it('only confirmed all-step execution success closes an episode, without proving a goal or adopting anything',()=>{
 const b=new PlanReviewBook();for(let i=1;i<=2;i++){call(b,i);b.recordEvents([terminal(i)]);}
 const before=b.priority('r')!.key;call(b,3);b.recordEvents([terminal(3,'completed',[])]);expect(b.priority('r')).not.toBeNull();
 call(b,4);b.recordEvents([terminal(4,'completed',[{step:1,outcome:'ok'}])]);expect(b.priority('r')).toBeNull();
 for(let i=5;i<=6;i++){call(b,i);b.recordEvents([terminal(i)]);}expect(b.priority('r')?.key).not.toBe(before);
 expect(b.snapshot()).not.toHaveProperty('adopted');
});
it('does not correlate foreign or unaccepted outcomes and never retains chat bodies in feedback metadata',()=>{
 const b=new PlanReviewBook();b.recordEvents([terminal(1),terminal(2)]);expect(b.priority('r')).toBeNull();
 for(let i=1;i<=2;i++){call(b,i,{steps:[{skill:'chat',message:'private fixture chat'}]});b.recordEvents([terminal(i)]);}
 expect(b.context('r').episodes[0].failedSteps[0].why).toBeNull();expect(JSON.stringify(b.snapshot())).not.toContain('private fixture chat');
});
it('preserves changed-world metadata without erasing explicit failures; a different chosen plan ends priority',()=>{
 const b=new PlanReviewBook();for(let i=1;i<=2;i++){call(b,i);b.recordEvents([{...terminal(i),meta:{repeatFailure:{observation:'changed'}}}]);}
 expect(b.priority('r')).toMatchObject({observation:'changed',failureKind:'failed-step',count:2});
 call(b,3);b.recordEvents([terminal(3)]);expect(b.priority('r')).not.toBeNull();
 call(b,4,{steps:[{skill:'goto',at:[1,64,1]}]});expect(b.priority('r')).toBeNull();
});
it('retains repeated failed smelting when moving inputs out of inventory changed state but produced nothing',()=>{
 const b=new PlanReviewBook({now:()=>3000});for(let id=1;id<=2;id++){
  call(b,id,{steps:[{skill:'smelt',input:'pufferfish',fuel:'coal',at:[1,64,1],count:1}]});
  b.recordEvents([{...terminal(id,'blocked',[{step:1,outcome:'fail',why:'Loaded inputs but no smelting progress or output',observedEffect:{schema:'agent-mc-observed-effect/v1',skill:'smelt',dimension:'overworld',status:'changed',changed:{inventory:true,position:id===1},before:{inventory:{pufferfish:1,coal:1}},after:{inventory:{}}}}]),ts:new Date(id*1000).toISOString(),meta:{repeatFailure:{observation:'changed'}}}]);
 }
 expect(b.priority('r')).toMatchObject({count:2,failureKind:'failed-step',observation:'changed'});
 expect(b.context('r').episodes[0].failedSteps[0].why).toContain('no smelting progress');
 expect(b.context('r').recentEffects[0]).toMatchObject({goalVerified:false,inventoryChanges:[{item:'coal',before:1,after:0},{item:'pufferfish',before:1,after:0}]});
});
it('does not let a different partial gain erase a failed step or infer a failed step from an unknown changed terminal',()=>{
 const b=new PlanReviewBook();for(let id=1;id<=2;id++){call(b,id);b.recordEvents([terminal(id,'partial',[{step:1,outcome:'fail',why:'route remains blocked',observedEffect:'changed'},{step:2,outcome:'partial',why:'one item gained',observedEffect:'changed'}])]);}
 expect(b.priority('r')?.count).toBe(2);expect(b.context('r').episodes[0].failedSteps[0].why).toContain('blocked');
 const unknown=new PlanReviewBook();for(let id=1;id<=2;id++){call(unknown,id);unknown.recordEvents([{...terminal(id,'blocked',[]),meta:{repeatFailure:{observation:'changed'}}}]);}
 expect(unknown.priority('r')).toBeNull();expect(unknown.context('r').episodes[0].failureKind).toBe('incomplete-terminal');
});
it('reads the real observed-effect object, keeps target geometry and ignores measured partial inventory gains',()=>{
 const b=new PlanReviewBook();for(let i=1;i<=2;i++){call(b,i);b.recordEvents([terminal(i,'blocked',[{step:1,outcome:'fail',why:'Route failed',detail:{text:'Target occupied; pure walking has no route'},observedEffect:{schema:'agent-mc-observed-effect/v1',dimension:'overworld',status:'unchanged',before:{target:{name:'stone',stateId:1}},changed:{position:false}}}])]);}
 expect(b.priority('r')?.observation).toBe('unchanged');expect(b.context('r').episodes[0].failedSteps[0].why).toContain('occupied');
 expect(b.context('r').episodes[0].failedSteps[0].observedEffect.target.name).toBe('stone');
 call(b,3);b.recordEvents([terminal(3,'partial',[{step:1,outcome:'partial',why:'one log',observedEffect:{schema:'agent-mc-observed-effect/v1',dimension:'overworld',status:'changed'}}])]);
 expect(b.priority('r')).toBeNull();
});
it('does not spend priority reasoning while accepted body work is in flight; old episodes expire without banning actions',()=>{
 let now=1000;const b=new PlanReviewBook({now:()=>now,windowMs:1000});for(let i=1;i<=2;i++){call(b,i);b.recordEvents([terminal(i)]);}
 expect(b.priority('r')).not.toBeNull();call(b,3);expect(b.priority('r')).toBeNull();b.recordEvents([terminal(3)]);expect(b.priority('r')).not.toBeNull();
 now=3000;expect(b.priority('r')).toBeNull();call(b,4);b.recordEvents([terminal(4)]);expect(b.snapshot().episodes.at(-1)?.count).toBe(1);
});
it('does not mix the same coordinates across reported dimensions',()=>{
 const b=new PlanReviewBook();for(let i=1;i<=2;i++){call(b,i);b.recordEvents([terminal(i,'blocked',[{step:1,outcome:'fail',observedEffect:{schema:'agent-mc-observed-effect/v1',dimension:i===1?'overworld':'nether',status:'unchanged'}}])]);}
 expect(b.priority('r')).toBeNull();expect(b.snapshot().episodes).toHaveLength(2);
});
it('retains an unattributed consumption during generation and the first later failure without calling either automatic replay',()=>{
 const b=new PlanReviewBook({now:()=>3000}),e={schema:'agent-mc-observed-effect/v1',skill:'eat',dimension:'overworld',status:'changed',before:{inventory:{cod:1}},after:{inventory:{}}};
 const consumed={...terminal(769,'completed',[{step:1,outcome:'ok',observedEffect:e}]),ts:new Date(1000).toISOString()};
 b.recordEvents([consumed,consumed]);expect(b.snapshot().recentEffects).toHaveLength(1);
 expect(b.context('r').recentEffects[0]).toMatchObject({executionId:'epoch:769',submission:'unattributed',historical:true,goalVerified:false,inventoryChanges:[{item:'cod',before:1,after:0}]});
 call(b,770,{steps:[{skill:'eat',item:'cod'},{skill:'chat',text:'private statement'}]});
 b.recordEvents([{...terminal(770,'blocked',[{step:1,outcome:'fail',why:'No cod in current stock',observedEffect:{...e,status:'unchanged',before:{inventory:{}},after:{inventory:{}}}},{step:2,outcome:'ok'}]),ts:new Date(2000).toISOString()}]);
 expect(b.context('r').episodes[0].failedSteps[0].why).toContain('No cod');expect(b.priority('r')).toBeNull();
 expect(JSON.stringify(b.snapshot())).not.toMatch(/No cod|private statement/);expect(b.context('foreign').recentEffects).toEqual([]);
});
it('keeps unknown inventory and missing timestamps unknown, and permits a later exact tool correlation without duplicate effects',()=>{
 const b=new PlanReviewBook({now:()=>3000}),e={schema:'agent-mc-observed-effect/v1',skill:'eat',status:'changed',before:{inventory:null},after:{inventory:{cod:1}}};
 b.recordEvents([{...terminal(1,'completed',[{step:1,outcome:'ok',observedEffect:e}]),ts:new Date(1000).toISOString()}]);expect(b.snapshot().recentEffects).toEqual([]);
 const row=terminal(2,'completed',[{step:1,outcome:'ok',observedEffect:{...e,before:{inventory:{}},after:{inventory:{cod:1}}}}]);
 b.recordEvents([row]);expect(b.snapshot().recentEffects).toEqual([]);
 b.recordEvents([{...row,ts:new Date(2000).toISOString()}]);call(b,2);b.recordEvents([{...row,ts:new Date(2000).toISOString()}]);
 expect(b.snapshot().recentEffects).toHaveLength(1);expect(b.context('r').recentEffects[0].submission).toBe('matched-tool-call');
});
it('bounds changed-item metadata and retains newer effects when historical reads arrive late',()=>{
 let now=20000;const b=new PlanReviewBook({now:()=>now,windowMs:1000});
 for(let id=1;id<=12;id++)b.recordEvents([{...terminal(id,'partial',[{step:1,outcome:'partial',observedEffect:{schema:'agent-mc-observed-effect/v1',skill:'collect',status:'changed',before:{inventory:{}},after:{inventory:Object.fromEntries(Array.from({length:12},(_,i)=>['item_'+i,1]))}}}]),ts:new Date(id*1000).toISOString()}]);
 b.recordEvents([{...terminal(1,'completed',[{step:1,outcome:'ok',observedEffect:{schema:'agent-mc-observed-effect/v1',skill:'fish',status:'changed',before:{inventory:{}},after:{inventory:{cod:1}}}}]),ts:new Date(1000).toISOString()}]);
 expect(b.snapshot().recentEffects).toHaveLength(8);expect(b.snapshot().recentEffects.at(-1)?.executionId).toBe('epoch:12');
 expect(b.snapshot().recentEffects[0].changesTruncated).toBe(true);expect(b.snapshot().recentEffects[0].inventoryChanges).toHaveLength(8);expect(b.context('r').recentEffects).toEqual([]);
 now=12500;expect(b.context('r').recentEffects.map(e=>e.executionId)).toEqual(['epoch:12']);
});
