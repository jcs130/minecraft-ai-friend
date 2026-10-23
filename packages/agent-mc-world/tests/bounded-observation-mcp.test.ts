import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import { RequestLedger } from '../src/client/request-ledger.ts';
import { methodHarness } from './method-harness.ts';
import { PROTOCOL } from '../src/contracts/protocol.ts';
import { assertMinecraftReady } from '../src/client/config.ts';

it('reads actual bounded data in one MCP call, reports precise errors and reconciles an original unknown request without replay', async () => {
  const r=methodHarness('1.21.1'), dir=await mkdtemp(join(tmpdir(),'mc-bounded-mcp-'));
  let attempted=0;
  const tools=[...r.world.tools(),{name:'mc_unconfirmed',description:'Test interrupted transport',tags:['act'] as const,
    parameters:{type:'object'},handler:async()=>{attempted++;throw new Error('transport lost after dispatch');}}];
  const observe=tools.find(t=>t.name==='mc_observe')!;
  const execute=vi.spyOn(observe,'handler');
  const world={id:'minecraft',tools:()=>tools,envPromptVars:()=>null,start:async()=>{},stop:async()=>{}};
  const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'Probe'};
  const runtime=new MinecraftAgentClient({dataDir:dir,cfg,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'fixture',{catalog:'compact'}),client=new Client({name:'bounded-reader',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try {
    await runtime.connect(); await server.connect(a); await client.connect(b);
    const result=await client.callTool({name:'mc_observe',arguments:{mode:'voxels',bounds:[-10,0,-10,10,4,10]}});
    expect(result.isError).not.toBe(true);
    const payload=result.structuredContent as any;
    expect(payload.data.status).toBe('partial'); expect(payload.data.cells.length).toBe(payload.data.returned_count);
    expect(payload.data.returned_count).toBeLessThanOrEqual(512); expect(payload.data.observed_count).toBeGreaterThan(0);
    expect(execute).toHaveBeenCalledTimes(1);
    for(const [args,path] of [[{mode:'voxels',bounds:[0,0]},'/bounds'],[{mode:'voxels',to:[1,64,1]},'/to'],[{},'/mode'],
      [{mode:'sites'},'/sites'],[{mode:'rays',bounds:[0,0,0,0,0,0]},'/bounds']] as const) {
      const invalid=await client.callTool({name:'mc_observe',arguments:args});
      expect(invalid.isError).toBe(true);
      const data=(invalid.structuredContent as any).data;
      expect(data).toMatchObject({status:'invalid_arguments',executed:false,minimal_legal_example:{mode:'voxels'}});
      expect(data.errors.some((e:any)=>e.path===path)).toBe(true);
      if(Object.keys(args).length===0) expect(data.errors.map((e:any)=>e.path)).toEqual(['/mode']);
      expect(execute).toHaveBeenCalledTimes(1);
    }
    const conflict=await client.callTool({name:'mc_observe',arguments:{mode:'voxels',bounds:[0,0,0,0,0,0],cursor:payload.data.next_cursor}});
    expect((conflict.structuredContent as any).data.errors[0].path).toBe('/bounds');
    expect(execute).toHaveBeenCalledTimes(1); // Declared mutual exclusion rejects before dispatch.
    const requestId='uncertain-original',args={mode:'voxels'};
    new RequestLedger(runtime.journal).write({requestId,phase:'pending',signature:createHash('sha256')
      .update(JSON.stringify(['mc_observe',args,undefined])).digest('hex')});
    const unknown=await client.callTool({name:'mc_observe',arguments:args,_meta:{[PROTOCOL]:{requestId}}});
    expect(unknown.isError).not.toBe(true);
    expect((unknown.structuredContent as any).data).toMatchObject({status:'unknown',retryable:false,request_id:requestId,
      next_safe_read:{tool:'mc_protocol',arguments:{action:'request',id:requestId}}});
    const reconciled=await client.callTool({name:'mc_protocol',arguments:{protocol:PROTOCOL,action:'request',id:requestId}});
    expect(JSON.parse((reconciled.structuredContent as any).text)).toMatchObject({status:'unknown',replayed:false,reason:'interrupted_or_pending'});
    expect(execute).toHaveBeenCalledTimes(1);
    Object.assign(r.bot,{recipesAll:()=>[]});
    const business=await client.callTool({name:'mc_do',arguments:{steps:[{skill:'craft',item:'cooked_chicken',count:1}]}});
    expect(business.isError).not.toBe(true);
    expect((business.structuredContent as any).data).toMatchObject({status:'blocked',completed:0,goal_completed:false});
    const interrupted={name:'mc_unconfirmed',arguments:{},_meta:{[PROTOCOL]:{requestId:'transport-original'}}};
    const firstUnknown=await client.callTool(interrupted);
    expect((firstUnknown.structuredContent as any).data).toMatchObject({status:'unknown',request_id:'transport-original',completed:null});
    await client.callTool(interrupted);expect(attempted).toBe(1);
    await runtime.disconnect();
    expect(runtime.request(requestId)).toMatchObject({status:'unknown',replayed:false});
  } finally { await client.close();await server.close();await runtime.disconnect();r.close();await rm(dir,{recursive:true,force:true}); }
},15000);

it('accepts explicit chunk-radius settings without silently changing defaults or allowing fractional distances', () => {
  const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'Probe'};
  expect(cfg.viewDistance).toBeUndefined(); expect(()=>assertMinecraftReady(cfg)).not.toThrow();
  for(const viewDistance of [2,6,32]) expect(()=>assertMinecraftReady({...cfg,viewDistance})).not.toThrow();
  for(const viewDistance of [0,1,33,6.2,NaN]) expect(()=>assertMinecraftReady({...cfg,viewDistance})).toThrow('viewDistance');
});
