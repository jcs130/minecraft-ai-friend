import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';
import { SkillNoop } from '../core/skill-context.ts';

const pickup = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../core/skills-container.ts', async original => ({
  ...await original<typeof import('../core/skills-container.ts')>(),
  skillPickup: async () => { pickup.calls++; throw new SkillNoop('No matching drop; no inventory gain'); },
}));
const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
afterEach(() => { vi.useRealTimers(); pickup.calls = 0; });
function fixture() {
  vi.useFakeTimers(); let id = 0; const reports: TaskReport[] = [];
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(.5, 75, .5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 20, entities: {}, players: {},
    inventory: { items: () => [], slots: Array(46).fill(null) }, currentWindow: null,
    blockAt: (position: Vec3) => ({ name: 'air', stateId: 0, position, boundingBox: 'empty', getProperties: () => ({}) }),
    setControlState: vi.fn(), pathfinder: { stop: vi.fn(), setGoal: vi.fn(), goto: vi.fn(async () => {}), isMoving: () => false },
  }) as unknown as Bot;
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const exec = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never, nextId: () => ++id, fleeHealth: () => 0 });
  return { bot, exec, reports };
}
const plan = () => [{ skill: 'goto' as const, at: [0, 75, 0] }, { skill: 'pickup' as const, item: 'phantom_membrane', needs: [1] }];
it('keeps completed/noop terminals but does not dispatch their unchanged mixed plan forever', async () => {
  const { exec, reports } = fixture();
  for (let i = 0; i < 2; i++) { expect(exec.submitDetailed(plan(), 'append').accepted).toBe(true); await vi.runAllTimersAsync(); }
  expect(reports.filter(r => r.kind === 'done'), JSON.stringify(reports.map(r => ({ kind:r.kind,steps:r.steps?.map(s => s.outcome) })))).toHaveLength(2);
  expect(reports.at(-1)?.steps?.map(s => s.outcome)).toEqual(['ok', 'noop']);
  expect(reports.at(-1)?.progress).toMatchObject({ observation: 'unchanged', noopSteps: 1, goalVerified: false });
  const queue = exec.status(), refused = exec.submitDetailed(plan(), 'now');
  expect(refused).toMatchObject({ accepted: false, rejection: { kind: 'repeat', rule: 'task.no-observed-effect', review: { latestTaskId: 2 } } });
  expect(exec.status()).toEqual(queue); expect(pickup.calls).toBe(2); expect(refused).not.toHaveProperty('taskId');
  exec.shutdown();
});
it('a new item entity at the real 24-block pickup boundary permits fresh verification', async () => {
  const { exec, bot } = fixture();
  for (let i = 0; i < 2; i++) { exec.submitDetailed(plan(), 'append'); await vi.runAllTimersAsync(); }
  expect(exec.submitDetailed(plan(), 'append').accepted).toBe(false);
  bot.entities[7] = { id:7,name:'item',position:new Vec3(1,75,.5),getDroppedItem:()=>({name:'bone',count:1}) } as never;
  expect(exec.submitDetailed(plan(), 'append').accepted).toBe(false);
  bot.entities[8] = { id: 8, name: 'item', position: new Vec3(24.5, 75, .5), getDroppedItem: () => ({ name: 'phantom_membrane', count: 1 }) } as never;
  expect(exec.submitDetailed(plan(), 'append').accepted).toBe(true); await vi.runAllTimersAsync();
  expect(pickup.calls).toBe(3); exec.shutdown();
});
it('unidentified nearby drop metadata is unknown and cannot uphold a no-effect refusal', async () => {
  const { exec, bot } = fixture();
  for (let i = 0; i < 2; i++) { exec.submitDetailed(plan(), 'append'); await vi.runAllTimersAsync(); }
  bot.entities[7] = { id:7,name:'item',position:new Vec3(1,75,.5),getDroppedItem:()=>null } as never;
  expect(exec.submitDetailed(plan(), 'append').accepted).toBe(true); await vi.runAllTimersAsync(); exec.shutdown();
});
it('a changed selection stays available and unavailable entity coverage is not silently empty', async () => {
  const { exec, bot } = fixture();
  for (let i = 0; i < 2; i++) { exec.submitDetailed(plan(), 'append'); await vi.runAllTimersAsync(); }
  expect(exec.submitDetailed([{ skill: 'pickup', item: 'bone' }], 'append').accepted).toBe(true); await vi.runAllTimersAsync();
  (bot as any).entities = undefined;
  expect(exec.submitDetailed(plan(), 'append').accepted).toBe(true); await vi.runAllTimersAsync(); exec.shutdown();
});
it('rejecting a repeated empty pickup cannot interrupt an unrelated accepted navigation', async () => {
  const { exec, bot } = fixture();
  for (let i = 0; i < 2; i++) { exec.submitDetailed(plan(), 'append'); await vi.runAllTimersAsync(); }
  let settle!: () => void;
  (bot.pathfinder as any).goto = vi.fn(() => new Promise<void>(resolve => { settle = resolve; }));
  expect(exec.submitDetailed([{ skill: 'goto', at: [8, 75, 0] }], 'append').accepted).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  const before = exec.status(), stops = (bot.pathfinder.stop as any).mock.calls.length;
  expect(before.running).not.toBeNull();
  expect(exec.submitDetailed(plan(), 'now').accepted).toBe(false);
  expect(exec.status().running?.id).toBe(before.running?.id);
  expect((bot.pathfinder.stop as any).mock.calls.length).toBe(stops);
  settle(); await vi.runAllTimersAsync(); exec.shutdown();
});
