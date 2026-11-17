import {describe,it,expect} from 'vitest';
import {projectGameMemoryEvent,gameMemoryGroup} from '../src/context.ts';
import type {EventEnvelope} from '../src/contracts/host.ts';
const event=(patch:Partial<EventEnvelope>={}):EventEnvelope=>({source:'minecraft',type:'minecraft.chat',cursor:1,
  run:'run-a',ts:'2026-11-17T00:00:00Z',origin:'external',text:'A: I caught a fish',
  meta:{from:'A',senderUuid:'actor-a',body:'I caught a fish',channel:'public',chatChannel:'nearby'},...patch});
describe('source-owned historical gameplay evidence',()=>{
 it('preserves actual actor and words while keeping an attributed claim separate from measured effects',()=>{
  const e=event(),original=structuredClone(e),r=projectGameMemoryEvent(e)!;
  expect(e).toEqual(original);expect(r.actor).toMatchObject({name:'A',uuid:'actor-a',self:false});
  expect(r.text).toBe('I caught a fish');expect(r.evidence).toBe('speaker-claim');expect(r.goalVerified).toBe(false);
  expect(r.source.reference).toBe('event:minecraft:run-a:1');expect(r.source.sha256).toMatch(/^[a-f0-9]{64}$/);
 });
 it('reads the outgoing text instead of treating the transport receipt as speech',()=>{
  const r=projectGameMemoryEvent(event({type:'minecraft.chat.sent',text:'transport sent',meta:{chatDelivery:{
   protocol:'agent-mc/chat-delivery/v1',id:'send-1',text:'Here is my actual reply',status:'sent',recipientRead:'unknown'}}}))!;
  expect(r.text).toBe('Here is my actual reply');expect(r.actor.self).toBe(true);expect(r.evidence).toBe('client-transport');
  expect(r.data.recipientRead).toBe('unknown');
 });
 it('excludes system chat echoes, snapshots, raw ticks and incomplete action acceptance',()=>{
  for(const e of [event({meta:{channel:'system'},text:'[nearby] A: I caught a fish'}),event({tags:['snapshot']}),
   event({type:'minecraft.tactic'}),event({type:'minecraft.task',execution:{kind:'task',id:'1',phase:'accepted',terminal:false,goalCompleted:false}})]){
   expect(projectGameMemoryEvent(e)).toBeNull();
  }
 });
 it('deduplicates delivery by cursor/logical ID without merging independent identical utterances or worlds',()=>{
  const e=event(),first=projectGameMemoryEvent(e)!;
  expect(projectGameMemoryEvent({...e,contextDelivery:'archive-only'})!.id).toBe(first.id);
  expect(projectGameMemoryEvent({...e,cursor:2})!.id).not.toBe(first.id);
  expect(projectGameMemoryEvent({...e,source:'other',type:'other.chat'})!.id).not.toBe(first.id);
  const native=event({meta:{...e.meta,maidOperationId:'operation-a'}});
  expect(projectGameMemoryEvent(native)!.id).toBe(projectGameMemoryEvent({...native,cursor:9})!.id);
 });
 it('admits archive-only task terminals and measured deltas without upgrading completed to goal success',()=>{
  const r=projectGameMemoryEvent(event({type:'minecraft.task',contextDelivery:'archive-only',execution:{kind:'task',id:'task-1',
   phase:'completed',terminal:true,goalCompleted:false,evidence:{steps:[{step:1,skill:'fish',outcome:'ok',observedEffect:{
    schema:'agent-mc-observed-effect/v1',status:'changed',coverage:'client-visible-only',dimension:'minecraft:overworld',
    before:{at:'2026-11-17T00:00:00Z',inventory:{cod:2},position:[1,2,3]},after:{at:'2026-11-17T00:00:03Z',inventory:{cod:3},position:[1,2,3]}}}]}}}))!;
  expect(r.category).toBe('execution');expect(r.correlation.executionId).toBe('task-1');
  expect((r.data.steps as any[])[0].observed.inventoryDelta).toEqual({cod:1});expect(r.data.goalCompleted).toBe(false);
 });
 it('unknown inventories and target deaths do not invent resources or kill ownership',()=>{
  const r=projectGameMemoryEvent(event({type:'minecraft.combat',meta:{receipt:{id:7,reason:'lost-sight',healthBefore:20,healthAfter:17,
   swings:3,meleeLanded:1,targetDeaths:{zombie:1},kills:{zombie:1},casts:[{spell:'spark',sentAt:'now'}]}}}))!;
  expect(r.data).toMatchObject({healthDelta:-3,killCredit:null,goalCompleted:false,reason:'lost-sight'});
  expect(r.data).not.toHaveProperty('kills');expect(r.category).toBe('combat');
 });
 it('keeps batches scoped by execution, run, world and minute and flags omitted details',()=>{
  const a=projectGameMemoryEvent(event({text:'long '.repeat(800),meta:{from:'A'}}))!;
  expect(a.truncated).toBe(true);expect(a.text.length).toBe(1200);
  const b=projectGameMemoryEvent(event({ts:'2026-11-17T00:01:00Z'}))!;
  expect(gameMemoryGroup(a)).not.toBe(gameMemoryGroup(b));
 });
});
