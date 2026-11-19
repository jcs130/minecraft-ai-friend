import {afterEach,expect,it,vi} from 'vitest';
import {methodHarness,methodEnded} from './method-harness.ts';
import {Vec3} from 'vec3';
import {inspectToolCall, toolRequiresBodyControl} from '../src/contracts/index.ts';
import * as travel from '../core/travel.ts';
const rigs:ReturnType<typeof methodHarness>[]=[];
afterEach(()=>rigs.splice(0).forEach(r=>r.close()));
it.each(['1.20.6','1.21.1'])('returns detached entity/player observations without claiming a body in %s',async version=>{
  const r=methodHarness(version);rigs.push(r);
  Object.assign(r.bot.entities,{'8':{id:8,name:'zombie',position:new Vec3(2,64,2),velocity:new Vec3(0,0,0),_client:{private:true}}});
  Object.assign(r.bot.players,{Alice:{username:'Alice',uuid:'alice-id',entity:{id:9},client:{private:true}}});
  const run=r.runner.start({code:'const s=await bot.read("entitySnapshot"); return {s,entities:await bot.read("entities"),players:await bot.read("players"),frozen:Object.isFrozen(s.entities)};'});
  const end=await methodEnded(r,run.id);expect(end.status).toBe('completed');
  const value=end.result as any;
  expect(value.s).toMatchObject({sampledAt:expect.any(String),entities:{8:{name:'zombie',position:{x:2,y:64,z:2}}},players:{Alice:{uuid:'alice-id',entityId:9}}});
  expect(value.frozen).toBe(true);expect(JSON.stringify(value)).not.toContain('private');
  expect(r.exec.currentTask).toBeNull();
  r.bot.entities[8].position.x=20;expect(value.s.entities[8].position.x).toBe(2);
});
it.each(['return 1;','return (await bot.read("entity")).id;'])('does not cancel a non-body method when probe is admitted (%s)',async code=>{
  const r=methodHarness();rigs.push(r);
  const run=r.runner.start({code});
  const result=await r.world.tools().find(t=>t.name==='mc_scout')!.handler({steps:[{skill:'probe',shape:'line',anchors:[[0,65,0],[1,65,0]]}]},{role:'test',log:r.host.log});
  expect(result.failed).not.toBe(true);
  expect((await methodEnded(r,run.id)).status).toBe('completed');
});
it('still revokes a method holding native body input when a new body task is admitted',async()=>{
  const r=methodHarness();rigs.push(r);
  let release!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  Object.assign(r.bot,{waitForTicks:()=>waiting});
  try {
    const run=r.runner.start({code:'await bot.setControlState("forward",true); await bot.waitForTicks(200);'});
    await vi.waitFor(()=>expect(r.keys.forward).toBe(true));
    const result=await r.world.tools().find(t=>t.name==='mc_do')!.handler({queue:'replace',steps:[{skill:'probe',shape:'line',anchors:[[0,65,0],[1,65,0]]}]},{role:'test',log:r.host.log});
    expect(result.failed).not.toBe(true);
    expect((await methodEnded(r,run.id)).status).toBe('cancelled');
    expect(r.keys.forward).toBe(false);
  }finally{release();}
});

it('appends a scout behind a method holding native input', async () => {
  const r=methodHarness(); rigs.push(r);
  let release!: () => void;
  Object.assign(r.bot,{waitForTicks:()=>new Promise<void>(resolve=>{release=resolve;})});
  const move=r.runner.start({code:'await bot.setControlState("forward",true); await bot.waitForTicks(200);'});
  try {
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    const navigation=vi.spyOn(r.bot.pathfinder,'setGoal');
    const scout=r.world.tools().find(tool=>tool.name==='mc_scout')!;
    const args={steps:[{skill:'observe',mode:'sites',sites:[[1,64,1]]}]};
    const result=await scout.handler(args,{role:'task_worker',log:r.host.log});
    expect(result).toMatchObject({execution:{phase:'accepted'}});
    expect(r.exec.status().waiting).toHaveLength(1);
    expect(r.runner.read(move.id)[0].status).toBe('running');
    expect(r.keys.forward).toBe(true);
    expect(navigation).not.toHaveBeenCalled();
  } finally { release?.(); await methodEnded(r,move.id); }
});

it('leaves another controller’s path, input and window intact when a scout runs alone',async()=>{
  const r=methodHarness(); rigs.push(r);
  const externalPath={name:'external route'};
  Object.assign(r.bot.pathfinder,{goal:externalPath});
  r.bot.setControlState('forward',true);
  const navigation=vi.spyOn(r.bot.pathfinder,'setGoal');
  const waterControl=vi.spyOn(travel,'holdTreadWater');
  const window={...r.bot.inventory,id:1,type:'minecraft:chest',inventoryStart:9,inventoryEnd:45};
  const closeWindow=vi.fn();
  Object.assign(r.bot,{currentWindow:window,closeWindow});
  const world=r.world as unknown as {closeStrayWindow():void};
  Object.assign((r.exec as unknown as {opts:object}).opts,{onDrain:()=>world.closeStrayWindow()});
  const scout=r.world.tools().find(t=>t.name==='mc_scout')!;
  const result=await scout.handler({steps:[{skill:'probe',shape:'line',anchors:[[0,64,0],[1,64,0]]}]},{role:'task_worker',log:r.host.log});
  expect(result).toMatchObject({execution:{phase:'accepted'}});
  await vi.waitFor(()=>expect(r.exec.status().running).toBeNull());
  expect(r.bot.pathfinder.goal).toBe(externalPath);
  expect(r.keys.forward).toBe(true);
  expect(navigation).not.toHaveBeenCalled();
  expect(waterControl).not.toHaveBeenCalled();
  expect(closeWindow).not.toHaveBeenCalled();
  waterControl.mockRestore();
});

it('queues observation behind existing work and reserves queue edits for the action tool',async()=>{
  const r=methodHarness(); rigs.push(r);
  const ctx={role:'task_worker',log:r.host.log};
  const scout=r.world.tools().find(t=>t.name==='mc_scout')!;
  const action=r.world.tools().find(t=>t.name==='mc_do')!;
  const steps=[{skill:'observe',mode:'sites',sites:[[1,64,1]]}];
  let finish!:()=>void;
  const wait=new Promise<void>(resolve=>{finish=resolve;});
  const running=r.exec.enqueueProgram({name:'fixture-owner',run:()=>wait,cancel:finish});
  try {
    await action.handler({queue:'append',steps:[{skill:'chat',text:'queued'}]},ctx);
    const status=()=>({running:r.exec.status().running?.id,waiting:r.exec.status().waiting.map(w=>w.id)});
    const before=status();
    expect(before.running).toBe(running);
    expect(before.waiting).toHaveLength(1);
    expect(toolRequiresBodyControl(scout)).toBe(false);
    for (const queue of ['replace','now','afterCheckpoint']) {
      expect(inspectToolCall(scout,scout.name,{steps,queue})).toMatchObject({valid:false,dispatched:false});
      expect(await scout.handler({steps,queue},ctx)).toMatchObject({failed:true,data:{executed:false},meta:{admission:{accepted:false}}});
      expect(status()).toEqual(before);
    }
    for (const args of [{steps},{steps:[{skill:'observe',mode:'sites',sites:[[2,64,2]]}],queue:'append'}]) {
      expect(inspectToolCall(scout,scout.name,args)).toMatchObject({valid:true,readOnly:true,requiresBody:false});
      expect(await scout.handler(args,ctx)).toMatchObject({execution:{phase:'accepted'}});
    }
    expect(status().waiting).toHaveLength(3);
    expect(status().waiting[0]).toBe(before.waiting[0]);
    expect(await action.handler({queue:'replace',steps:[{skill:'chat',text:'replacement'}]},ctx)).toMatchObject({execution:{phase:'accepted'}});
    expect(status().running).toBe(running);
    expect(status().waiting).toHaveLength(1);
    expect(status().waiting[0]).not.toBe(before.waiting[0]);
  } finally { finish(); }
});
