import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {expect,it} from 'vitest';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger} from '../src/client/index.ts';
import {MinecraftClientWorld} from '../src/client/world.ts';
import {createMinecraftMcpServer} from '../src/mcp/server.ts';
import {PROTOCOL} from '../src/contracts/protocol.ts';
it('carries turn boundaries, receipt bytes and cancellation through SDK, MCP and a real child IPC connection',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'mc-protocol-ipc-')),oldOptions=process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS=`--import=${new URL('./fixtures/deny-network.mjs',import.meta.url).href}`;
  const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'offline.invalid',username:'Fixture'};
  const runtime=new MinecraftAgentClient({cfg,dataDir:dir,log:nullLogger()},new MinecraftClientWorld({cfg,dataDir:dir,
    extension:{module:new URL('./fixtures/protocol-engine.mjs',import.meta.url).href,
      tools:[{name:'mc_fixture',description:'Offline fixture',parameters:{type:'object'},tags:['flow']}]}}));
  const server=createMinecraftMcpServer(runtime,'test'),client=new Client({name:'ipc-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  const protocol=(action:string,id:string)=>client.callTool({name:'mc_protocol',arguments:{protocol:PROTOCOL,action,id}});
  try {
    await server.connect(a);await client.connect(b);await runtime.connect();await protocol('begin_turn','turn-a');
    const initial=await runtime.events();
    const image=initial.events.find(e=>e.type==='fixture.deferred')!.blobs![0];
    expect([...runtime.journal.blob(image.handle)!.bytes]).toEqual([4,5,6]);
    const response=await client.callTool({name:'mc_fixture',arguments:{},_meta:{[PROTOCOL]:{requestId:'bytes',turnId:'turn-a'}}});
    expect(response.structuredContent).toMatchObject({endsTurn:true,execution:{terminal:true,goalCompleted:false},
      control:{turnEnded:false,turnId:'turn-a'},events:[{text:'raw',trigger:'preempt'}]});
    expect((response.content as Array<{text?:string}>)[0].text).toContain('"round":1');
    const sdk=await runtime.call('mc_fixture',{}, {requestId:'bytes',turnId:'turn-a'});
    expect([...((sdk.blobs![0] as {bytes:Uint8Array}).bytes)]).toEqual([1,2,3]);
    expect(runtime.journal.read(0,10).events.filter(e=>e.type==='turn.ended')).toHaveLength(0);
    await protocol('end_turn','turn-a');expect(runtime.journal.read(0,10).events.filter(e=>e.type==='turn.ended')).toHaveLength(1);
    await protocol('begin_turn','turn-b');
    const pending=client.callTool({name:'mc_fixture',arguments:{hold:true},_meta:{[PROTOCOL]:{requestId:'held',turnId:'turn-b'}}});
    let cursor=0;
    const waitFor=async(type:string)=>{
      for(let i=0;i<20;i++) {const page=await runtime.events({after:cursor,run:runtime.journal.run,waitMs:100});cursor=page.nextCursor;if(page.events.some(e=>e.type===type))return;}
      throw new Error('Missing child event: '+type);
    };
    await waitFor('fixture.waiting');await protocol('cancel','held');expect((await pending).isError).toBe(true);
    await waitFor('fixture.cancelled');await protocol('end_turn','turn-b');
  } finally {
    await runtime.disconnect();await client.close();await server.close();
    if(oldOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=oldOptions;
    rmSync(dir,{recursive:true,force:true});
  }
},15000);
