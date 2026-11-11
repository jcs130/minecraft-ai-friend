import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { skillTransit } from '../core/skills-container.ts';
import { methodHarness } from './method-harness.ts';
import type { SkillContext } from '../core/skill-context.ts';
import type { TaskReport } from '../core/executor.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';

// Production searches use cached block-state projections, not full Block instances.
installPathfinderPerf();

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const h of rigs.splice(0)) h.close(); vi.useRealTimers(); });

function rig(cross = true, rotated = false, transitionOnTouch = false, waterApproach = false) {
  vi.useFakeTimers();
  const h = methodHarness('1.21.1'); rigs.push(h);
  const bot = h.bot as unknown as Bot;
  Object.assign(bot.world, {
    getBlockStateId: (p: Vec3) => bot.blockAt(p)?.stateId ?? 0,
    getColumn: () => ({}), // The local fixture has a loaded flat world around the gate.
  });
  Object.assign(bot, { supportFeature: (name: string) => bot.registry.supportFeature(name), isAlive: true,
    getControlState: (key: string) => (h.keys as Record<string, boolean>)[key],
    lookAt: async (p: Vec3) => { const d = p.minus(bot.entity.position); await bot.look(Math.atan2(-d.x, -d.z), 0, true); } });
  bot.entity.position.set(...(rotated ? [-3.5, 64, 4.5] : [4.5, 64, -3.5]) as [number, number, number]);
  for (let x = 3; x <= 6; x++) for (let y = 64; y <= 68; y++)
    h.set(rotated ? 0 : x, y, rotated ? x : 0, x === 3 || x === 6 || y === 64 || y === 68 ? 'obsidian' : 'nether_portal');
  if (waterApproach) for (let x = 2; x <= 7; x++) for (let z = -5; z < 0; z++)
    h.set(rotated ? z : x, 64, rotated ? x : z, 'water');
  h.set(12, 64, 0, 'nether_portal'); // A different portal remains forbidden.
  pathfinder.pathfinder(bot);
  const movements = bot.pathfinder.movements;
  movements.canDig = false; movements.allowParkour = false; movements.allow1by1towers = false; movements.scafoldingBlocks = [];
  movements.blocksToAvoid.add(bot.registry.blocksByName.nether_portal.id);
  movements.blocksCantBreak.add(bot.registry.blocksByName.obsidian.id);
  movements.blocksCantBreak.add(bot.registry.blocksByName.nether_portal.id);
  bot.pathfinder.tickTimeout = 10;
  let dwell = 0, touched = false;
  bot.on('physicsTick', () => {
    const p = bot.entity.position.floored();
    const inside = bot.blockAt(p)?.name === 'nether_portal';
    touched ||= inside;
    dwell = inside ? dwell + 50 : 0;
    // Server transition fixture only after real local physics reached and stayed in the gate.
    if (cross && dwell >= (transitionOnTouch ? 50 : 1500) && bot.game.dimension !== 'the_nether') {
      bot.game.dimension = 'the_nether';
      if (transitionOnTouch) { bot.pathfinder.setGoal(null); bot.emit('game'); }
    }
  });
  return { h, bot, movements, touched: () => touched };
}

it.each([{rotated:false,water:false},{rotated:true,water:false},{rotated:false,water:true},{rotated:true,water:true}])('enters a raised portal through real collision physics (rotated=$rotated, water=$water)', async ({rotated,water}) => {
  const r = rig(true, rotated, false, water), original = r.movements.getBlock;
  let outcome: string | Error | undefined;
  const done = skillTransit(r.bot, { skill: 'transit', at: rotated ? [0, 67, 4] : [4, 67, 0] }, { aborted: () => false } as SkillContext)
    .then(v => { outcome = v; }, e => { outcome = e; });
  await vi.advanceTimersByTimeAsync(26000); await done;
  expect(outcome).toEqual(expect.stringContaining('穿门成功'));
  expect(r.touched()).toBe(true);
  expect(r.movements.getBlock).toBe(original);
  expect(r.movements.blocksToAvoid.has(r.bot.registry.blocksByName.nether_portal.id)).toBe(true);
  expect(r.movements.getBlock(new Vec3(12, 64, 0), 0, 0, 0).safe).toBe(false);
  expect(r.h.keys.forward).toBe(false); expect(r.h.keys.jump).toBe(false);
});

it('accepts a measured dimension change that revokes the old navigation before its goal settles', async () => {
  const r = rig(true, false, true), original = r.movements.getBlock;
  let outcome: unknown;
  const done = skillTransit(r.bot, { skill: 'transit', at: [4, 65, 0] }, { aborted: () => false } as SkillContext)
    .then(v => { outcome = v; }, e => { outcome = e; });
  await vi.advanceTimersByTimeAsync(26000); await done;
  expect(outcome).toEqual(expect.stringContaining('穿门成功'));
  expect(r.touched()).toBe(true);
  expect(r.movements.getBlock).toBe(original);
  expect(r.h.keys.forward).toBe(false);
});

it('does not grant portal entry to another goal while the original approach is pending', async () => {
  const r = rig(), original = r.movements.getBlock;
  let aborted = false;
  const done = skillTransit(r.bot, { skill: 'transit', at: [4, 65, 0] }, { aborted: () => aborted } as SkillContext).catch(e => e);
  await vi.advanceTimersByTimeAsync(100);
  expect(r.movements.getBlock(new Vec3(4, 65, 0), 0, 0, 0).safe).toBe(true);
  expect(r.movements.getBlock(new Vec3(12, 64, 0), 0, 0, 0).safe).toBe(false);
  aborted = true;
  r.bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(2, 64, 2));
  expect(r.movements.getBlock(new Vec3(4, 65, 0), 0, 0, 0).safe).toBe(false);
  await vi.advanceTimersByTimeAsync(1000); await done;
  expect(r.movements.getBlock).toBe(original);
});

it('never reports arrival from gate contact alone when the dimension did not change', async () => {
  const r = rig(false), original = r.movements.getBlock;
  let outcome: unknown;
  const done = skillTransit(r.bot, { skill: 'transit', at: [4, 65, 0] }, { aborted: () => false } as SkillContext)
    .then(v => { outcome = v; }, e => { outcome = e; });
  await vi.advanceTimersByTimeAsync(30000); await done;
  expect(r.touched()).toBe(true);
  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toContain('等了 20 秒');
  expect(r.movements.getBlock).toBe(original);
  expect(r.h.keys.forward).toBe(false); expect(r.h.keys.jump).toBe(false);
});

it('restores the portal exclusion when cancelled during approach', async () => {
  const r = rig(), original = r.movements.getBlock;
  let aborted = false, outcome: unknown;
  const done = skillTransit(r.bot, { skill: 'transit', at: [4, 65, 0] }, { aborted: () => aborted } as SkillContext)
    .then(v => { outcome = v; }, e => { outcome = e; });
  await vi.advanceTimersByTimeAsync(100); aborted = true;
  await vi.advanceTimersByTimeAsync(1000); await done;
  expect(outcome).toBeInstanceOf(Error);
  expect(r.movements.getBlock).toBe(original);
  expect(r.h.keys.forward).toBe(false); expect(r.h.keys.jump).toBe(false);
});

it('returns the actual transit contract when ordinary goto cannot enter an observed portal', async () => {
  const r = rig(), reports: TaskReport[] = [];
  // This intentionally unreachable search has an unbounded flat fixture world.
  // Bound each A* pass; the simulated 10-second navigation watchdog is unchanged.
  r.bot.pathfinder.thinkTimeout = 100;
  Object.assign((r.h.exec as any).opts, { report: (report: TaskReport) => reports.push(report), fleeHealth: () => 0 });
  r.h.exec.submitDetailed([{ skill: 'goto', at: [4, 65, 0], exact: true, walkOnly: true }]);
  await vi.advanceTimersByTimeAsync(26000);
  expect(reports).toHaveLength(1);
  expect(reports[0].text).toContain('"skill":"transit","at":[4,65,0]');
  expect(reports[0].text).toContain('不证明穿门');
  expect(r.bot.game.dimension).toBe('overworld');
});
