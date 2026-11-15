import type { EventEmitter } from 'node:events';
import { nativeBodyReadiness } from './body-readiness.ts';
import { serverWindows } from './orphan-windows.ts';

/**
 * Post-respawn liveness check.
 *
 * Some plugin servers (Folia + forced-respawn plugins) send the respawn packet
 * before, or instead of, the health=0 edge Mineflayer uses for `death`, so the
 * client can stay in a half-dead state: no physics ticks, no movement packets,
 * and server commands rejected as if a screen were open. This watchdog only
 * reads state, then performs at most one vanilla-client-equivalent repair per
 * respawn boundary:
 * - a dead or never-revived client sends the normal "perform respawn" request
 *   (the server ignores it for a living player);
 * - a revived client that missed Mineflayer's alive edge is marked alive and
 *   sends `player_loaded` (1.21.4+), like the vanilla client after loading;
 * - a server window still tracked across the boundary is closed.
 * It never moves the player, retries, or reconnects.
 */
export interface RespawnWatchdogBot extends EventEmitter {
  _client: EventEmitter & { state?: string; write(name: string, params: unknown): unknown };
  isAlive?: boolean;
  health?: number;
  food?: number;
  physicsEnabled?: boolean;
  entity?: { position?: { x: number; y: number; z: number } } | null;
  blockAt?: (pos: { x: number; y: number; z: number }) => unknown;
  supportFeature?: (name: string) => boolean;
  world?: { async?: { columns?: Record<string, unknown> } };
}

export interface RespawnDiagnosis {
  at: number;
  boundary: string | null;
  phase: string | null;
  sinceBoundaryMs: number | null;
  isAlive: boolean | null;
  health: number | null;
  food: number | null;
  protocolState: string | null;
  physicsEnabled: boolean | null;
  position: [number, number, number] | null;
  chunkLoaded: boolean | null;
  loadedColumns: number | null;
  serverWindow: number | null;
  repairs: string[];
}

export interface RespawnWatchdogOptions {
  checkMs?: number;
  finalMs?: number;
  onDiagnosis?: (diag: RespawnDiagnosis, final: boolean) => void;
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;

export function diagnoseBody(bot: RespawnWatchdogBot): RespawnDiagnosis {
  const ready = nativeBodyReadiness(bot);
  const p = bot.entity?.position;
  const pos = p && [p.x, p.y, p.z].every(Number.isFinite) ? [p.x, p.y, p.z] as [number, number, number] : null;
  let chunkLoaded: boolean | null = null;
  if (pos && typeof bot.blockAt === 'function') {
    try { chunkLoaded = bot.blockAt({ x: pos[0], y: pos[1], z: pos[2] } as never) != null; } catch { chunkLoaded = null; }
  }
  const columns = bot.world?.async?.columns;
  return { at: Date.now(), boundary: ready?.boundary ?? null, phase: ready?.phase ?? null,
    sinceBoundaryMs: ready ? Date.now() - ready.boundaryAt : null,
    isAlive: typeof bot.isAlive === 'boolean' ? bot.isAlive : null, health: num(bot.health), food: num(bot.food),
    protocolState: bot._client.state ?? null,
    physicsEnabled: typeof bot.physicsEnabled === 'boolean' ? bot.physicsEnabled : null,
    position: pos, chunkLoaded, loadedColumns: columns ? Object.keys(columns).length : null,
    serverWindow: serverWindows(bot as never)?.current()?.id ?? null, repairs: [] };
}

export function installRespawnWatchdog(bot: RespawnWatchdogBot, options: RespawnWatchdogOptions = {}): () => void {
  const checkMs = options.checkMs ?? 5000, finalMs = options.finalMs ?? 15000;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let disposed = false;
  const clear = () => { for (const t of timers) clearTimeout(t); timers = []; };
  const stuck = () => {
    const phase = nativeBodyReadiness(bot)?.phase;
    return phase === 'waiting-physics' || phase === 'waiting-position';
  };
  const inPlay = () => bot._client.state === undefined || bot._client.state === 'play';
  const repair = (diag: RespawnDiagnosis) => {
    if (!inPlay()) return;
    const health = diag.health;
    if (bot.isAlive === false && health !== null && health > 0) {
      bot.isAlive = true;
      diag.repairs.push('mark-alive');
      if (bot.supportFeature?.('sendsPlayerLoadedPacket')) {
        try { bot._client.write('player_loaded', {}); diag.repairs.push('player_loaded'); } catch { /* connection closing */ }
      }
    } else if (bot.isAlive === false || (health !== null && health <= 0)) {
      try {
        bot._client.write('client_command', bot.supportFeature?.('respawnIsPayload') ? { payload: 0 } : { actionId: 0 });
        diag.repairs.push('respawn-request');
      } catch { /* connection closing */ }
    }
    if (diag.serverWindow !== null) {
      try { if (serverWindows(bot as never)?.close()) diag.repairs.push(`close-window-${diag.serverWindow}`); } catch { /* ignore */ }
    }
  };
  const onBoundary = () => {
    clear();
    if (disposed) return;
    timers.push(setTimeout(() => {
      if (disposed || !stuck()) return;
      const diag = diagnoseBody(bot);
      repair(diag);
      options.onDiagnosis?.(diag, false);
    }, checkMs));
    timers.push(setTimeout(() => {
      if (disposed || !stuck()) return;
      options.onDiagnosis?.(diagnoseBody(bot), true);
    }, finalMs));
    for (const t of timers) t.unref?.();
  };
  const onEnd = () => dispose();
  const dispose = () => {
    if (disposed) return;
    disposed = true; clear();
    bot.off('respawn', onBoundary); bot.off('end', onEnd);
  };
  // Only the server's respawn packet; a normal death is handled by death-lifecycle,
  // whose own respawn request produces this packet and then this check.
  bot.on('respawn', onBoundary); bot.once('end', onEnd);
  return dispose;
}
