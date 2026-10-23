import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JavaMethods, JAVA_METHODS, JAVA_METHOD_REQUIRED, JAVA_METHOD_PROTOCOL, JAVA_METHOD_FIELDS, javaMethodHelp, javaMethodCapabilities } from '../src/client/java-methods.ts';
import { methodHarness, methodEnded } from './method-harness.ts';
import { portableMethod } from '../examples/portable-method.mjs';
const paths:string[]=[];const methods:JavaMethods[]=[];
afterEach(async()=>{for(const m of methods.splice(0))await m.stop('test finished');for(const path of paths.splice(0))rmSync(path,{recursive:true,force:true});});
function rig(){
  const dir=mkdtempSync(join(tmpdir(),'native-method-'));paths.push(dir);
  const cfg={expectedServer:'fixture.test:25565',expectedUuid:'a'.repeat(32),controllerId:'test',ledgerDir:dir,credentialsFile:'unused',leaseMs:1000,methodWaitMs:0};
  const events:any[]=[],actions=new Map<string,any>(),calls:any[]=[],readAttempts:any[]=[];let cap=true,hang=false,cleanupFail=false,advertised=JAVA_METHODS,stateReads=0;
  const held=new Set<string>();
  const state:any={protocol:'agent-mc-java/v1',connected:true,generation:1,sampledAt:new Date().toISOString(),server:'fixture.test',position:[0,64,0],health:20,food:20,inventory:[],menuSlots:[],cursor:{empty:true},actions:[],messages:[]};
  const rpc=async(method:string,args:any)=>{
    // The real bridge checks expectedGeneration before evaluating MethodSession.read.
    if(method==='method_read'){readAttempts.push(args);if(args.expectedGeneration!==state.generation)throw new Error('Method connection changed before dispatch');}
    calls.push({method,args});if(method==='capabilities')return{methodAdapter:cap?JAVA_METHOD_PROTOCOL:null,methodCalls:advertised};
    if(method==='renew')return{};
    if(method==='do'){const a={id:args.action_id,phase:args.operation==='method.run'?'running':'partial',operation:args.operation};actions.set(a.id,a);return a;}
    if(method==='result')return actions.get(args.action_id);
    if(method==='method_read')return{generation:state.generation,value:args.name==='blockAt'||args.name==='findBlock'?{name:'carrots',type:1,stateId:2,position:args.name==='findBlock'?{x:0,y:63,z:2}:args.args[0],properties:{age:'7'}}:args.name==='findBlocks'?[{x:0,y:63,z:2}]:args.args[0]==='entity'?{position:{x:-1,y:64,z:2}}:args.name==='getControlState'?held.has(args.args[0]):null};
    if(method==='method_call'){
      if(args.name==='setControlState'){if(args.args[1])held.add(args.args[0]);else held.delete(args.args[0]);}
      if(args.name==='clearControlStates')held.clear();
      return{status:hang?'running':'completed',value:null};
    }
    if(method==='method_result')return{status:hang?'running':'completed',value:null};
    if(method==='method_finish'||method==='cancel'){if(cleanupFail)throw new Error('response lost');held.clear();const a=actions.get(args.action_id);a.phase=method==='cancel'?'cancelled':'partial';return a;}
    throw new Error('Unexpected '+method);
  };
  const port={rpc,state:async()=>{stateReads++;return state;},owner:()=>({controllerId:'test',nonce:'private'}),host:()=>({pushEvent:async(event:any)=>{events.push(event);},blob:()=>null}) as any};
  const m=new JavaMethods(cfg,port);methods.push(m);
  const call=(args:any)=>m.execute(args,{role:'fixture-agent',callId:'fixture'} as any);
  return{m,cfg,port,call,calls,readAttempts,events,actions,held,state,get stateReads(){return stateReads;},setCap:(v:boolean)=>cap=v,setAdvertised:(v:string[])=>advertised=v,setHang:(v:boolean)=>hang=v,setCleanupFail:(v:boolean)=>cleanupFail=v};
}
// Native and Mineflayer methods both start a real SES worker. Preserve the
// upstream bounded completion window while retaining short-reply coverage.
async function finished(r:ReturnType<typeof rig>,id:number){await vi.waitFor(()=>expect(r.m.runner.read(id)[0].status).not.toBe('running'),{timeout:5000});await vi.waitFor(()=>expect(r.events.some(e=>e.execution.evidence.localId===id)).toBe(true),{timeout:5000});return r.m.runner.read(id)[0];}
it('folds a short native program and its confirmed cleanup into the default tool reply',async()=>{
  const r=rig();Reflect.deleteProperty(r.cfg,'methodWaitMs');
  const reply=await r.call({name:'one-read',code:'return (await bot.read("entity.position")).x;'});
  expect(JSON.parse(reply.text)).toMatchObject({status:'completed',result:-1,cleanupPending:false,cleanupUnknown:false,raw:{sha256:expect.any(String)}});
  expect(reply.execution).toMatchObject({kind:'method',phase:'completed',terminal:true,goalCompleted:false});
  expect(r.stateReads).toBe(1);expect(r.calls.filter(c=>c.method==='method_read')).toHaveLength(1);
  expect(r.calls.some(c=>['do','claim','method_call'].includes(c.method))).toBe(false);
});
it('the shared find recipe uses native registry observations and one bounded search without claiming the body',async()=>{
  const r=rig(),original=r.port.rpc;
  r.port.rpc=async(method:string,args:any)=>method==='method_read'&&args.name==='read'&&args.args[0]==='registry.blocksByName.water'
    ?{generation:1,value:{id:17,name:'water'}}:original(method,args);
  const reply=await r.call({language:'javascript',find:{names:['water'],maxDistance:8,count:3},waitMs:2000});
  expect(reply.failed).not.toBe(true);expect(JSON.parse(reply.text)).toMatchObject({status:'completed',result:{positions:[{x:0,y:63,z:2}],observedOnly:true,goalCompleted:false}});
  expect(r.m.runner.read(1)[0].trace).toHaveLength(2);
  expect(r.calls.some(c=>['do','method_call','claim'].includes(c.method))).toBe(false);
});
it('native find advertises its actual radius and rejects an excessive radius before worker or registry calls',async()=>{
  const r=rig();
  expect(JAVA_METHOD_FIELDS.find.properties.maxDistance.maximum).toBe(16);
  await expect(r.call({language:'javascript',find:{names:['water'],maxDistance:17}})).rejects.toThrow(/1\.\.16/);
  expect(r.calls).toEqual([]);expect(r.stateReads).toBe(0);expect(r.m.runner.read()).toEqual([]);
});
it('waits for owned body cleanup before returning a terminal and never claims goal completion',async()=>{
  const r=rig();const reply=await r.call({name:'bounded-input',code:'await bot.setControlState("forward",true);return {held:true};',waitMs:2000});
  expect(reply.execution).toMatchObject({phase:'completed',terminal:true,goalCompleted:false});expect(r.held.size).toBe(0);
  expect(r.calls.filter(c=>c.method==='method_finish')).toHaveLength(1);expect(JSON.parse(reply.text).cleanupPending).toBe(false);
});
it('an expired tool wait preserves the original running program for one later long-poll',async()=>{
  const r=rig();r.setHang(true);
  const first=await r.call({name:'longer',code:'await bot.look(0,0);return {observed:true};',waitMs:1});
  const id=JSON.parse(first.text).id;expect(first.execution).toMatchObject({phase:'accepted',terminal:false});
  expect(r.m.runner.current?.id).toBe(id);expect(r.calls.some(c=>c.method==='cancel')).toBe(false);
  r.setHang(false);const final=await r.call({runId:id,waitMs:2000});
  expect(JSON.parse(final.text)).toMatchObject({id,status:'completed',cleanupPending:false,cleanupUnknown:false});
  expect(r.calls.filter(c=>c.method==='do')).toHaveLength(1);
});
it('unknown cleanup never becomes a successful terminal merely because the program returned',async()=>{
  const r=rig();r.setCleanupFail(true);
  const reply=await r.call({name:'cleanup-unknown',code:'await bot.look(0,0);return {ended:true};',waitMs:2000});
  expect(JSON.parse(reply.text)).toMatchObject({status:'completed',cleanupUnknown:true});
  expect(reply.execution).toMatchObject({phase:'blocked',terminal:false,goalCompleted:false});
  await expect(r.call({name:'no-replay',code:'await bot.look(0,0);'})).rejects.toThrow(/Cleanup unknown/);
});
it('rejects mismatched read generations and retains the guarded fallback for old read replies',async()=>{
  const modern=rig(),rpc=modern.port.rpc;
  modern.port.rpc=async(method:string,args:any)=>method==='method_read'?{generation:2,value:999}:rpc(method,args);
  const rejected=await modern.call({name:'wrong-generation',code:'return await bot.read("health");',waitMs:2000});
  expect(rejected.failed).toBe(true);expect(JSON.parse(rejected.text).error).toMatch(/connection changed/);
  const legacy=rig(),original=legacy.port.rpc;
  legacy.port.rpc=async(method:string,args:any)=>{const result=await original(method,args);if(method==='method_read')delete result.generation;return result;};
  const accepted=await legacy.call({name:'legacy-read',code:'return (await bot.read("entity")).position.x;',waitMs:2000});
  expect(JSON.parse(accepted.text)).toMatchObject({status:'completed',result:-1});expect(legacy.stateReads).toBe(2);
});
it.each([-1,30001,1.5,'1000'])('invalid wait %s cannot start a program or contact the client',async waitMs=>{
  const r=rig();await expect(r.call({name:'invalid-wait',code:'await bot.look(0,0);',waitMs})).rejects.toThrow(/waitMs/);
  expect(r.calls).toEqual([]);expect(r.m.runner.current).toBeNull();
});
it('cancelling a wait returns the original accepted identity without cancelling or replaying body work',async()=>{
  const r=rig();r.setHang(true);const abort=new AbortController();
  const pending=r.m.execute({name:'cancel-wait',code:'await bot.look(0,0);',waitMs:30000},{role:'fixture-agent',callId:'fixture',signal:abort.signal} as any);
  await vi.waitFor(()=>expect(r.calls.some(c=>c.method==='method_call')).toBe(true),{timeout:4000});abort.abort(new Error('Only the waiter ended'));
  const result=await pending,id=JSON.parse(result.text).id;
  expect(JSON.parse(result.text)).toMatchObject({waitingCancelled:true,status:'running'});
  expect(result.execution).toMatchObject({kind:'method',terminal:false,id:expect.stringMatching(new RegExp(':'+id+'$'))});
  expect(r.m.runner.current?.id).toBe(id);expect(r.calls.some(c=>c.method==='cancel')).toBe(false);
  await r.call({stop:true});expect(r.held.size).toBe(0);
});
it('projects the same nested public reads through one root RPC and preserves Vec3/unknown values',async()=>{
  const r=rig();const result=await r.call({name:'nested-read',code:'const p=await bot.read("entity.position");return {p:p.offset(1,0,0),x:await bot.read("entity.position.x"),unknown:await bot.read("entity.velocity.x"),emptyHand:await bot.read("heldItem.name")};'});
  expect(await finished(r,JSON.parse(result.text).id)).toMatchObject({status:'completed',result:{p:{x:0,y:64,z:2},x:-1,unknown:null,emptyHand:null}});
  expect(r.calls.filter(c=>c.method==='method_read').map(c=>c.args.args)).toEqual([['entity'],['entity'],['entity'],['heldItem']]);
  expect(r.calls.some(c=>['do','method_call'].includes(c.method))).toBe(false);
});
it('runs exactly the same capability-aware Mineflayer program on both bodies, without source rewriting',async()=>{
  const native=rig(),headless=methodHarness();
  try {
    const before=native.calls.length;
    const inspected=await native.call({name:'portable-read',code:portableMethod});
    expect(await finished(native,JSON.parse(inspected.text).id)).toMatchObject({status:'completed',result:{ready:true,position:{x:-1,y:64,z:2},health:null,goalCompleted:false}});
    expect(native.calls.slice(before).some(c=>['do','method_call','claim'].includes(c.method))).toBe(false);
    const a=await native.call({name:'portable-look',code:portableMethod,params:{look:{yaw:.25,pitch:0}}});
    const b=headless.runner.start({name:'portable-look',code:portableMethod,params:{look:{yaw:.25,pitch:0}}});
    const [nativeRun,mineflayerRun]=await Promise.all([finished(native,JSON.parse(a.text).id),methodEnded(headless,b.id)]);
    expect(nativeRun.sourceHash).toBe(mineflayerRun.sourceHash);
    for(const run of [nativeRun,mineflayerRun]){
      expect(run).toMatchObject({status:'completed',result:{ready:true,goalCompleted:false}});
      expect(run.trace.map(t=>t.method==='mineflayer'?(t.args as any).name:t.method)).toEqual(['capabilities','read','look','read']);
    }
    expect(native.calls.filter(c=>c.method==='method_call').map(c=>c.args.name)).toEqual(['look']);
  } finally {headless.close();}
});
it('uses actual advertised methods for portable preflight and never treats a future or absent method as supported',async()=>{
  const r=rig();r.setAdvertised([...JAVA_METHOD_REQUIRED,'dig','unknown.future.method','nonce:private']);
  const a=await r.call({name:'capability-check',code:'const caps=await mc.capabilities(); if(!caps.botMethods.includes("pathfinder.goto")) return {missing:"pathfinder.goto",caps}; await bot.pathfinder.goto(new goals.GoalBlock(1,64,0));'});
  const run=await finished(r,JSON.parse(a.text).id);
  expect(run).toMatchObject({status:'completed',result:{missing:'pathfinder.goto',caps:{backend:'java-client',contract:'minecraft-method/v1',pluginLoading:false,stepGroups:'single-legacy'}}});
  const caps=(run.result as any).caps;
  expect(caps.botMethods).not.toContain('dig');expect(caps.botMethods).not.toContain('pathfinder.goto');
  expect(JSON.stringify(caps)).not.toContain('private');
  expect(r.calls.some(c=>['do','method_call','method_read','claim','renew'].includes(c.method))).toBe(false);
  expect(javaMethodCapabilities({methodCalls:JAVA_METHODS,nonce:'private'}).botMethods).toEqual([]);
  expect(javaMethodCapabilities({methodAdapter:JAVA_METHOD_PROTOCOL,methodCalls:['look','read','look']}).botMethods).toEqual([]);
  expect(javaMethodCapabilities({methodAdapter:JAVA_METHOD_PROTOCOL,methodCalls:[...JAVA_METHOD_REQUIRED].reverse().concat('read')})).toMatchObject({botMethods:JAVA_METHOD_REQUIRED});
});
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
it('keeps baseline v1 programs usable and refuses unadvertised optional methods before dispatch',async()=>{
  const r=rig();r.setAdvertised(JAVA_METHOD_REQUIRED);
  const started=await r.call({name:'baseline',code:'return (await bot.read("entity")).position;'});
  expect((await finished(r,JSON.parse(started.text).id)).status).toBe('completed');
  for(const code of ['return await bot.findBlock({matching:1});','await bot.setQuickBarSlot(3);','await bot.pathfinder.goto(new goals.GoalBlock(1,64,0));']){
    const before=r.calls.length;
    const attempt=await r.call({name:'optional',code});
    const run=await finished(r,JSON.parse(attempt.text).id);
    expect(run.status).toBe('failed');expect(run.error).toContain('does not advertise');
    expect(r.calls.slice(before).some(c=>['do','method_call','method_read'].includes(c.method))).toBe(false);
  }
});
it('reuses unchanged findBlock(s) and hotbar calls in the shared worker with native read/body routing',async()=>{
  const r=rig();
  const code='const positions=await bot.findBlocks({matching:[1],maxDistance:4,count:2}); const nearest=await bot.findBlock({point:positions[0].offset(0,1,0),matching:1}); await bot.setQuickBarSlot(3); return {pos:nearest.position,age:nearest.getProperties().age};';
  const started=await r.call({name:'find-and-select',code});
  expect(await finished(r,JSON.parse(started.text).id)).toMatchObject({status:'completed',result:{pos:{x:0,y:63,z:2},age:'7'}});
  expect(r.calls.filter(c=>c.method==='method_read').map(c=>c.args.name)).toEqual(['findBlocks','findBlock']);
  expect(r.calls.filter(c=>c.method==='method_call').map(c=>[c.args.name,c.args.args])).toEqual([['setQuickBarSlot',[3]]]);
  expect(r.calls.filter(c=>c.method==='do')).toHaveLength(1);
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
  const run=await finished(r,1);expect(run.status).toBe('failed');expect(run.error).toContain('connection changed');expect(r.calls.some(c=>c.method==='method_read')).toBe(false);expect(r.readAttempts).toMatchObject([{expectedGeneration:1}]);expect(r.calls.some(c=>c.method==='cancel')).toBe(true);
});
it('reconciles already cancelled native work after lease loss without reacquiring control',async()=>{
  const r=rig();r.setHang(true);r.setCleanupFail(true);await r.call({name:'lease-loss',code:'await bot.waitForTicks(200);'});
  await vi.waitFor(()=>expect(r.actions.size).toBe(1));const action=[...r.actions.values()][0];action.phase='cancelled';await r.m.stop('lease expired');expect(r.m.busy).toBe(false);
  expect(r.calls.some(c=>c.method==='claim')).toBe(false);expect(r.events.at(-1).execution.terminal).toBe(true);
});
it('reports supported signatures and gaps explicitly',()=>{expect(javaMethodHelp('movement')).toContain('RADIANS');expect(javaMethodHelp('inventory')).toContain('36..44');expect(javaMethodHelp('compatibility')).toContain('placeBlock');expect(javaMethodHelp('pathfinder')).toContain('measured feet');});
it('awaits one native navigation call and retains actual arrival evidence in the shared script trace',async()=>{
  const r=rig(),original=r.port.rpc;let arrived=false;
  r.port.rpc=async(method,args)=>{
    if(method==='method_call'&&args.name==='pathfinder.goto'){expect(args.args).toEqual([{x:-1,y:64,z:2,rangeSq:1}]);return{status:'running'};}
    if(method==='method_result')return arrived?{status:'completed',value:null,navigation:{phase:'completed',goal:{x:-1,y:64,z:2,range:1},feet:[-.5,64,2.5],onGround:true,cleanupPending:false}}:{status:'running'};
    return original(method,args);
  };
  const start=await r.call({name:'walk',code:'await bot.pathfinder.goto(new goals.GoalNear(-.1,64.5,2.9,1));return (await bot.read("entity.position")).x;'});
  const id=JSON.parse(start.text).id;await vi.waitFor(()=>expect(r.calls.some(c=>c.method==='do')).toBe(true));expect(r.m.runner.read(id)[0].status).toBe('running');
  arrived=true;const run=await finished(r,id);expect(run.status).toBe('completed');expect(run.trace[0].result).toMatchObject({navigation:{phase:'completed',feet:[-.5,64,2.5],cleanupPending:false}});
  expect(r.calls.filter(c=>c.method==='do')).toHaveLength(1);expect(run.trace.map(t=>t.method)).toHaveLength(2);
});
it('does not reserve a body for invalid navigation and cancels the original action on a rejected route',async()=>{
  const r=rig();const invalid=await r.call({name:'bad-goal',code:'await bot.pathfinder.goto({x:0,y:64,z:0,rangeSq:2});'});
  expect(await finished(r,JSON.parse(invalid.text).id)).toMatchObject({status:'failed'});expect(r.calls.some(c=>c.method==='do')).toBe(false);
  const original=r.port.rpc;r.port.rpc=async(method,args)=>method==='method_call'?{status:'failed',error:'No measured progress for5s; feet=(0,64,0)'}:original(method,args);
  const attempt=await r.call({name:'blocked-walk',code:'await bot.pathfinder.goto(new goals.GoalBlock(3,64,0));'});
  expect(await finished(r,JSON.parse(attempt.text).id)).toMatchObject({status:'failed',error:expect.stringContaining('No measured progress')});
  expect(r.calls.filter(c=>c.method==='cancel')).toHaveLength(1);expect(r.calls.some(c=>c.method==='stop')).toBe(false);
});
it('awaits storage equip through the unchanged shared program and retains server evidence outside the script return',async()=>{
  const r=rig(),original=r.port.rpc,seed={slot:30,name:'wheat_seeds',type:5,count:23,instanceHash:'a'.repeat(64)};
  let response=false,dispatches=0;
  r.port.rpc=async(method,args)=>{
    if(method==='method_read'&&args.name==='inventory.items')return{value:[seed]};
    if(method==='method_read'&&args.args[0]==='heldItem')return{value:response?{...seed,slot:40}:null};
    if(method==='method_call'&&args.name==='equip'){dispatches++;expect(args.args).toEqual([seed,'hand']);return{status:'running'};}
    if(method==='method_result')return response?{status:'completed',value:null,inventoryTransfer:{phase:'completed',sourceSlot:30,selectedSlot:4,matched:true,confirmation:'server-slot-and-selection-packets'}}:{status:'running'};
    return original(method,args);
  };
  const start=await r.call({name:'equip-seeds',code:'const item=(await bot.inventory.items()).find(i=>i.name==="wheat_seeds"); await bot.equip(item,"hand"); return await bot.read("heldItem");'});
  const id=JSON.parse(start.text).id;await vi.waitFor(()=>expect(dispatches).toBe(1));
  expect(r.m.runner.read(id)[0].status).toBe('running');response=true;
  const run=await finished(r,id);expect(run).toMatchObject({status:'completed',result:{name:'wheat_seeds',count:23,slot:40}});
  expect(run.trace[1].result).toMatchObject({inventoryTransfer:{phase:'completed',matched:true,confirmation:'server-slot-and-selection-packets'}});
  expect(dispatches).toBe(1);
});
