import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Executor, type TaskReport } from '../core/executor.ts';

afterEach(() => vi.useRealTimers());

function rig() {
  vi.useFakeTimers();
  let serial = 0;
  let busy: string | null = null;
  const ally = { id: 2, type: 'player', username: 'Ally', name: 'player', isValid: true, position: new Vec3(4, 64, 0) };
  const bot = Object.assign(new EventEmitter(), {
    entity: { id: 1, position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' },
    entities: { 2: ally }, players: { Ally: { entity: ally } }, registry: { entitiesByName: {} },
    inventory: { items: () => [], slots: [] }, chat: vi.fn(),
    pathfinder: { goal: null as unknown, movements: { canDig: true, scafoldingBlocks: [1] },
      setGoal(goal: unknown) { this.goal = goal; }, stop: vi.fn() },
    clearControlStates() {}, stopDigging() {},
  });
  const reports: TaskReport[] = [];
  const exec = new Executor({ getBot: () => bot as never, nextId: () => ++serial,
    busyWith: () => busy, report: report => reports.push(report),
    log: { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as never });
  return { exec, bot, reports, setBusy(value: string | null) { busy = value; } };
}

it.each(['combat', 'external-hold'] as const)('settles every accepted queued task on death during %s', async boundary => {
  const r = rig();
  if (boundary === 'combat') r.setBusy('正在跟怪打');
  else r.exec.pauseForExternal('server-confirmed inability to act');
  r.exec.submit([{ skill: 'chat', text: '/old-one' }], 'append');
  r.exec.submit([{ skill: 'chat', text: '/old-two' }], 'append');
  const ids = r.exec.status().waiting.map(task => task.id);
  expect(ids).toHaveLength(2);
  expect(r.bot.chat).not.toHaveBeenCalled();
  r.exec.cancelForDeath();
  expect(r.reports.map(report => ({ id: report.taskId, kind: report.kind })))
    .toEqual(ids.map(id => ({ id, kind: 'cancelled' })));
  expect(r.reports.every(report => report.text.includes('死亡') && report.text.includes('一步都没开始'))).toBe(true);
  expect(r.exec.status().waiting).toEqual([]);
  r.exec.cancelForDeath();
  r.setBusy(null);
  await vi.advanceTimersByTimeAsync(100);
  expect(r.reports).toHaveLength(2);
  expect(r.bot.chat).not.toHaveBeenCalled();
  r.exec.submit([{ skill: 'chat', text: '/new-body-task' }], 'append');
  await vi.advanceTimersByTimeAsync(100);
  expect(r.bot.chat).toHaveBeenCalledTimes(1);
  expect(r.bot.chat).toHaveBeenCalledWith('/new-body-task');
  r.exec.shutdown();
});

it.each([false, true])('settles the %s-frozen active task and its queued successor without late completion', async frozen => {
  const r = rig();
  r.exec.submit([{ skill: 'follow', name: 'Ally' }], 'append');
  await vi.advanceTimersByTimeAsync(10);
  const active = r.exec.status().running!.id;
  r.setBusy('正在跟怪打');
  if (frozen) r.exec.suspend('战斗');
  r.exec.submit([{ skill: 'chat', text: '/old-successor' }], 'append');
  r.exec.cancelForDeath();
  const cancelled = r.reports.filter(report => report.kind === 'cancelled');
  expect(cancelled.map(report => report.taskId)).toEqual([active, active + 1]);
  expect(cancelled[0].text).toContain('死亡');
  r.setBusy(null);
  await vi.advanceTimersByTimeAsync(1000);
  expect(r.reports.filter(report => report.taskId === active && !['suspended', 'resumed'].includes(report.kind)))
    .toEqual([cancelled[0]]);
  expect(r.bot.chat).not.toHaveBeenCalled();
  expect(r.exec.status().waiting).toEqual([]);
  expect(r.exec.status().running).toBeNull();
  r.exec.shutdown();
});

it('does not invent a terminal task when an idle body dies', () => {
  const r = rig();
  r.exec.cancelForDeath();
  expect(r.reports).toEqual([]);
  r.exec.shutdown();
});
