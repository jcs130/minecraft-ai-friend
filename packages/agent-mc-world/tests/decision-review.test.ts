import {describe,it,expect} from 'vitest';import {DecisionReviewBook,type DecisionRound} from '../src/client/decision-review.ts';
const revision='a'.repeat(64),response='b'.repeat(64),now=100000;
const round=(turn:number,extra:Partial<DecisionRound>={}):DecisionRound=>({run:'run-a',goalId:'goal-a',turn,at:now-3000+turn*500,completed:true,autonomous:true,goalActive:true,hadToolCall:false,toolsAvailable:34,response:{hash:response,chars:6},
 execution:{protocol:'agent-mc-execution-state/v1',scope:'runtime-receipts',run:'run-a',generation:1,phase:'started',revision,activeCount:0,pendingCalls:0,pendingTactics:0,detachedCount:0,observedAt:now},...extra});
describe('autonomous decision metadata review',()=>{
 it('exposes a stable episode for repeated responses without tools, never success or an action',()=>{
  const book=new DecisionReviewBook({now:()=>now});for(let n=1;n<=3;n++)book.recordRound(round(n));
  const first=book.priority('run-a','goal-a');expect(first).toMatchObject({noToolRounds:3,sameResponseRounds:3,responseChars:6,knownIdle:true,idleScope:'registered-current-runtime',historical:true,goalVerified:false});
  book.recordRound(round(4));expect(book.priority('run-a','goal-a')?.key).toBe(first?.key);expect(book.context('run-b','goal-a')).toBeNull();
  expect(JSON.stringify(first)).not.toContain('content');
 });
 it('keeps duplicate and old turns from inflating the episode',()=>{
  const b=new DecisionReviewBook({now:()=>now});b.recordRound(round(2));b.recordRound(round(2));b.recordRound(round(1));expect(b.context('run-a','goal-a')?.noToolRounds).toBe(1);
 });
 it('resets for real tool calls, human conversations and inactive goals',()=>{
  for(const extra of [{hadToolCall:true},{autonomous:false},{goalActive:false},{completed:false}]){const b=new DecisionReviewBook({now:()=>now});b.recordRound(round(1));b.recordRound(round(2));b.recordRound(round(3,extra));expect(b.priority('run-a','goal-a')).toBeNull();}
 });
 it('does not treat missing, stale, busy or another runtime execution state as zero',()=>{
  const original=round(1).execution!;
  for(const execution of [null,{...original,activeCount:1},{...original,pendingCalls:1},{...original,pendingTactics:1},{...original,detachedCount:1},{...original,run:'foreign'},{...original,observedAt:now-15001}]){
   const b=new DecisionReviewBook({now:()=>now});for(let n=1;n<=3;n++)b.recordRound(round(n,{execution}));expect(b.priority('run-a','goal-a')).toBeNull();}
 });
 it('starts a new episode after execution progress or generation changes',()=>{
  const b=new DecisionReviewBook({now:()=>now});for(let n=1;n<=3;n++)b.recordRound(round(n));const key=b.priority('run-a','goal-a')!.key;
  b.recordRound(round(4,{execution:{...round(4).execution!,revision:'c'.repeat(64)}}));expect(b.context('run-a','goal-a')?.noToolRounds).toBe(1);expect(b.context('run-a','goal-a')?.key).not.toBe(key);
 });
 it('requires an actual model reply and an advertised tool catalogue, and expires',()=>{
  let clock=now;const b=new DecisionReviewBook({now:()=>clock});for(let n=1;n<=3;n++)b.recordRound(round(n,{toolsAvailable:null}));expect(b.priority('run-a','goal-a')).toBeNull();
  for(let n=1;n<=3;n++)b.recordRound(round(n,{response:null}));expect(b.priority('run-a','goal-a')).toBeNull();
  for(let n=1;n<=3;n++)b.recordRound(round(n));clock+=300001;expect(b.context('run-a','goal-a')).toBeNull();
 });
});
