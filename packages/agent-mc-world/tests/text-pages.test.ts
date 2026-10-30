import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger,readTextPage,referenceToolText,renderToolTextPage,readOnlyToolResult,TextPageRangeError,TextReadRecoveryBook} from '../src/client/index.ts';
import {createMinecraftMcpServer} from '../src/mcp/server.ts';
const handle='log:'+'a'.repeat(64);

it('text offsets reconstruct Unicode exactly and reject split characters or invalid ranges',()=>{
  const text='a🐟中\n𠮷z';let offset=0,whole='';
  do{const page=readTextPage(text,handle,{offset,maxChars:1});whole+=page.text;
    expect(page.returnedChars).toBe(page.text.length);expect(page.totalChars).toBe(text.length);
    if(page.nextOffset===null)break;expect(page.nextOffset).toBeGreaterThan(offset);offset=page.nextOffset;
  }while(offset<text.length);
  expect(whole).toBe(text);expect(readTextPage('',handle).nextOffset).toBeNull();
  expect(()=>readTextPage(text,handle,{offset:2})).toThrow('Unicode');
  for(const options of [{offset:-1},{offset:999},{maxChars:0},{offset:0.5}])expect(()=>readTextPage(text,handle,options)).toThrow();
});

it('MCP snapshots and their model-sized continuations expose all text without re-running the query',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mc-text-pages-'));let calls=0;
  const text='攻略 🐟\n'.repeat(800)+'末尾事实';
  const world={id:'text-fixture',tools:()=>[{name:'mc_fixture',tags:['read'],description:'inert guide',parameters:{type:'object'},
    handler:async()=>{calls++;return{text};}}],envPromptVars:()=>null,start:async()=>{},stop:async()=>{}};
  const runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'fixture.invalid',username:'TextPageQA'},dataDir:dir,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'text-fixture'),client=new Client({name:'text-fixture',version:'1'});
  const[left,right]=InMemoryTransport.createLinkedPair();
  try{
    await runtime.connect();await server.connect(left);await client.connect(right);
    const specs=(await client.listTools()).tools,spec=specs.find(t=>t.name==='mc_fixture')!;
    expect(specs.find(t=>t.name==='mc_read_text')?.annotations?.readOnlyHint).toBe(true);
    const raw:any=await client.callTool({name:spec.name,arguments:{}}),before=structuredClone(raw),handles:string[]=[];
    const save=(t:string)=>{const ref=runtime.journal.saveBlobs([{bytes:Buffer.from(t),mime:'text/plain'}])[0];handles.push(ref.handle);return ref.handle;};
    const reference=()=>referenceToolText(raw,{readOnly:readOnlyToolResult(spec,raw),budgetChars:1500,save});
    let value=reference(),whole='',expectedOffset=0,rounds=0;
    reference();expect(handles[0]).toBe(handles[1]);expect(raw).toEqual(before);
    while(true){
      expect(value).toEqual(JSON.parse(JSON.stringify(value)));
      const rendered=renderToolTextPage(value,{budgetChars:1500,toolPrefix:'mc'})!;
      expect(rendered.length).toBeLessThanOrEqual(1500);const model=JSON.parse(rendered),page=model.meta.textPage;
      expect(page.offset).toBe(expectedOffset);expect(page.returnedChars).toBe(model.text.length);
      expect(page.totalChars).toBe(text.length);whole+=model.text;rounds++;
      if(!page.hasMore){expect(page.next).toBeNull();break;}
      expect(page.nextOffset).toBe(expectedOffset+model.text.length);expectedOffset=page.nextOffset;
      expect(page.next.tool).toBe('mc_read_text');value=await client.callTool({name:page.next.tool,arguments:page.next.arguments}) as any;
      expect(rounds).toBeLessThan(100);
    }
    expect(whole).toBe(text);expect(calls).toBe(1);
    const legacy:any=await client.callTool({name:'mc_artifact',arguments:{action:'get',handle:handles[0]}});
    expect(legacy.structuredContent.text).toBe(text);expect(legacy.structuredContent.data).toBeUndefined();
    const explicit:any=await client.callTool({name:'mc_artifact',arguments:{action:'get',handle:handles[0],offset:0,maxChars:10}});
    expect(explicit.structuredContent.data.protocol).toBe('agent-mc-text-page/v1');
    for(const name of ['mc_read_text','mc_artifact']){
      const invalid:any=await client.callTool({name,arguments:{...(name==='mc_artifact'?{action:'get'}:{}),handle:handles[0],offset:text.length+650,maxChars:650}});
      expect(invalid.isError).toBe(true);expect(invalid.structuredContent.failed).toBe(true);
      expect(invalid.structuredContent.data).toMatchObject({protocol:'agent-mc-text-read-error/v1',code:'TEXT_OFFSET_OUT_OF_RANGE',handle:handles[0],
        requestedOffset:text.length+650,totalChars:text.length,returnedChars:0,nextOffset:null});
      expect(invalid.structuredContent.text).toContain('Do not add maxChars');expect(calls).toBe(1);
      expect(renderToolTextPage(invalid,{budgetChars:1500,toolPrefix:'mc'})).toBeNull();
    }
    const binary=runtime.journal.saveBlobs([{bytes:Buffer.from([1,2]),mime:'application/octet-stream'}])[0];
    expect(()=>runtime.readTextArtifact(binary.handle)).toThrow('UTF-8');
    const bad:any=await client.callTool({name:'mc_read_text',arguments:{handle,offset:0}});expect(bad.isError).toBe(true);
  }finally{await client.close();await server.close();await runtime.disconnect();await rm(dir,{recursive:true,force:true});}
});

it('an invalid range preserves the actual bounds without pretending that unseen pages were read',()=>{
  let error:TextPageRangeError|undefined;
  try{readTextPage('one🐟two',handle,{offset:123456,maxChars:650});}catch(e){error=e as TextPageRangeError;}
  expect(error).toBeInstanceOf(TextPageRangeError);expect(error!.data).toEqual({protocol:'agent-mc-text-read-error/v1',code:'TEXT_OFFSET_OUT_OF_RANGE',
    handle,unit:'utf16',requestedOffset:123456,maxChars:650,totalChars:8,returnedChars:0,nextOffset:null});
  expect(()=>readTextPage('one🐟two',handle,{offset:4})).toThrow('Unicode');
  const end=readTextPage('one🐟two',handle,{offset:8,maxChars:650});expect(end.returnedChars).toBe(0);expect(end.hasMore).toBe(false);
});

it('projected document ends and varying invalid offsets survive request boundaries as bounded recovery evidence',()=>{
  let now=1000;const book=new TextReadRecoveryBook({now:()=>now}),run='original-run';
  const eof={structuredContent:{failed:false,text:'',meta:{textPage:{protocol:'agent-mc-text-page/v1',handle,offset:12890,totalChars:12890,returnedChars:0,nextOffset:null,hasMore:false}}}};
  book.observe({run,requestId:'eof',name:'mc_read_text',result:eof});
  expect(book.context(run)?.observedEnd).toMatchObject({requestId:'eof',totalChars:12890,hasMore:false});
  const failed=(offset:number)=>{let e;try{readTextPage('x'.repeat(12890),handle,{offset,maxChars:650});}catch(error){e=error as TextPageRangeError;}
    return{isError:true,structuredContent:{failed:true,data:e!.data}};};
  book.observe({run,requestId:'failed-1',name:'mc_read_text',result:failed(13540)});
  book.observe({run,requestId:'failed-2',name:'mc_read_text',result:failed(14190)});
  book.observe({run,requestId:'failed-2',name:'mc_read_text',result:failed(14190)});
  expect(book.context(run)?.attempts).toBe(2);expect(book.context(run)?.failure?.requestedOffset).toBe(14190);
  expect(book.context(run)?.observedEnd?.requestId).toBe('eof');expect(JSON.stringify(book.snapshot())).not.toContain('x'.repeat(100));
  now+=120001;expect(book.context(run)).toBeNull();
  book.observe({run:'different-run',requestId:'other',name:'mc_events',result:{}});
  expect(book.context(run)).toBeNull();expect(book.snapshot().knownEnds).toBe(0);
});

it('the read-recovery book ignores raw unrendered text references and clears only its request cue on other work',()=>{
  const book=new TextReadRecoveryBook();
  book.observe({run:'r',requestId:'full',name:'mc_query',result:{structuredContent:{failed:false,text:'not yet rendered',meta:{textReference:{protocol:'agent-mc-text-reference/v1',handle,totalChars:16}}}}});
  expect(book.context('r')).toBeNull();
  book.observe({run:'r',requestId:'eof',name:'mc_read_text',result:{structuredContent:{failed:false,text:'last',meta:{textPage:{protocol:'agent-mc-text-page/v1',handle,offset:0,returnedChars:4,totalChars:4,hasMore:false,nextOffset:null}}}}});
  expect(book.context('r')).not.toBeNull();
  book.observe({run:'r',requestId:'act',name:'mc_do',result:{structuredContent:{execution:{id:'original-task',phase:'accepted'}}}});
  expect(book.context('r')).toBeNull();expect(book.snapshot().knownEnds).toBe(1);
});

it('reverse pagination over fully delivered text remains repeat evidence rather than becoming new progress',()=>{
  const book=new TextReadRecoveryBook(),text='x'.repeat(12890);let id=0;
  const observe=(offset:number,maxChars=650)=>{const page=readTextPage(text,handle,{offset,maxChars});
    const model=JSON.parse(renderToolTextPage({structuredContent:{failed:false,text:page.text,data:page,meta:{textPage:page}}},{budgetChars:1500,toolPrefix:'mc'})!);
    book.observe({run:'r',requestId:String(++id),name:'mc_read_text',result:{structuredContent:model}});return model;};
  for(let offset=0;offset<text.length;){const model=observe(offset);if(!model.meta.textPage.hasMore)break;offset=model.meta.textPage.nextOffset;}
  expect(book.context('r')?.delivery).toMatchObject({coveredChars:12890,allDelivered:true,missingRanges:[]});
  for(let offset=12240;offset>=0;offset-=650){observe(offset);
    expect(book.context('r')?.read?.newlyDeliveredChars).toBe(0);expect(book.context('r')?.delivery.allDelivered).toBe(true);}
  expect(JSON.stringify(book.snapshot())).not.toContain('x'.repeat(100));
});

it('a final page alone leaves earlier delivery unknown and interval bounds never fill an unobserved gap',()=>{
  const book=new TextReadRecoveryBook();let id=0;
  const observe=(offset:number,text:string)=>book.observe({run:'r',requestId:String(++id),name:'mc_read_text',result:{structuredContent:{failed:false,text,meta:{textPage:{protocol:'agent-mc-text-page/v1',handle,offset,returnedChars:text.length,totalChars:1000,hasMore:offset+text.length<1000,nextOffset:offset+text.length<1000?offset+text.length:null}}}}});
  observe(900,'x'.repeat(100));expect(book.context('r')?.delivery).toMatchObject({coveredChars:100,allDelivered:false,missingRanges:[[0,900]]});
  for(let offset=0;offset<150;offset+=2)observe(offset,'x');
  observe(900,'x'.repeat(100));const cue=book.context('r')!;
  expect(cue.delivery.allDelivered).toBe(false);expect(cue.delivery.trackingTruncated).toBe(true);expect(cue.delivery.coveredChars).toBeLessThan(1000);
  expect(book.snapshot().deliveryDocuments).toBe(1);
});

it('ordinary/error/write/data receipts are not archived and tiny soft budgets never loop on an empty page',()=>{
  const save=()=>{throw Error('Must not archive');};
  for(const value of [{structuredContent:{failed:false,text:'small'}},{isError:true,structuredContent:{failed:false,text:'large'.repeat(500)}},
    {structuredContent:{failed:false,text:'large'.repeat(500),data:{actual:1}}}]){
    expect(referenceToolText(value,{budgetChars:100,readOnly:true,save})).toBe(value);
  }
  const raw={structuredContent:{failed:false,text:'🐟'.repeat(500)}};
  expect(referenceToolText(raw,{budgetChars:100,readOnly:false,save})).toBe(raw);
  const referenced=referenceToolText(raw,{budgetChars:100,readOnly:true,save:()=>handle});
  const p=JSON.parse(renderToolTextPage(referenced,{budgetChars:10,toolPrefix:'mc'})!);
  expect(p.text.length).toBeGreaterThan(0);expect(p.meta.textPage.nextOffset).toBe(p.text.length);
  expect(p.meta.textPage.presentationBudgetExceeded).toBe(true);expect(p.text.endsWith('\ud83d')).toBe(false);
});
