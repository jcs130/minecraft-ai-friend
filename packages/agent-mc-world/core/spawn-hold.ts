/**
 * Client-side spawn movement policy. Claimed spawn may silently resync
 * position; auto-walking there can look like cheating. Stay still until the
 * first play position is stable, or the host explicitly starts a move.
 */
export interface SpawnHoldStatus {
  stable: boolean;
  reason: string | null;
  resyncCount: number;
}

export interface SpawnHold {
  stable(): boolean;
  status(): SpawnHoldStatus;
  /** Host-initiated movement may proceed immediately. */
  release(reason?: string): void;
  dispose(): void;
}

export interface SpawnHoldOptions {
  stableMs?: number;
  resyncThreshold?: number;
}

type PositionPacket = { x?: number; y?: number; z?: number; flags?: unknown };

export function installSpawnMovementHold(bot: {
  entity?: { position?: { x: number; y: number; z: number } } | null;
  _client?: {
    state?: string;
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
  };
}, options: SpawnHoldOptions = {}): SpawnHold {
  const stableMs = Number.isFinite(options.stableMs) ? Math.max(0, options.stableMs!) : 1500;
  const threshold = Number.isFinite(options.resyncThreshold) ? options.resyncThreshold! : 0.05;
  let stable = false;
  let reason: string | null = 'awaiting-spawn-position';
  let resyncCount = 0;
  let last: { x: number; y: number; z: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const arm = (nextReason: string): void => {
    if (closed || stable) return;
    reason = nextReason;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (closed || stable) return;
      stable = true;
      reason = null;
    }, stableMs);
    timer.unref?.();
  };

  const onPosition = (packet: PositionPacket): void => {
    if (closed || stable || bot._client?.state === 'configuration') return;
    const x = Number(packet.x), y = Number(packet.y), z = Number(packet.z);
    if (![x, y, z].every(Number.isFinite)) return;
    if (last && (Math.abs(x - last.x) > threshold || Math.abs(y - last.y) > threshold || Math.abs(z - last.z) > threshold)) {
      resyncCount++;
      arm('position-resync');
    } else if (!last) {
      arm('awaiting-spawn-stable');
    }
    last = { x, y, z };
  };

  const client = bot._client;
  client?.on('position', onPosition as never);

  return {
    stable: () => stable,
    status: () => ({ stable, reason, resyncCount }),
    release(releaseReason = 'host-move') {
      if (closed || stable) { reason = stable ? null : reason; return; }
      stable = true;
      reason = null;
      clearTimeout(timer);
      void releaseReason;
    },
    dispose() {
      closed = true;
      clearTimeout(timer);
      client?.off('position', onPosition as never);
    },
  };
}
