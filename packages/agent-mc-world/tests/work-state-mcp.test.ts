import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import type { World, WorkReference, WorkState } from '../src/contracts/index.ts';

it('preserves typed work facts and resolves only the exact occurrence/revision across SDK and MCP', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'work-state-mcp-'));
  const reference:WorkReference={scope:{realm:'realm',account:'account',agent:'agent'},subject:'quest',instance:'first',revision:3};
  const state:WorkState={...reference,status:'completed',observedAt:'2026-11-05T00:00:00Z',evidence:{source:'server',reference:'event-1',text:'Server completion'}};
  let states:WorkState[]=[state], ready=true;
  const world:World & {connectionReadiness():{ready:boolean;phase:string}}={id:'minecraft',tools:()=>[],envPromptVars:()=>null,start:async()=>{},stop:async()=>{},
    connectionReadiness:()=>({ready,phase:ready?'ready':'reconnecting'}),
    requestFacts:()=>({text:'',snapshotTypes:[],workStates:states,workBindings:[reference],
      partKeys:['gear','equip'],executionPartKeys:['gear'],partDependencies:{gear:['equip']},decisionBoundary:'body-episode-7'})};
  const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'test.invalid',username:'agent'},dataDir:dir,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'test',{turnOwnership:'host'}),client=new Client({name:'work-consumer',version:'1'});
  const [left,right]=InMemoryTransport.createLinkedPair();
  try{
    await runtime.connect();await server.connect(left);await client.connect(right);
    const facts=runtime.currentFacts();expect(facts.workStates).toEqual([state]);expect(facts.workBindings).toEqual([reference]);
    expect(facts.partDependencies).toEqual({gear:['equip']});expect(facts.decisionBoundary).toBe('body-episode-7');
    facts.partDependencies!.gear=['wrong'];expect(runtime.currentFacts().partDependencies).toEqual({gear:['equip']});
    const factReply=await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action:'facts'}});
    const mcpFacts=JSON.parse((factReply.structuredContent as {text:string}).text);
    expect(mcpFacts.partDependencies).toEqual({gear:['equip']});expect(mcpFacts.executionPartKeys).toContain('gear');
    expect(mcpFacts.decisionBoundary).toBe('body-episode-7');
    facts.workStates![0].revision=999;expect(runtime.currentFacts().workStates![0].revision).toBe(3);
    const refs=[reference,{...reference,instance:'other'},{...reference,revision:4},
      {...reference,scope:{...reference.scope,realm:'other'}}];
    const result=await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action:'resolve_work',references:refs}});
    const resolved=JSON.parse((result.structuredContent as {text:string}).text);
    expect(resolved).toEqual(runtime.resolveWork(refs));
    expect(resolved.adopted).toBe(false);
    expect(resolved.resolutions.map((r:any)=>r.disposition)).toEqual(['retire','unknown','unknown','unknown']);
    states=[state,{...state,status:'active'}];expect(runtime.resolveWork([reference]).resolutions[0].disposition).toBe('conflict');
    ready=false;expect(runtime.currentFacts().workStates).toBeUndefined();
    expect(runtime.resolveWork([reference]).resolutions[0].disposition).toBe('unknown');
    await runtime.disconnect();expect(runtime.currentFacts().workStates).toBeUndefined();
    expect(runtime.resolveWork([reference]).resolutions[0].disposition).toBe('unknown');
  }finally{await client.close();await server.close();await runtime.disconnect();await rm(dir,{recursive:true,force:true});}
});
