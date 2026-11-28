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
  const runtime = new MinecraftAgentClient({cfg:structuredClone(MINECRAFT_CLIENT_DEFAULTS),dataDir:dir,
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
