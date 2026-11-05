import type { EventEmitter } from 'node:events';

interface BodyBot extends EventEmitter {
  _client: EventEmitter & { state?: string };
  physicsEnabled?: boolean;
  health?: number;
  entity?: { position?: { x: number; y: number; z: number } };
}

export interface NativeBodyReadiness {
  phase: 'waiting-position' | 'waiting-physics' | 'controlled-flight' | 'ready' | 'closed';
  boundary: 'attached' | 'login' | 'death' | 'respawn' | 'configuration' | 'mount';
  boundaryAt: number;
  positionAt: number | null;
  physicsAt: number | null;
  movementAt: number | null;
}

const readers = new WeakMap<object, () => NativeBodyReadiness>();
const flightTrackers = new WeakMap<object, (active: () => boolean) => (() => void) | null>();
/** Normal native physics is 20 Hz; this is a liveness bound, not an FPS estimate. */
const TICK_STALE_MS = 5_000;

/** Read-only lifecycle observer. Never sends packets, changes physics or starts a body. */
export function installNativeBodyReadiness(bot: BodyBot,
  observe?: (event: 'boundary' | 'position' | 'physics-ready', state: NativeBodyReadiness) => void,
): { read(): NativeBodyReadiness; dispose(): void } {
  const existing = readers.get(bot);
  if (existing) return { read: existing, dispose() {} };
  let closed = false;
  let flight: (() => boolean) | undefined;
  let state: NativeBodyReadiness = { phase: 'waiting-position', boundary: 'attached',
    boundaryAt: Date.now(), positionAt: null, physicsAt: null, movementAt: null };
  const finitePosition = () => {
    const p = bot.entity?.position;
    return !!p && [p.x, p.y, p.z].every(Number.isFinite);
  };
  const inPlay = () => bot._client.state === undefined || bot._client.state === 'play';
  const read = (): NativeBodyReadiness => {
    let phase: NativeBodyReadiness['phase'] = 'waiting-physics';
    if (closed) phase = 'closed';
    else if (state.positionAt === null || !finitePosition()) phase = 'waiting-position';
    else if (state.physicsAt !== null && inPlay() && Number.isFinite(bot.health) && bot.health! > 0) {
      // Mineflayer stops physicsTick during owned flight but still sends movement
      // updates (including a stationary position heartbeat about once a second).
      // Neither a permission flag nor an arbitrary physicsEnabled=false is ownership.
      if (bot.physicsEnabled === false && flight?.()
        && Date.now() - Math.max(state.physicsAt, state.movementAt ?? 0) <= TICK_STALE_MS) phase = 'controlled-flight';
      else if (bot.physicsEnabled !== false && Date.now() - state.physicsAt <= TICK_STALE_MS) phase = 'ready';
    }
    return { ...state, phase };
  };
  const reset = (boundary: NativeBodyReadiness['boundary']) => {
    flight = undefined;
    state = { phase: 'waiting-position', boundary, boundaryAt: Date.now(), positionAt: null, physicsAt: null, movementAt: null };
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
    if (!closed && inPlay() && bot.physicsEnabled !== false && state.positionAt !== null && p && [p.x, p.y, p.z].every(Number.isFinite)) {
      const first = state.physicsAt === null;
      state.physicsAt = Date.now();
      if (first) observe?.('physics-ready', read());
    }
  };
  const move = () => {
    if (!closed && inPlay() && state.physicsAt !== null && finitePosition()) state.movementAt = Date.now();
  };
  const dispose = () => {
    if (closed) return;
    closed = true;
    flight = undefined;
    // Keep the closed reading on this obsolete bot, so it cannot silently become unmanaged.
    bot.off('login', login); bot.off('death', death); bot.off('respawn', respawn); bot.off('mount', mount);
    bot.off('physicsTick', tick); bot.off('move', move); bot.off('end', dispose);
    bot._client.off('state', protocol); bot._client.off('position', position); bot._client.off('end', dispose);
  };
  readers.set(bot, read);
  flightTrackers.set(bot, active => {
    // Only a body with native physics in this position epoch may hand off control.
    if (read().phase !== 'ready') return null;
    flight = active;
    return () => { if (flight === active) flight = undefined; };
  });
  bot.on('login', login); bot.on('death', death); bot.on('respawn', respawn); bot.on('mount', mount);
  bot.on('physicsTick', tick); bot.on('move', move); bot.once('end', dispose);
  bot._client.on('state', protocol); bot._client.on('position', position); bot._client.once('end', dispose);
  return { read, dispose };
}

/** No installation retains a legacy consumer's explicit compatibility behavior. */
export function nativeBodyReadiness(bot: object): NativeBodyReadiness | null { return readers.get(bot)?.() ?? null; }

/** @internal Flight-controller handoff; never creates position or physics evidence. */
export function trackNativeFlightControl(bot: object, active: () => boolean): (() => void) | null {
  const track = flightTrackers.get(bot);
  return track ? track(active) : () => {}; // Explicit legacy, unobserved consumer.
}

/** A chat packet needs transport/authentication, but does not need locomotion physics. */
export function nativeBodyBlockedReason(bot: object, skill?: string): string | null {
  if (skill === 'chat') return null;
  const state = nativeBodyReadiness(bot);
  if (!state || state.phase === 'ready') return null;
  if (state.phase === 'controlled-flight') {
    // control has its own mode check: ground/water inputs reject active flight.
    if (skill === 'land' || skill === 'flight' || skill === 'control') return null;
    return '原生身体正由飞行控制器悬停；继续飞行或调用 land 安全落地后再执行本步。';
  }
  if (state.phase === 'closed') return '原生身体所属连接已结束，本步未执行；旧动作不得重放。';
  return state.phase === 'waiting-position'
    ? '原生身体尚未收到本次登录/重生/切换后的服务器位置，旧坐标不是当前落点；本步未执行，等待位置同步。'
    : '原生身体的位置已收到，但物理更新尚未恢复或已经中断；本步未执行，不能把排队或正血量当成行动成功。';
}
