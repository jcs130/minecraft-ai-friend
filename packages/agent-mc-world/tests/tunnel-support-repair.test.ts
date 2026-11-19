import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, type TaskReport } from '../core/executor.ts';
import type { SkillCall } from '../core/skills.ts';
import { SkillBlocked, type SkillContext } from '../core/skill-context.ts';
import { skillTunnel } from '../core/skills-dig.ts';
import { Upkeep } from '../core/placement.ts';
import { PlacementRetryDeferred } from '../core/placement-miss-state.ts';

// Keep the executor, dependency gates and tunnel's physical checks real. Only
// replace placement/movement transport so the test controls server confirmation.
vi.mock('../core/skills-build.ts', async original => ({
  ...await original<typeof import('../core/skills-build.ts')>(),
  skillBuild: async (bot: Bot, call: SkillCall) => (bot as any).confirmBuild(call),
}));
vi.mock('../core/travel.ts', async original => ({
  ...await original<typeof import('../core/travel.ts')>(),
  gotoGoal: async (bot: Bot, goal: { x: number; y: number; z: number }) => {
    (bot as any).moves.push([goal.x, goal.y, goal.z]);
    bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5);
  },
}));

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
const repair: SkillCall = { skill: 'build', material: 'netherrack', anchors: [[1, 63, 0]] };
const tunnel: SkillCall = { skill: 'tunnel', at: [3, 64, 0] };

function rig(mode: 'confirmed' | 'failed' | 'unconfirmed' = 'confirmed') {
  let id = 0, stock = 1; const reports: TaskReport[] = [], cells = new Map<string, string>();
  cells.set('1,63,0', 'air');
  const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(.5, 64, .5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 20, entities: {}, players: {},
    inventory: { items: () => stock ? [{ name: 'netherrack', count: stock, type: registry.itemsByName.netherrack.id }] : [],
      slots: Array(46).fill(null) }, currentWindow: null, moves: [] as number[][],
    blockAt: (position: Vec3) => {
      const name = cells.get(key(position)) ?? (position.y < 64 ? 'stone' : 'air');
      return { name, type: registry.blocksByName[name].id, stateId: registry.blocksByName[name].defaultState,
        position, boundingBox: registry.blocksByName[name].boundingBox, getProperties: () => ({}) };
    },
    confirmBuild: vi.fn(async (call: Extract<SkillCall, { skill: 'build' }>) => {
      if (call.dryRun) return 'preview only';
      stock = 0;
      if (mode === 'failed') throw new SkillBlocked('server rejected placement');
      if (!('material' in call) || !registry.blocksByName[call.material]) throw new SkillBlocked('unknown material');
      if (mode === 'confirmed' && 'anchors' in call) for (const at of call.anchors) cells.set(at.join(','), call.material);
      return 'placement call returned';
    }),
    dig: vi.fn(), equip: vi.fn(), placeBlock: vi.fn(), setControlState: vi.fn(),
    pathfinder: { stop: vi.fn(), setGoal: vi.fn(), goto: vi.fn() },
  }) as unknown as Bot & { confirmBuild: ReturnType<typeof vi.fn>; moves: number[][] };
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const exec = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never,
    nextId: () => ++id, fleeHealth: () => 0 });
  const stops = [{ at: Date.now(), dimension: 'overworld', cell: { x: 1, y: 64, z: 0 } }];
  Object.assign(exec, { tunnelSupportStops: stops });
  return { exec, bot, cells, reports, stops };
}

it.each(['unconfirmed', 'reference-disappears', 'no-reference', 'deferred', 'denied'] as const)(
  'reports the actual support placement path: %s', async mode => {
    const r = rig();
    const cell = { x: -63, y: 81, z: -78 };
    const support = '-63,80,-78';
    if (mode !== 'no-reference') r.cells.set(support, 'stone');
    const placement = vi.mocked(r.bot.placeBlock).mockImplementation(async () => {
      if (mode === 'denied') throw new SkillBlocked('服务端保护预检 deny', [], 'server');
      if (mode === 'deferred') throw new PlacementRetryDeferred(cell, 100, 900);
      if (mode === 'reference-disappears') r.cells.delete(support);
      throw new Error('Timed out waiting for block update');
    });
    const finish = vi.fn();
    const ctx = { aborted: () => false, escape: { active: false }, policy: { get: () => ({ scaffold: ['netherrack'] }) },
      permitResourcePlacement: () => ({ ok: true, finish }) } as unknown as SkillContext;
    const upkeep = new Upkeep(r.bot, ctx);
    try {
      if (mode === 'denied') {
        await expect(upkeep.footing(cell)).rejects.toThrow('服务端保护预检 deny');
      } else {
        expect(await upkeep.footing(cell)).toBe(false);
        const reason = upkeep.why('footing');
        if (mode === 'no-reference') expect(reason).toMatch(/放置时没有可贴的实心面，本次未发包/);
        else if (mode === 'deferred') expect(reason).toContain('同场景失败缓存');
        else expect(reason).toMatch(/填充 \(-63, 81, -78\).*未确认放置成功.*回读：air/);
      }
      expect(placement).toHaveBeenCalledTimes(mode === 'no-reference' ? 0 : 1);
      expect(finish).toHaveBeenCalledWith(false);
    } finally { r.exec.shutdown(); }
  },
);

afterEach(() => vi.useRealTimers());

it('previews the actual rising diagonal step and its lower floor before taking a step', async () => {
  const r = rig();
  const ctx = { aborted: () => false, escape: { active: false } } as SkillContext;
  const call = { skill: 'tunnel' as const, at: [-2, 65, -2] as [number, number, number] };
  try {
    const preview = await skillTunnel(r.bot, { ...call, dryRun: true }, ctx);
    expect(preview).toContain('终点 (-2, 65, -2)');
    expect(preview).toContain('4 个落脚点中，1 处脚下已有支撑');
    expect(preview).toContain('第2步预定脚格 (-1, 65, -1)，支撑格 (-1, 64, -1) 是空气');
    expect(preview).toContain('再下一格 (-1, 63, -1) 是石头');
    expect(preview).toContain('垫脚名单里的方块包里都没有');
    expect(r.bot.moves).toEqual([]);
    expect(r.bot.dig).not.toHaveBeenCalled();
    expect(r.bot.placeBlock).not.toHaveBeenCalled();

    await expect(skillTunnel(r.bot, call, ctx)).rejects.toThrow('前面 (-1, 65, -1) 脚下悬空');
    expect(r.bot.moves).toEqual([[-1, 64, 0]]);
  } finally { r.exec.shutdown(); }
});

it('separates liquid and unread support from a material gap and queries only preview permissions', async () => {
  const r = rig();
  r.cells.set('2,63,0', 'lava');
  const read = r.bot.blockAt.bind(r.bot);
  vi.spyOn(r.bot, 'blockAt').mockImplementation(at => at.equals(new Vec3(3, 63, 0)) ? null : read(at));
  const items = [{ name: 'dirt', count: 2, type: registry.itemsByName.dirt.id }] as ReturnType<Bot['inventory']['items']>;
  vi.spyOn(r.bot.inventory, 'items').mockReturnValue(items);
  const previewResourcePlacement = vi.fn(() => ({ ok: false, reason: '测试材料已预留' }));
  const permitResourcePlacement = vi.fn();
  const ctx = { aborted: () => false, previewResourcePlacement, permitResourcePlacement } as unknown as SkillContext;
  try {
    const call = { ...tunnel, dryRun: true } as Extract<SkillCall, { skill: 'tunnel' }>;
    const preview = await skillTunnel(r.bot, call, ctx);
    expect(preview).toContain('1 处缺支撑');
    expect(preview).toContain('测试材料已预留');
    expect(preview).toContain('1 处脚下为液体，首处在第2步 (2, 63, 0)');
    expect(preview).toContain('1 处支撑格未读到，首处在第3步 (3, 63, 0)');
    expect(previewResourcePlacement).toHaveBeenCalledOnce();
    previewResourcePlacement.mockReturnValue({ ok: true, reason: '' });
    const stocked = await skillTunnel(r.bot, call, ctx);
    expect(stocked).toContain('当前可选垫材泥土，背包有 2 块');
    expect(permitResourcePlacement).not.toHaveBeenCalled();
    expect(r.bot.placeBlock).not.toHaveBeenCalled();
    expect(r.bot.equip).not.toHaveBeenCalled();
    expect(r.bot.moves).toEqual([]);
  } finally { r.exec.shutdown(); }
});

it('keeps support behind an opaque wall unknown even when the chunk contains lava', async () => {
  const r = rig();
  for (let y = 63; y <= 67; y++) for (let z = -1; z <= 1; z++) r.cells.set(`1,${y},${z}`, 'stone');
  r.cells.set('3,63,0', 'lava');
  try {
    const preview = await skillTunnel(r.bot, { skill: 'tunnel', at: [3, 64, 0], dryRun: true },
      { aborted: () => false } as SkillContext);
    expect(preview).toContain('支撑格未读到');
    expect(preview).not.toContain('处脚下为液体');
  } finally { r.exec.shutdown(); }
});

it('admits repair then tunnel without declaring a planned support already repaired', async () => {
  vi.useFakeTimers(); const r = rig();
  try {
    expect(r.exec.submitDetailed([repair, { ...tunnel, needs: [1] }], 'append').accepted).toBe(true);
    expect((r.exec as any).tunnelSupportStops).toEqual(r.stops);
    await vi.runAllTimersAsync();
    expect(r.bot.confirmBuild).toHaveBeenCalledOnce();
    expect(r.cells.get('1,63,0')).toBe('netherrack');
    expect(r.bot.moves).toContainEqual([3, 64, 0]);
    expect(r.reports.find(r => r.kind === 'done')?.steps?.map(s => s.outcome)).toEqual(['ok', 'ok']);
  } finally { r.exec.shutdown(); }
});

it('keeps dependency failure from moving onto an unconfirmed repair', async () => {
  vi.useFakeTimers(); const r = rig('failed');
  try {
    expect(r.exec.submitDetailed([repair, { ...tunnel, needs: [1] }], 'append').accepted).toBe(true);
    await vi.runAllTimersAsync();
    expect(r.reports.find(r => r.kind === 'blocked')?.steps?.map(s => s.outcome)).toEqual(['fail', 'skip']);
    expect(r.bot.moves).toEqual([]);
    expect(r.cells.get('1,63,0')).toBe('air');
  } finally { r.exec.shutdown(); }
});

it('rechecks actual footing even when a preceding placement returns without a dependency', async () => {
  vi.useFakeTimers(); const r = rig('unconfirmed');
  try {
    expect(r.exec.submitDetailed([repair, tunnel], 'append').accepted).toBe(true);
    await vi.runAllTimersAsync();
    expect(r.bot.moves).toEqual([]);
    expect(r.cells.get('1,63,0')).toBe('air');
    expect(r.reports.find(r => r.kind === 'blocked')?.steps?.at(-1)).toMatchObject({ outcome: 'fail',
      why: expect.stringContaining('脚下悬空') });
  } finally { r.exec.shutdown(); }
});

it.each([
  ['no repair', []],
  ['preview only', [{ ...repair, dryRun: true }]],
  ['different cell', [{ skill: 'build', material: 'netherrack', anchors: [[1, 62, 0]] }]],
  ['non-support material', [{ skill: 'build', material: 'torch', anchors: [[1, 63, 0]] }]],
  ['unknown material', [{ skill: 'build', material: 'unknown_block', anchors: [[1, 63, 0]] }]],
] as [string, SkillCall[]][])('admits %s with history while execution still checks actual support', async (_name, prefix) => {
  vi.useFakeTimers();
  const r = rig();
  try {
    r.exec.submitDetailed([{ skill: 'wait', ticks: 100 }], 'append');
    const before = r.exec.status();
    const result = r.exec.submitDetailed([...prefix, tunnel], 'append');
    expect(result.accepted).toBe(true);
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    await vi.runAllTimersAsync();
    expect(r.bot.moves).toEqual([]);
    expect(r.reports.at(-1)?.kind).toBe('blocked');
  } finally { r.exec.shutdown(); }
});

it('a later repair cannot make an earlier unsupported crossing succeed', async () => {
  vi.useFakeTimers();
  const r = rig();
  try {
    expect(r.exec.submitDetailed([tunnel, repair], 'append').accepted).toBe(true);
    await vi.runAllTimersAsync();
    expect(r.bot.moves).toEqual([]);
    expect(r.reports.at(-1)?.steps?.[0].outcome).toBe('fail');
  } finally { r.exec.shutdown(); }
});

it.each([
  { skill: 'build', material: 'netherrack', anchors: [[1, 63, 0], [1, 62, 0]] },
  { skill: 'build', material: 'netherrack', shape: 'line', anchors: [[1, 62, 0], [1, 63, 0]] },
  { skill: 'build', material: 'netherrack', on: [{ at: [1, 62, 0], face: 'up' }] },
] as SkillCall[])('recognizes the actual build footprint after an earlier waypoint: %j', planned => {
  const r = rig();
  try {
    expect(r.exec.submitDetailed([
      { skill: 'goto', at: [-1, 64, 0] }, { ...planned, needs: [1] }, { ...tunnel, needs: [2] },
    ], 'append').accepted).toBe(true);
    expect((r.exec as any).tunnelSupportStops).toEqual(r.stops);
  } finally { r.exec.shutdown(); }
});
