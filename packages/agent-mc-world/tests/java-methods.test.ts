import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JavaMethods, JAVA_METHODS, JAVA_METHOD_PROTOCOL, javaMethodHelp } from '../src/client/java-methods.ts';
const paths:string[]=[];const methods:JavaMethods[]=[];
afterEach(async()=>{for(const m of methods.splice(0))await m.stop('test finished');for(const path of paths.splice(0))rmSync(path,{recursive:true,force:true});});
function rig(){
  const dir=mkdtempSync(join(tmpdir(),'native-method-'));paths.push(dir);
  const cfg={expectedServer:'fixture.test:25565',expectedUuid:'a'.repeat(32),controllerId:'test',ledgerDir:dir,credentialsFile:'unused',leaseMs:1000};
  const events:any[]=[],actions=new Map<string,any>(),calls:any[]=[];let cap=true,hang=false,cleanupFail=false;
  const held=new Set<string>();
  const state:any={protocol:'agent-mc-java/v1',connected:true,generation:1,sampledAt:new Date().toISOString(),server:'fixture.test',position:[0,64,0],health:20,food:20,inventory:[],menuSlots:[],cursor:{empty:true},actions:[],messages:[]};
  const rpc=async(method:string,args:any)=>{
    calls.push({method,args});if(method==='capabilities')return{methodAdapter:cap?JAVA_METHOD_PROTOCOL:null,methodCalls:JAVA_METHODS};
    if(method==='renew')return{};
    if(method==='do'){const a={id:args.action_id,phase:args.operation==='method.run'?'running':'partial',operation:args.operation};actions.set(a.id,a);return a;}
    if(method==='result')return actions.get(args.action_id);
    if(method==='method_read')return{value:args.name==='blockAt'?{name:'carrots',type:1,stateId:2,position:args.args[0],properties:{age:'7'}}:args.args[0]==='entity'?{position:{x:-1,y:64,z:2}}:args.name==='getControlState'?held.has(args.args[0]):null};
    if(method==='method_call'){
      if(args.name==='setControlState'){if(args.args[1])held.add(args.args[0]);else held.delete(args.args[0]);}
      if(args.name==='clearControlStates')held.clear();
      return{status:hang?'running':'completed',value:null};
    }
    if(method==='method_result')return{status:hang?'running':'completed',value:null};
    if(method==='method_finish'||method==='cancel'){if(cleanupFail)throw new Error('response lost');held.clear();const a=actions.get(args.action_id);a.phase=method==='cancel'?'cancelled':'partial';return a;}
    throw new Error('Unexpected '+method);
  };
  const port={rpc,state:async()=>state,owner:()=>({controllerId:'test',nonce:'private'}),host:()=>({pushEvent:async(event:any)=>{events.push(event);},blob:()=>null}) as any};
  const m=new JavaMethods(cfg,port);methods.push(m);
  const call=(args:any)=>m.execute(args,{role:'fixture-agent',callId:'fixture'} as any);
  return{m,cfg,port,call,calls,events,actions,held,state,setCap:(v:boolean)=>cap=v,setHang:(v:boolean)=>hang=v,setCleanupFail:(v:boolean)=>cleanupFail=v};
}
async function finished(r:ReturnType<typeof rig>,id:number){await vi.waitFor(()=>expect(r.m.runner.read(id)[0].status).not.toBe('running'));await vi.waitFor(()=>expect(r.events.some(e=>e.execution.evidence.localId===id)).toBe(true));return r.m.runner.read(id)[0];}
it('executes unchanged JS in the actual shared worker, revives Vec3 and Block.getProperties and serializes native body calls',async()=>{
  const r=rig();const result=await r.call({name:'old-farm-method',code:'const p=(await bot.read("entity")).position; const b=await bot.blockAt(p.offset(1,-1,0)); await bot.setControlState("forward",true); await bot.waitForTicks(3); const held=await bot.getControlState("forward"); await bot.clearControlStates(); return {age:b.getProperties().age,position:b.position.offset(0,1,0),held};'});
  const run=await finished(r,JSON.parse(result.text).id);expect(run.status).toBe('completed');expect(run.result).toEqual({age:'7',position:{x:0,y:64,z:2},held:true});
  expect(r.calls.filter(c=>c.method==='do')).toHaveLength(1);expect(r.calls.filter(c=>c.method==='method_call').map(c=>c.args.call)).toEqual([1,2,3]);
  expect(r.calls.some(c=>c.args.operation==='minescript.run'||c.method==='claim')).toBe(false);expect(r.held.size).toBe(0);expect(r.events.at(-1).execution).toMatchObject({phase:'completed',terminal:true,goalCompleted:false});
});
it('validates and saves immutable methods offline, reopens the same scoped library and executes a chosen original version',async()=>{
  const r=rig();r.setCap(false);const code='return (await bot.read("entity")).position.x;';
  const started=await r.call({name:'coordinate-check',code,validate:true});const run=await finished(r,JSON.parse(started.text).id);expect(run.status).toBe('validated');expect(r.calls).toHaveLength(0);
  const saved=JSON.parse((await r.call({library:{op:'save',id:'coordinate-check',code,description:'Read current position',conditions:['Connected native client'],parent:null,validationRunId:run.id}})).text);
  const reopened=new JavaMethods(r.cfg,r.port);methods.push(reopened);const read=await reopened.execute({library:{op:'read',id:'coordinate-check'}},{role:'fixture'} as any);expect(JSON.parse(read.text).code).toBe(code);
  r.setCap(true);const executed=await r.call({procedure:saved.reference});expect((await finished(r,JSON.parse(executed.text).id)).result).toBe(-1);
  const isolated=new JavaMethods({...r.cfg,expectedUuid:'b'.repeat(32)},r.port);methods.push(isolated);expect(JSON.parse((await isolated.execute({library:{op:'list'}},{role:'fixture'} as any)).text).methods).toEqual([]);
});
it('refuses an old bridge before execution instead of translating JavaScript to guessed Python',async()=>{
  const r=rig();r.setCap(false);await expect(r.call({name:'old',code:'await bot.look(0,0);'})).rejects.toThrow('lacks agent-mc-method/v1');expect(r.calls.some(c=>['do','method_call','method_read'].includes(c.method))).toBe(false);
});
it('cancels only its original pending native action and blocks new body commands until cleanup is confirmed',async()=>{
  const r=rig();r.setHang(true);r.setCleanupFail(true);await r.call({name:'move',code:'await bot.setControlState("forward",true); await bot.waitForTicks(200);'});
  await vi.waitFor(()=>expect(r.held.has('forward')).toBe(true));expect(()=>r.m.guard()).toThrow();await r.m.stop('operator');expect(()=>r.m.guard()).toThrow();
  expect(r.calls.filter(c=>c.method==='cancel')).toHaveLength(1);expect(r.calls.some(c=>c.method==='stop')).toBe(false);expect(r.events.at(-1).execution).toMatchObject({phase:'blocked',terminal:false});
  await expect(r.call({name:'again',code:'return 1;'})).rejects.toThrow('Cleanup unknown');
  r.setCleanupFail(false);const original=r.calls.find(c=>c.method==='do').args.action_id;await r.port.rpc('cancel',{action_id:original});await r.call({runId:1});expect(r.m.busy).toBe(false);expect(r.held.size).toBe(0);
});
it('rejects unsupported mc.do groups before any native dispatch and returns partial dispatch as unfinished',async()=>{
  const r=rig();const a=await r.call({name:'group',code:'return await mc.do([{skill:"chat",text:"hi"},{skill:"mine",block:"stone"}]);'});
  const rejected=await finished(r,JSON.parse(a.text).id);expect(rejected.result).toMatchObject({accepted:false,done:false,kind:'rejected'});expect(r.calls.some(c=>c.method==='do')).toBe(false);
  const b=await r.call({name:'single',code:'return await mc.do([{skill:"chat",text:"hi"}]);'});const run=await finished(r,JSON.parse(b.text).id);expect(run.result).toMatchObject({accepted:true,done:false,steps:[{outcome:'partial'}]});
});
it('revokes a method on generation change before the next observation or body action',async()=>{
  const r=rig();r.setHang(true);await r.call({name:'moving',code:'await bot.waitForTicks(1);return await bot.read("entity");'});await vi.waitFor(()=>expect(r.calls.some(c=>c.method==='method_call')).toBe(true));r.state.generation++;r.setHang(false);
  const run=await finished(r,1);expect(run.status).toBe('failed');expect(run.error).toContain('connection changed');expect(r.calls.some(c=>c.method==='method_read')).toBe(false);expect(r.calls.some(c=>c.method==='cancel')).toBe(true);
});
it('reconciles already cancelled native work after lease loss without reacquiring control',async()=>{
  const r=rig();r.setHang(true);r.setCleanupFail(true);await r.call({name:'lease-loss',code:'await bot.waitForTicks(200);'});
  await vi.waitFor(()=>expect(r.actions.size).toBe(1));const action=[...r.actions.values()][0];action.phase='cancelled';await r.m.stop('lease expired');expect(r.m.busy).toBe(false);
  expect(r.calls.some(c=>c.method==='claim')).toBe(false);expect(r.events.at(-1).execution.terminal).toBe(true);
});
it('reports supported signatures and gaps explicitly',()=>{expect(javaMethodHelp('movement')).toContain('RADIANS');expect(javaMethodHelp('inventory')).toContain('36..44');expect(javaMethodHelp('compatibility')).toContain('placeBlock');expect(()=>javaMethodHelp('pathfinder')).toThrow('unavailable');});
