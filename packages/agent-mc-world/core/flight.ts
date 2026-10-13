import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { SkillBlocked, sleep } from './skill-context.ts';

interface FlightAbilities {
  flags: number;
  observedAtMs: number;
  flyingSpeed: number;
  speedObserved: boolean;
  requestedFlying?: boolean;
  lastStop?: { reason: string; atMs: number };
  expiresAtMs?: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
}
interface FlightControl {
  physicsEnabled: boolean;
  gravity: number;
  interrupted?: string;
}
export interface FlightState {
  allowed: boolean;
  flying: boolean;
  serverFlying: boolean;
  controlActive: boolean;
  observedAtMs?: number;
  expiresAtMs?: number;
  lastStop?: { reason: string; atMs: number };
}
export interface FlightMoveOptions {
  /** End flight on a safe supporting surface. Otherwise retain flight for the next action. */
  land?: boolean;
}
export interface FlightPreview {
  from: [number, number, number];
  at: [number, number, number];
  land: boolean;
  distance: number;
  estimatedDurationMs: number;
  speedSource: 'server' | 'default';
  /** Ability speed is a protocol value; timing describes actual client execution separately. */
  timing: { source: 'nominal' | 'runtime'; tickMs: number; samples: number; observedAtMs: number | null };
  allowed: boolean;
  remainingMs: number | null;
  timeEnough: boolean | null;
}
const abilities = new WeakMap<Bot, FlightAbilities>();
const controls = new WeakMap<Bot, FlightControl>();
const moving = new WeakSet<Bot>();
const timings = new WeakMap<Bot, { elapsedMs: number; ticks: number; atMs: number }[]>();
const timingEpochs = new WeakMap<Bot, object>();
export const MAX_FLIGHT_DISTANCE = 12;
const FLIGHT_TICK_MS = 50;
const TIMING_MAX_AGE_MS = 5 * 60_000;
const MAX_FLIGHT_MOVE_MS = 10_000;
const DEFAULT_FLYING_SPEED = 0.05;
const HALF_WIDTH = 0.3;
const PLAYER_HEIGHT = 1.8;
const EPSILON = 0.0001;
const HAZARDS = /^(lava|water|magma_block|cactus|fire|soul_fire|campfire|soul_campfire)$/;

/** Permission remains valid until the server revokes it or an adapter supplies an expiry. */
export function watchFlightAbilities(bot: Bot): () => void {
  timingEpochs.set(bot, {});
  const onAbilities = (packet: { flags?: number; flyingSpeed?: number }): void => {
    const old = abilities.get(bot);
    const flags = Number(packet.flags ?? 0);
    const speedObserved = !!packet.flyingSpeed && Number.isFinite(packet.flyingSpeed) && packet.flyingSpeed > 0;
    if (!timingEpochs.has(bot) || (speedObserved && old?.flyingSpeed !== packet.flyingSpeed)) {
      timings.delete(bot);
      timingEpochs.set(bot, {});
    }
    const state: FlightAbilities = {
      flags, observedAtMs: Date.now(),
      flyingSpeed: speedObserved ? packet.flyingSpeed! : old?.flyingSpeed ?? DEFAULT_FLYING_SPEED,
      speedObserved: speedObserved || old?.speedObserved === true,
      expiresAtMs: flags & 4 ? old?.expiresAtMs : undefined,
      expiryTimer: flags & 4 ? old?.expiryTimer : undefined,
      lastStop: old?.lastStop,
    };
    abilities.set(bot, state);
    if (!(flags & 4)) {
      if (old?.expiryTimer) clearTimeout(old.expiryTimer);
      releaseFlight(bot, '服务端已收回飞行权限', false);
    } else if (controls.has(bot) && !(flags & 2)) {
      releaseFlight(bot, '服务端已结束当前飞行', false);
    }
  };
  const reset = (): void => {
    releaseFlight(bot, '连接或维度已变化', false);
    const state = abilities.get(bot);
    if (state?.expiryTimer) clearTimeout(state.expiryTimer);
    abilities.delete(bot);
    timings.delete(bot);
    timingEpochs.delete(bot);
  };
  const forcedMove = (): void => releaseFlight(bot, '服务端修正了位置，已停止飞行移动', true);
  bot._client.on('abilities', onAbilities);
  bot.on('forcedMove', forcedMove);
  bot.on('respawn', reset);
  bot.on('end', reset);
  return () => {
    bot._client.off('abilities', onAbilities);
    bot.off('forcedMove', forcedMove);
    bot.off('respawn', reset);
    bot.off('end', reset);
    reset();
  };
}

/** A server adapter may provide an explicit deadline. No duration is inferred from a spell name. */
export function setFlightExpiry(bot: Bot, expiresAtMs: number | null): void {
  if (expiresAtMs !== null && !Number.isFinite(expiresAtMs)) throw new Error('飞行到期时间必须是有限时间戳');
  const state = abilities.get(bot);
  if (!state) return;
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  state.expiryTimer = undefined;
  state.expiresAtMs = expiresAtMs ?? undefined;
  if (expiresAtMs !== null) {
    state.expiryTimer = setTimeout(() => {
      state.expiryTimer = undefined;
      releaseFlight(bot, '已到服务端声明的飞行期限', true);
    }, Math.max(0, expiresAtMs - Date.now()));
    state.expiryTimer.unref?.();
  }
}

export function flightFlags(bot: Bot, now = Date.now()): number {
  const state = abilities.get(bot);
  if (!state) return 0;
  return state.expiresAtMs !== undefined && now >= state.expiresAtMs ? state.flags & ~6 : state.flags;
}

export function flightState(bot: Bot, now = Date.now()): FlightState {
  const state = abilities.get(bot);
  const allowed = !!(flightFlags(bot, now) & 4);
  return {
    allowed, flying: allowed && (state?.requestedFlying ?? !!(flightFlags(bot, now) & 2)),
    serverFlying: !!(state?.flags && state.flags & 2),
    controlActive: controls.has(bot), lastStop: state?.lastStop,
    observedAtMs: state?.observedAtMs, expiresAtMs: state?.expiresAtMs,
  };
}

function releaseFlight(bot: Bot, reason: string, send: boolean): void {
  const control = controls.get(bot);
  if (!control) return;
  control.interrupted = reason;
  controls.delete(bot);
  bot.physics.gravity = control.gravity;
  bot.physicsEnabled = control.physicsEnabled;
  const state = abilities.get(bot);
  if (state) {
    state.requestedFlying = false;
    state.lastStop = { reason, atMs: Date.now() };
  }
  if (send && ((abilities.get(bot)?.flags ?? 0) & 4)) bot._client.write('abilities', { flags: 0 });
}

/** Restore ordinary physics. Call landFlight first when a controlled landing is required. */
export function stopFlight(bot: Bot): void {
  if (!controls.has(bot)) {
    const state = abilities.get(bot);
    if (flightState(bot).flying) bot._client.write('abilities', { flags: 0 });
    if (state) state.requestedFlying = false;
    return;
  }
  releaseFlight(bot, '飞行已停止', true);
}

async function awaitFlightPermission(bot: Bot, aborted: () => boolean): Promise<void> {
  const waitUntil = Date.now() + 2_000;
  while (!(flightFlags(bot) & 4) && Date.now() < waitUntil) {
    if (aborted()) throw new SkillBlocked('飞行任务已取消');
    await sleep(FLIGHT_TICK_MS);
  }
  if (aborted()) throw new SkillBlocked('飞行任务已取消');
  if (!(flightFlags(bot) & 4)) throw new SkillBlocked('服务端尚未授予飞行能力；先取得飞行许可并查看成功回执');
}

function beginFlight(bot: Bot): FlightControl {
  const current = controls.get(bot);
  if (current) return current;
  const control = { physicsEnabled: bot.physicsEnabled, gravity: bot.physics.gravity };
  if (!flightState(bot).flying) bot._client.write('abilities', { flags: 2 });
  abilities.get(bot)!.requestedFlying = true;
  abilities.get(bot)!.lastStop = undefined;
  controls.set(bot, control);
  bot.clearControlStates();
  bot.physicsEnabled = false;
  bot.physics.gravity = 0;
  return control;
}

/** Direction is a world-space input vector. Each tick starts at the current observed position. */
export async function flyWithInput(bot: Bot, direction: Vec3, durationMs: number,
  aborted: () => boolean, sample: () => void): Promise<void> {
  if (!bot.entity?.position) throw new SkillBlocked('还没进入世界，不能飞行');
  if (moving.has(bot)) throw new SkillBlocked('另一段飞行移动尚未结束');
  moving.add(bot);
  try {
    await awaitFlightPermission(bot, aborted);
    const control = beginFlight(bot);
    const until = Date.now() + durationMs;
    while (Date.now() < until) {
      if (aborted()) throw new SkillBlocked('飞行控制已中断，保持当前悬停位置');
      if (control.interrupted) throw new SkillBlocked(control.interrupted, [], 'server');
      if (!(flightFlags(bot) & 4)) throw new SkillBlocked('服务端飞行许可已结束', [], 'server');
      const tickMs = Math.min(FLIGHT_TICK_MS, until - Date.now());
      const step = Math.min(0.3, abilities.get(bot)!.flyingSpeed * 3) * tickMs / FLIGHT_TICK_MS;
      const offset = direction.norm() > 0 ? direction.scaled(step / direction.norm()) : new Vec3(0, 0, 0);
      const next = bot.entity.position.plus(offset);
      const obstruction = spaceObstruction(bot, next);
      if (obstruction) throw new SkillBlocked(`直接飞行受阻：${obstruction}；已停止移动并悬停`);
      bot.entity.velocity = new Vec3(0, 0, 0);
      bot.entity.onGround = false;
      bot.entity.position = next;
      await sleep(tickMs);
      sample();
    }
    await sleep(150);
    sample();
    if (aborted()) throw new SkillBlocked('飞行控制已中断');
    if (control.interrupted) throw new SkillBlocked(control.interrupted, [], 'server');
    if (!(flightFlags(bot) & 4)) throw new SkillBlocked('服务端飞行许可已结束', [], 'server');
  } finally {
    moving.delete(bot);
  }
}

function collisionShapes(block: NonNullable<ReturnType<Bot['blockAt']>>): number[][] {
  return block.shapes ?? (block.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : []);
}

function spaceObstruction(bot: Bot, pos: Vec3): string | undefined {
  const min = [pos.x - HALF_WIDTH + EPSILON, pos.y + EPSILON, pos.z - HALF_WIDTH + EPSILON];
  const max = [pos.x + HALF_WIDTH - EPSILON, pos.y + PLAYER_HEIGHT - EPSILON, pos.z + HALF_WIDTH - EPSILON];
  // Shapes can extend outside their cell (fences and walls are 1.5 blocks high).
  for (let x = Math.floor(min[0]); x <= Math.floor(max[0]); x++) {
    for (let y = Math.floor(min[1]) - 1; y <= Math.floor(max[1]); y++) {
      for (let z = Math.floor(min[2]); z <= Math.floor(max[2]); z++) {
        const block = bot.blockAt(new Vec3(x, y, z));
        const at = `(${x},${y},${z})`;
        if (!block) return `有未加载区域 @ ${at}`;
        if (y >= Math.floor(min[1]) && HAZARDS.test(block.name)) return `有危险方块或液体 ${block.name} @ ${at}`;
        for (const shape of collisionShapes(block)) {
          if (min[0] < x + shape[3] && max[0] > x + shape[0]
            && min[1] < y + shape[4] && max[1] > y + shape[1]
            && min[2] < z + shape[5] && max[2] > z + shape[2]) return `有碰撞方块 ${block.name} @ ${at}`;
        }
      }
    }
  }
  return undefined;
}

function openForPlayer(bot: Bot, pos: Vec3): boolean {
  return spaceObstruction(bot, pos) === undefined;
}

function routeObstruction(bot: Bot, positions: Vec3[]): string | undefined {
  for (const pos of positions) {
    const obstruction = spaceObstruction(bot, pos);
    if (obstruction) return obstruction;
  }
  return undefined;
}

function hasSupport(bot: Bot, pos: Vec3): boolean {
  const block = bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y - EPSILON), Math.floor(pos.z)));
  if (!block || HAZARDS.test(block.name)) return false;
  const x = pos.x - Math.floor(pos.x), z = pos.z - Math.floor(pos.z);
  const localY = pos.y - Math.floor(pos.y - EPSILON);
  return collisionShapes(block).some(shape => Math.abs(shape[4] - localY) < 0.01
    && x >= shape[0] && x <= shape[3] && z >= shape[2] && z <= shape[5]);
}

function flightPositions(start: Vec3, waypoints: Vec3[], step: number): Vec3[] {
  let distance = 0;
  let previous = start;
  for (const point of waypoints) { distance += previous.distanceTo(point); previous = point; }
  if (Math.ceil(distance / step) * FLIGHT_TICK_MS > MAX_FLIGHT_MOVE_MS) return [];
  const out: Vec3[] = [];
  let from = start;
  for (const to of waypoints) {
    const steps = Math.ceil(from.distanceTo(to) / step);
    for (let i = 1; i <= steps; i++) out.push(from.clone().add(to.minus(from).scaled(i / steps)));
    from = to;
  }
  return out;
}

function flightRoute(bot: Bot, start: Vec3, target: Vec3): Vec3[] {
  // Vanilla's non-sprinting creative speed is three times its ability speed per tick.
  const step = Math.min(0.3, (abilities.get(bot)?.flyingSpeed ?? DEFAULT_FLYING_SPEED) * 3);
  const direct = flightPositions(start, [target], step);
  let obstruction = routeObstruction(bot, direct);
  if ((direct.length || start.distanceTo(target) < EPSILON) && !obstruction) return direct;
  for (const rise of [0, 0.5, 1, 2]) {
    const y = Math.max(start.y, target.y) + rise;
    const route = flightPositions(start, [new Vec3(start.x, y, start.z), new Vec3(target.x, y, target.z), target], step);
    if (!route.length) continue;
    const blocked = routeObstruction(bot, route);
    if (!blocked) return route;
    obstruction ??= blocked;
  }
  if (obstruction) throw new SkillBlocked(`飞行路径${obstruction}；请核对这处身体空间并选择能绕开的路径`);
  throw new SkillBlocked(`按服务端飞行速度，候选路径均超过单段 ${MAX_FLIGHT_MOVE_MS / 1000} 秒的移动时限；请缩短这段路径`);
}

function flightPlan(bot: Bot, start: Vec3, target: Vec3, options: FlightMoveOptions): Vec3[] {
  if (![target.x, target.y, target.z].every(Number.isFinite)) throw new SkillBlocked('飞行目标坐标必须是有限数字');
  const distance = start.distanceTo(target);
  if (distance > MAX_FLIGHT_DISTANCE) throw new SkillBlocked(flightDistanceNote(start, target));
  if (options.land && !hasSupport(bot, target)) throw new SkillBlocked('飞行目标下方没有已加载的安全落脚方块；当前 land:true 要求落地；空中悬停用 land:false，落地须选已核实的平台');
  const targetObstruction = spaceObstruction(bot, target);
  if (targetObstruction) throw new SkillBlocked(`飞行目标空间${targetObstruction}`);
  return flightRoute(bot, start, target);
}

function flightDistanceNote(start: Vec3, target: Vec3): string {
  return `客户端飞行单段最多 ${MAX_FLIGHT_DISTANCE} 格；目标的三维直线距离 ${start.distanceTo(target)} 格；`
    + `实际起点 (${start.x},${start.y},${start.z})。整段飞行试算可用 subdivide:true 自动分段并返回连续步骤，`
    + '总航程另由服务端实际许可、速度和期限决定，须核对总耗时';
}

function flightTiming(bot: Bot): FlightPreview['timing'] {
  const recent = (timings.get(bot) ?? []).filter(sample => Date.now() - sample.atMs <= TIMING_MAX_AGE_MS);
  const ticks = recent.reduce((sum, sample) => sum + sample.ticks, 0);
  const elapsed = recent.reduce((sum, sample) => sum + sample.elapsedMs, 0);
  return { source: ticks ? 'runtime' : 'nominal',
    tickMs: ticks ? Math.max(FLIGHT_TICK_MS, Math.ceil(elapsed / ticks * 10) / 10) : FLIGHT_TICK_MS,
    samples: ticks, observedAtMs: recent.at(-1)?.atMs ?? null };
}

function flightDurationMs(bot: Bot, ticks: number): number {
  return Math.ceil(ticks * flightTiming(bot).tickMs) + 500;
}

function recordFlightTiming(bot: Bot, elapsedMs: number, ticks: number): void {
  if (ticks < 5) return;
  const now = Date.now();
  const recent = (timings.get(bot) ?? []).filter(sample => now - sample.atMs <= TIMING_MAX_AGE_MS);
  recent.push({ elapsedMs, ticks, atMs: now });
  timings.set(bot, recent.slice(-4));
}

/** Inspect loaded geometry from the observed or explicitly projected origin without side effects. */
export function previewFlight(bot: Bot, targetAt: { x: number; y: number; z: number },
  options: FlightMoveOptions = {}, origin?: { x: number; y: number; z: number }): FlightPreview {
  if (!bot.entity?.position) throw new SkillBlocked('还没进入世界，不能试算飞行');
  const from = origin ?? bot.entity.position;
  const start = new Vec3(from.x, from.y, from.z);
  const target = new Vec3(targetAt.x, targetAt.y, targetAt.z);
  const route = flightPlan(bot, start, target, options);
  const state = flightState(bot);
  const remainingMs = state.expiresAtMs === undefined ? null : Math.max(0, state.expiresAtMs - Date.now());
  const estimatedDurationMs = flightDurationMs(bot, route.length);
  return {
    from: [start.x, start.y, start.z], at: [target.x, target.y, target.z],
    land: options.land === true, distance: start.distanceTo(target), estimatedDurationMs,
    speedSource: abilities.get(bot)?.speedObserved ? 'server' : 'default', allowed: state.allowed, remainingMs,
    timing: flightTiming(bot),
    timeEnough: state.allowed && remainingMs !== null ? remainingMs >= estimatedDurationMs : null,
  };
}

/** Exact feet coordinates support takeoff, ascent, descent and an airborne building/viewing position. */
export async function flyToPosition(bot: Bot, targetAt: { x: number; y: number; z: number },
  aborted: () => boolean, options: FlightMoveOptions = {}): Promise<string> {
  if (!bot.entity?.position) throw new SkillBlocked('还没进入世界，不能飞行');
  if (![targetAt.x, targetAt.y, targetAt.z].every(Number.isFinite)) throw new SkillBlocked('飞行目标坐标必须是有限数字');
  if (moving.has(bot)) throw new SkillBlocked('另一段飞行移动尚未结束');
  moving.add(bot);
  let control: FlightControl | undefined;
  let elapsedTickMs = 0;
  let ticks = 0;
  let timingEpoch: object | undefined;
  try {
    const target = new Vec3(targetAt.x, targetAt.y, targetAt.z);
    let start = bot.entity.position.clone();
    let distance = start.distanceTo(target);
    if (distance > MAX_FLIGHT_DISTANCE) throw new SkillBlocked(flightDistanceNote(start, target));
    if (options.land && !hasSupport(bot, target)) throw new SkillBlocked('飞行目标下方没有已加载的安全落脚方块；当前 land:true 要求落地；空中悬停用 land:false，落地须选已核实的平台');
    await awaitFlightPermission(bot, aborted);
    start = bot.entity.position.clone();
    distance = start.distanceTo(target);
    if (distance > MAX_FLIGHT_DISTANCE) throw new SkillBlocked(`等待飞行许可时位置已变化；${flightDistanceNote(start, target)}`);
    const route = flightPlan(bot, start, target, options);
    const expiresAt = abilities.get(bot)?.expiresAtMs;
    if (expiresAt !== undefined && expiresAt - Date.now() < flightDurationMs(bot, route.length)) {
      throw new SkillBlocked('服务端声明的飞行剩余时间不足以抵达目标；先就近落地');
    }
    if (aborted()) throw new SkillBlocked('飞行任务已取消');
    control = beginFlight(bot);
    timingEpoch = timingEpochs.get(bot);
    for (const pos of route) {
      const tickAtMs = Date.now();
      if (aborted()) throw new SkillBlocked('飞行任务已取消，保持当前位置悬停；可调用落地');
      if (control.interrupted) throw new SkillBlocked(control.interrupted, [], 'server');
      if (!(flightFlags(bot) & 4)) throw new SkillBlocked('服务端飞行许可已结束', [], 'server');
      const obstruction = spaceObstruction(bot, pos);
      if (obstruction) throw new SkillBlocked(`途中空间发生变化：${obstruction}；已停止移动并悬停`);
      bot.entity.velocity = new Vec3(0, 0, 0);
      bot.entity.onGround = false;
      bot.entity.position = pos;
      await sleep(FLIGHT_TICK_MS);
      elapsedTickMs += Date.now() - tickAtMs;
      ticks++;
    }
    // Position packets continue through Mineflayer with local gravity simulation disabled.
    await sleep(150);
    if (control.interrupted) throw new SkillBlocked(control.interrupted, [], 'server');
    if (!(flightFlags(bot) & 4)) throw new SkillBlocked('服务端飞行许可已结束', [], 'server');
    if (bot.entity.position.distanceTo(target) > 0.4) throw new SkillBlocked('服务端未接受飞行目标位置', [], 'server');
    if (options.land) {
      if (!hasSupport(bot, bot.entity.position)) throw new SkillBlocked('落脚支撑已变化，保持悬停；请换一个落脚点');
      stopFlight(bot);
    }
    const actual = bot.entity.position;
    return `${options.land ? '飞到平台并落地' : '飞到目标并悬停'}，实际在 (${actual.x.toFixed(1)},${actual.y.toFixed(1)},${actual.z.toFixed(1)})`;
  } finally {
    // Excludes permission waits, model latency and settling. Completed ticks from
    // an interrupted leg still measure the scheduler; an unstarted leg does not.
    if (timingEpoch && timingEpoch === timingEpochs.get(bot)) recordFlightTiming(bot, elapsedTickMs, ticks);
    moving.delete(bot);
  }
}

export async function flyToLanding(bot: Bot, cell: { x: number; y: number; z: number }, aborted: () => boolean): Promise<string> {
  return flyToPosition(bot, { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }, aborted, { land: true });
}

/** Land vertically on the first safe loaded surface below the current flight position. */
export async function landFlight(bot: Bot, aborted: () => boolean): Promise<string> {
  if (!bot.entity?.position) throw new SkillBlocked('还没进入世界，不能落地');
  const start = bot.entity.position;
  if (hasSupport(bot, start) && openForPlayer(bot, start)) {
    stopFlight(bot);
    return `已在安全地面 (${start.x.toFixed(1)},${start.y.toFixed(1)},${start.z.toFixed(1)})`;
  }
  for (let y = Math.floor(start.y); y >= Math.floor(start.y - MAX_FLIGHT_DISTANCE); y--) {
    const block = bot.blockAt(new Vec3(Math.floor(start.x), y, Math.floor(start.z)));
    if (!block || HAZARDS.test(block.name)) break;
    const tops = collisionShapes(block).map(shape => y + shape[4]).sort((a, b) => b - a);
    for (const top of tops) {
      const target = new Vec3(start.x, top, start.z);
      if (top > start.y + EPSILON || !hasSupport(bot, target) || !openForPlayer(bot, target)) continue;
      return flyToPosition(bot, target, aborted, { land: true });
    }
  }
  throw new SkillBlocked('下方没有已加载的安全落点；保持悬停，先移动到附近平台');
}
