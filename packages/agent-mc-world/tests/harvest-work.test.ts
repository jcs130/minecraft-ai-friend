import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { skillHarvest } from '../core/skills-harvest.ts';
import { SkillBlocked, type SkillContext } from '../core/skill-context.ts';
import { parseSteps } from '../core/skills.ts';
import { freezeFirstStep } from '../core/executor.ts';

const calls = vi.hoisted(() => ({ collect: vi.fn(), use: vi.fn(), release: vi.fn() }));
vi.mock('../core/skills-gather.ts', async original => ({...await original<any>(),skillCollect:calls.collect}));
vi.mock('../core/skills-interact.ts', async original => ({...await original<any>(),skillUse:calls.use}));
vi.mock('../core/travel.ts', async original => ({...await original<any>(),walkOnlyPath:() => calls.release}));
const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.20.6');
const Block = req('prismarine-block')(registry);

function rig() {
  let aborted = false, seeds = 2;
  const cells = new Map<string, any>();
  const set = (x:number,y:number,z:number,name:string,properties:Record<string,unknown> = {}) => {
    const block = Block.fromProperties(registry.blocksByName[name].id,properties);
    block.position = new Vec3(x,y,z);cells.set(`${x},${y},${z}`,block);
  };
  set(1,64,0,'wheat',{age:7}); set(1,63,0,'farmland');
  const bot = {registry,entity:{position:new Vec3(0.5,64,0.5)},
    inventory:{items:() => seeds ? [{name:'wheat_seeds',count:seeds}] : []},
    // Real Mineflayer blockAt calls Vec3.floored; plain coordinate objects are not accepted.
    blockAt:(at:Vec3) => {const cell=at.floored();return cells.get(`${cell.x},${cell.y},${cell.z}`) ?? null;}} as unknown as Bot;
  const ctx = {aborted:()=>aborted} as SkillContext;
  calls.collect.mockImplementation(async()=>{set(1,64,0,'air');return '实际小麦入包1';});
  calls.use.mockImplementation(async()=>{set(1,64,0,'wheat',{age:0});seeds--;return '种子消耗1';});
  const call = {skill:'harvest' as const,block:'wheat',at:[1,64,0] as [number,number,number],replant:true};
  return {bot,ctx,call,set,noSeeds:()=>{seeds=0;},abort:()=>{aborted=true;}};
}
beforeEach(()=>vi.clearAllMocks());

describe('single executor harvest transaction',()=>{
  it('reserves a seed before touching the crop and passes only the frozen exact cell to collection',async()=>{
    const r=rig();
    await expect(skillHarvest(r.bot,r.call,r.ctx)).resolves.toContain('age=0');
    expect(calls.collect).toHaveBeenCalledWith(r.bot,'wheat',1,r.ctx,false,true,undefined,{x:1,y:64,z:0});
    expect(calls.use).toHaveBeenCalledWith(r.bot,{skill:'use',item:'wheat_seeds',at:[1,63,0],face:'up'},r.ctx);
    expect(calls.release).toHaveBeenCalledTimes(1);
    const missing=rig();missing.noSeeds();
    await expect(skillHarvest(missing.bot,missing.call,missing.ctx)).rejects.toThrow(/预留/);
    expect(calls.collect).toHaveBeenCalledTimes(1);
  });

  it('leaves immature crops, different blocks and missing soil untouched',async()=>{
    for(const change of [(r:ReturnType<typeof rig>)=>r.set(1,64,0,'wheat',{age:3}),
      (r:ReturnType<typeof rig>)=>r.set(1,64,0,'carrots',{age:7}),
      (r:ReturnType<typeof rig>)=>r.set(1,63,0,'dirt')]) {
      const r=rig();change(r);await expect(skillHarvest(r.bot,r.call,r.ctx)).rejects.toBeInstanceOf(SkillBlocked);
    }
    expect(calls.collect).not.toHaveBeenCalled();expect(calls.use).not.toHaveBeenCalled();
  });

  it('repairs the now empty crop cell after unconfirmed drops but keeps the original blocked receipt',async()=>{
    const r=rig();calls.collect.mockImplementation(async()=>{r.set(1,64,0,'air');throw new SkillBlocked('掉落未确认',[],'server');});
    await expect(skillHarvest(r.bot,r.call,r.ctx)).rejects.toThrow(/掉落未确认.*已补种/);
    expect(calls.use).toHaveBeenCalledTimes(1);
  });

  it('does not replant over another player’s replacement block or write after cancellation',async()=>{
    const r=rig();calls.collect.mockImplementation(async()=>{r.set(1,64,0,'stone');return 'harvested';});
    await expect(skillHarvest(r.bot,r.call,r.ctx)).rejects.toThrow(/未覆盖/);
    expect(calls.use).not.toHaveBeenCalled();
    const cancelled=rig();calls.collect.mockImplementation(async()=>{cancelled.set(1,64,0,'air');cancelled.abort();return 'harvested';});
    await expect(skillHarvest(cancelled.bot,cancelled.call,cancelled.ctx)).rejects.toThrow();
    expect(calls.use).not.toHaveBeenCalled();expect(calls.release).toHaveBeenCalledTimes(2);
  });

  it('refuses dispatched planting without a real age-zero crop and does not retry',async()=>{
    const r=rig();calls.use.mockResolvedValue('packet sent');
    await expect(skillHarvest(r.bot,r.call,r.ctx)).rejects.toThrow(/补种未确认/);
    expect(calls.use).toHaveBeenCalledTimes(1);
  });

  it('adds exact work without changing collect coordinate refusal and freezes relative harvest targets on admission',()=>{
    const result=parseSteps([{skill:'harvest',block:'wheat',at:['~1',64,'~'],replant:true}]);
    expect(result).toHaveProperty('steps');
    if('steps' in result) expect(freezeFirstStep(result.steps,{x:4,y:64,z:7}).steps[0]).toMatchObject({at:[5,64,7],replant:true});
    expect(parseSteps([{skill:'collect',block:'wheat',at:[1,64,0]}])).toHaveProperty('error');
  });
});
