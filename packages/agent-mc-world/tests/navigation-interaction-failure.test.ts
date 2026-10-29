import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { afterEach, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { installNavigationBareHand, withPreparedInteractionHand } from '../core/hand-interaction.ts';
import { CRAFTING_STATION, ensureStation } from '../core/placement.ts';
import type { TaskReport } from '../core/executor.ts';

const rigs: ReturnType<typeof corridor>[] = [];
afterEach(() => { for (const h of rigs.splice(0)) { h.close(); h.bot.emit('end', 'fixture'); } vi.restoreAllMocks(); vi.useRealTimers(); });
function corridor() {
  vi.useFakeTimers();
  const h = methodHarness('1.21.1'), bot = h.bot as unknown as Bot;
  const wheat = { name: 'wheat', type: bot.registry.itemsByName.wheat.id, count: 64, slot: 36 };
  Object.assign(bot, { heldItem: wheat, supportFeature: (name: string) => bot.registry.supportFeature(name),
    inventory: { slots: Array(46).fill(wheat), items: () => [wheat] },
    activateBlock: vi.fn(async () => {}), equip: vi.fn(), unequip: vi.fn(),
  });
  Object.assign(bot.game, { minY: -64, height: 384 });
  Object.assign(bot.world, { getBlockStateId: (at: any) => bot.blockAt(at)!.stateId, getColumn: () => ({}) });
  for (let x = -1; x < 12; x++) {
    for (let y = 64; y <= 65; y++) { h.set(x, y, -1, 'stone'); h.set(x, y, 1, 'stone'); }
    h.set(x, 66, 0, 'stone');
  }
  h.set(2, 64, 0, 'oak_fence_gate');
  pathfinder.pathfinder(bot);
  Object.assign(bot.pathfinder.movements, { canDig: false, allowParkour: false,
    allow1by1towers: false, scafoldingBlocks: [], canOpenDoors: true });
  bot.pathfinder.thinkTimeout = 100; bot.pathfinder.tickTimeout = 5;
  installNavigationBareHand(bot);
  const reports: TaskReport[] = [];
  (h.exec as any).opts.report = (report: TaskReport) => reports.push(report);
  (h.exec as any).opts.fleeHealth = () => 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return { ...h, bot, reports };
}

it('ends an actual pathfinder useOne failure promptly and releases the body for queued recovery', async () => {
  const h = corridor(); rigs.push(h);
  h.exec.submit([{ skill: 'goto', at: [8, 64, 0], walkOnly: true }], 'append');
  h.exec.submit([{ skill: 'chat', text: 'queued recovery can run' }], 'append');
  await vi.advanceTimersByTimeAsync(2500);
  const failed = h.reports.find(r => /找不到可安全右键/.test(r.text ?? ''));
  expect(failed, JSON.stringify(h.reports)).toBeDefined();
  expect(failed!.text).not.toMatch(/25s|noPath|目前没有可走到/);
  expect(h.said).toEqual(['queued recovery can run']);
  expect(h.bot.pathfinder.goal).toBeNull();
  expect(h.bot.unequip).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledTimes(1);
});

it('does not retry every workstation or poison their route cache for one unchanged hand precondition', async () => {
  const h = corridor(); rigs.push(h);
  const positions = [7, 9, 11].map(x => h.bot.entity.position.offset(x, 0, 0).floored());
  for (const p of positions) h.set(p.x, p.y, p.z, 'crafting_table');
  h.bot.findBlocks = () => positions;
  const goto = vi.spyOn(h.bot.pathfinder, 'goto');
  let error: any;
  const attempt = ensureStation(h.bot, CRAFTING_STATION, { aborted: () => false } as never).catch(e => { error = e; });
  await vi.advanceTimersByTimeAsync(2500);
  expect(error?.code).toBe('interaction-hand-unavailable');
  expect(goto).toHaveBeenCalledTimes(1);
  await attempt;
  // The station itself was not disproved. After repairing inventory, its
  // already-reachable location remains usable without a two-minute blacklist.
  h.bot.entity.position = positions[0].offset(0, 0, -1);
  h.bot.inventory.slots[9] = null as never;
  const next = ensureStation(h.bot, CRAFTING_STATION, { aborted: () => false } as never);
  await vi.advanceTimersByTimeAsync(500);
  expect((await next).x).toBe(positions[0].x);
});

it('does not cancel a replacement path when an older preparation fails late', async () => {
  const bot = Object.assign(new EventEmitter(), { heldItem: { name: 'wheat' },
    inventory: { slots: Array(46).fill(null), items: () => [] },
    activateBlock: vi.fn(async () => {}),
    pathfinder: { goal: {} as unknown, isBuilding: () => true,
      setGoal(goal: unknown) { this.goal = goal; bot.emit('goal_updated', goal); } },
    unequip: vi.fn(),
  });
  let reject!: (error: Error) => void;
  bot.unequip.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  installNavigationBareHand(bot as unknown as Bot);
  const attempt = bot.activateBlock({ name: 'oak_door' } as never).catch(e => e);
  const replacement = {};
  bot.pathfinder.setGoal(replacement);
  reject(new Error('old inventory request failed'));
  await attempt;
  expect(bot.pathfinder.goal).toBe(replacement);
});

it('keeps a prepared explicit interaction separate from pathfinder ownership', async () => {
  const goal = {};
  const native = vi.fn(async () => { throw new Error('explicit use failed'); });
  const bot = Object.assign(new EventEmitter(), { activateBlock: native,
    pathfinder: { goal, isBuilding: () => true, setGoal: vi.fn() } });
  installNavigationBareHand(bot as unknown as Bot);
  await expect(withPreparedInteractionHand(bot as unknown as Bot,
    () => bot.activateBlock({ name: 'oak_door' } as never))).rejects.toThrow('explicit use failed');
  expect(bot.pathfinder.setGoal).not.toHaveBeenCalled();
});

it('does not send a late door interaction after the same goal has started a replacement path', async () => {
  let finish!: () => void;
  const native = vi.fn(async () => {});
  const bot = Object.assign(new EventEmitter(), { heldItem: { name: 'wheat' } as { name: string } | null,
    inventory: { slots: Array(46).fill(null), items: () => [] }, activateBlock: native,
    pathfinder: { goal: {}, isBuilding: () => true, setGoal: vi.fn() },
    unequip: async () => { await new Promise<void>(resolve => { finish = resolve; }); bot.heldItem = null; },
  });
  installNavigationBareHand(bot as unknown as Bot);
  const attempt = (bot as unknown as Bot).activateBlock({ name: 'oak_door' } as never).catch(e => e);
  bot.emit('path_reset', 'block_updated');
  finish();
  expect((await attempt).message).toContain('原寻路已结束');
  expect(native).not.toHaveBeenCalled(); expect(bot.pathfinder.setGoal).not.toHaveBeenCalled();
  bot.emit('end', 'fixture');
});

it('installs one observer per connection and removes its listeners on connection end', () => {
  const bot = Object.assign(new EventEmitter(), { activateBlock: vi.fn(async () => {}) });
  installNavigationBareHand(bot as unknown as Bot);
  installNavigationBareHand(bot as unknown as Bot);
  expect(bot.listenerCount('goal_updated')).toBe(1);
  expect(bot.listenerCount('path_reset')).toBe(1);
  bot.emit('end', 'fixture');
  expect(bot.listenerCount('goal_updated')).toBe(0);
  expect(bot.listenerCount('path_reset')).toBe(0);
});
