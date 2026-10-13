/** Light at the viewer account's eyes, read from the loaded Minecraft world. */
import type mineflayer from 'mineflayer';

export interface ViewerLight {
  sky: number;
  block: number;
}

export function viewerLight(bot: mineflayer.Bot): ViewerLight | null {
  if (!bot.entity?.position) return null;
  const world = bot.world as typeof bot.world & {
    getSkyLight?: (position: typeof bot.entity.position) => number;
    getBlockLight?: (position: typeof bot.entity.position) => number;
  };
  if (typeof world.getSkyLight !== 'function' || typeof world.getBlockLight !== 'function') return null;
  const feet = bot.entity.position.floored();
  for (const position of [feet.offset(0, 1, 0), feet]) {
    try {
      const block = bot.blockAt(position, false);
      if (!block || block.boundingBox === 'block') continue;
      const sky = world.getSkyLight(position);
      const emitted = world.getBlockLight(position);
      if (Number.isInteger(sky) && sky >= 0 && sky <= 15 &&
          Number.isInteger(emitted) && emitted >= 0 && emitted <= 15) {
        return { sky, block: emitted };
      }
    } catch { /* the column is still loading */ }
  }
  return null;
}
