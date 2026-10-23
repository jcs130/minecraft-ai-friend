import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';
import { precheckStep, type PrecheckDeps } from '../core/precheck.ts';
import { skillTunnel } from '../core/skills-dig.ts';
import { Aborted, SkillNoop } from '../core/skill-context.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
const target = [-54, 81, -180] as [number, number, number];
function rig() {
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(-53.5, 81, -179.5), onGround: true },
    game: { dimension: 'the_nether' }, health: 24, food: 20, entities: {}, players: {},
    inventory: { items: () => [], slots: Array(46).fill(null) }, currentWindow: null,
    blockAt: (position: Vec3) => ({ name: position.y < 81 ? 'netherrack' : 'air', stateId: 0,
      position, boundingBox: position.y < 81 ? 'block' : 'empty', getProperties: () => ({}) }),
    dig: vi.fn(), equip: vi.fn(), placeBlock: vi.fn(), setControlState: vi.fn(),
    pathfinder: { stop: vi.fn(), setGoal: vi.fn(), goto: vi.fn() },
  }) as unknown as Bot;
  const deps: PrecheckDeps = { resolve: at => { const p = at as number[]; return { x: p[0], y: p[1], z: p[2] }; },
    blockAt: p => bot.blockAt(new Vec3(p.x, p.y, p.z)), cellsOf: () => null };
  return { bot, deps };
}
afterEach(() => vi.useRealTimers());

it('keeps the live repeated tunnel at an already reached cell out of the blocked ledger', async () => {
  vi.useFakeTimers(); const { bot, deps } = rig(); let id = 0; const reports: TaskReport[] = [];
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const exec = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never,
    nextId: () => ++id, fleeHealth: () => 0 });
  const before = bot.entity.position.clone();
  expect(precheckStep(bot, { skill: 'tunnel', at: target }, deps)).toBeNull();
  try {
    expect(exec.submitDetailed([{ skill: 'tunnel', at: target }], 'append').accepted).toBe(true);
    await vi.runAllTimersAsync();
    const terminal = reports.find(r => r.kind === 'done');
    expect(terminal?.steps?.[0]).toMatchObject({ outcome: 'noop', why: expect.stringContaining('未挖掘、未移动') });
    expect(terminal?.text).toContain('未验证此前整条通道');
    expect(reports.some(r => r.kind === 'blocked')).toBe(false);
    expect(exec.blockedLog()).toHaveLength(0);
    expect(bot.entity.position).toEqual(before);
    expect(bot.dig).not.toHaveBeenCalled();
    expect(bot.equip).not.toHaveBeenCalled();
    expect(bot.placeBlock).not.toHaveBeenCalled();
    expect(bot.pathfinder.goto).not.toHaveBeenCalled();
  } finally { exec.shutdown(); }
});

it('rechecks the reached cell at execution time and still honors cancellation', async () => {
  const { bot, deps } = rig(); bot.entity.position = new Vec3(-53.5, 81, -177.5);
  const call = { skill: 'tunnel' as const, at: target };
  expect(precheckStep(bot, call, deps)).toBeNull();
  bot.entity.position = new Vec3(-53.5, 81, -179.5);
  await expect(skillTunnel(bot, call, { aborted: () => false } as never)).rejects.toBeInstanceOf(SkillNoop);
  await expect(skillTunnel(bot, call, { aborted: () => true } as never)).rejects.toBeInstanceOf(Aborted);
  expect(precheckStep(bot, { skill: 'tunnel', at: [-53, 84, -180] }, deps))
    .toMatchObject({ level: 'hard', rule: 'tunnel.slope' });
  expect(bot.dig).not.toHaveBeenCalled();
});
