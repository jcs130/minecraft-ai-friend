/**
 * mineflayer-pathfinder 的 postProcessPath 会把路径节点放到方块最高碰撞面。
 * 门板无论开合都有一条薄碰撞面；从平行方向穿过关门时也可通行，
 * 但 postProcessPath 仍会把门内节点抬到门顶 y+1。
 * 在 path_update 事件里就地修正，事件之后寻路器才把同一条 path 交给运动层。
 */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

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
  bot.prependListener('path_update', (result: { path?: Array<{ x: number; y: number; z: number; toPlace?: unknown[] }> }) => {
    if (result.path) repairDoorWaypoints(bot, result.path);
  });
}
