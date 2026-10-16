import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Executor, type TaskReport } from '../core/executor.ts';
import type { SkillContext } from '../core/skill-context.ts';
import { skillProbe } from '../core/skills-gather.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
const call: Parameters<typeof skillProbe>[1] = {
  skill: 'probe', shape: 'line', anchors: [[0, 65, 2], [1, 65, 2]], where: ['stone'],
};
function rig(readings: Array<string | null>) {
  const bot = Object.assign(new EventEmitter(), {
    registry, game: { dimension: 'overworld' },
    entity: { id: 1, position: new Vec3(.5, 64, .5), onGround: true },
    health: 20, food: 20, entities: {}, players: {}, currentWindow: null,
    inventory: { items: () => [], slots: Array(46).fill(null) },
    blockAt(point: Vec3) {
      const position = point.floored();
      const name = position.y === 65 && position.z === 2 && position.x >= 0 && position.x < 2
        ? readings[position.x] : position.y < 64 ? 'stone' : 'air';
      if (name === null) return null;
      return { name, type: registry.blocksByName[name!].id, position,
        boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) };
    },
    setControlState: vi.fn(), pathfinder: { stop: vi.fn(), setGoal: vi.fn(), goto: vi.fn() },
  }) as unknown as Bot;
  const ctx = { aborted: () => false, probeMemo: { last: null, entries: new Map() } } as SkillContext;
  return { bot, ctx };
}
afterEach(() => vi.useRealTimers());

describe('filtered probe observation limits', () => {
  it('reports an entirely hidden region as unknown, including a repeated memo', async () => {
    const { bot, ctx } = rig([null, null]);
    for (let repeat = 0; repeat < 2; repeat++) {
      const receipt = await skillProbe(bot, call, ctx);
      expect(receipt).toContain('已观察 0 格');
      expect(receipt).toContain('目标数量未知');
      expect(receipt).toContain('2 格未观察到');
      expect(receipt).not.toContain('一样都没有');
      expect(receipt).not.toContain('未命中指定方块');
    }
  });
  it('limits a negative result to the observed portion', async () => {
    const { bot, ctx } = rig(['air', null]);
    const receipt = await skillProbe(bot, call, ctx);
    expect(receipt).toContain('已观察的 1 格未命中指定方块');
    expect(receipt).toContain('1 格未观察到');
    expect(receipt).toContain('未知格不能排除目标存在');
  });
  it('keeps visible hits while retaining unobserved coverage', async () => {
    const { bot, ctx } = rig(['stone', null]);
    const receipt = await skillProbe(bot, call, ctx);
    expect(receipt).toContain('石头×1');
    expect(receipt).toContain('1 格未观察到');
    expect(receipt).not.toContain('未命中指定方块');
  });
  it('does not call unrecognized block names an empty region', async () => {
    const { bot, ctx } = rig(['air', 'air']);
    const receipt = await skillProbe(bot, { ...call, where: ['invented_ruin_block'] }, ctx);
    expect(receipt).toContain('未指定可识别的方块目标');
    expect(receipt).toContain('这几样没算进去');
    expect(receipt).not.toContain('未命中指定方块');
  });
});

describe('probe admission after real execution', () => {
  it.each([[null, null], ['air', null]] as Array<Array<string | null>>)(
    'rechecks unknown cells when the client later receives their blocks (%j)', async (...initial) => {
      vi.useFakeTimers();
      const readings = [...initial]; const { bot } = rig(readings);
      const reports: TaskReport[] = []; let id = 0;
      const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
      const exec = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never,
        nextId: () => ++id, fleeHealth: () => 0 });
      try {
        expect(exec.submitDetailed([call], 'append').accepted).toBe(true);
        await vi.runAllTimersAsync();
        expect(reports.find(r => r.kind === 'done')?.text).toContain('未观察到');
        readings[0] = 'air'; readings[1] = 'stone';
        const again = exec.submitDetailed([call], 'append');
        expect(again.accepted).toBe(true);
        await vi.runAllTimersAsync();
        const done = reports.filter(r => r.kind === 'done');
        expect(done).toHaveLength(2);
        expect(done[1].text).toContain('石头×1');
        expect(bot.entity.position).toEqual(new Vec3(.5, 64, .5));
        expect(bot.pathfinder.goto).not.toHaveBeenCalled();
      } finally { exec.shutdown(); }
    },
  );
  it('still bounds an unchanged, fully observed empty query to 30 seconds', async () => {
    vi.useFakeTimers(); const { bot } = rig(['air', 'air']);
    const reports: TaskReport[] = []; let id = 0;
    const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
    const exec = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never,
      nextId: () => ++id, fleeHealth: () => 0 });
    try {
      expect(exec.submitDetailed([call], 'append').accepted).toBe(true);
      await vi.runAllTimersAsync();
      expect(reports.find(r => r.kind === 'done')?.text).toContain('已观察全部 2 格，未命中指定方块');
      expect(exec.submitDetailed([call], 'append')).toMatchObject({ accepted: false,
        rejection: { rule: 'probe.empty' } });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(exec.submitDetailed([call], 'append').accepted).toBe(true);
      await vi.runAllTimersAsync();
    } finally { exec.shutdown(); }
  });
});
