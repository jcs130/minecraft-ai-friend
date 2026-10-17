import type { Bot } from 'mineflayer';
import type { EventEmitter } from 'node:events';

/** Observe confirmed window lifecycle immediately. A polling fallback alone
 * loses an entire fast craft/open/close cycle between two timer ticks. */
export function observeViewerContainer(
  bot: Pick<Bot, 'on' | 'off' | 'currentWindow'>,
  publish: () => void,
): () => void {
  // prismarine-windows emits updateSlot; the Mineflayer declaration erases
  // its event map. Keep the emitter interface at this protocol boundary.
  let observed: EventEmitter | null = null;
  let disposed = false;
  let queued = false;
  // One server packet can update every slot. Publish its settled snapshot
  // once, while window open/close remain synchronous and cannot be coalesced.
  const onSlot = () => {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) publish();
    });
  };
  const onLifecycle = () => {
    observed?.off('updateSlot', onSlot);
    observed = bot.currentWindow as unknown as EventEmitter | null;
    observed?.on('updateSlot', onSlot);
    publish();
  };
  bot.on('windowOpen', onLifecycle);
  bot.on('windowClose', onLifecycle);
  observed = bot.currentWindow as unknown as EventEmitter | null;
  observed?.on('updateSlot', onSlot);
  return () => {
    if (disposed) return;
    disposed = true;
    bot.off('windowOpen', onLifecycle);
    bot.off('windowClose', onLifecycle);
    observed?.off('updateSlot', onSlot);
    observed = null;
  };
}
