import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {afterEach,it,expect,vi} from 'vitest';
import {OperationExperienceBook,operationScopeKey,operationObservation,operationInventory} from '../core/operation-experience.ts';
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

it('retains step change evidence across restart without copying result prose or promoting a goal',()=>{
  const directory=dir(),book=new OperationExperienceBook(directory);
  const row=book.begin(scope,'run','effect-readback','mc_do',{steps:[{skill:'use',at:[1,63,1]}]},sample());
  book.finish(scope,row.id,{text:'Accepted.',execution:accepted},sample(),2);
  book.terminal(scope,row.id,{...completed,evidence:{steps:[{step:1,outcome:'ok',why:'PRIVATE_RESULT_PROSE',observedEffect:{
    schema:'agent-mc-observed-effect/v1',skill:'use',status:'unchanged',at:[1,63,1],coverage:'client-visible-only',goalVerified:false,
    changed:{target:false,inventory:false,position:false,window:false},prompt:'PRIVATE_PROMPT'}}]}},sample());
  const restored=new OperationExperienceBook(directory).get(scope,row.id);
  expect(restored.execution?.phase).toBe('completed');expect(restored.stepEffects?.[0].status).toBe('unchanged');
  expect(restored.goalVerified).toBe(false);expect(JSON.stringify(restored)).not.toContain('PRIVATE_');
});

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
it('documents the real reflection wrapper and rejects observed array conditions without writing or rewriting memory',async()=>{
  const directory=dir(),book=new OperationExperienceBook(directory),memory=new GameMemoryBook(directory);
  const row=book.begin(scope,'run','inspect','mc_do',{skill:'inspect'},sample());
  const help=await book.query({action:'experience',operation:'help'},ctx,memory);
  const contract=help.reflection as {text:string;fields:Record<string,unknown>;example:Record<string,any>};
  expect(contract.fields).toMatchObject({requestId:{location:'top-level',type:'string',maxLength:128},summary:{location:'input',type:'string',maxLength:180},
    lesson:{maxLength:1800},conditions:{location:'input',type:'string',maxLength:600},counterexample:{maxLength:600},ids:{minItems:1,maxItems:8,uniqueItems:true}});
  expect(contract.text).toContain('single-line');expect(contract.text).toContain('UTF-16');
  expect(contract.example).toMatchObject({action:'experience',operation:'reflect',requestId:'review-1',input:{verdict:'unclear'}});
  // The live error shape: the caller sent two conditions as an array after reading help.
  const conditions=['主背包占用36/36且需要捡掉落物','organize的rules里keep等于该物品现有数量'];
  const request={...contract.example,requestId:'array-conditions',input:{...contract.example.input,ids:[row.id],conditions}};
  const original=JSON.stringify(request);
  const snapshot=()=>readdirSync(directory,{recursive:true}).filter(file=>String(file).endsWith('.json')).sort().map(file=>[file,readFileSync(join(directory,String(file)),'utf8')]);
  const before=snapshot();
  for(let attempt=0;attempt<2;attempt++)await expect(book.query(request,ctx,memory)).rejects.toThrow(/Invalid conditions: expected a non-empty single-line string, at most 600.*received array/);
  expect(JSON.stringify(request)).toBe(original);expect(snapshot()).toEqual(before);
  expect(memory.execute({action:'search',kind:'lesson'},ctx).total).toBe(0);
  // Only an explicit caller correction follows the original evidence-linked save path.
  const corrected={...request,input:{...request.input,conditions:conditions.join('；')}};
  const receipt=await book.query(corrected,ctx,memory);
  expect(receipt).toMatchObject({saved:true,masteryVerified:false,goalVerified:false,verdict:'unclear'});
  expect(await book.query(corrected,ctx,memory)).toMatchObject({duplicate:true,note:receipt.note});
  expect(memory.execute({action:'search',kind:'lesson'},ctx).total).toBe(1);
  expect((memory.execute({action:'get',id:(receipt.note as {id:string}).id},ctx).entry as {content:string}).content).toContain(conditions.join('；'));
});
it.each([
  ['requestId',129,128],['summary',181,180],['lesson',1801,1800],['conditions',601,600],['counterexample',601,600],
] as const)('reports the %s limit without echoing private text and saves nothing on failure',async(field,length,limit)=>{
  const directory=dir(),book=new OperationExperienceBook(directory),memory=new GameMemoryBook(directory);
  const row=book.begin(scope,'run','inspect','mc_do',{skill:'inspect'},sample());
  const request:{requestId:string;operation:string;input:Record<string,unknown>}={requestId:'review',operation:'reflect',input:{ids:[row.id],summary:'summary',lesson:'lesson',conditions:'conditions',counterexample:'counterexample',verdict:'unclear'}};
  const privateText='PRIVATE_TEXT'.padEnd(length,'x');
  if(field==='requestId')request.requestId=privateText;else request.input[field]=privateText;
  const before=readdirSync(directory,{recursive:true}).sort();
  await expect(book.query(request,ctx,memory)).rejects.toThrow(new RegExp(`at most ${limit}.*received string \\(length ${length}\\)`));
  await book.query(request,ctx,memory).catch(error=>expect(String(error)).not.toContain('PRIVATE_TEXT'));
  expect(readdirSync(directory,{recursive:true}).sort()).toEqual(before);
  expect(memory.execute({action:'search',kind:'lesson'},ctx).total).toBe(0);
});
it.each([['line\nbreak','string'],['line\tbreak','string'],['   ','string'],[null,'null'],[{},'object']] as const)('preserves the single-line reflection contract for %j',async(value,type)=>{
  const directory=dir(),book=new OperationExperienceBook(directory),memory=new GameMemoryBook(directory);
  const row=book.begin(scope,'run','inspect','mc_do',{skill:'inspect'},sample());
  await expect(book.query({requestId:'review',operation:'reflect',input:{ids:[row.id],summary:'summary',lesson:'lesson',conditions:value,counterexample:'counterexample',verdict:'unclear'}},ctx,memory))
    .rejects.toThrow(new RegExp(`Invalid conditions:.*received ${type}`));
  expect(memory.execute({action:'search',kind:'lesson'},ctx).total).toBe(0);
});
it('records rejected decisions without treating their probability as execution accuracy',async()=>{
  const directory=dir(),book=new OperationExperienceBook(directory);
  const row=book.decision(scope,'run',{id:'d',category:'skill',selected:'blink',status:'stale',candidates:[{id:'blink',ready:true,probability:.95}],elapsedMs:2100},sample());
  expect(row).toMatchObject({kind:'decision',before:null,execution:null,goalVerified:false});
  expect(row.after).not.toBeNull();
  expect(book.decision(scope,'run',row.decision!,sample(9))).toEqual(row);
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
it.each(['realm','account','agent'] as const)('keeps early terminal samples bound to their sampled %s',field=>{
  for(const ordering of ['same','changed','changed-back','changed-after'] as const){
    const data=dir();let current=scope;
    const other={...scope,[field]:'other'};
    const c=new ClientOperationLearning(data,'run',()=>({text:'',snapshotTypes:[],experience:{scope:current,observation:sample(7)}}),()=>scope);
    const pending=c.begin({name:'mc_do',tags:['act'],description:'',parameters:{},handler:async()=>''},{skill:'flight'},'r')!;
    if(ordering==='changed'||ordering==='changed-back')current=other;
    c.execution(completed);
    if(ordering==='changed-back')current=scope;
    if(ordering==='changed-after')current=other;
    c.finish(pending,{text:'accepted',execution:accepted});
    const row=new OperationExperienceBook(join(data,'minecraft-memory')).get(scope,pending.id);
    expect(row.execution).toMatchObject({kind:completed.kind,id:completed.id,phase:'completed',terminal:true});
    if(ordering==='changed'||ordering==='changed-back')expect(row.after).toBeNull();
    else expect(row.after?.position?.x).toBe(7);
    expect(c.status().recordingFailures).toBe(0);
  }
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
  const paths=new Set(manifest.files.map((file:any)=>file.file));
  for(const file of manifest.files.filter((file:any)=>file.file.endsWith('.md'))){
    const markdown=execFileSync('tar',['-xOf',bundle.archive,file.file],{encoding:'utf8'});
    for(const match of markdown.matchAll(/\]\(([^\s)]+)\)/g)){
      const link=match[1].split('#')[0];if(!link||/^[a-z][a-z0-9+.-]*:/i.test(link))continue;
      const target=posix.normalize(posix.join(posix.dirname(file.file),link));
      expect(target.startsWith(file.file.split('/')[0]+'/'),`${file.file}: local Skill link escapes its folder: ${link}`).toBe(true);
      expect(paths.has(target),`${file.file}: missing packaged reference ${link}`).toBe(true);
    }
  }
  expect(()=>execFileSync(process.execPath,[script,directory],{stdio:'pipe'})).toThrow();
});

it('aggregates duplicate physical stacks into truthful forward-only operation evidence',()=>{
  const stacks=Object.freeze([Object.freeze({name:'minecraft:cobblestone',count:64}),Object.freeze({name:'minecraft:cobblestone',count:10}),Object.freeze({name:'mod:cobblestone',count:3})]);
  const original=JSON.stringify(stacks),directory=dir(),book=new OperationExperienceBook(directory);
  const row=book.begin(scope,'run','stack-removal','mc_do',{skill:'craft'},{...sample(),inventory:operationInventory(stacks,true)});
  book.finish(scope,row.id,{text:'completed',execution:completed},{...sample(),inventory:operationInventory([stacks[0],stacks[2]],true)},1);
  const stored=book.get(scope,row.id);
  expect(stored.before?.inventory).toEqual({'minecraft:cobblestone':74,'mod:cobblestone':3});
  expect(stored.after?.inventory?.['minecraft:cobblestone']).toBe(64);
  expect(stored.after!.inventory!['minecraft:cobblestone']-stored.before!.inventory!['minecraft:cobblestone']).toBe(-10);
  expect(operationInventory([...stacks].reverse(),true)).toEqual(stored.before?.inventory);
  expect(JSON.stringify(stacks)).toBe(original);
  // Old persisted evidence remains exactly as recorded, including former producer errors.
  const historical=book.begin(scope,'old-run','old-stack-record','mc_do',{}, {...sample(),inventory:{'minecraft:cobblestone':10}});
  const path=join(directory,'operations',operationScopeKey(scope),historical.id+'.json'),bytes=readFileSync(path,'utf8');
  operationInventory(stacks,true);
  expect(readFileSync(path,'utf8')).toBe(bytes);
  expect(new OperationExperienceBook(directory).get(scope,historical.id).before?.inventory).toEqual({'minecraft:cobblestone':10});
});
it('retains unknown inventory separately from synchronized empty and preserves exact IDs',()=>{
  expect(operationInventory([{name:'minecraft:stone',count:1}],false)).toBeNull();
  expect(operationInventory([],false)).toBeNull();
  expect(operationObservation({...sample(),inventory:operationInventory([],true)})?.inventory).toEqual({});
  expect(operationObservation({...sample(),inventory:operationInventory([],false)})?.inventory).toBeNull();
  expect(operationInventory([{name:'__proto__',count:2},{name:'__proto__',count:3},{name:'constructor',count:1}],true)).toEqual(JSON.parse('{"__proto__":5,"constructor":1}'));
});
