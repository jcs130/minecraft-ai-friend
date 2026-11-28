import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import type { World } from '../src/contracts/host.ts';

it('reuses receipts across native/canonical names and enforces the same SDK and MCP grants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-tool-grants-'));
  const calls: unknown[] = [];
  const tools = ['mc_bag','mc_script'].map(name=>({name,description:name,tags:['read'],
    parameters:{type:'object'},handler:async(args:Record<string,unknown>)=>{calls.push(args);return {text:'slot observation'};}}));
  const world:World = {id:'minecraft',tools:()=>tools,envPromptVars:()=>null,start:async()=>{},stop:async()=>{}};
  const runtime = new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'localhost',username:'AliasFixture'},dataDir:dir,
    bodyGate:{key:{},expose:name=>name!=='mc_script'},log:nullLogger()},world);
  const server = createMinecraftMcpServer(runtime,'fixture');
  const client = new Client({name:'alias-consumer',version:'1'});
  const [left,right] = InMemoryTransport.createLinkedPair();
  try {
    await runtime.connect();await server.connect(left);await client.connect(right);
    const native = await runtime.call('bot.inventory.items',{},'one-read');
    expect(await runtime.call('mc_bag',{detail:'slots'},'one-read')).toEqual(native);
    expect(calls).toEqual([{detail:'slots'}]);
    expect((await client.callTool({name:'mineflayer_inventory_items',arguments:{}})).isError).not.toBe(true);
    await expect(runtime.call('bot.lookAt',{args:[{x:0,y:70,z:0}]})).rejects.toThrow(/reserved/);
    expect((await client.callTool({name:'bot_look_at',arguments:{args:[{x:0,y:70,z:0}]}})).isError).toBe(true);
    expect(calls).toHaveLength(2);
  } finally {
    await client.close();await server.close();await runtime.disconnect();await rm(dir,{recursive:true,force:true});
  }
});

it('reopens pre-upgrade call receipts and coalesces new SDK and MCP calls without replaying the body', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'native-replay-'));
  const calls:unknown[]=[];
  const world:World={id:'minecraft',tools:()=>[{name:'mc_script',description:'run',tags:['body'],parameters:{type:'object'},
    handler:async(args)=>{calls.push(args);return {text:'observed '+calls.length};}}],envPromptVars:()=>null,start:async()=>{},stop:async()=>{}};
  const open=()=>new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'localhost',username:'ReplayFixture'},dataDir:dir,log:nullLogger()},world);
  let runtime=open();
  const point={x:2,y:70,z:-5},legacy={code:'return await bot.lookAt(...params.args)',params:{args:[point,true]},waitMs:1000};
  try{
    await runtime.connect();
    const saved=await runtime.call('mc_script',legacy,'upgrade');
    await runtime.disconnect();
    runtime=open();await runtime.connect();
    expect(await runtime.call('bot.lookAt',{point,force:true},'upgrade')).toMatchObject(saved);
    await expect(runtime.call('bot.lookAt',{point,force:false},'upgrade')).rejects.toThrow(/different|conflict/i);
    expect(calls).toEqual([legacy]);
    const server=createMinecraftMcpServer(runtime,'test');
    const client=new Client({name:'native-consumer',version:'1'});
    const [left,right]=InMemoryTransport.createLinkedPair();
    try{
      await server.connect(left);await client.connect(right);
      expect((await client.callTool({name:'bot_look_at',arguments:{point,force:true}})).isError).not.toBe(true);
      expect(calls).toEqual([legacy,{native:{name:'lookAt',args:[point,true]},waitMs:1000}]);
    }finally{await client.close();await server.close();}
  }finally{await runtime.disconnect();await rm(dir,{recursive:true,force:true});}
});
