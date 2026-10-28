import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';
import { precheckStep, precheckSteps, type PrecheckDeps } from '../core/precheck.ts';
import { skillTunnel } from '../core/skills-dig.ts';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
function rig() {
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(-424.424, 24, 679.5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 20, entities: {}, players: {},
    inventory: { items: () => [], slots: Array(46).fill(null) }, currentWindow: null,
    blockAt: (position: Vec3) => ({ name: position.y < 24 ? 'stone' : 'air', stateId: 0,
      position, boundingBox: position.y < 24 ? 'block' : 'empty', getProperties: () => ({}) }),
    dig: vi.fn(), equip: vi.fn(), placeBlock: vi.fn(), setControlState: vi.fn(), chat: vi.fn(),
    pathfinder: { stop: vi.fn(), setGoal: vi.fn(), goto: vi.fn(async () => undefined) },
  }) as unknown as Bot;
  const deps: PrecheckDeps = { resolve: at => { const p = at as number[]; return { x: p[0], y: p[1], z: p[2] }; },
    blockAt: p => bot.blockAt(new Vec3(p.x, p.y, p.z)), cellsOf: () => null };
  return { bot, deps };
}
afterEach(() => vi.useRealTimers());

it('reports the same measured spiral alignment failure in preview and execution without acting', async () => {
  const { bot, deps } = rig();
  const call = { skill: 'tunnel' as const, at: [-425, 46, 678], spiral: true };
  const note = precheckStep(bot, call, deps);
  expect(note).toMatchObject({ level: 'hard', rule: 'tunnel.spiralAlignment' });
  expect(note!.text).toContain('(-425, 24, 679)');
  expect(note!.text).toContain('exact:true');
  await expect(skillTunnel(bot, call, { aborted: () => false } as never)).rejects.toThrow(note!.text);
  expect(bot.dig).not.toHaveBeenCalled();
  expect(bot.pathfinder.goto).not.toHaveBeenCalled();
});

it('does not project a nearby arrival as the exact start of a spiral or rewrite the plan', () => {
  const { bot, deps } = rig();
  const steps = [{ skill: 'goto' as const, at: [-425, 24, 678] },
    { skill: 'tunnel' as const, at: [-425, 46, 678], spiral: true }];
  const original = structuredClone(steps);
  const notes = precheckSteps(bot, steps, deps);
  expect(notes).toContainEqual({ index: 1, note: expect.objectContaining({ level: 'soft', rule: 'tunnel.nearApproach' }) });
  expect(notes.some(n => n.note.level === 'hard')).toBe(false);
  expect(steps).toEqual(original);
});

it('keeps exact arrival projection but treats a previous tunnel endpoint as unverified', () => {
  const { bot, deps } = rig();
  expect(precheckSteps(bot, [{ skill: 'goto', at: [-425, 24, 678], exact: true },
    { skill: 'tunnel', at: [-425, 46, 678], spiral: true }], deps)).toEqual([]);
  expect(precheckSteps(bot, [{ skill: 'goto', at: [-425, 24, 677], exact: true },
    { skill: 'tunnel', at: [-425, 46, 678], spiral: true }], deps)[0]?.note.rule).toBe('tunnel.spiralAlignment');
  expect(precheckSteps(bot, [{ skill: 'tunnel', at: [-425, 46, 679], spiral: true },
    { skill: 'tunnel', at: [-425, 47, 678], spiral: true }], deps)).toEqual([]);
});

it.each([false, true])('labels near-only arrival without adding movement (queued=%s)', async queued => {
  vi.useFakeTimers(); const { bot } = rig(); const reports: TaskReport[] = [];
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const executor = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never,
    nextId: () => 1, fleeHealth: () => 0 });
  const before = bot.entity.position.clone();
  try {
    const admission = executor.submitDetailed([{ skill: 'goto', at: [-425, 24, 678] },
      ...(queued ? [{ skill: 'chat' as const, text: 'after arrival' }] : [])], 'append');
    expect(admission, JSON.stringify(admission)).toMatchObject({ accepted: true });
    let receipt = admission.receipt;
    if (queued) {
      for (let turn = 0; turn < 20 && reports.length === 0; turn++) await vi.advanceTimersByTimeAsync(100);
      const terminal = reports.find(r => r.kind === 'done');
      expect(terminal, JSON.stringify(reports)).toBeDefined();
      receipt = terminal!.text;
    } else {
      expect(admission.completedImmediately).toBe(true);
      expect(reports).toHaveLength(0);
    }
    expect(receipt).toContain('邻域');
    expect(receipt).toContain('exact:true');
    expect(receipt).toContain('(-425, 24, 679)');
    expect(bot.entity.position).toEqual(before);
    expect(bot.dig).not.toHaveBeenCalled();
    expect(bot.placeBlock).not.toHaveBeenCalled();
  } finally { executor.shutdown(); }
});

it('does not report repeated already-satisfied goto as new completed work; position changes and expiry permit fresh checks', () => {
  vi.useFakeTimers(); const { bot } = rig(); const reports: TaskReport[] = []; let ids = 0;
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const executor = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never,
    nextId: () => ++ids, fleeHealth: () => 0 });
  const calls = [{ skill: 'goto' as const, at: [-425, 24, 678] }];
  const original = structuredClone(calls);
  try {
    expect(executor.submitDetailed(calls, 'append')).toMatchObject({ accepted: true, completedImmediately: true });
    const repeated = executor.submitDetailed(calls, 'now');
    expect(repeated).toMatchObject({ accepted: false, rejection: { kind: 'repeat', rule: 'navigation.already-satisfied' } });
    expect(repeated.completedImmediately).toBeUndefined();
    expect(repeated.receipt).toContain('本单未派发');
    expect(ids).toBe(0); expect(reports).toHaveLength(0);
    expect(bot.pathfinder.goto).not.toHaveBeenCalled();
    bot.entity.position.z -= 1;
    expect(executor.submitDetailed(calls, 'append')).toMatchObject({ accepted: true, completedImmediately: true });
    vi.advanceTimersByTime(15_001);
    expect(executor.submitDetailed(calls, 'append')).toMatchObject({ accepted: true, completedImmediately: true });
    expect(calls).toEqual(original); expect(ids).toBe(0);
  } finally { executor.shutdown(); }
});

it('returns an actionable goal field correction and preserves the existing goal after rejection', async () => {
  const world = new MinecraftWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS) });
  const call = (args: Record<string, unknown>) => world.tools().find(t => t.name === 'mc_goal')!.handler(args, {} as never);
  const original = { text: 'Survey the route', plan: [{ do: 'measure geometry', judgment: 'actual survey receipt' }] };
  await call({ add: original });
  const rejected = await call({ add: { ...original, type: 'exploration' } });
  expect(rejected).toMatchObject({ failed: true });
  expect(JSON.stringify(rejected)).toContain('kind');
  expect(JSON.stringify(rejected)).toContain('支持字段');
  expect(JSON.stringify(await call({}))).toContain('#1 v1');
  expect(JSON.stringify(await call({}))).not.toContain('#2');
  expect(JSON.stringify(await call({ add: { ...original, kind: 'exploration' } }))).toContain('#2');
});
