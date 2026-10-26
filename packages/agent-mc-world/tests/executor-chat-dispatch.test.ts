import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Executor, sendChat, type TaskReport } from '../core/executor.ts';
import { configureChatDedup } from '../core/chat-dedup.ts';
import { ServerActionWait } from '../core/server-action-wait.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('minecraft-data')('1.21.1');
const executors: Executor[] = [];

afterEach(() => { for (const executor of executors.splice(0)) executor.shutdown(); vi.useRealTimers(); });

function harness() {
  const wait = new ServerActionWait();
  const reports: TaskReport[] = [];
  const chat = vi.fn((_text: string) => { wait.noteFeedback('请等待 10 秒'); });
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '1.21.1', entity: { id: 1, position: new Vec3(.5, 64, .5), onGround: true },
    game: { dimension: 'overworld' }, health: 20, food: 20, entities: {}, players: {},
    inventory: { items: () => [], slots: Array(46).fill(null) }, currentWindow: null,
    blockAt: (position: Vec3) => ({ name: position.y < 64 ? 'stone' : 'air', position,
      boundingBox: position.y < 64 ? 'block' : 'empty', getProperties: () => ({}) }),
    chat, setControlState: vi.fn(), clearControlStates: vi.fn(),
    pathfinder: { stop: vi.fn(), setGoal: vi.fn() },
  }) as unknown as Bot;
  const log = { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} };
  const dispatch = vi.fn((text: string, send: () => void) => wait.dispatchChat(text, send));
  let id = 0;
  const exec = new Executor({ getBot: () => bot, report: r => reports.push(r), log: log as never,
    nextId: () => ++id, fleeHealth: () => 0, chatDispatch: dispatch });
  executors.push(exec);
  return { wait, reports, chat, bot, dispatch, exec };
}

it('starts reply correlation only when a chat queued for over three seconds is sent', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  const r = harness();
  const hold = r.exec.pauseForExternal('another body owner');
  const admitted = r.exec.submitDetailed([{ skill: 'chat', text: '/example enter' }], 'append');
  expect(admitted.accepted).toBe(true);
  await vi.advanceTimersByTimeAsync(5_000);
  r.wait.noteFeedback('请等待 20 秒');
  expect(r.wait.blockChat('/example enter')).toBeNull();
  expect(r.chat).not.toHaveBeenCalled(); expect(r.dispatch).not.toHaveBeenCalled();
  expect(r.exec.resumeAfterExternal(hold).released).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(r.chat).toHaveBeenCalledTimes(1);
  expect(r.chat).toHaveBeenCalledWith('/example enter');
  expect(r.dispatch).toHaveBeenCalledTimes(1);
  expect(r.wait.blockChat('/example enter')).toContain('10 秒');
  expect(r.reports.find(report => report.taskId === admitted.taskId && report.kind === 'done')).toBeDefined();
});

it('never arms or sends a queued command cancelled before dispatch', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  const r = harness();
  const hold = r.exec.pauseForExternal('another body owner');
  const admitted = r.exec.submitDetailed([{ skill: 'chat', text: '/example enter' }], 'append');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(r.exec.cancelTask(admitted.taskId!, 'caller cancelled')).toBe(true);
  expect(r.exec.resumeAfterExternal(hold).released).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  r.wait.noteFeedback('请等待 20 秒');
  expect(r.chat).not.toHaveBeenCalled(); expect(r.dispatch).not.toHaveBeenCalled();
  expect(r.wait.blockChat('/example enter')).toBeNull();
  expect(r.reports.find(report => report.taskId === admitted.taskId && report.kind === 'cancelled')).toBeDefined();
});

it('reports a rejected transport as failure without retaining a wait or reporting successful send', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  const r = harness();
  r.chat.mockImplementation(() => { r.wait.noteFeedback('请等待 20 秒'); throw new Error('socket closed'); });
  const admitted = r.exec.submitDetailed([{ skill: 'chat', text: '/example enter' }], 'append');
  await vi.advanceTimersByTimeAsync(100);
  r.wait.noteFeedback('请等待 20 秒');
  expect(r.wait.blockChat('/example enter')).toBeNull();
  expect(r.reports.some(report => report.taskId === admitted.taskId && report.kind === 'done')).toBe(false);
  const terminal = r.reports.find(report => report.taskId === admitted.taskId && report.kind === 'blocked');
  expect(terminal?.steps?.[0].outcome).toBe('fail');
  expect(terminal?.text).toContain('socket closed');
});

it('does not notify dispatch for input rejected by validation or duplicate speech', () => {
  const r = harness();
  configureChatDedup(r.bot, () => 30_000);
  expect(() => sendChat(r.bot, '/example enter\n/example leave', r.dispatch)).toThrow();
  expect(r.dispatch).not.toHaveBeenCalled(); expect(r.chat).not.toHaveBeenCalled();
  sendChat(r.bot, 'hello there', r.dispatch);
  expect(() => sendChat(r.bot, 'hello there', r.dispatch)).toThrow('本次未重复发送');
  expect(r.dispatch).toHaveBeenCalledTimes(1); expect(r.chat).toHaveBeenCalledTimes(1);
});
