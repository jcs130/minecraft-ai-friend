import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';
import { parseScoutSteps } from '../core/skills.ts';
import { SkillBlocked } from '../core/skill-context.ts';
import { contextExecutionReading } from '../src/context.ts';

const skill = vi.hoisted(() => ({ failure: null as string | null }));

vi.mock('../core/skills-interact.ts', async original => ({
  ...await original<typeof import('../core/skills-interact.ts')>(),
  skillUse: async () => { if (skill.failure) throw new SkillBlocked(skill.failure); return 'Right-click packet completed; no claimed block change.'; },
}));
const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
afterEach(() => { vi.useRealTimers(); skill.failure = null; });
it.each([false, true, 'blocked'] as const)('publishes observed effects and bounded original failure reasons (mode: %s)', async mode => {
  const preview = mode === true;
  if (mode === 'blocked') skill.failure = 'Opened the requested entity window. '.repeat(3) + 'This is a custom dialogue, not a merchant; inspect the menu before using trade indexes.';
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
  const terminal = reports.find(r => r.kind === (mode === 'blocked' ? 'blocked' : 'done'));
  expect(terminal?.steps?.[0].outcome).toBe(mode === 'blocked' ? 'fail' : 'ok');
  if (mode === 'blocked') {
    expect(terminal?.steps?.[0].why?.length).toBeLessThanOrEqual(41);
    expect(terminal?.steps?.[0].detail).toEqual({ text: skill.failure, chars: skill.failure!.length, truncated: false });
    const reading = contextExecutionReading({ source: 'minecraft', ts: new Date().toISOString(), text: terminal!.text,
      execution: { kind: 'task', id: `epoch:${terminal!.taskId}`, phase: 'blocked', terminal: true, goalCompleted: false, evidence: { steps: terminal!.steps } } });
    expect(reading?.steps[0].reason?.text).toContain('inspect the menu before using trade indexes');
  }
  if (preview) expect(terminal?.steps?.[0]).not.toHaveProperty('observedEffect');
  else expect(terminal?.steps?.[0].observedEffect).toMatchObject({ status: 'unchanged', goalVerified: false,
    changed: { target: false, inventory: false, position: false, window: false }, at: [1, 63, 1] });
  exec.shutdown();
});
