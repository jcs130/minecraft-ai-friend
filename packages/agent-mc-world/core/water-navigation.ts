/** Match the pathfinder's fluid semantics to the actual registry and physics. */
import type { Bot } from 'mineflayer';
import type { Movements } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { WATER_BLOCKS } from './fluid-blocks.ts';

/** Pathfinder 2.4.5 only registers water/lava, while physics also floats in aquatic plants. */
export function configureWaterMovements(bot: Pick<Bot, 'registry'>, movements: Movements): void {
  for (const name of [...WATER_BLOCKS, 'flowing_water']) {
    const block = bot.registry.blocksByName[name];
    if (block) movements.liquids.add(block.id);
  }
}

interface WaterWaypoint {
  x: number; y: number; z: number;
  hash?: string;
  toBreak?: readonly unknown[];
  toPlace?: readonly unknown[];
}

/**
 * 2.4.5 post-processing recognizes only the water block ID. Above kelp/seagrass
 * it lowers an empty-shape waypoint by a block. Move.hash retains the original
 * A* cell even after x/y/z change; restore only that verified fluid cell.
 * Unknown hashes/blocks and future construction remain unmodified.
 */
export function repairWaterWaypoints(bot: Pick<Bot, 'blockAt'>, path: readonly WaterWaypoint[]): number {
  let repaired = 0;
  for (const point of path) {
    if (point.toBreak?.length || point.toPlace?.length) break;
    if (typeof point.hash !== 'string' || !/^-?\d+,-?\d+,-?\d+$/.test(point.hash)) continue;
    const [x, y, z] = point.hash.split(',').map(Number);
    if (![x, y, z].every(Number.isSafeInteger) || Math.floor(point.x) !== x || Math.floor(point.z) !== z) continue;
    const block = bot.blockAt(new Vec3(x, y, z), false);
    if (!block || block.shapes.length !== 0 || !WATER_BLOCKS.has(block.name)) continue;
    if (point.x === x + .5 && point.y === y && point.z === z + .5) continue;
    point.x = x + .5; point.y = y; point.z = z + .5;
    repaired++;
  }
  return repaired;
}
