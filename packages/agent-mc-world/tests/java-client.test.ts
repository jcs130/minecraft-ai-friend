import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, JavaClientWorld, MINECRAFT_CLIENT_DEFAULTS, offlineUuid, nullLogger, loadMinecraftClientConfig } from '../src/client/index.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';
import { javaScriptErrorHelp } from '../src/client/java-script-help.ts';
const paths: string[]=[];
const directory=()=>{const path=mkdtempSync(join(tmpdir(),'real-java-client-'));paths.push(path);return path;};
afterEach(()=>{vi.restoreAllMocks();for(const path of paths.splice(0))rmSync(path,{recursive:true,force:true});});
function rig(scriptEnabled = false) {
  const data=directory(), credentials=join(data,'connection.json');
  writeFileSync(credentials,JSON.stringify({protocol:'agent-mc-java/v1',endpoint:'http://127.0.0.1:1234',token:'a'.repeat(64),instanceId:'offline-fixture'}));
  const cfg={...structuredClone(MINECRAFT_CLIENT_DEFAULTS),provider:'java-client' as const,host:'fixture.test',username:'Test',version:'1.20.6',
    javaClient:{expectedUuid:offlineUuid('Test'),expectedServer:'fixture.test:25565',controllerId:'independent-test',credentialsFile:credentials,ledgerDir:join(data,'ledger'),leaseMs:15000,minescriptEnabled:scriptEnabled,actionWaitMs:0}};
  const state={protocol:'agent-mc-java/v1',connected:true,uuid:cfg.javaClient.expectedUuid,server:cfg.javaClient.expectedServer,username:'Test',sampledAt:new Date().toISOString(),generation:1,
    position:[1,65,3],health:20,food:20,inventory:[{slot:0,name:'player_head',displayName:'大背包',components:'CustomModelData=backpack',encoded:{components:{custom_name:'大背包'}}}],cursor:{empty:true},menuSlots:[],actions:[] as any[],messages:[]};
  const calls:any[]=[];let completed=false;
  const http=vi.fn(async(_url:any,init:any)=>{
    const request=JSON.parse(init.body);calls.push(request);
    const {method,params}=request;let value:any=state;
    if(method==='claim'||method==='renew')value={controllerId:'independent-test',nonce:'private-lease-proof',expiresAt:Date.now()+15000};
    else if(method==='release'||method==='stop')value={stopped:true};
    else if(method==='cancel')value={id:params.action_id,operation:'move',phase:'cancelled',acceptedAt:Date.now(),updatedAt:Date.now()};
    else if(method==='operations')value={operations:{move:'native move'}};
    else if(method==='capabilities')value={protocol:'agent-mc-java/v1',realRendering:true,minescript:scriptEnabled,baritone:false};
    else if(method==='do'||method==='result'){
      value={id:params.action_id,operation:'move',phase:completed?'completed':'accepted',acceptedAt:Date.now(),updatedAt:Date.now(),evidence:{position:[2,65,3]}};
      if(method==='do')state.actions=[value];
    }
    return new Response(JSON.stringify(value));
  });
  const world=new JavaClientWorld(cfg,http),runtime=new MinecraftAgentClient({cfg,dataDir:join(data,'sdk'),log:nullLogger(),autoAcknowledgeBarriers:true},world);
  return {cfg,state,world,runtime,http,calls,complete:()=>{completed=true;state.actions[0].phase='completed';}};
}
describe('real Java client body provider, offline protocol fixtures',()=>{
  it('explains observed version-specific API failures without rewriting or dispatching a correction',()=>{
    expect(javaScriptErrorHelp("module 'minescript' has no attribute 'equipment_hotbar_select'")).toContain('player_inventory_select_slot(slot)');
    expect(javaScriptErrorHelp("module 'minescript' has no attribute 'block_at'")).toContain('mc_probe');
    expect(javaScriptErrorHelp('java.lang.IllegalArgumentException: No key mapping with name `attack`')).toContain('"key.attack"');
    expect(javaScriptErrorHelp("module 'minescript' has no attribute 'state'")).toContain('No correction was executed');
    expect(javaScriptErrorHelp('Unexpected unrelated script error')).toBeUndefined();
    expect(javaScriptErrorHelp(null)).toBeUndefined();
  });
  it('reports unavailable data rendering without detaching the actual body or falling back to screenshots',async()=>{
    const r=rig();r.cfg.viewerPort=1;r.cfg.viewerAssetsDir=join(directory(),'not-installed');
    await r.runtime.connect();try {
      expect(r.world.console().lamps).toEqual(expect.arrayContaining([expect.objectContaining({label:'服务器',state:'online'}),expect.objectContaining({label:'画面',state:'error'})]));
      expect(r.world.console().links).toEqual([]);
      expect(r.calls.some(call=>['screenshot','claim','release','stop'].includes(call.method))).toBe(false);
    }finally{await r.runtime.disconnect();}
  });
  it('exposes Python programs only when explicitly configured and passes original identity, action ID and cancellation to the same body',async()=>{
    const r=rig(true);expect(r.calls).toEqual([]);await r.runtime.connect();
    try {
      const manual=await r.runtime.call('mc_script',{api:'index'});expect(manual.text).toContain('trusted code');expect(r.calls.some(call=>call.method==='do')).toBe(false);
      const ambiguous=await r.runtime.call('mc_script',{api:'index',code:'result="placeholder"'});expect(ambiguous.text).toContain('not executed');expect(r.calls.some(call=>call.method==='do')).toBe(false);
      await r.runtime.call('mc_control',{action:'claim'});
      const code='result = minescript.player_position()';
      const accepted=await r.runtime.call('mc_script',{code,input:{label:'fixture'},timeoutMs:2000,action_id:'program-original'});
      expect(accepted.execution).toMatchObject({id:'program-original',terminal:false,goalCompleted:false});
      expect(r.calls.find(call=>call.method==='do').params).toMatchObject({operation:'minescript.run',action_id:'program-original',input:{code,timeoutMs:2000,input:{label:'fixture'}}});
      expect((await r.runtime.call('mc_script',{language:'javascript',code:'old()'})).failed).toBe(true);
      await r.runtime.call('mc_cancel',{action_id:'program-original'});
      expect(r.calls.filter(call=>call.method==='do')).toHaveLength(1);
    } finally {await r.runtime.disconnect();}
  });
  it('returns a short real terminal in the original call without ending the host turn or resubmitting',async()=>{
    const r=rig();r.cfg.javaClient.actionWaitMs=1000;await r.runtime.connect();await r.runtime.call('mc_control',{action:'claim'});
    try {
      setTimeout(()=>r.complete(),30);
      const reply=await r.runtime.call('mc_do',{action_id:'short-original',operation:'move',input:{ticks:2}});
      expect(reply.execution).toMatchObject({id:'short-original',phase:'completed',terminal:true,goalCompleted:false});
      expect(reply.control?.turnEnded).toBe(false);expect(r.calls.filter(c=>c.method==='do')).toHaveLength(1);
    }finally{await r.runtime.disconnect();}
  });
  it('leaves long actions admitted and cancels folded waiting without cancelling or replaying body work',async()=>{
    const r=rig();await r.runtime.connect();await r.runtime.call('mc_control',{action:'claim'});
    try {
      const long=await r.runtime.call('mc_do',{action_id:'long-original',operation:'move',input:{ticks:200},waitMs:30});
      expect(long.execution).toMatchObject({terminal:false,goalCompleted:false});
      const abort=new AbortController();setTimeout(()=>abort.abort(new Error('cancel short wait')),20);
      await expect(r.runtime.call('mc_do',{action_id:'second-original',operation:'move',input:{ticks:2},waitMs:1000},{requestId:'folded-wait',signal:abort.signal})).rejects.toThrow('cancel short wait');
      expect(r.calls.filter(c=>c.method==='do')).toHaveLength(2);expect(r.calls.some(c=>['cancel','stop'].includes(c.method))).toBe(false);
    }finally{await r.runtime.disconnect();}
  });
  it('delivers every native notice and terminal with cooperative wakeups instead of interrupting on own receipts',async()=>{
    const r=rig(),events:any[]=[];
    await r.world.start({log:nullLogger(),pushEvent:async(event:any,options:any)=>{events.push({event,options});return event;}} as any);
    try {
      r.state.messages=[{seq:1,text:'command reply',at:new Date().toISOString(),overlay:false,kind:'system'},
        {seq:2,text:'HUD',at:new Date().toISOString(),overlay:true,kind:'system'},
        {seq:3,text:'hello',at:new Date().toISOString(),overlay:false,kind:'player',sender:'Alex'}] as any;
      r.state.actions=[{id:'own-completed',phase:'completed',updatedAt:1}];r.complete();
      await vi.waitFor(()=>expect(events).toHaveLength(4),{timeout:1500});
      expect(events.map(e=>[e.event.text==='command reply'?'system':e.event.text==='HUD'?'hud':e.event.text==='hello'?'player':'terminal',e.options.trigger]))
        .toEqual([['system','debounce'],['hud','piggyback'],['player','preempt'],['terminal','flush']]);
      expect(events.at(-1).event.execution).toMatchObject({id:'own-completed',terminal:true,goalCompleted:false});
    }finally{await r.world.stop();}
  });
  it('offers a bounded batch probe through the same original body task without model-generated code',async()=>{
    const r=rig(true);await r.runtime.connect();await r.runtime.call('mc_control',{action:'claim'});
    try {
      const reply=await r.runtime.call('mc_probe',{action_id:'probe-original',positions:[[-1,65,-2]],names:['minecraft:stone']});
      expect(reply.execution).toMatchObject({id:'probe-original',terminal:false,goalCompleted:false});
      const call=r.calls.find(c=>c.method==='do');expect(call.params).toMatchObject({action_id:'probe-original',operation:'minescript.run',input:{timeoutMs:5000,input:{positions:[[-1,65,-2]],names:['minecraft:stone']}}});
      expect(call.params.input.code).toContain('getblocklist');expect(call.params.input.code).not.toContain('press_key');
    }finally{await r.runtime.disconnect();}
  });
  it('delivers compact terminal evidence with an exact archive without repeating inventory and queue snapshots',async()=>{
    const r=rig(true),events:any[]=[],http=r.http.getMockImplementation()!;
    const inventory=Array.from({length:36},(_,slot)=>({slot,count:64,name:'minecraft:stone',displayName:'原始物品'.repeat(60),encoded:{component:'exact-original-'+slot}}));
    const action={id:'compact-terminal',operation:'minescript.run',phase:'partial',acceptedAt:1,updatedAt:2,
      evidence:{...r.state,inventory,menuSlots:inventory,script:{ok:true,jobId:'job-original',result:{observed:36}}}};
    r.http.mockImplementation(async(url:any,init:any)=>JSON.parse(init.body).method==='result'?new Response(JSON.stringify(action)):http(url,init));
    await r.world.start({log:nullLogger(),pushEvent:async(event:any,options:any)=>{events.push({event,options});return event;}} as any);
    try {
      r.state.actions=[{id:action.id,phase:'partial',updatedAt:2}];
      await vi.waitFor(()=>expect(events).toHaveLength(1),{timeout:1500});
      const event=events[0].event,projected=JSON.parse(event.text);
      expect(event.text.length).toBeLessThan(2000);expect(events[0].options.trigger).toBe('flush');
      expect(projected.evidence).toMatchObject({position:[1,65,3],health:20,script:{ok:true,result:{observed:36}},originalQuery:expect.stringContaining('mc_evidence')});
      expect(projected.evidence.inventory).toBeUndefined();expect(projected.evidence.actions).toBeUndefined();
      expect(event.execution).toMatchObject({id:action.id,phase:'partial',terminal:true,goalCompleted:false,evidence:{raw:projected.evidence.raw}});
      const query=r.world.tools().find(t=>t.name==='mc_evidence')!;
      let full='';for(let offset=0;offset<projected.evidence.raw.originalChars;offset+=16000){const page=await query.handler({...projected.evidence.raw,offset,limit:16000},{} as any);full+=JSON.parse(page.text).text;}
      expect(JSON.parse(full)).toEqual(action);
    }finally{await r.world.stop();}
  });
  it('serves focused version-correct Python recipes through SDK/MCP without executing body operations', async()=>{
    const r=rig(true),server=createMinecraftMcpServer(r.runtime,'script-help'),client=new Client({name:'script-help',version:'1'});
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);await r.runtime.connect();
    try {
      for (const topic of ['blocks','movement','interaction','inventory']) {
        const sdk=await r.runtime.call('mc_script',{api:topic});
        const mcp=await client.callTool({name:'mc_script',arguments:{api:topic}});
        expect((mcp.content as any[])[0].text).toBe(sdk.text);
        expect(sdk.failed).not.toBe(true);
      }
      const blocks=await r.runtime.call('mc_script',{api:'blocks'});
      expect(blocks.text).toContain('getblocklist');expect(blocks.text).toContain('math.floor');expect(blocks.text).toContain('age=7');
      expect((await r.runtime.call('mc_script',{api:'nonexistent'})).failed).toBe(true);
      expect(r.calls.some(call=>['do','claim','cancel'].includes(call.method))).toBe(false);
      const help=await r.runtime.call('mc_help',{skill:'move'});
      expect(help.text).toContain('native move');expect(help.text.length).toBeLessThan(800);
      expect(help.text).not.toContain('Minescript');expect((await r.runtime.call('mc_help',{skill:'invented'})).failed).toBe(true);
    } finally {await client.close();await server.close();await r.runtime.disconnect();}
  });
  it('bounds repeated terminal history while preserving pending work, uncertainty counts and the complete original',async()=>{
    const r=rig();
    r.state.actions=Array.from({length:100},(_,i)=>({id:`old-${i}`,phase:i===99?'unknown':'completed',updatedAt:i}));
    r.state.actions.push({id:'currently-running',phase:'running',updatedAt:101});
    await r.runtime.connect();
    try {
      const current=JSON.parse((await r.runtime.call('mc_state',{})).text);
      expect(current.actions).toHaveLength(5);expect(current.actions).toContainEqual(expect.objectContaining({id:'currently-running'}));
      expect(current.actionSummary).toMatchObject({retained:101,shown:5,omitted:96,pending:1,unknown:1});
      const raw=JSON.parse((await r.runtime.call('mc_evidence',{key:current.raw.key,sha256:current.raw.sha256,limit:16000})).text);
      expect(JSON.parse(raw.text).actions).toHaveLength(101);
      expect(JSON.parse((await r.runtime.call('mc_queue',{})).text)).toHaveLength(101);
    } finally {await r.runtime.disconnect();}
  });
  it('discovers without credentials/network and defaults to the existing independent body',()=>{
    const r=rig();expect(r.http).not.toHaveBeenCalled();expect(r.runtime.tools().map(tool=>tool.name)).toEqual(expect.arrayContaining(['mc_control','mc_operations','mc_wait','mc_photo']));
    expect(r.runtime.tools().map(tool=>tool.name)).not.toContain('mc_script');expect(r.runtime.status().phase).toBe('disconnected');
    expect(MINECRAFT_CLIENT_DEFAULTS.provider).toBe('mineflayer');
  });
  it('validates actual offline UUID/server, claims explicitly and keeps lease proofs out of tool results',async()=>{
    const r=rig();await r.runtime.connect();
    try {
      expect((await r.runtime.call('mc_do',{operation:'move',input:{forward:true,ticks:2}})).failed).toBe(true);
      expect(r.calls.some(call=>call.method==='do'||call.method==='claim')).toBe(false);
      expect(r.runtime.status().lamps).toContainEqual({label:'服务器',state:'online'});
      const claim=await r.runtime.call('mc_control',{action:'claim'});expect(claim.text).not.toContain('private-lease-proof');
      const admitted=await r.runtime.call('mc_do',{operation:'move',input:{forward:true,ticks:2},action_id:'native-id'},'stable-rpc');
      expect(admitted.execution).toMatchObject({id:'native-id',terminal:false,goalCompleted:false});
      await r.runtime.call('mc_do',{operation:'move',input:{forward:true,ticks:2},action_id:'native-id'},'stable-rpc');
      expect(r.calls.filter(call=>call.method==='do')).toHaveLength(1);
      expect(r.calls.find(call=>call.method==='do').params).toMatchObject({nonce:'private-lease-proof',expectedUuid:r.cfg.javaClient.expectedUuid,expectedServer:'fixture.test:25565'});
      r.complete();await vi.waitFor(()=>expect(r.runtime.task('task','native-id')?.terminal).toBe(true),{timeout:2000});
      expect(r.runtime.journal.read(0,10).events.some(event=>event.type==='minecraft.client.action')).toBe(true);
      expect(r.runtime.currentFacts().parts.some(part=>part.text.includes('大背包'))).toBe(true);
    } finally {await r.runtime.disconnect();}
    expect(r.calls.filter(call=>call.method==='release')).toHaveLength(1);
  });
  it.each(['uuid','server'])('blocks identity mismatch in %s before any control or body input',async field=>{
    const r=rig();r.state[field]=field==='uuid'?offlineUuid('Other'):'different.test:25565';
    await expect(r.runtime.connect()).rejects.toThrow('mismatch');expect(r.calls.some(call=>['claim','do'].includes(call.method))).toBe(false);
  });
  it('rejects disconnected bodies and malformed UUIDs without claiming or reconnecting',async()=>{
    const disconnected=rig();disconnected.state.connected=false;
    await expect(disconnected.runtime.connect()).rejects.toThrow('join explicitly');
    expect(disconnected.calls.map(call=>call.method)).toEqual(['state']);
    const invalid=rig();invalid.cfg.javaClient.expectedUuid='123456781234-1234-1234-123456789abc';
    await expect(invalid.runtime.connect()).rejects.toThrow('Configure javaClient');expect(invalid.http).not.toHaveBeenCalled();
  });
  it('keeps full components available while current facts omit repeated book payloads',async()=>{
    const r=rig();(r.state.inventory[0] as any).encoded.components.book='large-book-payload-'.repeat(10000);
    await r.runtime.connect();
    try {
      expect(JSON.stringify(r.runtime.currentFacts())).not.toContain('large-book-payload');
      const bag=await r.runtime.call('mc_bag',{});expect(bag.text.length).toBeLessThan(5000);expect(bag.text).not.toContain('large-book-payload');
      expect((await r.runtime.call('mc_bag',{item:'player_head',detail:'components',limit:1000})).text).toContain('large-book-payload');
      const snapshot=await r.runtime.call('mc_state',{}),compact=JSON.parse(snapshot.text);expect(snapshot.text.length).toBeLessThan(5000);
      let original='';for(let offset=0;offset<compact.raw.originalChars;offset+=16000){const page=JSON.parse((await r.runtime.call('mc_evidence',{key:compact.raw.key,sha256:compact.raw.sha256,offset,limit:16000})).text);original+=page.text;}
      expect(JSON.parse(original).inventory[0].encoded.components.book).toBe((r.state.inventory[0] as any).encoded.components.book);
    } finally {await r.runtime.disconnect();}
  });
  it('exposes explicit action cancellation and never polls or claims again after stop',async()=>{
    const r=rig();await r.runtime.connect();await r.runtime.call('mc_control',{action:'claim'});
    const cancelled=await r.runtime.call('mc_cancel',{action_id:'original'});
    expect(cancelled.execution).toMatchObject({id:'original',phase:'cancelled',terminal:true,goalCompleted:false});
    await r.runtime.disconnect();const count=r.calls.length;
    await new Promise(resolve=>setTimeout(resolve,650));expect(r.calls).toHaveLength(count);
    expect(r.runtime.status().phase).toBe('disconnected');
  });
  it('ignores a late previous attachment poll after explicit reattachment',async()=>{
    const r=rig();await r.runtime.connect();
    let finish: ((response: Response)=>void)|undefined;
    r.http.mockImplementationOnce(async()=>new Promise<Response>(resolve=>{finish=resolve;}));
    await vi.waitFor(()=>expect(finish).toBeDefined(),{timeout:1500});
    await r.runtime.disconnect();await r.runtime.connect();
    finish!(new Response(JSON.stringify({...r.state,connected:false})));
    await new Promise(resolve=>setTimeout(resolve,600));
    expect(r.runtime.status().phase).toBe('started');
    expect(r.runtime.journal.read(0,100).events.some(event=>event.type==='minecraft.client.disconnected')).toBe(false);
    await r.runtime.disconnect();
  });
  it('reports bounded message gaps and preserves player sender metadata',async()=>{
    const r=rig();await r.runtime.connect();
    try {
      r.state.messages=[{seq:51,text:'hello',at:new Date().toISOString(),overlay:false,kind:'player',sender:'Other'}] as any;
      await vi.waitFor(()=>expect(r.runtime.journal.read(0,100).events.some(event=>event.type==='minecraft.client.message')).toBe(true),{timeout:1500});
      const events=r.runtime.journal.read(0,100).events;
      expect(events.find(event=>event.type==='minecraft.client.message_gap')?.meta).toMatchObject({missing:50});
      expect(events.find(event=>event.type==='minecraft.client.message')?.meta).toMatchObject({raw:true,kind:'player',sender:'Other'});
    }finally{await r.runtime.disconnect();}
  });
  it('keeps pre-attachment server guides queryable without replaying historical chat events',async()=>{
    const r=rig();r.state.messages=[{seq:1,text:'Server guide: /fixture --help',at:new Date().toISOString(),overlay:false,kind:'system'}] as any;
    await r.runtime.connect();
    try {
      expect(r.runtime.journal.read(0,100).events.some(event=>event.type==='minecraft.client.message')).toBe(false);
      const notices=JSON.parse((await r.runtime.call('mc_notices',{})).text);
      expect(notices).toMatchObject({observationOnly:true,messages:[{text:'Server guide: /fixture --help'}]});
      expect(r.runtime.currentFacts().parts.find(part=>part.key==='notices')?.text).toContain('mc_notices');
    }finally{await r.runtime.disconnect();}
  });
  it('cancels a pending wait without cancelling/replaying the body action',async()=>{
    const r=rig();await r.runtime.connect();const controller=new AbortController();
    try {
      const wait=r.runtime.call('mc_wait',{action_id:'original'}, {requestId:'wait',signal:controller.signal});
      setTimeout(()=>controller.abort(new Error('caller cancelled wait')),25);
      await expect(wait).rejects.toThrow('caller cancelled');
      expect(r.calls.some(call=>['do','cancel','stop'].includes(call.method))).toBe(false);
    } finally {await r.runtime.disconnect();}
  });
  it('uses explicit local credentials, rejects remote endpoints, and preserves names independent of ledger paths',async()=>{
    const r=rig();writeFileSync(r.cfg.javaClient.credentialsFile,JSON.stringify({protocol:'agent-mc-java/v1',endpoint:'http://remote.test:1234',token:'a'.repeat(64),instanceId:'x'}));
    await expect(r.runtime.connect()).rejects.toThrow('nonlocal');expect(r.http).not.toHaveBeenCalled();
    const config=join(directory(),'client.json');writeFileSync(config,JSON.stringify({dataDir:'./stable-ledger',world:{...r.cfg,javaClient:{...r.cfg.javaClient,credentialsFile:'./native/connection.json',ledgerDir:'./stable-ledger'}}}));
    const loaded=loadMinecraftClientConfig(config);expect(loaded.cfg.javaClient?.ledgerDir).toBe(join(config,'..','stable-ledger'));
  });
  it('passes actual provider capabilities and neutral turn/task metadata through MCP',async()=>{
    const r=rig(),server=createMinecraftMcpServer(r.runtime,'test'),client=new Client({name:'java-parity',version:'1'});
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);await r.runtime.connect();
    try {
      const catalogue=await client.listTools();
      expect(catalogue.tools.find(tool=>tool.name==='mc_control')?.annotations?.readOnlyHint).toBe(false);
      expect(catalogue.tools.find(tool=>tool.name==='mc_stop')?._meta?.['agent-mc/v1']).toMatchObject({barrierAfter:true,endsTurn:false});
      const response=await client.callTool({name:'mc_capabilities',arguments:{}});expect(response.isError).not.toBe(true);expect(JSON.parse((response.content as any[])[0].text).realRendering).toBe(true);
      expect(response.structuredContent).toMatchObject({protocol:'agent-mc/v1',control:{turnEnded:false}});
      await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action:'begin_turn',id:'native-turn'}});
      await client.callTool({name:'mc_control',arguments:{action:'claim'}});
      const admitted=await client.callTool({name:'mc_do',arguments:{operation:'move',input:{forward:true,ticks:2},action_id:'mcp-action'},
        _meta:{'agent-mc/v1':{requestId:'mcp-admission',turnId:'native-turn'}}});
      expect(admitted.structuredContent).toMatchObject({execution:{id:'mcp-action',phase:'accepted',terminal:false,goalCompleted:false},control:{turnId:'native-turn',turnEnded:false,barrierAfter:true}});
      await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action:'ack_barrier',id:'mcp-admission'}});
      r.complete();
      const terminal=await client.callTool({name:'mc_wait',arguments:{action_id:'mcp-action',timeoutMs:1000}});
      expect(terminal.structuredContent).toMatchObject({execution:{id:'mcp-action',terminal:true,goalCompleted:false},control:{turnEnded:false}});
      await client.callTool({name:'mc_protocol',arguments:{protocol:'agent-mc/v1',action:'end_turn',id:'native-turn'}});
    } finally {await r.runtime.disconnect();await client.close();await server.close();}
  });
});
