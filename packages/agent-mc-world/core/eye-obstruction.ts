import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** Find a loaded collision shape touching the vanilla eye sample after an in_wall packet. */
export function eyeObstruction(bot: Bot, previousCell?: string) {
  const entity = bot.entity as Bot['entity'] & { eyeHeight?: number };
  const eye = entity.position.offset(0, entity.eyeHeight ?? 1.62, 0);
  const width = entity.width ?? 0.6;
  if (!(width > 0 && width <= 2) || !Number.isFinite(eye.y)) return null;
  const radius = width * 0.4;
  let transparent: ReturnType<Bot['blockAt']> = null;
  for (let x = Math.floor(eye.x - radius); x <= Math.floor(eye.x + radius); x++) {
    for (let z = Math.floor(eye.z - radius); z <= Math.floor(eye.z + radius); z++) {
      const pos = new Vec3(x, Math.floor(eye.y), z);
      if (previousCell && pos.toString() !== previousCell) continue;
      const block = bot.blockAt(pos);
      if (!block || block.boundingBox !== 'block' || !block.diggable) continue;
      const intersects = block.shapes?.some(([x0, y0, z0, x1, y1, z1]) =>
        eye.y >= pos.y + y0 && eye.y < pos.y + y1 &&
        eye.x + radius > x + x0 && eye.x - radius < x + x1 &&
        eye.z + radius > z + z0 && eye.z - radius < z + z1);
      if (!intersects) continue;
      if (!block.transparent) return block;
      transparent ??= block;
    }
  }
  return transparent;
}
