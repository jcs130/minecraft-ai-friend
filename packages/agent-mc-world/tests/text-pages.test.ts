import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger,readTextPage,referenceToolText,renderToolTextPage,readOnlyToolResult} from '../src/client/index.ts';
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
    const binary=runtime.journal.saveBlobs([{bytes:Buffer.from([1,2]),mime:'application/octet-stream'}])[0];
    expect(()=>runtime.readTextArtifact(binary.handle)).toThrow('UTF-8');
    const bad:any=await client.callTool({name:'mc_read_text',arguments:{handle,offset:0}});expect(bad.isError).toBe(true);
  }finally{await client.close();await server.close();await runtime.disconnect();await rm(dir,{recursive:true,force:true});}
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
