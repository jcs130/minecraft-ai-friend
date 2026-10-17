import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {expect,it} from 'vitest';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger} from '../src/client/index.ts';
import {createMinecraftMcpServer} from '../src/mcp/server.ts';
import {methodHarness} from './method-harness.ts';

it('carries MCP attribution through the SDK into actual viewer events without renaming the host or granting a role',async()=>{
  const h=methodHarness(),directory=mkdtempSync(join(tmpdir(),'mc-source-')),events:any[]=[],roles:string[]=[];
  h.bot.on('viewer:decision',value=>events.push(value));
  const world={id:'minecraft',envPromptVars:()=>({}),start:async()=>{},stop:async()=>{},
    tools:()=>h.world.tools().map(t=>({...t,handler:async(args:any,ctx:any)=>{roles.push(ctx.role);return t.handler(args,ctx);}}))};
  const runtime=new MinecraftAgentClient({dataDir:directory,agentName:'DisplayName',log:nullLogger(),
    cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.test',username:'Test'}},world as never);
  const server=createMinecraftMcpServer(runtime,'test'),client=new Client({name:'source-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try {
    await runtime.connect();await server.connect(a);await client.connect(b);
    const before=h.bot.entity.position.clone();
    const result=await client.callTool({name:'mc_do',arguments:{source:'human',steps:[{skill:'goto',at:[8,64,0]}]},
      _meta:{'agent-mc/v1':{requestId:'planner-call',attribution:{controller:'system2',decisionId:'planner-turn'}}}});
    expect(result.isError).not.toBe(true);
    expect(events).toMatchObject([{source:'system2',status:'accepted'}]);
    expect(roles).toEqual(['DisplayName']);expect(h.bot.entity.position).toEqual(before);
    await client.callTool({name:'mc_do',arguments:{source:'system2',steps:[{skill:'goto',at:[9,64,0]}]}});
    expect(events.at(-1).source).toBe('unknown');
  } finally {await client.close();await server.close();await runtime.disconnect();h.close();rmSync(directory,{recursive:true,force:true});}
});
