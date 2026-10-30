import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Executor } from '../core/executor.ts';
import { MinecraftWorld } from '../core/world.ts';
import { nullLogger } from '../src/client/index.ts';

afterEach(() => vi.useRealTimers());
function rig() {
  vi.useFakeTimers();
  const stack = { name: 'beef', count: 3, type: minecraftData('1.21.1').itemsByName.beef.id };
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(0, 64, 0), onGround: true, effects: {} },
    game: { dimension: 'overworld' }, registry: minecraftData('1.21.1'), health: 1, food: 0,
    inventory: { items: () => stack.count ? [stack] : [], slots: [], selectedItem: null },
    heldItem: null as unknown, entities: {}, players: {},
    blockAt: () => ({ name: 'air', boundingBox: 'empty', shapes: [], type: 0 }),
    equip: vi.fn(async () => { bot.heldItem = stack; }),
    consume: vi.fn(async () => { stack.count--; bot.food += 3; }),
    clearControlStates() {}, stopDigging() {}, chat: vi.fn(),
    pathfinder: { goal:null as unknown, stop() {}, setGoal(goal:unknown) { this.goal=goal; } },
  });
  let id = 0;
  const reports: any[] = [];
  const exec = new Executor({ getBot: () => bot as never, nextId: () => ++id,
    report: r => reports.push(r), log: nullLogger(), fleeHealth: () => 0 });
  const world = Object.assign(Object.create(MinecraftWorld.prototype), {
    bridge: { bot, invSynced: true }, executor: exec, lastAutoEatAttemptAt: 0,
    escapeHoldUntil: 0, diag: { write: vi.fn() }, interruptIdle: vi.fn(),
  });
  return { bot, stack, exec, world, reports, tick: () => world.autoEatTick(bot) };
}

it('rejects a known inedible meal immediately without losing earlier queued work or suggesting seeds', () => {
  const r=rig();
  const hold=r.exec.pauseForEnvironment('drowning recovery');
  r.exec.submit([{skill:'chat',text:'/original'}],'append');
  const before=r.exec.status().waiting.map(t=>t.id);
  const rejected=r.exec.submitDetailed([{skill:'eat',item:'wheat'}],'append');
  expect(rejected.accepted).toBe(false);
  expect(rejected.receipt).toContain('不是可进食物品');
  expect(rejected.receipt).not.toContain('wheat_seeds');
  expect(rejected.receipt).toContain('生牛肉');
  expect(r.exec.status().waiting.map(t=>t.id)).toEqual(before);
  expect(r.bot.consume).not.toHaveBeenCalled();
  r.exec.resumeAfterEnvironment(hold);r.exec.shutdown();
});

it('accepts an explicit harmful meal with a concrete warning even when all carried food is risky', () => {
  const r = rig();
  r.stack.name = 'pufferfish'; r.stack.type = minecraftData('1.21.1').itemsByName.pufferfish.id;
  r.exec.pauseForEnvironment('isolated preflight');
  const submitted = r.exec.submitDetailed([{ skill: 'eat', item: 'pufferfish' }], 'append');
  expect(submitted.accepted).toBe(true);
  expect(submitted.receipt).toContain('中毒 II 60 秒');
  expect(r.exec.status().waiting[0].label).toContain('吃河豚');
  expect(r.bot.consume).not.toHaveBeenCalled();
  r.exec.shutdown();
});

it.each(['raw_beef', 'beef'])('a queued future %s meal does not suppress a safe native meal', async item => {
  const r = rig();
  const hold = r.exec.pauseForEnvironment('drowning recovery');
  r.exec.submit([{ skill: 'chat', text: '/original' }, { skill: 'eat', item }], 'append');
  const original = r.exec.status().waiting[0].id;
  expect(r.exec.hasPendingEat()).toBe(false);
  r.tick();
  expect(r.bot.consume).not.toHaveBeenCalled(); // Environment still owns the body.
  r.exec.resumeAfterEnvironment(hold);
  r.tick();
  await vi.advanceTimersByTimeAsync(300);
  expect(r.bot.consume).toHaveBeenCalled();
  expect(r.stack.count).toBeLessThan(3);
  expect(r.bot.food).toBeGreaterThan(0);
  expect(r.reports.some(row => row.taskId === original)).toBe(true);
  r.exec.shutdown();
});

it('yields real frozen movement to one meal, preserves its task ID, and waits for the consumption receipt', async () => {
  const r = rig();
  const ally = { id: 2, type: 'player', username: 'Ally', name: 'player', isValid: true, position: new Vec3(4, 64, 0) };
  Object.assign(r.bot.entities, { 2: ally });
  Object.assign(r.bot.players, { Ally: { entity: ally } });
  r.exec.submit([{ skill: 'follow', name: 'Ally' }, { skill: 'eat', item: 'raw_beef' }], 'append');
  await vi.advanceTimersByTimeAsync(10);
  const original = r.exec.status().running!.id;
  const hold = r.exec.pauseForEnvironment('drowning recovery');
  expect(r.exec.status().waiting.some(task => task.id === original)).toBe(true);
  expect(r.exec.hasPendingEat()).toBe(false);
  r.tick();
  expect(r.bot.consume).not.toHaveBeenCalled();
  let confirmMeal!: () => void;
  r.bot.consume.mockImplementation(() => new Promise<void>(resolve => {
    confirmMeal = () => { r.stack.count--; r.bot.food += 3; resolve(); };
  }));
  r.exec.resumeAfterEnvironment(hold);
  r.tick();
  r.tick();
  await vi.advanceTimersByTimeAsync(100);
  expect(r.bot.consume).toHaveBeenCalledTimes(1); // Grounded follow now offers a real checkpoint.
  expect(r.stack.count).toBe(3);expect(r.bot.food).toBe(0); // No receipt yet.
  confirmMeal();
  await vi.advanceTimersByTimeAsync(2000);
  expect(r.bot.consume, JSON.stringify({ status: r.exec.status(), reports: r.reports, diag: r.world.diag.write.mock.calls })).toHaveBeenCalledTimes(1);
  expect(r.stack.count).toBe(2);
  expect(r.bot.food).toBe(3);
  expect(r.exec.status().running,JSON.stringify(r.reports)).toMatchObject({id:original,skill:'follow'});
  ally.isValid = false;
  await vi.advanceTimersByTimeAsync(200);
  expect(r.reports.some(row => row.taskId === original && row.kind === 'suspended')).toBe(true);
  expect(r.reports.some(row => row.taskId === original && row.text.includes('raw_beef'))).toBe(true);
  expect(r.reports.some(row => row.kind === 'done' && row.text.includes('0 → 3'))).toBe(true);
  r.exec.shutdown();
});

it('ignores past and distant future meals but preserves active consumption and checkpoint deduplication', () => {
  const r = rig();
  // Explicit scheduler states exercise indices without racing native effects.
  const internal = r.exec as any;
  internal.task = { steps: [{ skill: 'eat', item: 'beef' }, { skill: 'pickup' }], stepIndex: 1, flag: {} };
  expect(r.exec.hasPendingEat()).toBe(false);
  internal.task.stepIndex = 0;
  expect(r.exec.hasPendingEat()).toBe(true);
  r.stack.count = 0; // A consumed stack may disappear before its receipt settles.
  expect(r.exec.hasPendingEat()).toBe(true);
  internal.task = null;
  r.stack.count = 3;
  internal.queue = [{ steps: [{ skill: 'eat', item: 'raw_beef' }], checkpointRequest: true }];
  expect(r.exec.hasPendingEat()).toBe(false);
  internal.queue[0].steps[0].item = 'beef';
  expect(r.exec.hasPendingEat()).toBe(true);
  internal.queue = [];
  r.exec.shutdown();
});

it.each(['inventory', 'combat', 'environment', 'airborne', 'empty', 'hold'])('does not eat through %s safety state', async state => {
  const r = rig();
  if (state === 'inventory') r.world.bridge.invSynced = false;
  if (state === 'combat') r.world.combat = { active: true };
  if (state === 'environment') r.world.reflexes = { envActive: true };
  if (state === 'airborne') r.bot.entity.onGround = false;
  if (state === 'empty') r.stack.count = 0;
  if (state === 'hold') r.exec.pauseForExternal('unknown native outcome');
  r.tick();
  await vi.advanceTimersByTimeAsync(1000);
  expect(r.bot.consume).not.toHaveBeenCalled();
  r.exec.shutdown();
});
