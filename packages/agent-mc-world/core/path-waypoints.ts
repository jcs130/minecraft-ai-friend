/**
 * mineflayer-pathfinder 的 postProcessPath 会把路径节点放到方块最高碰撞面。
 * 门板无论开合都有一条薄碰撞面；从平行方向穿过关门时也可通行，
 * 但 postProcessPath 仍会把门内节点抬到门顶 y+1。
 * 在 path_update 事件里就地修正，事件之后寻路器才把同一条 path 交给运动层。
 */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { createRequire } from 'node:module';

const physicsRequire = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const { PlayerState } = physicsRequire('prismarine-physics');
const SAFE_GROUND_DROP = 3;

type Waypoint = { x: number; y: number; z: number; toBreak?: unknown[]; toPlace?: unknown[] };
export interface GroundPathIssue { sequence: number; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; rise: number; reason: string }
const groundPathIssues = new WeakMap<object, GroundPathIssue>();
export const groundPathIssueOf = (bot: object): GroundPathIssue | null => groundPathIssues.get(bot) ?? null;

/** A compressed waypoint can span several real stair supports. Certify a short
 * walk or ordinary repeated jump with installed collision physics. Jumping
 * requires a measured start support and an intermediate higher landing; this
 * does not permit a direct two-block jump, unknown collision or applied state. */
function hasCollisionVerifiedClimb(bot: Pick<Bot, 'entity' | 'blockAt'>, from: Vec3, to: Waypoint): boolean {
  const body = bot as Bot;
  const simulate = body.physics as unknown as { simulatePlayer?: (state: any, world: { getBlock(p: Vec3): unknown }) => unknown };
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (!simulate?.simulatePlayer || !body.inventory || distance < .1 || distance > 4 || to.y - from.y > 3) return false;
  for (const jump of [false, true]) try {
    const controls = { forward: !jump, back: false, left: false, right: false, jump: false, sprint: false, sneak: false };
    const state = new PlayerState(body, controls);
    state.pos = new Vec3(from.x, from.y, from.z); state.vel = new Vec3(0, 0, 0); state.onGround = true;
    state.yaw = Math.atan2(from.x - to.x, from.z - to.z); state.pitch = 0;
    state.jumpTicks = 0; state.jumpQueued = false;
    const world = { getBlock(p: Vec3) {
      const block = bot.blockAt(p, false);
      if (!block || !Array.isArray(block.shapes)) throw new Error('unknown collision');
      return block;
    } };
    if (jump) {
      // Never create an air jump by assigning onGround to an unsupported start.
      state.onGround = false;
      for (let tick = 0; tick < 2; tick++) simulate.simulatePlayer(state, world);
      if (!state.onGround || Math.abs(state.pos.y - from.y) > .02 || state.isInWater || state.isInLava) continue;
      controls.forward = true; controls.jump = true;
    }
    let intermediateLanding = false;
    for (let tick = 0; tick < 48; tick++) {
      simulate.simulatePlayer(state, world);
      if (state.isInWater || state.isInLava || state.pos.y < from.y - .6) break;
      if (state.onGround && state.pos.y > from.y + .1 && state.pos.y < to.y - .1) intermediateLanding = true;
      if (Math.hypot(state.pos.x - to.x, state.pos.z - to.z) <= .35 && Math.abs(state.pos.y - to.y) <= .1 && state.onGround) {
        if (!jump || intermediateLanding) return true;
        break;
      }
      if (Math.hypot(state.pos.x - from.x, state.pos.z - from.z) > distance + .5) break;
    }
  } catch { /* Incomplete physics/collision cannot certify this exception. */ }
  return false;
}

/** Verify the final executable prefix after waypoint height adjustment, before any control input.
 * A later edge with dig/place depends on future geometry and is deliberately not certified here.
 */
export function checkGroundPath(bot: Pick<Bot, 'entity' | 'blockAt'> & Partial<Pick<Bot, 'registry'>>, path: readonly Waypoint[]): Omit<GroundPathIssue, 'sequence'> | null {
  const climb = new Set(['ladder', 'vine', 'scaffolding', 'water', 'bubble_column']);
  // Effect-assisted movement has a different jump envelope; the vanilla bound cannot certify it.
  if (Object.keys(bot.entity?.effects ?? {}).some(id => {
    const effect = bot.registry?.effects?.[Number(id)]?.name;
    return !effect || ['JumpBoost', 'Levitation'].includes(effect);
  })) return null;
  let from = bot.entity?.position;
  if (!from) return null;
  for (let i = 0; i < Math.min(path.length, 128); i++) {
    const to = path[i];
    if (to.toBreak?.length || to.toPlace?.length) break;
    const rise = to.y - from.y;
    if (rise < -SAFE_GROUND_DROP && (i > 0 || bot.entity.onGround)) {
      const start = bot.blockAt(new Vec3(from.x, from.y, from.z).floored());
      const end = bot.blockAt(new Vec3(to.x, to.y, to.z).floored());
      if (start && end && !climb.has(start.name) && !climb.has(end.name)) {
        return { from: { x: from.x, y: from.y, z: from.z }, to: { x: to.x, y: to.y, z: to.z }, rise,
          reason: `路径内部几何校验：脚高 ${from.y.toFixed(3)}→${to.y.toFixed(3)}，单步落差 ${(-rise).toFixed(3)} 格会产生摔落伤害；未读到水中或攀爬条件。已拒绝这条路径；目标在低处不代表可以直接跳下，请核实阶梯或其他安全路线。` };
      }
    }
    if (rise > 1.25 && (i > 0 || bot.entity.onGround)) {
      const start = bot.blockAt(new Vec3(from.x, from.y, from.z).floored());
      const end = bot.blockAt(new Vec3(to.x, to.y, to.z).floored());
      if (start && end && !climb.has(start.name) && !climb.has(end.name) && !hasCollisionVerifiedClimb(bot, from, to)) {
        return { from: { x: from.x, y: from.y, z: from.z }, to: { x: to.x, y: to.y, z: to.z }, rise,
          reason: `路径内部几何校验：脚高 ${from.y.toFixed(3)}→${to.y.toFixed(3)}，需直接升高 ${rise.toFixed(3)} 格，超过普通跳跃范围；该段未安排垫脚/挖掘，也未读到攀爬或水中条件。已拒绝这条路径，不能据此断言目标完全不可达；用 observe sites/voxels 检查台阶、净空和其他路线。` };
      }
    }
    from = new Vec3(to.x, to.y, to.z);
  }
  return null;
}

/** Predict the next 600ms using the same installed physics engine and received
 * block collision shapes as the body. Do not apply the simulated state. Stop at
 * the current waypoint: continuing straight through a future turn is not evidence.
 */
function predictedGroundFall(bot: Bot, path: readonly Waypoint[]): Omit<GroundPathIssue, 'sequence'> | null {
  // Mineflayer's public PhysicsOptions declaration omits these runtime members.
  type State = { pos: Vec3; onGround: boolean; isInWater: boolean; isInLava: boolean };
  const physics = bot.physics as unknown as { simulatePlayer?: (state: State, world: { getBlock(position: Vec3): unknown }) => unknown };
  if (!bot.entity?.onGround || bot.physicsEnabled === false || !physics?.simulatePlayer
    || !bot.pathfinder?.goal || (bot as Bot & { vehicle?: unknown }).vehicle != null || ['creative', 'spectator'].includes(bot.game?.gameMode ?? '')
    || !['forward', 'back', 'left', 'right'].some(key => bot.controlState?.[key as keyof typeof bot.controlState])) return null;
  if (Object.keys(bot.entity.effects ?? {}).some(id => {
    const name = bot.registry?.effects?.[Number(id)]?.name;
    return !name || ['JumpBoost', 'Levitation', 'SlowFalling'].includes(name);
  })) return null;
  const from = bot.entity.position, state: State = new PlayerState(bot, { ...bot.controlState }), next = path[0];
  let peak = from.y;
  const unknown = Symbol('unreceived_collision');
  const world = { getBlock(position: Vec3) {
    const block = bot.blockAt(position, false);
    if (!block) throw unknown;
    return block;
  } };
  try {
    for (let tick = 0; tick < 12; tick++) {
      if (next && Math.abs(next.x - state.pos.x) <= .35 && Math.abs(next.z - state.pos.z) <= .35 && Math.abs(next.y - state.pos.y) < 1) return null;
      physics.simulatePlayer(state, world);
      if (state.isInWater || state.isInLava) return null;
      peak = Math.max(peak, state.pos.y);
      const drop = peak - state.pos.y;
      if (drop > SAFE_GROUND_DROP) return { from: { x: from.x, y: from.y, z: from.z },
        to: { x: state.pos.x, y: state.pos.y, z: state.pos.z }, rise: state.pos.y - from.y,
        reason: `路径内部几何校验：按当前控制与已加载的真实碰撞，未来 ${(tick + 1) * 50}ms 会出现超过 ${SAFE_GROUND_DROP} 格的干燥落差（预测 ${drop.toFixed(2)} 格）；已在离开支撑前制动。此为物理预测而非已发生位移，请改走安全阶梯或核实路线。` };
      if (state.onGround && tick > 0 && state.pos.y < from.y) return null;
    }
  } catch (error) {
    // An incomplete collision view cannot certify a predicted fall. Never turn
    // unknown chunks into air or a world-impossibility claim.
    if (error !== unknown) throw error;
  }
  return null;
}

export function repairDoorWaypoints(
  bot: Pick<Bot, 'blockAt'>,
  path: Array<{ x: number; y: number; z: number; toPlace?: unknown[] }>,
): number {
  let repaired = 0;
  for (const move of path) {
    if (move.toPlace?.length) continue;
    const x = Math.floor(move.x), z = Math.floor(move.z);
    const foot = bot.blockAt(new Vec3(x, Math.floor(move.y) - 1, z));
    if (!foot || (!foot.name.endsWith('_door') && !foot.name.endsWith('_fence_gate'))) continue;
    const props = foot.getProperties?.() ?? {};
    if (foot.name.endsWith('_door') && props.half !== 'lower') continue;
    if (move.y - foot.position.y < 0.9 || move.y - foot.position.y > 1.2) continue;
    move.x = x + 0.5;
    move.y = foot.position.y;
    move.z = z + 0.5;
    repaired++;
  }
  return repaired;
}

export function installDoorWaypointRepair(bot: Bot): void {
  let path: Waypoint[] = [], braking = false;
  bot.prependListener('path_update', (result: { path?: Waypoint[]; status?: string }) => {
    if (!result.path) return;
    path = result.path;
    repairDoorWaypoints(bot, result.path);
    const issue = checkGroundPath(bot, result.path);
    if (issue) {
      groundPathIssues.set(bot, { ...issue, sequence: (groundPathIssues.get(bot)?.sequence ?? 0) + 1 });
      result.path.length = 0;
      result.status = 'noPath';
    }
  });
  // Installed after pathfinder: inspect the actual control it selected for the
  // next tick, including shortcut/sprint execution, rather than only its A* nodes.
  bot.on('physicsTick', () => {
    if (braking) { bot.setControlState('sneak', false); braking = false; }
    const issue = predictedGroundFall(bot, path);
    if (!issue) return;
    groundPathIssues.set(bot, { ...issue, sequence: (groundPathIssues.get(bot)?.sequence ?? 0) + 1 });
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    bot.setControlState('sneak', true);
    braking = true;
  });
}
