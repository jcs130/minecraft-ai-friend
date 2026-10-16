import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';
import { parseScoutSteps } from '../core/skills.ts';

vi.mock('../core/skills-interact.ts', async original => ({
  ...await original<typeof import('../core/skills-interact.ts')>(),
  skillUse: async () => 'Right-click packet completed; no claimed block change.',
}));
const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
afterEach(() => vi.useRealTimers());
it.each([false, true])('only publishes physical evidence for executed steps (scout preview: %s)', async preview => {
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
  const scout = parseScoutSteps([{ skill: 'cleanup' }]);
  if ('error' in scout) throw Error(scout.error);
  expect(scout.steps[0]).toMatchObject({ skill: 'cleanup', dryRun: true });
  const admission = exec.submitDetailed(preview ? scout.steps : [{ skill: 'use', at: [1, 63, 1] }], 'append');
  const returnedReceipt = structuredClone(admission);
  expect(admission.accepted).toBe(true);
  await vi.runAllTimersAsync();
  expect(admission).toEqual(returnedReceipt);
  const terminal = reports.find(r => r.kind === 'done');
  expect(terminal?.steps?.[0].outcome).toBe('ok');
  if (preview) expect(terminal?.steps?.[0]).not.toHaveProperty('observedEffect');
  else expect(terminal?.steps?.[0].observedEffect).toMatchObject({ status: 'unchanged', goalVerified: false,
    changed: { target: false, inventory: false, position: false, window: false }, at: [1, 63, 1] });
  exec.shutdown();
});
