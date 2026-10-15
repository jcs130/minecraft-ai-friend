import { randomUUID } from 'node:crypto';

export interface DeathLifecycle {
  episodeId: string;
  phase: 'dead' | 'respawn_pending' | 'alive';
  observedAt: string;
  respawnAt: string | null;
}
interface DeathBot {
  health: number;
  deathLifecycle?: DeathLifecycle;
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
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (bot.deathLifecycle?.phase === 'respawn_pending') bot.deathLifecycle = { ...bot.deathLifecycle, phase: 'dead', respawnAt: null };
  };
  const death = () => {
    if (dead || !current()) return;
    dead = true;
    const now = Date.now();
    bot.deathLifecycle = { episodeId: randomUUID(), phase: 'respawn_pending', observedAt: new Date(now).toISOString(),
      respawnAt: new Date(now + delay).toISOString() };
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
  bot.on('death', death);
  bot.on('spawn', spawn);
  bot.on('end', cancel);
  return { cancel, dispose: () => {
    cancel();
    bot.removeListener('death', death);
    bot.removeListener('spawn', spawn);
    bot.removeListener('end', cancel);
  } };
}
