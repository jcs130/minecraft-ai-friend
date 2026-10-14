/**
 * mineflayer-pathfinder 的 postProcessPath 会把路径节点放到方块最高碰撞面。
 * 门板无论开合都有一条薄碰撞面；从平行方向穿过关门时也可通行，
 * 但 postProcessPath 仍会把门内节点抬到门顶 y+1。
 * 在 path_update 事件里就地修正，事件之后寻路器才把同一条 path 交给运动层。
 */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

type Waypoint = { x: number; y: number; z: number; toBreak?: unknown[]; toPlace?: unknown[] };
export interface GroundPathIssue { sequence: number; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; rise: number; reason: string }
const groundPathIssues = new WeakMap<object, GroundPathIssue>();
export const groundPathIssueOf = (bot: object): GroundPathIssue | null => groundPathIssues.get(bot) ?? null;

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
    if (rise > 1.25 && (i > 0 || bot.entity.onGround)) {
      const start = bot.blockAt(new Vec3(from.x, from.y, from.z).floored());
      const end = bot.blockAt(new Vec3(to.x, to.y, to.z).floored());
      if (start && end && !climb.has(start.name) && !climb.has(end.name)) {
        return { from: { x: from.x, y: from.y, z: from.z }, to: { x: to.x, y: to.y, z: to.z }, rise,
          reason: `路径内部几何校验：脚高 ${from.y.toFixed(3)}→${to.y.toFixed(3)}，需直接升高 ${rise.toFixed(3)} 格，超过普通跳跃范围；该段未安排垫脚/挖掘，也未读到攀爬或水中条件。已拒绝这条路径，不能据此断言目标完全不可达；用 observe sites/voxels 检查台阶、净空和其他路线。` };
      }
    }
    from = new Vec3(to.x, to.y, to.z);
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
  bot.prependListener('path_update', (result: { path?: Waypoint[]; status?: string }) => {
    if (!result.path) return;
    repairDoorWaypoints(bot, result.path);
    const issue = checkGroundPath(bot, result.path);
    if (issue) {
      groundPathIssues.set(bot, { ...issue, sequence: (groundPathIssues.get(bot)?.sequence ?? 0) + 1 });
      result.path.length = 0;
      result.status = 'noPath';
    }
  });
}
