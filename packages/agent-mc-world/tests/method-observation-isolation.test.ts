import {afterEach,expect,it,vi} from 'vitest';
import {methodHarness,methodEnded} from './method-harness.ts';
import {Vec3} from 'vec3';
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
    const result=await r.world.tools().find(t=>t.name==='mc_scout')!.handler({steps:[{skill:'probe',shape:'line',anchors:[[0,65,0],[1,65,0]]}]},{role:'test',log:r.host.log});
    expect(result.failed).not.toBe(true);
    expect((await methodEnded(r,run.id)).status).toBe('cancelled');
    expect(r.keys.forward).toBe(false);
  }finally{release();}
});
