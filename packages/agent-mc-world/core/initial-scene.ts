import type { EventEmitter } from 'node:events';

/** The login entity can precede chunks and the player list. A short quiet
 * window waits for the initial list burst, never claims the list is complete.
 * This only delays narration; it does not freeze controls or repeat a greeting. */
export function observeInitialScene(bot: EventEmitter & {
  username?: string; players?: Record<string, unknown>;
  entity?: { position: { offset(x: number, y: number, z: number): unknown } };
  blockAt?(position: unknown): unknown;
}, current: () => boolean, ready: () => void): () => void {
  let disposed = false, changed = Date.now();
  const started = changed;
  const updated = () => { changed = Date.now(); };
  const dispose = () => {
    if (disposed) return; disposed = true; clearInterval(timer);
    for (const event of ['playerJoined', 'playerLeft']) bot.off(event, updated);
    for (const event of ['end', 'respawn', 'death']) bot.off(event, dispose);
  };
  const timer = setInterval(() => {
    if (!current() || Date.now() - started > 60_000) { dispose(); return; }
    if (Date.now() - started < 1000 || Date.now() - changed < 500) return;
    const pos = bot.entity?.position;
    if (!pos || !bot.username || !bot.players?.[bot.username]) return;
    try {
      // Nine columns cover the 16-block summary footprint, including corners.
      for (const x of [-16, 0, 16]) for (const z of [-16, 0, 16])
        if (!bot.blockAt?.(pos.offset(x, 0, z))) return;
    } catch { return; }
    dispose(); ready();
  }, 100);
  timer.unref?.();
  for (const event of ['playerJoined', 'playerLeft']) bot.on(event, updated);
  for (const event of ['end', 'respawn', 'death']) bot.once(event, dispose);
  return dispose;
}
