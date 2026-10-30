import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger,withToolHelp} from '../src/client/index.ts';
import {createMinecraftMcpServer} from '../src/mcp/server.ts';
import type {World} from '../src/contracts/host.ts';

async function fixture(mode:'caller'|'host',catalog:'full'|'compact'='full'){
  const dir=await mkdtemp(join(tmpdir(),'host-owned-turn-'));let actions=0,ends=0;
  const world:World={id:'minecraft',envPromptVars:()=>null,start:async()=>{},stop:async()=>{},onTurnEnded:async()=>{ends++;},
    tools:()=>withToolHelp([{name:'mc_fixture',tags:['act'],description:'Offline action',barrierAfter:true,
      parameters:{type:'object'},handler:async()=>{actions++;return{text:'native action receipt'};}}],'mc_tool_help')};
  const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'offline.invalid',username:'TurnFixture'},dataDir:dir,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'fixture',{turnOwnership:mode,catalog});
  const client=new Client({name:'turn-owner-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);await runtime.connect();
  return{runtime,client,counts:()=>({actions,ends}),protocol:(action:string,id?:string)=>client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action,...(id?{id}:{})}}),
    close:async()=>{await client.close();await server.close();await runtime.disconnect();await rm(dir,{recursive:true,force:true});}};
}

it.each(['full','compact'] as const)('host-owned %s MCP enforces ownership without altering SDK turns or body barriers',async catalog=>{
  const f=await fixture('host',catalog);
  try{
    const turn=f.runtime.beginTurn('host-session:7');
    const advertised=(await f.client.listTools()).tools.find(x=>x.name==='mc_protocol')!;
    expect(JSON.stringify(advertised.inputSchema)).not.toContain('"begin_turn"');
    for(const action of ['begin_turn','end_turn','ack_barrier']){
      const result=await f.protocol(action,'invented-model-id');
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({failed:true,data:{code:'HOST_MANAGED_TURN',lifecycleSubmitted:false,gameActionSubmitted:false,retryable:false}});
      expect(f.runtime.beginTurn('host-session:7')).toEqual(turn);
    }
    const facts=await f.protocol('facts');expect(facts.isError).not.toBe(true);
    const action=await f.runtime.call('mc_fixture',{}, {turnId:'host-session:7',requestId:'real-action'});
    expect(action.text).toBe('native action receipt');
    expect((await f.protocol('ack_barrier','real-action')).isError).toBe(true);
    await expect(f.runtime.call('mc_fixture',{}, {turnId:'host-session:7',requestId:'blocked-action'})).rejects.toThrow(/barrier/);
    f.runtime.acknowledgeBarrier('real-action');await f.runtime.endTurn('host-session:7');
    expect(f.counts()).toEqual({actions:1,ends:1});
    const env=await f.client.callTool({name:'mc_connection',arguments:{action:'environment'}});
    expect((env.structuredContent as {text:string}).text).toContain('Your host opens/closes decision turns');
    expect((env.structuredContent as {text:string}).text).not.toContain('Use mc_protocol to mark actual decision turns');
    expect(await f.runtime.environment()).toContain('Use mc_protocol to mark actual decision turns');
  }finally{await f.close();}
});

it('standalone MCP retains explicit begin/end lifecycle and model-selected game actions',async()=>{
  const f=await fixture('caller');
  try{
    expect((await f.protocol('begin_turn','standalone')).isError).not.toBe(true);
    const result=await f.client.callTool({name:'mc_fixture',arguments:{},_meta:{'agent-mc/v1':{turnId:'standalone',requestId:'standalone-action'}}});
    expect(result.isError).not.toBe(true);await f.protocol('ack_barrier','standalone-action');
    expect((await f.protocol('end_turn','standalone')).isError).not.toBe(true);
    expect(f.counts()).toEqual({actions:1,ends:1});
  }finally{await f.close();}
});
