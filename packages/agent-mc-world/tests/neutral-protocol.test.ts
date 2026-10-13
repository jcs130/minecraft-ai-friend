import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, AgentJournal } from '../src/client/index.ts';
import { PROTOCOL, type ToolDef, type WorldHost } from '../src/client/contracts.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import { prepareContext, CurrentFacts } from '../src/client/context.ts';
import { RequestLedger } from '../src/client/request-ledger.ts';

const directories: string[] = [];
function directory() { const p=mkdtempSync(join(tmpdir(),'mc-neutral-')); directories.push(p); return p; }
afterEach(()=>{ vi.useRealTimers(); vi.restoreAllMocks(); for(const p of directories.splice(0))rmSync(p,{recursive:true,force:true}); });
function rig(tools: ToolDef[] = [], dataDir=directory()) {
  let host!: WorldHost;
  const onTurnEnded=vi.fn();
  const world={id:'minecraft',tools:()=>tools,envPromptVars:()=>({}),start:async(h:WorldHost)=>{host=h;},
    stop:vi.fn(async()=>{}),onTurnEnded,requestFacts:()=>({text:'',snapshotTypes:[],parts:[{key:'body',text:'health: 8'}]})};
  const runtime=new MinecraftAgentClient({dataDir,log:nullLogger(),cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'offline.invalid',username:'Test'}},world);
  return {runtime,world,onTurnEnded,host:()=>host};
}
function tool(name:string, handler:ToolDef['handler'], extra:Partial<ToolDef>={}):ToolDef {
  return {name,description:name,parameters:{type:'object'},tags:['act'],handler,...extra};
}
const admitted={kind:'task' as const,id:'connection-1:7',phase:'accepted' as const,terminal:false,goalCompleted:false as const};

describe('agent-mc/v1 semantics',()=>{
  it('keeps a real turn open across RPC returns, forwards round identity, and enforces barriers',async()=>{
    const contexts:unknown[]=[];
    const r=rig([tool('mc_act',async(_args,ctx)=>{contexts.push({round:ctx.round,turnId:ctx.turnId});return {text:'accepted',execution:admitted};}),
      tool('mc_barrier',async()=>({text:'check the result'}),{barrierAfter:true}),
      tool('mc_wait',async()=>({text:'host should end',endsTurn:true}))]);
    await r.runtime.connect();
    try {
      r.runtime.beginTurn('turn-1');
      const out=await r.runtime.call('mc_act',{}, {requestId:'request-1',turnId:'turn-1'});
      expect(out).toMatchObject({execution:admitted,control:{protocol:PROTOCOL,turnEnded:false}});
      expect(r.runtime.task('task',admitted.id)).toEqual(admitted);
      expect(r.onTurnEnded).not.toHaveBeenCalled();
      await r.runtime.call('mc_act',{});
      expect(contexts).toEqual([{round:1,turnId:'turn-1'},{round:1,turnId:'turn-1'}]);
      await r.runtime.call('mc_barrier',{},'barrier');
      await expect(r.runtime.call('mc_act',{})).rejects.toThrow('Acknowledge');
      r.runtime.acknowledgeBarrier('barrier');
      await r.runtime.call('mc_wait',{});
      await expect(r.runtime.call('mc_act',{})).rejects.toThrow('Host must end');
      expect(r.onTurnEnded).not.toHaveBeenCalled();
      expect(await r.runtime.endTurn('turn-1')).toMatchObject({phase:'ended'});
      expect(r.onTurnEnded).toHaveBeenCalledTimes(1);
      expect(()=>r.runtime.beginTurn('turn-1')).toThrow('already ended');
      expect(r.runtime.beginTurn('turn-2').round).toBe(2);
    } finally {await r.runtime.disconnect();}
  });

  it('replays a durable request without repeating effects, and refuses uncertain requests after interruption',async()=>{
    const execute=vi.fn(async()=>({text:'sent',execution:admitted}));
    const dir=directory(),r=rig([tool('mc_act',execute)],dir);
    await r.runtime.connect();
    const [a,b]=await Promise.all([r.runtime.call('mc_act',{},'durable'),r.runtime.call('mc_act',{},'durable')]);
    expect(a).toEqual(b);expect(execute).toHaveBeenCalledTimes(1);
    await expect(r.runtime.call('mc_act',{changed:true},'durable')).rejects.toThrow('different arguments');
    await r.runtime.disconnect();
    const resumed=rig([tool('mc_act',execute)],dir);await resumed.runtime.connect();
    try {expect(await resumed.runtime.call('mc_act',{},'durable')).toMatchObject(a);expect(execute).toHaveBeenCalledTimes(1);}
    finally {await resumed.runtime.disconnect();}
    const ledger=new RequestLedger(r.runtime.journal);
    ledger.write({requestId:'uncertain',signature:'same',phase:'pending'});
    expect(()=>new RequestLedger(r.runtime.journal).read('uncertain','same')).toThrow('outcome unknown');
  });

  it('cancels a pending tool and event wait, and never publishes a late deferred snapshot',async()=>{
    let captured:AbortSignal|undefined, release!:()=>void;
    const r=rig([tool('mc_wait',async(_a,ctx)=>{captured=ctx.signal;return await new Promise<string>(resolve=>{release=()=>resolve('late');});})]);
    await r.runtime.connect();
    const pending=r.runtime.call('mc_wait',{},'pending');
    const failure=expect(pending).rejects.toThrow('cancelled');await Promise.resolve();
    expect(r.runtime.cancel('pending').cancelled).toBe(true);await failure;expect(captured?.aborted).toBe(true);release();
    let render!:()=>void;
    r.host().pushDeferred({type:'sample',render:()=>new Promise<string>(resolve=>{render=()=>resolve('stale');})});
    const controller=new AbortController();
    const events=r.runtime.events({waitMs:30000},controller.signal);
    const aborted=expect(events).rejects.toThrow('cancelled');await Promise.resolve();
    controller.abort(new Error('cancelled'));await aborted;render();await Promise.resolve();await Promise.resolve();
    expect(r.runtime.journal.read(0,10).events).toEqual([]);
    await r.runtime.disconnect();
  });

  it('cannot revive from a late startup or update current execution state with a stale epoch',async()=>{
    const r=rig();let finish!:()=>void;
    const start=r.world.start;
    r.world.start=async h=>{await start(h);await new Promise<void>(resolve=>{finish=resolve;});};
    const connecting=r.runtime.connect();const cancelled=expect(connecting).rejects.toThrow('stopped');
    await Promise.resolve();await r.runtime.disconnect();await cancelled;
    expect(r.runtime.status().phase).toBe('disconnected');
    await expect(r.runtime.connect()).rejects.toThrow('still draining');
    finish();await new Promise(resolve=>setTimeout(resolve,5));
    await r.host().pushEvent({ts:'2026-10-13',source:'minecraft',type:'task',text:'late',execution:admitted});
    expect(r.runtime.task('task',admitted.id)).toBeNull();
    expect(r.runtime.journal.read(0,10).events).toEqual([]);
    expect((await r.runtime.journal.archive()).events[0]).toMatchObject({contextDelivery:'archive-only',meta:{staleEpoch:true}});
    expect(r.runtime.status().phase).toBe('disconnected');
  });

  it('delivers SDK/MCP receipts, control flags, event triggers and terminal execution state unchanged',async()=>{
    const r=rig([tool('mc_act',async(_args,ctx)=>{
      ctx.queueExternalEvents?.([{cursor:17,type:'server.reply',ts:'now',source:'minecraft',origin:'external',text:'protected',trigger:'preempt'}]);
      return {text:'accepted',execution:admitted,endsTurn:true};
    },{barrierAfter:true,interruptible:true})]);
    const server=createMinecraftMcpServer(r.runtime,'test'),client=new Client({name:'parity',version:'1'});
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);await r.runtime.connect();
    const protocol=async(action:string,extra:Record<string,unknown>={})=>client.callTool({name:'mc_protocol',arguments:{protocol:PROTOCOL,action,...extra}});
    try {
      const listed=(await client.listTools()).tools.find(t=>t.name==='mc_act')!;
      expect(listed._meta?.[PROTOCOL]).toMatchObject({barrierAfter:true,interruptible:true,endsTurn:false});
      await protocol('begin_turn',{id:'host-turn'});
      const rpc=await client.callTool({name:'mc_act',arguments:{},_meta:{[PROTOCOL]:{requestId:'parity-1',turnId:'host-turn'}}});
      const sdk=await r.runtime.call('mc_act',{}, {requestId:'parity-1',turnId:'host-turn'});
      expect(rpc.structuredContent).toMatchObject({execution:sdk.execution,control:sdk.control,events:sdk.events,endsTurn:true});
      expect(r.onTurnEnded).not.toHaveBeenCalled();
      await r.host().pushEvent({ts:'now',source:'minecraft',type:'task',text:'block placed and observed',execution:{...admitted,phase:'completed',terminal:true,evidence:{block:'stone'}}},{trigger:'flush'});
      const receipt=await protocol('task',{kind:'task',id:admitted.id});
      expect(JSON.parse((receipt.content as Array<{text:string}>)[0].text)).toMatchObject({phase:'completed',terminal:true,goalCompleted:false,evidence:{block:'stone'}});
      const events=await client.callTool({name:'mc_events',arguments:{}});
      expect(JSON.parse((events.content as Array<{text:string}>)[0].text).events[0].trigger).toBe('flush');
      await protocol('end_turn',{id:'host-turn'});expect(r.onTurnEnded).toHaveBeenCalledTimes(1);
      expect((await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v2',action:'facts'}})).isError).toBe(true);
      const facts=await protocol('facts');expect(JSON.parse((facts.content as Array<{text:string}>)[0].text)).toEqual(r.runtime.currentFacts());
      const archived=await protocol('archive',{keyword:'block placed'});expect(JSON.parse((archived.content as Array<{text:string}>)[0].text).events).toHaveLength(1);
    } finally {await client.close();await server.close();await r.runtime.disconnect();}
  });

  it('keeps stable context bytes, replaces dynamic keys, includes tools/output in budgets and preserves raw originals',async()=>{
    const r=rig();await r.runtime.connect();
    const prefix=await r.runtime.environment(),old=r.runtime.currentFacts().parts.find(p=>p.key==='body')!;
    r.world.requestFacts=()=>({text:'',snapshotTypes:[],parts:[{key:'body',text:'health: 20'}]});
    const current=r.runtime.currentFacts().parts;
    expect(current.filter(p=>p.key==='body')).toHaveLength(1);expect(await r.runtime.environment()).toBe(prefix);
    expect(Buffer.from(r.runtime.journal.blob(old.original)!.bytes).toString()).toBe('health: 8');
    const prepared=await r.runtime.prepareContext({contextTokens:50000,reservedOutputTokens:2048},'history');
    expect(prepared.usage.tools).toBeGreaterThan(0);expect(prepared.usage.reservedOutput).toBe(2048);
    expect(prepared.tail.find(p=>p.key==='body')?.text).toBe('health: 20');
    expect(()=>prepareContext('fixed',current,[{name:'large',description:'x'.repeat(300),parameters:{}}],{contextTokens:100,reservedOutputTokens:50})).toThrow('exceed');
    const bounded=prepareContext('fixed',current,[],{contextTokens:60,reservedOutputTokens:50});
    expect(bounded.tail).toEqual([]);expect(bounded.omittedKeys).toContain('body');expect(bounded.usage.total).toBeLessThanOrEqual(60);
    await r.runtime.disconnect();
  });

  it('queries archive-only and evicted original events across runs without putting them into current facts',async()=>{
    const dir=directory(),journal=new AgentJournal(dir,2),facts=new CurrentFacts(journal);
    for(let i=0;i<5;i++)await journal.pushEvent({source:'minecraft',ts:'now',type:'notice',text:`raw ${i}`},{deliver:i!==0,trigger:'piggyback'});
    expect(journal.read(0,10).gap).toBe(true);
    const next=new AgentJournal(dir,2);
    expect(next.archiveRuns()).toContain(journal.run);
    const page=await next.archive({run:journal.run,limit:2});expect(page.events.map(e=>e.text)).toEqual(['raw 0','raw 1']);expect(page.hasMore).toBe(true);
    expect(facts.replace({text:'',snapshotTypes:[],parts:[{key:'scene',text:'now'}]})).toHaveLength(1);
    expect(facts.replace(null)).toEqual([]);
  });
});
