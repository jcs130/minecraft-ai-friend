import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {afterEach,it,expect,vi} from 'vitest';
import {OperationExperienceBook,operationScopeKey,operationObservation} from '../core/operation-experience.ts';
import {GameMemoryBook} from '../core/game-memory.ts';
import {GameMemoryService} from '../core/game-memory-service.ts';
import {ClientOperationLearning} from '../src/client/operation-learning.ts';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger} from '../src/client/index.ts';
import type {WorldHost,ToolDef} from '../src/contracts/host.ts';

const dirs:string[]=[];
const dir=()=>{const d=mkdtempSync(join(tmpdir(),'mc-experience-'));dirs.push(d);return d;};
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const scope={realm:'weak:example.test:25565|',account:'offline:Test',agent:'Test'},ctx={scope,dimension:'overworld'};
const sample=(x=0)=>({at:new Date().toISOString(),dimension:'overworld',position:{x,y:64,z:0},health:20,food:18,inventory:{ender_pearl:2}});
const accepted={kind:'task' as const,id:'epoch:1',phase:'accepted' as const,terminal:false,goalCompleted:false as const};
const completed={...accepted,phase:'completed' as const,terminal:true};

it('records flight/blink/food choices and selected parameters without prompts, chat, code or credentials',()=>{
  const directory=dir(),book=new OperationExperienceBook(directory);
  const row=book.begin(scope,'run','req','mc_do',{steps:[{skill:'control',mode:'flight',durationMs:500,keys:['forward'],password:'secret'},
    {skill:'cast',spell:'blink',at:[1,64,2]},{skill:'eat',item:'cooked_beef'},{skill:'chat',text:'private words'}],code:'private code'},sample(),{controller:'system1',decisionId:'d1',memoryRefs:['mc-memory:1:1']});
  expect(row.operations).toEqual(['control','cast','blink','eat','chat']);
  expect(row.parameters[0]).toEqual({skill:'control',mode:'flight',durationMs:500,keys:['forward']});
  const text=readFileSync(join(directory,'operations',operationScopeKey(scope),row.id+'.json'),'utf8');
  for(const secret of ['secret','private words','private code','password'])expect(text).not.toContain(secret);
  expect(row.before?.health).toBe(20);expect(row.goalVerified).toBe(false);
});
it('deduplicates across restart with stable serialization and isolates realm/account/agent',()=>{
  const directory=dir(),a=new OperationExperienceBook(directory);
  const first=a.begin(scope,'run','same','mc_do',{skill:'flight',land:true},null);
  const b=new OperationExperienceBook(directory);
  expect(b.begin(scope,'run','same','mc_do',{land:true,skill:'flight'},null).id).toBe(first.id);
  expect(()=>b.begin(scope,'run','same','mc_do',{skill:'eat'},null)).toThrow('conflict');
  for(const changed of [{...scope,realm:'other'},{...scope,account:'other'},{...scope,agent:'other'}])expect(()=>b.get(changed,first.id)).toThrow('scope');
  expect(b.list(scope).total).toBe(1);
});
it('keeps missing/stale observations and unknown dispatches unknown; command completion is not goal success',async()=>{
  const directory=dir(),book=new OperationExperienceBook(directory),memory=new GameMemoryBook(directory);
  const row=book.begin(scope,'run','r','mc_do',{skill:'flight'},null);
  book.finish(scope,row.id,{text:'accepted',execution:accepted},sample(),4);
  expect(book.get(scope,row.id).execution?.terminal).toBe(false);
  const request={action:'experience',operation:'reflect',requestId:'review',input:{ids:[row.id],summary:'flight',lesson:'test',conditions:'known clearance',counterexample:'unknown permission',verdict:'helpful'}};
  await expect(book.query(request,ctx,memory)).rejects.toThrow('completed operation');
  book.terminal(scope,row.id,completed,null);
  await expect(book.query(request,ctx,memory)).rejects.toThrow('measured');
  expect(operationObservation({...sample(),at:new Date(Date.now()-10000).toISOString()})).toBeNull();
  const unknown=book.begin(scope,'run','u','mc_do',{},sample());book.finish(scope,unknown.id,null,null,10);
  expect(book.get(scope,unknown.id).dispatch).toBe('unknown');
  expect(await book.query({operation:'stats'},ctx,memory)).toMatchObject({sampleSize:2,goalSuccessRate:null,modelAccuracy:null});
});
it('reflects evidence into searchable memory once, recovers interrupted receipts and recalls bounded history without a network',async()=>{
  const data=dir(),directory=join(data,'minecraft-memory'),book=new OperationExperienceBook(directory),memory=new GameMemoryBook(directory),network=vi.fn();
  const service=new GameMemoryService(memory,directory,network);
  const row=book.begin(scope,'run','r','mc_do',{skill:'flight'},sample());book.finish(scope,row.id,{text:'accepted',execution:accepted},sample(),1);book.terminal(scope,row.id,completed,sample(3));
  const req={action:'experience',operation:'reflect',requestId:'flight-trial-1',input:{ids:[row.id],summary:'flight landing reserve',lesson:'Keep a landing allowance after the tested flight.',conditions:'Permission and path independently verified',counterexample:'No permission or unloaded landing area',verdict:'helpful'}};
  const saved=await service.execute(req,ctx);expect(saved).toMatchObject({saved:true,masteryVerified:false});
  const review=join(directory,'operations',operationScopeKey(scope),`review-${saved.reviewId}.json`),pending=JSON.parse(readFileSync(review,'utf8'));delete pending.receipt;writeFileSync(review,JSON.stringify(pending));
  expect(await service.execute(req,ctx)).toMatchObject({note:saved.note});
  expect(await service.execute(req,ctx)).toMatchObject({duplicate:true});
  await expect(service.execute({...req,input:{...req.input,lesson:'changed'}},ctx)).rejects.toThrow('conflict');
  expect(memory.execute({action:'search',query:'flight',kind:'lesson'},ctx).total).toBe(1);
  const collector=new ClientOperationLearning(data,'new-run',()=>({text:'',snapshotTypes:[],experience:{scope,observation:sample()}}),()=>scope);
  expect(collector.recall('flight')[0]).toMatchObject({trust:'historical-agent-interpretation',currentWorldVerified:false});
  expect(()=>collector.validateMemoryRefs([collector.recall('flight')[0].reference])).not.toThrow();
  expect(()=>collector.validateMemoryRefs(['mc-memory:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:1'])).toThrow();
  expect(network).not.toHaveBeenCalled();
});
it('records rejected decisions without treating their probability as execution accuracy',async()=>{
  const directory=dir(),book=new OperationExperienceBook(directory);
  const row=book.decision(scope,'run',{id:'d',category:'skill',selected:'blink',status:'stale',candidates:[{id:'blink',ready:true,probability:.95}],elapsedMs:2100},sample());
  expect(row).toMatchObject({kind:'decision',before:null,execution:null,goalVerified:false});
  expect(row.after).not.toBeNull();
  await expect(book.query({operation:'reflect',requestId:'bad',input:{ids:[row.id],verdict:'helpful'}},ctx,new GameMemoryBook(directory))).rejects.toThrow('completed');
});
it('joins a fast terminal before RPC return and a later terminal after admission through the public SDK',async()=>{
  const data=dir();let host!:WorldHost,x=0,early=true;const tool:ToolDef={name:'mc_do',tags:['act'],description:'',parameters:{},handler:async()=>{
    if(early){x=3;await host.pushEvent({type:'minecraft.task',source:'minecraft',ts:new Date().toISOString(),text:'terminal',execution:completed});}
    return {text:'admitted',execution:accepted};}};
  const world={id:'minecraft',tools:()=>[tool],envPromptVars:()=>({}),start:async(h:WorldHost)=>{host=h;},stop:async()=>{},
    requestFacts:()=>({text:'',snapshotTypes:[],experience:{scope,observation:sample(x)}})};
  const runtime=new MinecraftAgentClient({dataDir:data,log:nullLogger(),cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'example.test',username:'Test'}},world);
  await runtime.connect();
  try{
    const outcome=await runtime.call('mc_do',{steps:[{skill:'flight',at:[3,64,0]}]},{requestId:'r',attribution:{controller:'system1',decisionId:'d'}});
    const id=(outcome.meta?.experience as {id:string}).id,book=new OperationExperienceBook(join(data,'minecraft-memory'));
    expect(book.get(scope,id)).toMatchObject({execution:{phase:'completed'},after:{position:{x:3}}});
    expect(await runtime.call('mc_do',{steps:[{skill:'flight',at:[3,64,0]}]},{requestId:'r',attribution:{controller:'system1',decisionId:'d'}})).toEqual(outcome);
    early=false;accepted.id='epoch:2';const next=await runtime.call('mc_do',{steps:[{skill:'eat'}]},'r2');
    x=4;await host.pushEvent({type:'minecraft.task',source:'minecraft',ts:new Date().toISOString(),text:'done',execution:{...completed,id:'epoch:2'}});
    expect(book.get(scope,(next.meta?.experience as {id:string}).id)).toMatchObject({execution:{phase:'completed'},after:{position:{x:4}}});
    expect(runtime.learning.status().recordingFailures).toBe(0);
  }finally{await runtime.disconnect();accepted.id='epoch:1';}
});
it('never changes a real tool outcome when experience persistence fails',async()=>{
  const data=dir();writeFileSync(join(data,'minecraft-memory'),'path conflict');
  const collect=new ClientOperationLearning(data,'run',()=>null,()=>scope);
  expect(collect.begin({name:'mc_do',tags:['act'],description:'',parameters:{},handler:async()=>''},{},'r')).toBeNull();
  expect(collect.status().recordingFailures).toBe(1);
});
it('does not attach another realm sample to a pending action',()=>{
  const data=dir();let current=scope;
  const c=new ClientOperationLearning(data,'run',()=>({text:'',snapshotTypes:[],experience:{scope:current,observation:sample()}}),()=>scope);
  const pending=c.begin({name:'mc_do',tags:['act'],description:'',parameters:{},handler:async()=>''},{skill:'flight'},'r')!;
  c.finish(pending,{text:'accepted',execution:accepted});current={...scope,realm:'new-world'};c.execution(completed);
  expect(new OperationExperienceBook(join(data,'minecraft-memory')).get(scope,pending.id).after).toBeNull();
});
it('summarizes archived metadata in an explicit scope and never invents an accuracy',()=>{
  const directory=dir(),book=new OperationExperienceBook(directory),row=book.begin(scope,'run','r','mc_do',{skill:'flight'},sample());
  book.finish(scope,row.id,{text:'done',execution:completed},sample(3),2);
  const script=fileURLToPath(new URL('../skills/minecraft-learning/scripts/summarize-experiences.mjs',import.meta.url));
  const result=JSON.parse(execFileSync(process.execPath,[script,join(directory,'operations',operationScopeKey(scope))],{encoding:'utf8'}));
  expect(result).toMatchObject({sampleSize:1,operations:{flight:1},measuredPairs:1,modelAccuracy:null,goalSuccessRate:null,causalImprovementVerified:false});
  expect(()=>execFileSync(process.execPath,[script,directory],{stdio:'pipe'})).toThrow();
});
it('packages portable skills with hashes, validates paths and refuses overwriting reviewed artifacts',()=>{
  const directory=dir(),script=fileURLToPath(new URL('../scripts/package-skills.mjs',import.meta.url));
  const bundle=JSON.parse(execFileSync(process.execPath,[script,directory],{encoding:'utf8'}));
  const listing=execFileSync('tar',['-tzf',bundle.archive],{encoding:'utf8'});
  expect(listing).toContain('minecraft-agent/SKILL.md');expect(listing).toContain('minecraft-learning/SKILL.md');
  expect(listing).not.toMatch(/(?:runtime|data|\.env|node_modules)\//);
  const manifest=JSON.parse(execFileSync('tar',['-xOf',bundle.archive,'skill-bundle-manifest.json'],{encoding:'utf8'}));
  expect(manifest).toMatchObject({gameTarget:'Java 1.21.1',runtimeInstalled:false,marketplacePublished:false});
  expect(manifest.files.every((f:any)=>/^[a-f0-9]{64}$/.test(f.sha256))).toBe(true);
  expect(()=>execFileSync(process.execPath,[script,directory],{stdio:'pipe'})).toThrow();
});
