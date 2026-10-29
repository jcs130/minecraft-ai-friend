import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, runtimeExecutionState } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import type { WorldHost, ExecutionReceipt } from '../src/client/contracts.ts';

it('SDK/MCP preserve the latest terminal independently of noisy event cursors, without executing anything',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mc-event-state-'));let host!:WorldHost,actions=0;
  const world={id:'event-state-fixture',tools:()=>[{name:'mc_fixture',description:'fixture',parameters:{type:'object'},tags:['act'],handler:async()=>{actions++;return 'unused';}}],
    envPromptVars:()=>({}),async start(h:WorldHost){host=h;},async stop(){}};
  const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'EventStateQA'},dataDir:dir,log:nullLogger()},world as any);
  const server=createMinecraftMcpServer(runtime,'event-state'),client=new Client({name:'fixture',version:'1'});
  const[left,right]=InMemoryTransport.createLinkedPair();
  const receipt=(phase:'running'|'completed',terminal:boolean):ExecutionReceipt=>({kind:'task',id:'original-body:1',phase,terminal,goalCompleted:false});
  const emit=async(execution:ExecutionReceipt)=>host.pushEvent({source:'fixture',ts:new Date().toISOString(),type:'minecraft.task',text:'full original '.repeat(2000),execution});
  try{
    await runtime.connect();await server.connect(left);await client.connect(right);
    await emit(receipt('running',false));
    const active=await runtime.events();expect(active.readout.execution.activeCount).toBe(1);
    expect(active.readout.execution.active[0]).toMatchObject({id:'original-body:1',terminal:false});
    await emit(receipt('completed',true));const state=runtime.executionState();
    expect(state).toMatchObject({activeCount:0,detachedCount:0,latestTerminal:{id:'original-body:1',terminal:true,phase:'completed',goalCompleted:false},previousRuns:'not-covered'});
    await host.pushEvent({source:'fixture',ts:new Date().toISOString(),type:'minecraft.chat',text:'untrusted chat '.repeat(3000),
      senderKey:undefined,meta:{optionalReading:undefined,observedCount:0}});
    const result=await client.callTool({name:'mc_events',arguments:{after:active.nextCursor,run:active.run}});
    const value=result.structuredContent as any;
    expect(isDeepStrictEqual(result,JSON.parse(JSON.stringify(result)))).toBe(true);
    expect(value.data.events[1].meta).toEqual({observedCount:0});
    expect(Object.hasOwn(runtime.journal.store.get(3)!.meta!,'optionalReading')).toBe(true);
    expect(value.meta.eventRead.execution).toEqual(state);
    expect(value.data.readout).toEqual(value.meta.eventRead);
    expect(value.text).toBe(JSON.stringify(value.data));
    expect(value.data.nextCursor).toBeGreaterThan(active.nextCursor);
    expect(value.meta.eventRead.returnedCount).toBe(2);
    expect(value.meta.eventRead.cursor).toMatchObject({after:active.nextCursor,nextCursor:value.data.nextCursor,gap:false,hasMore:false});
    expect(runtime.executionState().revision).toBe(state.revision);
    expect(runtime.currentFacts().parts.find(x=>x.key==='executionState')?.text).toBe(JSON.stringify(state));
    expect(actions).toBe(0);
    await emit({kind:'method',id:'old-generation:2',phase:'running',terminal:false,goalCompleted:false});
    await runtime.disconnect();await runtime.connect();
    expect(runtime.executionState()).toMatchObject({activeCount:0,detachedCount:1,latestTerminal:null});
    expect(runtime.executionState().detached[0]).toMatchObject({id:'old-generation:2',phase:'running',terminal:false});
    expect(runtime.task('method','old-generation:2')).toMatchObject({terminal:false});
  }finally{await client.close();await server.close();await runtime.disconnect();await rm(dir,{recursive:true,force:true});}
});

it('bounded identity previews retain exact counts and include every identity in the state revision',()=>{
  const entries=Array.from({length:5},(_,i)=>({generation:2,receipt:{kind:'task' as const,id:'body:'+i,phase:'running' as const,terminal:false,goalCompleted:false as const}}));
  const first=runtimeExecutionState('run',2,'started',entries);
  expect(first.activeCount).toBe(5);expect(first.active).toHaveLength(3);
  const changed=structuredClone(entries);changed[0].receipt.id='another-original-task';
  expect(runtimeExecutionState('run',2,'started',changed).revision).not.toBe(first.revision);
  expect(runtimeExecutionState('new-run',2,'started',[])).toMatchObject({activeCount:0,detachedCount:0,latestTerminal:null,previousRuns:'not-covered'});
});
