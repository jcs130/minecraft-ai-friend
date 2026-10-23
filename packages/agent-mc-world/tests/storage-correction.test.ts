import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Executor } from '../core/executor.ts';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';

afterEach(() => vi.useRealTimers());

function rig() {
  vi.useFakeTimers();
  const bot = Object.assign(new EventEmitter(), {
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) },
    game: { dimension: 'overworld' }, currentWindow: null,
    inventory: { items: () => [], slots: [] }, blockAt: () => null,
  });
  let nextId = 0;
  const exec = new Executor({ getBot: () => bot as never, nextId: () => ++nextId,
    report: vi.fn(), busyWith: () => '现有身体动作',
    log: { child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {}, emit() {} } as never });
  const world = new MinecraftWorld({ cfg: structuredClone(MINECRAFT_CLIENT_DEFAULTS) });
  Object.assign(world, { executor: exec, bridge: { bot, connected: true }, diag: { write: vi.fn() } });
  const tool = world.tools().find(tool => tool.name === 'mc_do')!;
  return { exec, call: (steps: unknown[]) => tool.handler({ steps, queue: 'append' }, {} as never) };
}

describe('storage rejection scheduling', () => {
  it('rejects a closed-window transfer without forcing the host turn to end on repetition', async () => {
    const r = rig();
    const steps = [{ skill: 'take', item: 'string', count: 12, from: 'open' }];
    const first = await r.call(steps);
    expect(first).toMatchObject({ failed: true });
    expect(first).not.toHaveProperty('endsTurn');
    expect((first as { text: string }).text).toContain('当前没有打开容器窗口');
    const repeated = await r.call(steps);
    expect(repeated).toMatchObject({ failed: true });
    expect(repeated).not.toHaveProperty('endsTurn');
    expect(r.exec.status()).toMatchObject({ running: null, waiting: [] });
  });

  it('preserves queued work and accepts a corrected use-and-take sequence without waiting for another event', async () => {
    const r = rig();
    const prior = r.exec.submitDetailed([{ skill: 'chat', text: '/existing-work' }], 'append');
    expect(prior.accepted).toBe(true);
    const before = r.exec.status().waiting.map(task => task.id);
    await r.call([{ skill: 'take', item: 'string', count: 12, from: 'open' }]);
    expect(r.exec.status().waiting.map(task => task.id)).toEqual(before);
    const corrected = await r.call([{ skill: 'use', at: [1, 64, 0] },
      { skill: 'take', item: 'string', count: 12, from: 'open', needs: [1] }]);
    expect(corrected).toMatchObject({execution:{kind:'task',phase:'accepted',terminal:false,goalCompleted:false}});
    expect(r.exec.status().waiting.map(task => task.id)).toEqual([...before, expect.any(Number)]);
  });
});
