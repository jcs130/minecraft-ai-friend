import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { expect, it, vi } from 'vitest';
import { Executor } from '../core/executor.ts';
import { ServerActionWait } from '../core/server-action-wait.ts';
import { orderForStow, orderForTake, rememberStorageAccessFailure, rememberStorageWriteFailure } from '../core/containers.ts';
import type { SkillCall } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
function rig() {
  const bot = Object.assign(new EventEmitter(), {
    registry, entity: { id: 1, position: new Vec3(.5,64,.5), yaw: 0, pitch: 0 },
    game: { dimension: 'overworld' }, inventory: { items: () => [], slots: Array(46).fill(null) },
    blockAt: (position: Vec3) => ({ name: 'chest', stateId: registry.blocksByName.chest.defaultState, position, boundingBox: 'block' }),
    entities: {}, players: {}, findBlocks: () => [], setControlState() {},
  });
  let id = 0;
  const exec = new Executor({ getBot: () => bot as never, nextId: () => ++id, report() {},
    busyWith: () => 'existing body owner',
    log: { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as never });
  return { exec, bot };
}

it('admits same-container take/stow and its following retry with a history note', () => {
  const r = rig();
  const steps: SkillCall[] = [{ skill: 'use', at: [1,64,0] },
    { skill: 'take', item: 'dirt', count: 8, from: 'open' }, { skill: 'stow', item: 'dirt', count: 8, into: 'open' }];
  try {
    const first = r.exec.submitDetailed(steps, 'append');
    expect(first.accepted).toBe(true);
    expect(first.receipt).toContain('复核提示');
    const next = r.exec.submitDetailed([{ skill: 'use', at: [1,64,0] },
      { skill: 'stow', item: 'dirt', count: 4, into: 'open' }], 'append');
    expect(next.accepted).toBe(true);
    expect(r.exec.status().waiting).toHaveLength(2);
  } finally { r.exec.shutdown(); }
});

it('allows a fresh inspection immediately after a successful earlier peek', () => {
  const r = rig();const steps: SkillCall[] = [{ skill: 'use', at: [1,64,0] }];
  try {
    (r.exec as any).inspections.record(steps, 'minecraft:overworld', [{ step: 1, outcome: 'ok', line: '箱里: dirt' }], Date.now());
    const result = r.exec.submitDetailed(steps, 'append');
    expect(result.accepted).toBe(true);
    expect(result.receipt).toContain('箱内物品');
  } finally { r.exec.shutdown(); }
});

it('does not turn an old pinned route into a ban on a new request', () => {
  const r = rig();
  try {
    Object.assign(r.exec, { spatialFailures: [{ at: Date.now(), count: 3, dimension: 'overworld',
      from: { x:.5,y:64,z:.5 }, target: { x:8,y:64,z:0 }, why: '钉在原地' }] });
    const result = r.exec.submitDetailed([{ skill: 'goto', at: [8,64,0] }], 'append');
    expect(result.accepted).toBe(true);
    expect(result.receipt).toContain('上次卡在');
  } finally { r.exec.shutdown(); }
});

it('orders previously failed containers after alternatives without excluding them', () => {
  const r = rig();
  try {
    const failed = { x:1,y:64,z:0,name:'chest',d:1 }, other = { x:3,y:64,z:0,name:'chest',d:3 };
    rememberStorageAccessFailure(r.bot as never, failed, 'old route failed');
    rememberStorageWriteFailure(r.bot as never, failed, 'dirt', 'old capacity failed');
    for (const order of [orderForStow, orderForTake]) {
      expect(order([failed,other], {} as never, r.bot as never, 'dirt')).toEqual([other,failed]);
    }
  } finally { r.exec.shutdown(); }
});

it('does not invent a cooldown for repeated queries, commands or unchanged block uses', () => {
  const wait = new ServerActionWait();const query='/service status';
  for (let i=0;i<4;i++) { wait.noteChat(query,1000+i*100);wait.noteFeedback('unchanged',1050+i*100); }
  expect(wait.blockChat(query,1400)).toBeNull();
  wait.noteChat('/service perform',1500);expect(wait.blockChat('/service perform',1501)).toBeNull();
  wait.noteUse([1,64,0],2000,'unchanged');expect(wait.blockReason([1,64,0],2001,'unchanged')).toBeNull();
});

it('still honors only the correlated wait duration actually reported by the server', () => {
  const wait = new ServerActionWait();
  wait.noteChat('/service perform',1000);wait.noteFeedback('请等待 3 秒',1001);
  expect(wait.blockChat('/service perform',1002)).toContain('请等待 3 秒');
  expect(wait.blockChat('/other status',1002)).toBeNull();
  expect(wait.blockChat('/service perform',4002)).toBeNull();
});

it('executes another successful action when the legacy repetition setting is enabled', async () => {
  const r = methodHarness();
  try {
    (r.exec as any).opts.repeatSuccessFallback = () => ({ enabled: true, skillsCsv: 'look', maxSuccesses: 1, windowMinutes: 10 });
    const look = vi.fn(async (point: Vec3) => {
      const delta = point.minus(r.bot.entity.position.offset(0, 1.62, 0));
      await r.bot.look(Math.atan2(-delta.x,-delta.z), Math.atan2(delta.y,Math.hypot(delta.x,delta.z)));
    });
    Object.assign(r.bot, { lookAt: look, waitForTicks: async () => undefined });
    const steps: SkillCall[] = [{ skill: 'look', at: [0,68,-5] }];
    r.exec.submitDetailed(steps, 'append');
    await vi.waitFor(() => expect(r.exec.repeatSuccessHold(steps, (r.exec as any).opts.repeatSuccessFallback())).toContain('成功终态'));
    const before = look.mock.calls.length;
    expect(r.exec.submitDetailed(steps, 'append').accepted).toBe(true);
    await vi.waitFor(() => expect(look.mock.calls.length).toBeGreaterThan(before));
  } finally { r.close(); }
});

it('keeps repeated admission failures as evidence without starting an escape or ending the decision turn', async () => {
  const r = methodHarness();
  try {
    Object.assign(r.bot, { recipesAll: () => [] });
    const escape = vi.spyOn(r.world as any, 'doEscape');
    const tool = r.world.tools().find(tool => tool.name === 'mc_do')!;
    for (let i=0;i<4;i++) {
      const result = await tool.handler({ steps: [{ skill: 'craft', item: 'cooked_chicken', count: 1 }] }, { role: 'test', log: r.host.log });
      expect(result).toHaveProperty('failed', true);
      expect(result).not.toHaveProperty('endsTurn', true);
    }
    expect(escape).not.toHaveBeenCalled();
    expect(r.exec.status().waiting).toHaveLength(0);
  } finally { vi.restoreAllMocks();r.close(); }
});

it('accepts distinct appended attacks while the existing body owner keeps control', () => {
  const r = rig();
  try {
    (r.exec as any).opts.bodyState = () => ({ combatActive: true, environmentOwnerKind: null });
    for (const target of ['zombie', 'skeleton']) {
      expect(r.exec.submitDetailed([{ skill: 'attack', target }], 'append').accepted).toBe(true);
    }
    expect(r.exec.status().running).toBeNull();
    expect(r.exec.status().waiting).toHaveLength(2);
  } finally { r.exec.shutdown(); }
});

it('honors every stop without requiring the second task to run for 30 seconds', async () => {
  const r = methodHarness();
  try {
    for (let i=0;i<3;i++) {
      expect(r.exec.submitDetailed([{ skill: 'wait', ticks: 100+i }], 'append').accepted).toBe(true);
      await vi.waitFor(() => expect(r.exec.status().running).not.toBeNull());
      expect(r.exec.clear()).toContain('已叫停');
      await vi.waitFor(() => expect(r.exec.status().running).toBeNull());
    }
    expect(r.exec.status().waiting).toHaveLength(0);
    expect(Object.values(r.keys).some(Boolean)).toBe(false);
  } finally { r.close(); }
});

it('does not end the host turn when a queue is busy or a screenshot is unavailable', async () => {
  const r = methodHarness();
  try {
    r.exec.submitDetailed([{ skill: 'wait', ticks: 100 }], 'append');
    const tool = r.world.tools().find(tool => tool.name === 'mc_queue')!;
    for (let i=0;i<4;i++) {
      const result = await tool.handler({}, { role: 'test', log: r.host.log, round: 1 });
      expect(result).not.toHaveProperty('endsTurn', true);
    }
    const visual = await r.world.tools().find(tool => tool.name === 'mc_visual')!.handler({}, { role: 'test', log: r.host.log });
    expect(visual).toHaveProperty('failed', true);
    expect(visual).not.toHaveProperty('endsTurn', true);
  } finally { r.close(); }
});
