/** Scaffold materials must retain a full collision cube in every block state. */
import type { Bot } from 'mineflayer';

export function isGravityBlock(name: string): boolean {
  return ['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel',
    'anvil', 'chipped_anvil', 'damaged_anvil', 'dragon_egg', 'pointed_dripstone'].includes(name)
    || name.endsWith('_concrete_powder');
}

/** Shared by policy readouts, pathfinder and explicit placement. No implicit fallback. */
export function assessScaffoldMaterials(names: readonly string[], registry?: Bot['registry']) {
  const accepted: string[] = [], rejected: Array<{ name: string; reason: string }> = [];
  for (const raw of names) {
    const name = raw.replace(/^minecraft:/, '');
    const reason = isGravityBlock(name) ? '重力方块失去支撑会下落'
      : registry && !isStableScaffoldMaterial(registry, name) ? '当前执行器不支持作为完整稳定垫脚支撑' : null;
    if (reason) rejected.push({ name, reason });
    else if (!accepted.includes(name)) accepted.push(name);
  }
  return { accepted, rejected, verified: !!registry };
}

interface CollisionRegistry {
  blocksByName: Record<string, { boundingBox?: string } | undefined>;
  blockCollisionShapes?: {
    blocks: Record<string, number | number[] | undefined>;
    shapes: Record<number, readonly (readonly number[])[] | undefined>;
  };
}

export function isStableScaffoldMaterial(registry: Bot['registry'], name: string): boolean {
  const id = name.replace(/^minecraft:/, '');
  if (isGravityBlock(id)) return false;
  const data = registry as unknown as CollisionRegistry;
  if (data.blocksByName[id]?.boundingBox !== 'block') return false;
  const collision = data.blockCollisionShapes;
  const ids = collision?.blocks[id];
  if (ids === undefined || !collision) return false;
  return (Array.isArray(ids) ? ids : [ids]).every(shapeId => {
    const boxes = collision.shapes[shapeId];
    return boxes?.length === 1 && boxes[0].length === 6
      && boxes[0].every((value, index) => value === (index < 3 ? 0 : 1));
  });
}
