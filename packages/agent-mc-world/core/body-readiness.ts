import type { EventEmitter } from 'node:events';

interface BodyBot extends EventEmitter {
  _client: EventEmitter & { state?: string };
  physicsEnabled?: boolean;
  health?: number;
  entity?: { position?: { x: number; y: number; z: number } };
}

export interface NativeBodyReadiness {
  phase: 'waiting-position' | 'waiting-physics' | 'ready' | 'closed';
  boundary: 'attached' | 'login' | 'death' | 'respawn' | 'configuration' | 'mount';
  boundaryAt: number;
  positionAt: number | null;
  physicsAt: number | null;
}

const readers = new WeakMap<object, () => NativeBodyReadiness>();
/** Normal native physics is 20 Hz; this is a liveness bound, not an FPS estimate. */
const TICK_STALE_MS = 5_000;

/** Read-only lifecycle observer. Never sends packets, changes physics or starts a body. */
export function installNativeBodyReadiness(bot: BodyBot,
  observe?: (event: 'boundary' | 'position' | 'physics-ready', state: NativeBodyReadiness) => void,
): { read(): NativeBodyReadiness; dispose(): void } {
  const existing = readers.get(bot);
  if (existing) return { read: existing, dispose() {} };
  let closed = false;
  let state: NativeBodyReadiness = { phase: 'waiting-position', boundary: 'attached',
    boundaryAt: Date.now(), positionAt: null, physicsAt: null };
  const read = (): NativeBodyReadiness => ({ ...state,
    phase: closed ? 'closed' : state.positionAt === null ? 'waiting-position'
      : state.physicsAt === null || Date.now() - state.physicsAt > TICK_STALE_MS
        || bot._client.state !== undefined && bot._client.state !== 'play'
        || bot.physicsEnabled === false || (bot.health ?? 0) <= 0 ? 'waiting-physics' : 'ready' });
  const reset = (boundary: NativeBodyReadiness['boundary']) => {
    state = { phase: 'waiting-position', boundary, boundaryAt: Date.now(), positionAt: null, physicsAt: null };
    observe?.('boundary', read());
  };
  const login = () => reset('login'), death = () => reset('death'), respawn = () => reset('respawn');
  const mount = () => reset('mount');
  const protocol = (phase: string) => { if (phase === 'configuration') reset('configuration'); };
  const position = () => {
    if (closed || bot._client.state !== undefined && bot._client.state !== 'play') return;
    // A decoded server position is evidence of a new landing; positive health/spawn is not.
    const first = state.positionAt === null;
    if (first) state.physicsAt = null;
    state.positionAt = Date.now();
    if (first) observe?.('position', read());
  };
  const tick = () => {
    const p = bot.entity?.position;
    if (!closed && state.positionAt !== null && p && [p.x, p.y, p.z].every(Number.isFinite)) {
      const first = state.physicsAt === null;
      state.physicsAt = Date.now();
      if (first) observe?.('physics-ready', read());
    }
  };
  const dispose = () => {
    if (closed) return;
    closed = true;
    // Keep the closed reading on this obsolete bot, so it cannot silently become unmanaged.
    bot.off('login', login); bot.off('death', death); bot.off('respawn', respawn); bot.off('mount', mount);
    bot.off('physicsTick', tick); bot.off('end', dispose);
    bot._client.off('state', protocol); bot._client.off('position', position); bot._client.off('end', dispose);
  };
  readers.set(bot, read);
  bot.on('login', login); bot.on('death', death); bot.on('respawn', respawn); bot.on('mount', mount);
  bot.on('physicsTick', tick); bot.once('end', dispose);
  bot._client.on('state', protocol); bot._client.on('position', position); bot._client.once('end', dispose);
  return { read, dispose };
}

/** No installation retains a legacy consumer's explicit compatibility behavior. */
export function nativeBodyReadiness(bot: object): NativeBodyReadiness | null { return readers.get(bot)?.() ?? null; }

/** A chat packet needs transport/authentication, but does not need locomotion physics. */
export function nativeBodyBlockedReason(bot: object, skill?: string): string | null {
  if (skill === 'chat') return null;
  const state = nativeBodyReadiness(bot);
  if (!state || state.phase === 'ready') return null;
  if (state.phase === 'closed') return '原生身体所属连接已结束，本步未执行；旧动作不得重放。';
  return state.phase === 'waiting-position'
    ? '原生身体尚未收到本次登录/重生/切换后的服务器位置，旧坐标不是当前落点；本步未执行，等待位置同步。'
    : '原生身体的位置已收到，但物理更新尚未恢复或已经中断；本步未执行，不能把排队或正血量当成行动成功。';
}
