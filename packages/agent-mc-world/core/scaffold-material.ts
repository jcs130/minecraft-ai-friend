/** Scaffold materials must retain a full collision cube in every block state. */
import type { Bot } from 'mineflayer';
import { isGravityBlock } from './policy.ts';

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
