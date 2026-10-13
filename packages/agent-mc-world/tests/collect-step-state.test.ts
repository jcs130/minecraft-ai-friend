import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor, type TaskReport } from '../core/executor.ts';

const field = vi.hoisted(() => ({ visible: false, collections: 0 }));
vi.mock('../core/skills-gather.ts', async original => ({
  ...await original<typeof import('../core/skills-gather.ts')>(),
  collectVisible: () => field.visible,
  skillCollect: async () => { field.collections++; return 'collected after current observation'; },
}));
const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.20.6');

function rig(expose: boolean) {
  let id = 0;
  const reports: TaskReport[] = [];
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(.5, 64, .5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 20, entities: {},
    inventory: { items: () => [], slots: Array(46).fill(null) }, currentWindow: null,
    blockAt: () => null, findBlocks: () => [new Vec3(1, 64, 0)],
    chat: vi.fn(() => { field.visible = expose; }), setControlState: vi.fn(),
    pathfinder: { stop: vi.fn(), setGoal: vi.fn() },
  }) as unknown as Bot;
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const exec = new Executor({ getBot: () => bot, report: r => reports.push(r),
    log: log as never, nextId: () => ++id, fleeHealth: () => 0 });
  // Two actual target-not-visible outcomes are the prerequisite for this existing limiter.
  const failures = (exec as unknown as { unseenCollects: Map<string, unknown> }).unseenCollects;
  failures.set('overworld/iron_ore', { count: 2, at: Date.now(), from: { x: 0, y: 64, z: 0 } });
  return { exec, bot, reports };
}
beforeEach(() => { vi.useFakeTimers(); field.visible = false; field.collections = 0; });
afterEach(() => vi.useRealTimers());

describe('collection checks at its execution step', () => {
  it('preserves the immediate refusal for unchanged standalone collection', () => {
    const r = rig(false);
    const result = r.exec.submitDetailed([{ skill: 'collect', block: 'iron_ore', count: 1 }], 'append');
    expect(result.accepted).toBe(false);
    expect(result.receipt).toContain('没有看得见');
    expect(field.collections).toBe(0);
  });

  it('accepts earlier work and uses the new observation before collecting', async () => {
    const r = rig(true);
    const result = r.exec.submitDetailed([{ skill: 'chat', text: 'prior work' },
      { skill: 'collect', block: 'iron_ore', count: 1, needs: [1] }], 'append');
    expect(result.accepted).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(r.bot.chat).toHaveBeenCalledWith('prior work');
    expect(field.collections).toBe(1);
    expect(r.reports).toHaveLength(1);
  });

  it('keeps earlier work but prevents collection when its fresh read is still negative', async () => {
    const r = rig(false);
    expect(r.exec.submitDetailed([{ skill: 'chat', text: 'no change' },
      { skill: 'collect', block: 'iron_ore', count: 1, needs: [1] }], 'append').accepted).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(r.bot.chat).toHaveBeenCalledWith('no change');
    expect(field.collections).toBe(0);
    expect(r.reports).toHaveLength(1);
    expect(JSON.stringify(r.reports[0])).toContain('没有看得见');
  });
});
