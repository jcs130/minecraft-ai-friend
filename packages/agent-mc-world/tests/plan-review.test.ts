import { expect, it } from 'vitest';
import { PlanReviewBook } from '../src/client/plan-review.ts';
const steps = [{ skill: 'goto', at: [-462,67,-488] }, { skill: 'probe', shape:'box', anchors:[[-468,67,-494],[-456,67,-482]] }];
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
it('keeps new changed-world evidence and a different chosen plan out of the priority repair slot',()=>{
 const b=new PlanReviewBook();for(let i=1;i<=2;i++){call(b,i);b.recordEvents([{...terminal(i),meta:{repeatFailure:{observation:'changed'}}}]);}
 expect(b.priority('r')).toBeNull();
 call(b,3);b.recordEvents([terminal(3)]);expect(b.priority('r')).not.toBeNull();
 call(b,4,{steps:[{skill:'goto',at:[1,64,1]}]});expect(b.priority('r')).toBeNull();
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
