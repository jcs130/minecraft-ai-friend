import { Vec3 } from 'vec3';

export interface FootingReading {
  kind: 'support' | 'fluid' | 'air' | 'unknown';
  block: string | null;
  at?: { x: number; y: number; z: number };
  grounded: boolean | null;
}

/** Read actual contact faces, not the integer cell below the player's center.
 * Slabs, snow and fences have fractional/extended heights; an edge can support
 * only part of the footprint. No loaded collision geometry means unknown.
 */
export function footingFromBot(bot: any): FootingReading {
  const pos = bot.entity.position;
  const grounded = typeof bot.entity.onGround === 'boolean' ? bot.entity.onGround : null;
  const feet = bot.blockAt(pos);
  if (feet && ['water', 'lava', 'bubble_column'].includes(feet.name)) {
    return { kind: 'fluid', block: feet.name, grounded };
  }
  const half = Number.isFinite(bot.entity.width) && bot.entity.width > 0
    ? Math.min(bot.entity.width / 2, 2) : 0.3;
  const eps = 1e-5;
  let unknown = false, best: { area: number; block: string; at: Vec3 } | null = null;
  for (let x = Math.floor(pos.x - half + eps); x <= Math.floor(pos.x + half - eps); x++) {
    for (let z = Math.floor(pos.z - half + eps); z <= Math.floor(pos.z + half - eps); z++) {
      for (let y = Math.floor(pos.y) - 2; y <= Math.floor(pos.y + eps); y++) {
        const at = new Vec3(x, y, z), block = bot.blockAt(at);
        if (!block || !Array.isArray(block.shapes)) { unknown = true; continue; }
        for (const shape of block.shapes) {
          if (!Array.isArray(shape) || shape.length !== 6 || !shape.every(Number.isFinite)) {
            unknown = true; continue;
          }
          if (Math.abs(y + shape[4] - pos.y) > eps) continue;
          const dx = Math.min(pos.x + half, x + shape[3]) - Math.max(pos.x - half, x + shape[0]);
          const dz = Math.min(pos.z + half, z + shape[5]) - Math.max(pos.z - half, z + shape[2]);
          const area = dx > eps && dz > eps ? dx * dz : 0;
          if (area > (best?.area ?? 0)) best = { area, block: block.name, at };
        }
      }
    }
  }
  if (best && grounded !== false) return { kind: 'support', block: best.block, at: best.at, grounded };
  // Grounded physics is positive contact evidence, even when its support cannot
  // be identified. Never turn that discrepancy or an unloaded cell into "air".
  if (unknown || grounded === true) return { kind: 'unknown', block: null, grounded };
  return { kind: 'air', block: 'air', grounded };
}

export function narrateFooting(value: FootingReading, name: (block: string) => string): string {
  if (value.kind === 'support') return `脚下是${name(value.block!)}`;
  if (value.kind === 'fluid') return `脚部位于${name(value.block!)}中`;
  if (value.kind === 'air') return '脚部未接地，当前没有接触到支撑面';
  return value.grounded === true ? '脚部接地，支撑方块尚未核实' : '脚下支撑未知（未加载或碰撞形状未核实）';
}
