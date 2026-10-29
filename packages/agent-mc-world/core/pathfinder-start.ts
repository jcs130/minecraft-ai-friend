import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import type { Move, Movements } from 'mineflayer-pathfinder';
import type { Vec3 } from 'vec3';
import { configureWaterMovements, repairWaterWaypoints } from './water-navigation.ts';
import { awaitPathGoal } from './navigation-result.ts';

const require = createRequire(import.meta.url);
const pfRequire = createRequire(require.resolve('mineflayer-pathfinder/package.json'));
const PathfinderMove = pfRequire('./lib/move.js') as new (
  x: number, y: number, z: number, remainingBlocks: number, cost: number,
) => Move;

/**
 * Pathfinder normally rounds a grounded player up when standing in a partial
 * block (beds, slabs, etc.). Under a low ceiling that rounded start can have
 * no exits even while the player can walk off the block at the lower level.
 * Use the lower start only when the upper start is trapped and the lower one
 * has a real candidate move. The search still applies normal movement rules.
 */
export function partialBlockStartMove(
  bot: Pick<Bot, 'entity' | 'blockAt'>,
  movements: Movements,
  startPos: Vec3 | null,
): Move | null {
  if (!startPos || !bot.entity?.onGround) return null;
  const p = startPos.floored();
  if (startPos.y - p.y <= 0.001) return null;
  const block = bot.blockAt(p);
  if (!block || movements.emptyBlocks.has(block.type)) return null;
  const remaining = movements.countScaffoldingItems();
  const upper = new PathfinderMove(p.x, p.y + 1, p.z, remaining, 0);
  if (movements.getNeighbors(upper).length > 0) return null;
  const lower = new PathfinderMove(p.x, p.y, p.z, remaining, 0);
  return movements.getNeighbors(lower).length > 0 ? lower : null;
}

const installed = new WeakSet<object>();

/** Apply to one connection; route probes and goto share start/fluid/waypoint semantics. */
export function installPartialBlockStartRepair(bot: Bot): void {
  const finder = bot.pathfinder;
  if (installed.has(finder)) return;
  installed.add(finder);
  // Repair the pinned plugin at the connection adapter, retaining goto as the
  // shared contract for executor, SDK and any caller wrapping its lifecycle.
  finder.goto = goal => awaitPathGoal(bot, goal);
  const original = finder.getPathFromTo.bind(finder);
  finder.getPathFromTo = function* (movements, startPos, goal, options = {}) {
    configureWaterMovements(bot, movements);
    const corrected = options.startMove ? null : partialBlockStartMove(bot, movements, startPos);
    for (const probe of original(movements, startPos, goal,
      corrected ? { ...options, startMove: corrected } : options)) {
      if (options.optimizePath !== false) repairWaterWaypoints(bot, probe.result.path);
      yield probe;
    }
  };
}
