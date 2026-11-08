import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor, type SkillCall, type TaskReport } from '../core/executor.ts';
import type { RouteProbe } from '../core/skill-context.ts';
import { diagnoseTargetSpace } from '../core/terrain.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function routeRig() {
  const bot = Object.assign(new EventEmitter(), {
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) },
    game: { dimension: 'overworld' },
    inventory: { items: () => [] },
    blockAt: () => null,
    chat() {},
    clearControlStates() {},
    pathfinder: {
      stop() {}, setGoal() {},
      movements: { canDig: true, scafoldingBlocks: [] },
      goto: vi.fn(async () => { throw new Error('找不到可行路线'); }),
    },
  });
  const reports: TaskReport[] = [];
  const probeTarget = vi.fn(() => ({ kind: 'noStand' as const }));
  const probes: RouteProbe[] = (['walk','style'] as const).map(profile =>
    ({ profile, status: 'noPath', steps: 0, place: 0, breaks: 0, endDist: 48, visited: 5,
      capabilities: { maxDropDown: 2, allowParkour: false, canDig: profile === 'style', scaffoldCount: 0 } }));
  let nextId = 0;
  const exec = new Executor({
    getBot: () => bot as never,
    report: report => reports.push(report),
    nextId: () => ++nextId,
    log: { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as never,
    // The far destination is outside the loaded scene; only the failed leg can be probed.
    probeRoutes: target => target.x >= 200 ? null : probes,
    probeTarget,
  });
  return { bot, exec, reports, probeTarget };
}

async function untilReport(reports: TaskReport[], count: number) {
  for (let elapsed = 0; reports.length < count && elapsed < 3_000; elapsed += 10) {
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(reports).toHaveLength(count);
}

describe('long travel diagnostic scope', () => {
  it('a failed horizontal leg cannot diagnose occupancy at its synthetic height or condemn the final destination', async () => {
    const { bot, exec, reports, probeTarget } = routeRig();
    const step: SkillCall = { skill: 'goto', at: [250, 104, 0] };
    expect(exec.submitDetailed([step]).accepted).toBe(true);
    await untilReport(reports, 1);
    expect(reports[0].kind).toBe('blocked');
    expect(reports[0].text).toContain('长途最终目标 (250, 104, 0)');
    expect(reports[0].text).toContain('尚未核实最终目标的落脚条件');
    expect(reports[0].text).not.toContain('站不进人');
    expect(probeTarget).not.toHaveBeenCalled();

    // A fresh departure must not inherit an occupancy diagnosis from the failed leg.
    bot.entity.position = new Vec3(-12.5, 70, 0.5);
    expect(exec.submitDetailed([step]).accepted).toBe(true);
    await untilReport(reports, 2);
  });

  it('a local destination with measured no standing space still returns that diagnosis', async () => {
    const { exec, reports } = routeRig();
    expect(exec.submitDetailed([{ skill: 'goto', at: [10, 64, 0] }]).accepted).toBe(true);
    await untilReport(reports, 1);
    expect(reports[0].kind).toBe('blocked');
    expect(reports[0].text).toContain('目标那一格站不进人');
    expect(reports[0].text).toContain('规划落差≤2格、跑酷关闭、挖掘开启、垫脚料0块');
    expect(reports[0].text).toContain('未确定具体受阻原因');
    expect(reports[0].text).not.toContain('尚未核实最终目标');
  });

  it('rejects a measured occupied exact feet cell before starting a futile navigation wait', async () => {
    const { bot, exec, reports, probeTarget } = routeRig();
    expect(exec.submitDetailed([{ skill: 'goto', at: [10, 64, 0], exact: true }]).accepted).toBe(true);
    await untilReport(reports, 1);
    expect(reports[0].kind).toBe('blocked');
    expect(reports[0].text).toContain('目标那一格站不进人');
    expect(probeTarget).toHaveBeenCalledWith({ x: 10, y: 64, z: 0 }, {exact:true});
    expect(bot.pathfinder.goto).not.toHaveBeenCalled();
  });

  it('does not use an open neighbouring cell to validate an occupied exact destination after a timed-out route search', async () => {
    const { bot, exec, reports } = routeRig();
    const read = (x: number, y: number, z: number) => ({ name: y <= 64 ? 'grass_block' : 'air', solid: y <= 64 });
    // The exact feet cell is solid, but one block higher is valid for GoalNear.
    expect(diagnoseTargetSpace(read, {x:10,y:64,z:0}).kind).toBe('open');
    (exec as any).opts.probeTarget = (at: any, options: any) => diagnoseTargetSpace(read, at, options);
    (exec as any).opts.probeRoutes = () => [{profile:'walk',status:'timeout',steps:0,place:0,breaks:0,endDist:1}];
    expect(exec.submitDetailed([{skill:'goto',at:[10,64,0],exact:true}]).accepted).toBe(true);
    await untilReport(reports, 1);
    expect(reports[0].text).toContain('精确落脚格');
    expect(reports[0].text).toContain('grass_block');
    expect(bot.pathfinder.goto).not.toHaveBeenCalled();
  });

  it('keeps partial and unknown collision shapes eligible, and does not substitute a neighbouring goal', () => {
    const target={x:10,y:64,z:0};
    for (const block of [null,{name:'stone_slab',solid:true,uncertain:true as const},{name:'spruce_fence_gate',solid:true,uncertain:true as const}]) {
      expect(diagnoseTargetSpace(() => block,target,{exact:true})).toEqual({kind:'open'});
    }
    const read=(x:number,y:number,z:number)=>({name:y===65?'stone':'air',solid:y===65});
    expect(diagnoseTargetSpace(read,target,{exact:true})).toEqual({kind:'occupied',at:{x:10,y:65,z:0},block:'stone'});
  });

  it('permits a complete route to remove an exact-cell obstruction with the configured capabilities', async () => {
    const { bot,exec,reports }=routeRig();
    (exec as any).opts.probeTarget=()=>({kind:'occupied',at:{x:10,y:64,z:0},block:'dirt'});
    (exec as any).opts.probeRoutes=(_at:any,_goal:any,profiles?:string[])=>
      profiles?.includes('walk')?[{profile:'walk',status:'noPath',steps:0,place:0,breaks:0,endDist:10,visited:5}]
        :[{profile:'style',status:'complete',steps:10,place:0,breaks:1,endDist:0}];
    bot.pathfinder.goto.mockImplementation(async()=>{bot.entity.position=new Vec3(10.5,64,0.5);});
    exec.submitDetailed([{skill:'goto',at:[10,64,0],exact:true}]);
    await untilReport(reports,1);
    expect(bot.pathfinder.goto).toHaveBeenCalled();
    expect(reports[0].kind).toBe('done');
  });
});
