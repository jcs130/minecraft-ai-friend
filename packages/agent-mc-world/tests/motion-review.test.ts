import {describe,expect,it} from 'vitest';
import {MotionReviewBook,MotionReviewGate} from '../src/client/motion-review.ts';
import {PlanReviewBook} from '../src/client/plan-review.ts';
const end=100000;
const loop=(run='run-a',dimension='overworld')=>Array.from({length:16},(_,n)=>{
 const points=[[0,64,0],[8,64,0],[8,64,8],[0,64,8]],before=points[n%4],after=points[(n+1)%4];
 return {run,ts:new Date(end-30000+n*2000).toISOString(),execution:{kind:'task',id:'epoch:'+n,phase:'completed',terminal:true,evidence:{steps:[{step:1,outcome:'ok',observedEffect:{schema:'agent-mc-observed-effect/v1',skill:'control',dimension,before:{position:before},after:{position:after}}}]}}};
});
describe('measured motion review',()=>{
 it('recognizes observed closed movement without calling it failure, success or authorization',()=>{
  const book=new MotionReviewBook({now:()=>end});const events=loop();book.recordEvents(events);
  expect(book.context('run-a')).toMatchObject({samples:16,travelledDistance:128,netDisplacement:0,loopObserved:true,historical:true,goalVerified:false});
  expect(book.context('run-a')?.guidance).toMatch(/may be intentional/);expect(book.context('run-a')?.guidance).toMatch(/RELATIVE/);
  book.recordEvents(events);expect(book.context('run-a')?.samples).toBe(16);
 });
 it('keeps forward travel, short observations and unknown coordinates distinct from a loop',()=>{
  const book=new MotionReviewBook({now:()=>end}),events=loop();for(let n=0;n<events.length;n++){
   const e=events[n].execution.evidence.steps[0].observedEffect;e.before.position=[n*8,64,0];e.after.position=[(n+1)*8,64,0];
  }
  book.recordEvents(events);expect(book.context('run-a')).toMatchObject({loopObserved:false,netDisplacement:128});
  const still=new MotionReviewBook({now:()=>end}),unchanged=loop();for(const row of unchanged){const e=row.execution.evidence.steps[0].observedEffect;e.before.position=[0,64,0];e.after.position=[0,64,0];}
  still.recordEvents(unchanged);expect(still.context('run-a')).toMatchObject({loopObserved:false,stationaryObserved:true,travelledDistance:0});
  const short=new MotionReviewBook({now:()=>end});short.recordEvents(loop().slice(0,4));expect(short.context('run-a')?.loopObserved).toBe(false);
  const unknown=new MotionReviewBook({now:()=>end});unknown.recordEvents([{run:'run-a',ts:new Date(end).toISOString(),execution:{kind:'task',id:'x',terminal:true,phase:'completed',evidence:{steps:[{step:1,observedEffect:{schema:'agent-mc-observed-effect/v1',skill:'control',dimension:'overworld',at:[0,64,0]}}]}}}]);
  expect(unknown.context('run-a')).toBeNull();
 });
 it('never combines worlds/runs or an unobserved jump, and expires old trajectories',()=>{
  let now=end;const book=new MotionReviewBook({now:()=>now});book.recordEvents(loop().slice(0,4));book.recordEvents(loop('run-a','the_nether').slice(4,8));
  expect(book.context('run-a')?.samples).toBe(4);book.recordEvents(loop('run-b').slice(0,4));expect(book.context('run-b')?.samples).toBe(4);
  const gap=loop('run-c');for(let n=8;n<16;n++){const e=gap[n].execution.evidence.steps[0].observedEffect;e.before.position=e.before.position.map(v=>v+100);e.after.position=e.after.position.map(v=>v+100);}
  book.recordEvents(gap);expect(book.context('run-c')?.samples).toBe(8);
  now+=300001;expect(book.context('run-a')).toBeNull();
 });
 it('ignores cancelled, untyped, malformed and out-of-order evidence without retaining chat',()=>{
  const book=new MotionReviewBook({now:()=>end});const events:any[]=loop();
  for(const e of events)e.execution.phase='cancelled';book.recordEvents(events);expect(book.context('run-a')).toBeNull();
  book.recordEvents(loop().slice(-4));book.recordEvents(loop().slice(0,4));expect(book.context('run-a')?.samples).toBe(4);
  const bad:any[]=loop('bad');for(const e of bad){e.text='private conversation fixture';e.execution.evidence.steps[0].observedEffect.after.position[0]=NaN;}
  book.recordEvents(bad);expect(book.context('bad')).toBeNull();expect(JSON.stringify(book.context('run-a'))).not.toContain('private conversation');
 });
 it('adds completed-motion evidence to the existing plan-review context without manufacturing failed episodes',()=>{
  const book=new PlanReviewBook({now:()=>end});book.recordEvents(loop());expect(book.context('run-a').motionReview?.loopObserved).toBe(true);
  expect(book.context('run-a').episodes).toEqual([]);expect(book.priority('run-a')).toBeNull();
 });
 it('requires a review before further identical controls only when actual receipts show repetition',()=>{
  const gate=new MotionReviewGate(8,{now:()=>end}),args={steps:[{skill:'control',keys:['forward'],yawDeg:-90,durationMs:2000}]};
  gate.book.recordEvents(loop());for(let n=0;n<8;n++)expect(gate.admit('mc_do',args,'r'+n,'run-a')?.admitted).toBe(true);
  expect(gate.admit('mc_do',args,'blocked','run-a')).toMatchObject({admitted:false,submissions:8,review:{loopObserved:true}});
  expect(gate.admit('mc_do',args,'r0','run-a')?.submissions).toBe(1);
  expect(()=>gate.admit('mc_do',{steps:[{skill:'control',keys:['back']}]},'r0','run-a')).toThrow(/reused/);
  gate.inspected();expect(gate.admit('mc_do',args,'reviewed','run-a')?.admitted).toBe(true);
  expect(gate.admit('mc_do',{steps:[{skill:'goto',at:[10,64,10]}]},'other','run-a')).toBeNull();
  expect(new MotionReviewGate(0).admit('mc_do',args,'disabled','run-a')).toBeNull();
 });
 it('does not manufacture absent movement when a control request has no measured receipt',()=>{
  const gate=new MotionReviewGate(1,{now:()=>end});for(let n=0;n<20;n++)expect(gate.admit('mc_do',{steps:[{skill:'control',keys:['forward']}]},'r'+n,'run-a')?.admitted).toBe(true);
 });
});
