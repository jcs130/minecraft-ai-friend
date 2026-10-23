/** Loaded fluid geometry at the breathing point; unknown coverage stays unknown. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { WATER_BLOCKS } from './fluid-blocks.ts';

type WaterBot = Pick<Bot, 'blockAt' | 'entity'>;
const containsWater = (block: ReturnType<Bot['blockAt']>) => !!block
  && (WATER_BLOCKS.has(block.name) || block.name === 'flowing_water' || block.isWaterlogged === true);

export function waterAtPoint(bot: Pick<Bot, 'blockAt'>, point: Vec3): boolean | null {
  const cell = point.floored(), block = bot.blockAt(cell, false);
  if (!block) return null;
  if (!containsWater(block)) return false;
  const above = bot.blockAt(cell.offset(0, 1, 0), false);
  if (containsWater(above)) return true;
  let level: unknown;
  try { level = block.getProperties?.().level; } catch { /* A partial client snapshot may lack properties. */ }
  if (level === undefined) level = block.metadata;
  if (block.isWaterlogged || (block.name !== 'water' && block.name !== 'flowing_water')) level = 0;
  const depth = typeof level === 'string' && /^\d+$/.test(level) ? Number(level) : level;
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > 15) return null;
  const height = (8 - (depth >= 8 ? 0 : depth)) / 9;
  if (point.y - cell.y < height) return true;
  return above ? false : null;
}

export function headWaterObservation(bot: WaterBot) {
  const entity = bot.entity as (Bot['entity'] & {eyeHeight?: number}) | undefined;
  const actual = entity?.eyeHeight;
  const measured = typeof actual === 'number' && Number.isFinite(actual) && actual > 0;
  const eyeHeight = measured ? actual : 1.62;
  const eye = entity?.position?.offset(0, eyeHeight, 0);
  return { wet: eye ? waterAtPoint(bot, eye) : null, eyeHeight,
    eyeHeightSource: measured ? 'client' as const : 'standing-default' as const,
    eyePosition: eye ? {x:eye.x,y:eye.y,z:eye.z} : null };
}
