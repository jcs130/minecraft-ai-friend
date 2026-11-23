/**
 * Vulcan-safe pathfinding: no sprinting, no parkour jumps, no breaking or pillaring while the
 * pathfinder routes. Explicit dig/build tools still run under the core mining limits.
 * Clamps are installed as accessor properties so later core retuning cannot re-enable them.
 */
const clamped = new WeakSet();
export const VULCAN_MOVEMENT_CLAMPS = Object.freeze({ allowSprinting: false, allowParkour: false, canDig: false, allow1by1towers: false });

export function applyVulcanPace(movements, clamps = VULCAN_MOVEMENT_CLAMPS) {
  if (!movements || typeof movements !== 'object') return false;
  if (clamped.has(movements)) return true;
  for (const [key, value] of Object.entries(clamps)) {
    Object.defineProperty(movements, key, { configurable: true, enumerable: true, get: () => value, set: () => {} });
  }
  if (Array.isArray(movements.scafoldingBlocks)) movements.scafoldingBlocks = [];
  clamped.add(movements);
  return true;
}
