import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { methodHarness, methodEnded } from './method-harness.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import { installPartialBlockStartRepair } from '../core/pathfinder-start.ts';
import { installDoorWaypointRepair, groundPathIssueOf } from '../core/path-waypoints.ts';
import { installTreadWater } from '../core/travel.ts';
import { hasDryFooting } from '../core/skills-build.ts';
import { installWallGap } from '../core/mineflayer-fixes.ts';
import { prepareWorkRoutine } from '../core/work-routines.ts';

const rigs: ReturnType<typeof methodHarness>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const h of rigs.splice(0)) h.close(); vi.useRealTimers(); });
function bank(version = '1.21.1') {
  installWallGap();
  const h = methodHarness(version); rigs.push(h);
  for (let x = 0; x <= 5; x++) for (let z = -4; z <= 4; z++) for (let y = 64; y <= 65; y++) h.set(x, y, z, 'water');
  for (let z = -4; z <= 4; z++) for (let y = 64; y <= 65; y++) h.set(-1, y, z, 'stone');
  h.bot.entity.position = new Vec3(.5, 65.3, .5); h.bot.entity.onGround = false;
  Object.assign(h.bot, { supportFeature: (name: string) => h.bot.registry.supportFeature(name),
    getControlState: (key: string) => h.keys[key], isAlive: true });
  Object.assign(h.bot.game, { minY: -64, height: 384 });
  Object.assign(h.bot.world, { getBlockStateId: (at: Vec3) => h.bot.blockAt(at).stateId, getColumn: () => ({}) });
  const bot = h.bot as unknown as Bot;
  pathfinder.pathfinder(bot); installPathfinderPerf(); installPartialBlockStartRepair(bot); installTreadWater(bot); installDoorWaypointRepair(bot);
  bot.pathfinder.movements.canDig = false; bot.pathfinder.movements.allowParkour = false;
  bot.pathfinder.movements.allow1by1towers = false; bot.pathfinder.movements.scafoldingBlocks = [];
  bot.pathfinder.thinkTimeout = 250; bot.pathfinder.tickTimeout = 5;
  return { ...h, bot };
}

function notchedBank() {
  const h = bank();
  // Controlled analogue of the captured wall/step/water notch. Unrecorded
  // terrain is synthetic here; this is not asserted to be the live map.
  for (let x = -3; x <= 4; x++) for (let z = -3; z <= 3; z++) {
    for (let y = 64; y <= 67; y++) h.set(x,y,z,'air');
    h.set(x,64,z,'water');
  }
  for (let x = -2; x <= 2; x++) for (const z of [-2,-1]) {
    if (x === 0 && z === -1) continue;
    h.set(x,64,z,x===0?'crafting_table':'stone');
    if(x!==0) h.set(x,65,z,'stone');
  }
  h.set(-1,64,0,'cobblestone');h.set(1,64,1,'cobblestone');h.set(1,65,1,'cobblestone');
  h.set(2,64,0,'stone');h.set(2,65,0,'dirt');h.set(2,64,1,'dirt');h.set(2,65,1,'grass_block');
  h.bot.entity.position=new Vec3(.3,64.183,.052);
  return h;
}

it('escapes a one-cell water notch beside full-height steps without repeatedly pushing into the corner', async () => {
  const h = notchedBank(), reports: any[] = [], paths: any[] = [];
  (h.exec as any).opts.report = (report: any) => reports.push(report);
  h.bot.on('path_update', r=>paths.push({status:r.status,path:r.path.map(p=>({x:p.x,y:p.y,z:p.z,hash:p.hash}))}));
  h.exec.submit([{ skill: 'goto', at: [-4,64,-1], walkOnly:true }], 'append');
  for(let i=0;i<400&&!reports.some(r=>['done','blocked'].includes(r.kind));i++) await vi.advanceTimersByTimeAsync(50);
  expect(reports.at(-1),JSON.stringify({reports,paths:paths.slice(-3),at:h.bot.entity.position,keys:h.keys})).toMatchObject({kind:'done'});
  expect(h.bot.entity.position.x).toBeLessThan(-2);
});

it('jumps from the off-centre water cell onto an adjacent ledge without wedging against the corner', async () => {
  const h=notchedBank(),reports:any[]=[],paths:any[]=[];
  (h.exec as any).opts.report=(report:any)=>reports.push(report);
  h.bot.on('path_update',r=>paths.push(r.path.map(p=>({x:p.x,y:p.y,z:p.z}))));
  h.exec.submit([{skill:'goto',at:[-1,65,0],exact:true,walkOnly:true}],'append');
  for(let i=0;i<400&&!reports.some(r=>['done','blocked'].includes(r.kind));i++)await vi.advanceTimersByTimeAsync(50);
  expect(reports.at(-1),JSON.stringify({reports,paths:paths.slice(-3),at:h.bot.entity.position,keys:h.keys})).toMatchObject({kind:'done'});
  expect(hasDryFooting(h.bot)).toBe(true);
});

it('a one-block bank completes only after the real body lands and stays dry', async () => {
  const h = bank(), reports: any[] = [], trace: any[] = [];
  (h.exec as any).opts.report = (report: any) => reports.push(report);
  h.bot.on('goal_reached', () => trace.push({ at: h.bot.entity.position.clone(), dry: hasDryFooting(h.bot) }));
  h.exec.submit([{ skill: 'surface' }], 'append');
  for (let i = 0; i < 300 && !reports.some(r => ['done', 'blocked'].includes(r.kind)); i++) await vi.advanceTimersByTimeAsync(50);
  expect(reports.at(-1), JSON.stringify({ reports, trace, at: h.bot.entity.position, keys: h.keys })).toMatchObject({ kind: 'done' });
  expect(hasDryFooting(h.bot)).toBe(true);
  await vi.advanceTimersByTimeAsync(1000); expect(hasDryFooting(h.bot)).toBe(true);
  expect(h.bot.physicsEnabled).toBe(true);
});

it.each(['1.21.1', '1.20.6'])('in %s chooses a reachable bank instead of retrying a nearer sheer wall with a dry top', async version => {
  const h=bank(version),reports:any[]=[],paths:any[]=[];
  h.bot.prependListener('path_update',r=>paths.push({status:r.status,visited:r.visitedNodes,cost:r.cost,path:r.path.slice(0,8).map(p=>({x:p.x,y:p.y,z:p.z}))}));
  for(let z=-5;z<=5;z++)for(let y=64;y<=67;y++)h.set(-1,y,z,'stone');
  (h.exec as any).opts.report=(r:any)=>reports.push(r);
  h.exec.submit([{skill:'surface'}],'append');
  for(let i=0;i<500&&!reports.some(r=>['done','blocked'].includes(r.kind));i++)await vi.advanceTimersByTimeAsync(50);
  expect(reports.at(-1),JSON.stringify({reports,paths,issue:groundPathIssueOf(h.bot),at:h.bot.entity.position,keys:h.keys})).toMatchObject({kind:'done'});
  expect(hasDryFooting(h.bot)).toBe(true);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(hasDryFooting(h.bot)).toBe(true);
  expect(Object.values(h.keys).every(value => !value)).toBe(true);
});

it('does not call an enclosed pool dry land or leave jump held after a blocked exit', async () => {
  const h = bank(), reports: any[] = [];
  for (let x = -1; x <= 6; x++) for (let z = -5; z <= 5; z++) {
    if (x !== -1 && x !== 6 && z !== -5 && z !== 5) continue;
    for (let y = 64; y <= 71; y++) h.set(x, y, z, 'stone');
  }
  (h.exec as any).opts.report = (report: any) => reports.push(report);
  h.exec.submit([{ skill: 'surface' }], 'append');
  for (let i = 0; i < 100 && !reports.some(r => ['done', 'blocked'].includes(r.kind)); i++) await vi.advanceTimersByTimeAsync(50);
  expect(reports.at(-1)).toMatchObject({ kind: 'blocked' });
  expect(hasDryFooting(h.bot)).toBe(false);
  expect(Object.values(h.keys).every(value => !value)).toBe(true);
});

it('finds the real bank around a bend even when its straight ray crosses a solid wall', async () => {
  const h = bank(), reports: any[] = [];
  for (let x = -4; x <= 2; x++) for (let z = -1; z <= 5; z++) {
    for (let y = 64; y <= 69; y++) h.set(x, y, z, 'stone');
  }
  const channel = (x: number, z: number) => {
    for (let y = 64; y <= 69; y++) h.set(x, y, z, y <= 65 ? 'water' : 'air');
  };
  for (let z = 0; z <= 4; z++) { channel(0, z); channel(-3, z); }
  for (let x = -3; x <= 0; x++) channel(x, 4);
  h.set(-3, 65, 0, 'stone');
  (h.exec as any).opts.report = (report: any) => reports.push(report);
  h.exec.submit([{ skill: 'surface' }], 'append');
  for (let i = 0; i < 600 && !reports.some(r => ['done', 'blocked'].includes(r.kind)); i++) await vi.advanceTimersByTimeAsync(50);
  expect(reports.at(-1), JSON.stringify({ reports, at: h.bot.entity.position })).toMatchObject({ kind: 'done' });
  expect(hasDryFooting(h.bot)).toBe(true);
  expect(h.bot.entity.position.x).toBeCloseTo(-2.5, 0);
});

it('cancelling a bank approach releases the old path and keys without reporting successful arrival', async () => {
  const h = bank(), reports: any[] = [];
  (h.exec as any).opts.report = (report: any) => reports.push(report);
  h.exec.submit([{ skill: 'surface' }], 'append');
  for (let i = 0; i < 60 && !h.keys.forward; i++) await vi.advanceTimersByTimeAsync(50);
  expect(h.keys.forward).toBe(true);
  expect(h.exec.cancelTask(h.exec.status().running!.id, 'cancel bank approach')).toBe(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(reports.some(report => report.kind === 'done')).toBe(false);
  expect(h.bot.pathfinder.goal).toBeNull();
  expect(Object.values(h.keys).every(value => !value)).toBe(true);
});

it('water path execution reaches a dry bank without treating the water cell below it as arrival', async () => {
  const h = bank(); let reachedAt: Vec3 | null = null;
  h.bot.on('goal_reached', () => { reachedAt = h.bot.entity.position.clone(); });
  h.bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(-1, 66, 0));
  for (let i = 0; i < 200 && !reachedAt; i++) await vi.advanceTimersByTimeAsync(50);
  expect(reachedAt, JSON.stringify({ at: h.bot.entity.position, keys: h.keys })).not.toBeNull();
  await vi.advanceTimersByTimeAsync(300);
  expect(hasDryFooting(h.bot), JSON.stringify({ reachedAt, at: h.bot.entity.position })).toBe(true);
});

it('the public swim_to script ascends in 1.21.1 physics without turning toward tiny sideways drift', async () => {
  // The public script runs in a real worker, so its clock must progress along
  // with the main-thread physics rather than racing fake timers past startup.
  vi.useRealTimers();
  const h = bank();
  for (let x = -4; x <= 5; x++) for (let z = -4; z <= 4; z++) {
    for (let y = 64; y <= 70; y++) h.set(x, y, z, 'water');
  }
  h.bot.entity.position = new Vec3(.51, 66, .49); h.bot.entity.yaw = 1.1;
  const id = h.runner.start(prepareWorkRoutine('swim_to', { dimension: 'overworld', at: [0, 68, 0] })).id;
  const result = await methodEnded(h, id);
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'completed', result: { goalCompleted: true } });
  expect(h.bot.entity.yaw).toBeCloseTo(1.1, 5);
  expect(Object.values(h.keys).every(value => !value)).toBe(true);
});
