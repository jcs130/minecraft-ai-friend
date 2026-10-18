import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOnce } from '../core/skills-interact.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.21.1');
const Item = req('prismarine-item')(registry);

function rig(change: 'after' | 'consume' | 'before' | 'none') {
  const original = new Item(registry.itemsByName.written_book.id, 1);
  original.customName = 'Travel journal';
  const replacement = new Item(registry.itemsByName.written_book.id, 1);
  replacement.customName = original.customName;
  replacement.nbt = { type: 'compound', value: { revision: { type: 'int', value: 2 } } };
  const slots = Array(46).fill(null);
  slots[36] = original;
  const sent = vi.fn();
  const bot = {
    registry, heldItem: original,
    inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean) },
    currentWindow: null,
    equip: vi.fn(async (item: typeof original) => { bot.heldItem = item; }),
    _client: { write: sent },
    activateItem: vi.fn(async () => {
      if (change === 'before') bot.heldItem = replacement;
      bot._client.write('use_item', { hand: 0, sequence: 1 });
      if (change === 'after' || change === 'consume') {
        slots[36] = change === 'consume' ? null : replacement;
        bot.heldItem = slots[36];
      }
    }),
    deactivateItem: vi.fn(),
  };
  return { bot, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['after', 'consume'] as const)('retains the sent receipt when the server changes the hand %s activation', async change => {
  const { bot, sent } = rig(change);
  const work = useOnce(bot as unknown as Bot, { skill: 'use', item: 'written_book' }, { aborted: () => false } as never)
    .then(value => ({ value, error: null }), error => ({ value: '', error }));
  await vi.runAllTimersAsync();
  const result = await work;
  expect(result.error).toBeNull();
  expect(result.value).toContain('发送了使用请求');
  expect(sent).toHaveBeenCalledTimes(1);
  expect(sent).toHaveBeenCalledWith('use_item', { hand: 0, sequence: 1 });
  expect(bot.activateItem).toHaveBeenCalledTimes(1);
  expect(bot.deactivateItem).not.toHaveBeenCalled();
  expect(bot.equip).toHaveBeenCalledTimes(1);
  expect(bot.equip.mock.invocationCallOrder[0]).toBeLessThan(sent.mock.invocationCallOrder[0]);
});

it('still rejects a replacement before the native packet is sent', async () => {
  const { bot, sent } = rig('before');
  await expect(useOnce(bot as unknown as Bot, { skill: 'use', item: 'written_book' },
    { aborted: () => false } as never)).rejects.toThrow('没有发送这次使用');
  expect(sent).not.toHaveBeenCalled();
  expect(bot.deactivateItem).not.toHaveBeenCalled();
});

it('releases the original unchanged hand once without claiming an observed world effect', async () => {
  const { bot, sent } = rig('none');
  const work = useOnce(bot as unknown as Bot, { skill: 'use', item: 'written_book' }, { aborted: () => false } as never);
  const verified = expect(work).resolves.toContain('库存读不出有没有发生什么');
  await vi.runAllTimersAsync();
  await verified;
  expect(sent).toHaveBeenCalledTimes(1);
  expect(bot.deactivateItem).toHaveBeenCalledTimes(1);
});
