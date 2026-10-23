import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { expect, it, vi } from 'vitest';
import { observeViewerContainer } from '../core/viewer-container-observation.ts';

function fixture() {
  const bot = Object.assign(new EventEmitter(), { currentWindow: null as Bot['currentWindow'] });
  const received: (number | null)[] = [];
  const publish = () => received.push(bot.currentWindow?.id ?? null);
  const window = (id: number) => Object.assign(new EventEmitter(), { id }) as unknown as NonNullable<Bot['currentWindow']>;
  const open = (w: NonNullable<Bot['currentWindow']>) => { bot.currentWindow = w; bot.emit('windowOpen', w); };
  // Mineflayer sets currentWindow=null before emitting windowClose, for both
  // its local closeWindow path and the server close_window packet handler.
  const close = () => { const old = bot.currentWindow; bot.currentWindow = null; bot.emit('windowClose', old); };
  return { bot, received, publish, window, open, close };
}

it('delivers a confirmed window that opens and closes between two 150ms polls', () => {
  vi.useFakeTimers();
  const h = fixture();
  const stop = observeViewerContainer(h.bot as unknown as Bot, h.publish);
  const timer = setInterval(h.publish, 150);
  try {
    h.open(h.window(4));
    vi.advanceTimersByTime(15);
    h.close();
    expect(h.received).toEqual([4, null]);
    vi.advanceTimersByTime(135);
    expect(h.received).toEqual([4, null, null]);
  } finally { stop(); clearInterval(timer); vi.useRealTimers(); }
});

it('coalesces a slot packet and detaches the closed or replaced window', async () => {
  const h = fixture(), first = h.window(3), next = h.window(4);
  const stop = observeViewerContainer(h.bot as unknown as Bot, h.publish);
  h.open(first);
  for (let i = 0; i < 90; i++) first.emit('updateSlot', i);
  await Promise.resolve();
  expect(h.received).toEqual([3, 3]);
  h.open(next);
  expect(first.listenerCount('updateSlot')).toBe(0);
  h.close();
  expect(next.listenerCount('updateSlot')).toBe(0);
  first.emit('updateSlot', 0); next.emit('updateSlot', 0);
  await Promise.resolve();
  expect(h.received).toEqual([3, 3, 4, null]);
  stop();
});

it('observes an already-open window and cancels queued publication on viewer teardown', async () => {
  const h = fixture(), w = h.window(6);
  h.bot.currentWindow = w;
  const stop = observeViewerContainer(h.bot as unknown as Bot, h.publish);
  w.emit('updateSlot', 0);
  stop(); stop();
  await Promise.resolve();
  expect(h.received).toEqual([]);
  expect(w.listenerCount('updateSlot')).toBe(0);
  expect(h.bot.listenerCount('windowOpen')).toBe(0);
  expect(h.bot.listenerCount('windowClose')).toBe(0);
});
