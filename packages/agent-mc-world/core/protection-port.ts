export type ProtectAction = 'break' | 'place';
export type ProtectStatus = 'deny' | 'unknown' | 'allow_likely';
export interface ProtectCell { x: number; y: number; z: number }
export interface ProtectReply {
  action: ProtectAction;
  dimension: string;
  x: number; y: number; z: number;
  status: ProtectStatus;
  reason: string;
}

interface PathActionMove extends ProtectCell {
  toBreak: ProtectCell[];
  toPlace: Array<ProtectCell & { dx?: number; dy?: number; dz?: number; useOne?: boolean }>;
}

/** Keep the in-flight permission check while a changing path proposes other cells. */
export function selectHeldPathAction<T extends { key: string; querying: boolean }>(
  current: T | null, candidate: T,
): T {
  return current && (current.querying || current.key === candidate.key) ? current : candidate;
}

/**
 * pathfinder 在 path_update 事件返回后同一物理刻就可能开始挖掘。先截住第一处
 * 尚未获得 allow_likely 的改方块动作，只让已确认安全的前缀进入执行器。
 * 空前缀用当前位置的无动作节点占位，避免上游 goto 把空路径误判为完成。
 */
export function holdUnverifiedPathAction<T extends PathActionMove>(
  result: { path: T[] }, player: ProtectCell,
  verdict: (action: ProtectAction, cell: ProtectCell) => ProtectStatus | null,
): { action: ProtectAction; cell: ProtectCell; status: ProtectStatus | null; safePrefix: number } | null {
  for (let i = 0; i < result.path.length; i++) {
    const move = result.path[i];
    const actions: Array<{ action: ProtectAction; cell: ProtectCell }> = [
      ...(move.toBreak ?? []).map((cell) => ({ action: 'break' as const, cell })),
      ...(move.toPlace ?? []).filter((place) => !place.useOne).map((place) => ({
        action: 'place' as const,
        cell: { x: place.x + (place.dx ?? 0), y: place.y + (place.dy ?? 0), z: place.z + (place.dz ?? 0) },
      })),
    ];
    for (const action of actions) {
      const status = verdict(action.action, action.cell);
      if (status === 'allow_likely') continue;
      if (i === 0) {
        const hold = Object.assign(Object.create(Object.getPrototypeOf(move)) as T, move,
          { x: player.x, y: player.y, z: player.z, toBreak: [], toPlace: [] });
        result.path.splice(0, result.path.length, hold);
      } else {
        result.path.splice(i);
      }
      return { ...action, status, safePrefix: i };
    }
  }
  return null;
}

/** 多个邻近方块被拒或暂无法确认时，短时改走现有道路，避免 A* 逐格试探整座建筑。 */
export class NearbyProtectionBackoff {
  private denied: Array<{ key: string; dimension: string; at: ProtectCell; time: number }> = [];
  private anchor: (ProtectCell & { dimension: string; until: number }) | null = null;

  note(reply: ProtectReply, player: ProtectCell | undefined, now = Date.now()): boolean {
    if (reply.action !== 'break' || reply.status === 'allow_likely' || !player) return false;
    const dimension = normDimension(reply.dimension);
    this.denied = this.denied.filter((entry) => now - entry.time <= 20_000);
    const key = keyOf('break', dimension, reply);
    if (!this.denied.some((entry) => entry.key === key)) {
      this.denied.push({ key, dimension, at: reply, time: now });
    }
    if (this.active(player, dimension, now)) return false;
    const nearby = this.denied.filter((entry) => entry.dimension === dimension
      && Math.hypot(entry.at.x - player.x, entry.at.y - player.y, entry.at.z - player.z) <= 16);
    if (nearby.length < 3) return false;
    this.anchor = { x: player.x, y: player.y, z: player.z, dimension, until: now + 60_000 };
    this.denied = [];
    return true;
  }

  active(player: ProtectCell | undefined, dimension: string, now = Date.now()): boolean {
    const anchor = this.anchor;
    return !!(anchor && player && anchor.dimension === normDimension(dimension) && now < anchor.until
      && Math.hypot(anchor.x - player.x, anchor.y - player.y, anchor.z - player.z) <= 16);
  }
}


export interface BlockProtectionPort {
  check(action: ProtectAction, dimension: string, cell: ProtectCell, fresh?: boolean): Promise<ProtectReply>;
  verdict(action: ProtectAction, dimension: string, cell: ProtectCell): ProtectStatus | null;
}

const normDimension = (s: string): string => s.replace(/^minecraft:/, '');
const keyOf = (action: ProtectAction, dimension: string, cell: ProtectCell): string => `${action}|${normDimension(dimension)}|${cell.x},${cell.y},${cell.z}`;
