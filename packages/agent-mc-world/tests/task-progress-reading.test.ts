import {afterEach,expect,it} from 'vitest';
import {TaskProgressReading} from '../core/task-progress-reading.ts';
import type {QueueStatus,TaskProgress} from '../core/executor.ts';
import {methodHarness} from './method-harness.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger} from '../src/client/index.ts';
import {MinecraftClientWorld} from '../src/extension.ts';
import {createMinecraftMcpServer} from '../src/mcp/server.ts';

const progress:TaskProgress={taskId:7,label:'Go to the village',stepIndex:0,stepCount:2,step:'Go',elapsedS:30,
 pos:{x:1,y:64,z:2},movedBlocks:6,count:null,half:false};
const queue:QueueStatus={running:{id:7,label:'Go to the village',step:'Go',stepIndex:0,stepCount:2,
 elapsedMs:35_000,taskElapsedMs:35_000,count:null,pos:{x:2,y:64,z:2}},waiting:[]};
const read=(r:TaskProgressReading,q=queue)=>JSON.parse(r.read(q).split('\n')[1]);

it('preserves the original periodic observation, net movement and task identity without refreshing its age',()=>{
 let now=Date.parse('2026-01-01T10:00:00Z');const r=new TaskProgressReading(()=>now);
 const p=structuredClone(progress);r.observe(p);p.movedBlocks=999;now+=60_000;
 expect(read(r).lastObservedProgress).toEqual({observedAt:'2026-01-01T10:00:00.000Z',progress});
 expect(read(r).current).toMatchObject({taskId:7,elapsedMs:35000});
 expect(read(r).lastObservedProgress.progress.movedBlocks).toBe(6);
});

it('does not lend old progress to another task or step, and represents holds and absent samples explicitly',()=>{
 const r=new TaskProgressReading();r.observe(progress);
 expect(read(r,{...queue,running:{...queue.running!,id:8}}).lastObservedProgress).toBeNull();
 expect(read(r,{...queue,running:{...queue.running!,stepIndex:1}}).lastObservedProgress).toBeNull();
 const waiting=read(r,{running:null,waiting:[{id:7,label:'Go'}],hold:'combat'});
 expect(waiting.current).toBeNull();expect(waiting.hold).toBe('combat');expect(waiting.lastObservedProgress.progress.taskId).toBe(7);
 expect(read(r,{running:null,waiting:[]}).lastObservedProgress).toBeNull();
 r.clear();expect(read(r).lastObservedProgress).toBeNull();
});

const rigs:ReturnType<typeof methodHarness>[]=[];
afterEach(()=>{for(const r of rigs.splice(0))r.close();});
it('declares progress coverage only alongside self-contained body facts; disconnect removes that coverage',()=>{
 const r=methodHarness('1.21.1');rigs.push(r);
 const original=structuredClone(progress);
 (r.world as any).taskProgressReading.observe(original);
 const facts=r.world.requestFacts()!;
 expect(facts.snapshotTypes).toContain('minecraft.task.progress');
 expect(facts.parts!.find(p=>p.key==='taskProgress')!.text).toContain('lastObservedProgress');
 expect(facts.parts!.find(p=>p.key==='queue')).toBeDefined();
 expect((r.world as any).lastFinishedTask).toBeNull();
 (r.world as any).bridge.connected=false;expect(r.world.requestFacts()).toBeNull();
});

it('delivers the same task progress through independent SDK and actual MCP transport without replay',async()=>{
 const r=methodHarness('1.21.1');rigs.push(r);
 const dir=mkdtempSync(join(tmpdir(),'progress-parity-'));
 const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.test',username:'Fixture'};
 const engine={id:'minecraft',tools:()=>[],envPromptVars:()=>({}),requestFacts:()=>r.world.requestFacts(),start:async()=>{},stop:async()=>{}};
 const facade=new MinecraftClientWorld({cfg,dataDir:dir,botName:'Fixture'},engine);
 const runtime=new MinecraftAgentClient({cfg,dataDir:dir,agentName:'Fixture',log:nullLogger()},facade);
 const server=createMinecraftMcpServer(runtime,'progress-parity'),client=new Client({name:'progress-parity',version:'1'});
 const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
 try{
  await server.connect(serverTransport);await client.connect(clientTransport);await runtime.connect();
  expect(runtime.status().facts!.snapshotTypes).toContain('minecraft.task.progress');
  const sdk=runtime.currentFacts().parts.find(p=>p.key==='taskProgress')!.text;
  const before=runtime.journal.store.latestCursor();
  const response=await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action:'facts'}});
  expect(response.isError).not.toBe(true);
  const text=response.content.find(p=>p.type==='text');
  if(text?.type!=='text')throw Error('Missing MCP facts');
  expect(JSON.parse(text.text).parts.find((p:{key:string})=>p.key==='taskProgress').text).toBe(sdk);
  expect(runtime.journal.store.latestCursor()).toBe(before);
 }finally{await client.close();await server.close();await runtime.disconnect();rmSync(dir,{recursive:true,force:true});}
});
