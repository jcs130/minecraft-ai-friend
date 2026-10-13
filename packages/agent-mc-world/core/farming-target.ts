/**
 * 右键锄地/种地时，只有明确点在土格上方的空气、且下方方块已加载并适用，
 * 才将点击面落到下方。草苗、火把等有内容的格子不在此处暗中清除。
 */
import type { Bot } from 'mineflayer';
import type { BlockFace, Cell } from './geometry.ts';
import { AIR_NAMES, LIQUIDS, blockAtCell, cellText } from './cell-facts.ts';
import { HOE_TILLED } from './blueprint-registry.ts';
import { SEED_CROP } from './placed-ledger.ts';
import { zhName } from './names.ts';

export const isHoeUseItem = (item: string): boolean => item === 'hoe' || item.endsWith('_hoe');

/** 原版作物不能种进液体；检查实际作物格，不把湿润土壤当成可用空间。 */
export function floodedCropSpace(bot: Bot, soil: Cell, item: string): string | null {
  if (SEED_CROP[item] === undefined && item !== 'nether_wart') return null;
  const cropCell = { x: soil.x, y: soil.y + 1, z: soil.z };
  const above = blockAtCell(bot, cropCell);
  if (!above || !LIQUIDS.has(above.name)) return null;
  return `${cellText(cropCell)} 是${zhName(above.name)}，占住了作物格，当前不能播种；没有发送使用。`
    + (above.name === 'water'
      ? '先探查这片水的 level=0 源方块，用空桶点源方块本身收水，等作物格不再被水覆盖后再播种；不能把桶点在下方耕地上'
      : '先处理液体并核验作物格，再决定播种');
}

export function farmingClickCell(bot: Bot, requested: Cell, item: string, face?: BlockFace): Cell | null {
  if (!isHoeUseItem(item) && SEED_CROP[item] === undefined && item !== 'nether_wart') return null;
  if (face && face !== 'up') return null;
  const upper = blockAtCell(bot, requested);
  if (!upper || !AIR_NAMES.has(upper.name)) return null;
  const below = { x: requested.x, y: requested.y - 1, z: requested.z };
  const soil = blockAtCell(bot, below);
  if (!soil) return null;
  if (isHoeUseItem(item) && HOE_TILLED[soil.name] !== undefined) return below;
  if (SEED_CROP[item] !== undefined && soil.name === 'farmland') return below;
  if (item === 'nether_wart' && soil.name === 'soul_sand') return below;
  return null;
}
