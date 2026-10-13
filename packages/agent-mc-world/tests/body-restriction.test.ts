import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Executor } from '../core/executor.ts';

afterEach(() => vi.useRealTimers());
function rig() {
  vi.useFakeTimers();
  let id = 0;
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5,64,0.5) },
    game: { dimension: 'overworld' }, inventory: { items: () => [], slots: [] },
    chat: vi.fn(), clearControlStates() {}, stopDigging() {}, blockAt: () => null });
  const exec = new Executor({ getBot: () => bot as never, nextId: () => ++id, report: vi.fn(),
    log: { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as never });
  return { exec, bot };
}

it('keeps task identity and queued work until an explicit external recovery, independently of environment recovery', async () => {
  const {exec,bot}=rig();
  const restriction=exec.pauseForExternal('server-confirmed inability to act');
  exec.submit([{skill:'chat',text:'/pending-after-recovery'}],'append');
  const taskId=exec.status().waiting[0].id;
  const environment=exec.pauseForEnvironment('old hazard');
  exec.resumeAfterEnvironment(environment);
  await vi.advanceTimersByTimeAsync(65_000);
  expect(bot.chat).not.toHaveBeenCalled();
  expect(exec.status().waiting[0].id).toBe(taskId);
  expect(exec.resumeAfterExternal(restriction).released).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(bot.chat).toHaveBeenCalledTimes(1);
  expect(bot.chat).toHaveBeenCalledWith('/pending-after-recovery');
  expect(exec.resumeAfterExternal(restriction).released).toBe(false);
  exec.shutdown();
});

it('operator cancellation invalidates the external recovery token and does not resurrect cancelled work', async () => {
  const {exec,bot}=rig();
  const restriction=exec.pauseForExternal('incapacitated');
  exec.submit([{skill:'chat',text:'/cancelled'}],'append');
  exec.clear(true);
  expect(exec.resumeAfterExternal(restriction).released).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(bot.chat).not.toHaveBeenCalled();
  expect(exec.status().waiting).toEqual([]);
  exec.shutdown();
});
