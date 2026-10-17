import { onConnectionEnd } from './connection-end.ts';
import { randomUUID } from 'node:crypto';

export interface DeathLifecycle {
  episodeId: string;
  phase: 'dead' | 'respawn_pending' | 'alive';
  observedAt: string;
  respawnAt: string | null;
  /** A full player inventory packet received after this episode's native respawn. */
  inventorySynced?: boolean;
}
interface DeathBot {
  health: number;
  deathLifecycle?: DeathLifecycle;
  inventory?: { slots: unknown[] };
  _client?: { on(event: string, listener: (packet: { windowId: number; items: unknown[] }) => void): unknown;
    removeListener(event: string, listener: (packet: { windowId: number; items: unknown[] }) => void): unknown };
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
  respawn(): void;
}

export function respawnDelay(value: number | undefined): number {
  const delay = value ?? 4000;
  if (!Number.isInteger(delay) || delay < 0 || delay > 15000) throw new Error('deathRespawnDelayMs must be an integer from 0 to 15000');
  return delay;
}

/** One timer belongs to this exact connection. Native/server early respawn wins. */
export function installDeathLifecycle(bot: DeathBot, delayMs: number | undefined, current: () => boolean) {
  const delay = respawnDelay(delayMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dead = false;
  let respawnObserved = false;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (bot.deathLifecycle?.phase === 'respawn_pending') bot.deathLifecycle = { ...bot.deathLifecycle, phase: 'dead', respawnAt: null };
  };
  const death = () => {
    if (dead || !current()) return;
    dead = true;
    respawnObserved = false;
    const now = Date.now();
    bot.deathLifecycle = { episodeId: randomUUID(), phase: 'respawn_pending', observedAt: new Date(now).toISOString(),
      respawnAt: new Date(now + delay).toISOString(), inventorySynced: false };
    timer = setTimeout(() => {
      timer = null;
      if (!dead || !current() || bot.health > 0) return;
      bot.deathLifecycle = { ...bot.deathLifecycle!, phase: 'dead', respawnAt: null };
      bot.respawn(); // Exactly once; never retry an uncertain protocol dispatch.
    }, delay);
  };
  const spawn = () => {
    cancel();
    dead = false;
    if (bot.deathLifecycle) bot.deathLifecycle = { ...bot.deathLifecycle, phase: 'alive', respawnAt: null };
  };
  const respawn = () => {
    cancel();
    if (!current() || !dead || !bot.deathLifecycle) return;
    respawnObserved = true;
    bot.deathLifecycle = { ...bot.deathLifecycle, inventorySynced: false };
  };
  const inventory = (packet: { windowId: number; items: unknown[] }) => {
    if (!current() || !respawnObserved || !bot.deathLifecycle || packet.windowId !== 0
      || !Array.isArray(packet.items) || packet.items.length < (bot.inventory?.slots.length ?? 46)) return;
    // Packet listeners run synchronously. Mineflayer applies these slots before
    // the next facts request; spawn may come before or after this packet.
    bot.deathLifecycle = { ...bot.deathLifecycle, inventorySynced: true };
  };
  bot.on('death', death);
  bot.on('respawn', respawn); // Native packet precedes spawn/positive health; it already satisfies the dispatch.
  bot._client?.on('window_items', inventory);
  bot.on('spawn', spawn);
  const detachEnd = onConnectionEnd(bot, cancel);
  return { cancel, dispose: () => {
    cancel();
    bot.removeListener('death', death);
    bot.removeListener('respawn', respawn);
    bot._client?.removeListener('window_items', inventory);
    bot.removeListener('spawn', spawn);
    detachEnd();
  } };
}
