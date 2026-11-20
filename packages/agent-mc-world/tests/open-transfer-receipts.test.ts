import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { stowIntoOpenWindow, takeFromOpenWindow } from '../core/skills-container.ts';
import { SkillBlocked, type SkillContext } from '../core/skill-context.ts';
import { taskEffectProgress } from '../core/task-effect-progress.ts';
import type { ObservedEffect } from '../src/contracts/observed-effect.ts';

const req = createRequire(import.meta.url);
const registry = createRequire(req.resolve('mineflayer'))('prismarine-registry')('1.21.1');
const item = 'cobblestone';
function stack(count: number, slot: number) {
  return count > 0 ? { name: item, type: registry.itemsByName[item].id, slot, count, stackSize: 64, metadata: 0 } : null;
}
// Model one container and its player half. A server's close reconciliation can
// legitimately differ from what Mineflayer displayed in an open window.
function fixture(source: number, carried: number, closeCarried?: number, rejectClick = false) {
  const slots = Array.from({ length: 6 }, (_, i) => stack(i === 1 ? source : i === 3 ? carried : 0, i));
  const win = { id: 3, title: 'Storage', inventoryStart: 3, inventoryEnd: 6, slots,
    items: () => slots.slice(3).filter(Boolean) };
  let finalCarried = carried;
  const client = {
    currentWindow: win as typeof win | null, registry,
    inventory: { items: () => [stack(finalCarried, 9)].filter(Boolean) },
    transfer: vi.fn(async (arg: { sourceStart: number; sourceEnd: number; count: number; destStart: number }) => {
      if (rejectClick) throw Error('source unchanged');
      const at = slots.findIndex((v, i) => v && i >= arg.sourceStart && i < arg.sourceEnd);
      const to = arg.destStart === 0 ? 1 : 3;
      const amount = Math.min(slots[at]!.count, arg.count);
      slots[at] = stack(slots[at]!.count - amount, at);
      slots[to] = stack((slots[to]?.count ?? 0) + amount, to);
    }),
    closeWindow: vi.fn(() => { finalCarried = closeCarried ?? slots[3]?.count ?? 0; client.currentWindow = null; }),
  };
  const callbacks = { aborted: () => false, recordDecision: vi.fn(), partial: vi.fn() };
  const ctx = callbacks as unknown as SkillContext & typeof callbacks;
  return { bot: client as unknown as Bot, ctx, client };
}
async function terminal(promise: Promise<string>) {
  const result = promise.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(3500);
  return result;
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it.each([
  { source: 64, close: 12, expected: 12 }, { source: 5, close: 5, expected: 5 },
  { source: 64, close: 4, expected: 4 }, { source: 64, close: 0, expected: null },
  { source: 64, close: 12, reject: true, expected: null },
])('reconciles take from source and carried counts, including unrelated pickups: %j', async test => {
  const { bot, ctx, client } = fixture(test.source, 0, test.close, test.reject);
  const result = await terminal(takeFromOpenWindow(bot, { skill: 'take', from: 'open', item, count: 12 }, ctx));
  if (test.expected === null) {
    expect(result).toBeInstanceOf(SkillBlocked);
    expect((result as SkillBlocked).decision).toMatchObject({ status: 'unknown', completed: null, remaining: null,
      retryable: false, next_safe_read: { tool: 'mc_bag', arguments: { item, detail: 'slots' } } });
  } else {
    expect(ctx.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ unit: 'items',
      completed: test.expected, remaining: 12 - test.expected, status: test.expected === 12 ? 'completed' : 'partial' }));
  }
  expect(client.transfer).toHaveBeenCalledTimes(1);
});

it.each([
  { carried: 12, close: 0, expected: 12 }, { carried: 5, close: 0, expected: 5 },
  { carried: 12, close: 8, expected: 4 }, { carried: 12, close: 12, expected: null },
  { carried: 12, close: 0, reject: true, expected: null },
])('reconciles stow with both sides, including unrelated losses: %j', async test => {
  const { bot, ctx, client } = fixture(8, test.carried, test.close, test.reject);
  const result = await terminal(stowIntoOpenWindow(bot, { skill: 'stow', into: 'open', item, count: 12 }, ctx));
  if (test.expected === null) {
    expect((result as SkillBlocked).decision).toMatchObject({ status: 'unknown', completed: null, retryable: false });
  } else {
    expect(ctx.recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      status: test.expected === 12 ? 'completed' : 'partial', completed: test.expected, remaining: 12 - test.expected }));
  }
  expect(client.transfer).toHaveBeenCalledTimes(1);
});

it('keeps the same window usable, without counting its provisional change as a completed withdrawal', async () => {
  const { bot, ctx, client } = fixture(64, 0, 0);
  const step = { skill: 'take', from: 'open', item, count: 6 } as const;
  const first: SkillContext = { ...ctx, batch: { steps: [step, step], index: 0, absorb: vi.fn() } };
  expect(await terminal(takeFromOpenWindow(bot, step, first))).toContain('暂见');
  expect(client.currentWindow).not.toBeNull();
  expect(ctx.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown', completed: null }));
  const second = await terminal(takeFromOpenWindow(bot, step, ctx));
  expect((second as SkillBlocked).decision).toMatchObject({ status: 'unknown', completed: null });
  expect(client.closeWindow).toHaveBeenCalledTimes(1);
});

it('does not count opening an item GUI as work on a quantitative transfer that remained unknown', () => {
  const windowOnly = { schema: 'agent-mc-observed-effect/v1', status: 'changed',
    changed: { window: true, position: false, target: null, inventory: false } } as ObservedEffect;
  expect(taskEffectProgress([
    { skill: 'use', outcome: 'ok', observedEffect: windowOnly },
    { skill: 'take', outcome: 'fail', observedEffect: windowOnly, decision: { unit: 'items', completed: null, status: 'unknown' } },
  ])).toMatchObject({ observation: 'changed', workObservation: 'unknown', goalVerified: false });
});

it('restricts the click to the selected named stack even when another stack shares its registry ID', async () => {
  const { bot, ctx, client } = fixture(8, 0);
  const win = client.currentWindow!;
  win.slots[0] = Object.assign(stack(5, 0)!, { customName: 'ordinary' });
  Object.assign(win.slots[1]!, { customName: 'reserved' });
  // Retain names across the simulated transfer and window close for verification.
  client.transfer.mockImplementationOnce(async q => {
    expect([q.sourceStart, q.sourceEnd]).toEqual([1, 2]);
    win.slots[1]!.count -= q.count;
    win.slots[3] = Object.assign(stack(q.count, 3)!, { customName: 'reserved' });
  });
  client.inventory.items = () => win.items();
  expect(await terminal(takeFromOpenWindow(bot, { skill: 'take', from: 'open', item, count: 2, pick: 'reserved' }, ctx))).toContain('×2');
  expect(win.slots[0]!.count).toBe(5);
  expect(ctx.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', completed: 2 }));
});

it('records zero performed actions when the item is absent from this window', async () => {
  for (const dir of ['take', 'stow'] as const) {
    const { bot, ctx, client } = fixture(0, 0);
    const result = await terminal(dir === 'take'
      ? takeFromOpenWindow(bot, { skill: 'take', from: 'open', item, count: 4 }, ctx)
      : stowIntoOpenWindow(bot, { skill: 'stow', into: 'open', item, count: 4 }, ctx));
    expect((result as SkillBlocked).decision).toMatchObject({ status: 'blocked', completed: 0, remaining: 4, unit: 'items' });
    expect(client.transfer).not.toHaveBeenCalled();
  }
});
