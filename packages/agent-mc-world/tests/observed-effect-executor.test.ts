import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';

vi.mock('../core/skills-interact.ts', async original => ({
  ...await original<typeof import('../core/skills-interact.ts')>(),
  skillUse: async () => 'Right-click packet completed; no claimed block change.',
}));
const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
afterEach(() => vi.useRealTimers());
it('publishes unchanged effect evidence through the actual executor terminal report', async () => {
  vi.useFakeTimers(); let id = 0; const reports: TaskReport[] = [];
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(.5, 64, .5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 20, entities: {}, players: {},
    inventory: { items: () => [], slots: Array(46).fill(null) }, currentWindow: null,
    blockAt: (position: Vec3) => ({ name: 'moss_block', stateId: 123, position, boundingBox: 'block', getProperties: () => ({}) }),
    setControlState: vi.fn(), pathfinder: { stop: vi.fn(), setGoal: vi.fn() },
  }) as unknown as Bot;
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const exec = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never, nextId: () => ++id, fleeHealth: () => 0 });
  expect(exec.submitDetailed([{ skill: 'use', at: [1, 63, 1] }], 'append').accepted).toBe(true);
  await vi.runAllTimersAsync();
  const terminal = reports.find(r => r.kind === 'done');
  expect(terminal?.steps?.[0].outcome).toBe('ok');
  expect(terminal?.steps?.[0].observedEffect).toMatchObject({ status: 'unchanged', goalVerified: false,
    changed: { target: false, inventory: false, position: false, window: false }, at: [1, 63, 1] });
  exec.shutdown();
});
