/** Shared contact volume for burning blocks and pathfinder movement edges. */
export const BURNING_BLOCKS = new Set(['lava', 'fire', 'soul_fire']);
export const SCORCHING_FLOOR = new Set(['magma_block']);
export const HAZARD_BODY_REACH = 0.3 + 0.1;
export const HAZARD_FEET_OFFSET = 0.05;
export const HAZARD_HEAD_OFFSET = 1.8 - 0.1;

interface Point { x: number; y: number; z: number }
interface Bounds { min: Point; max: Point }
const AXES = ['x', 'y', 'z'] as const;
const EPS = 1e-7;

export function hazardBodyBounds(point: Point): Bounds {
  return {
    min: { x: Math.floor(point.x - HAZARD_BODY_REACH), y: Math.floor(point.y + HAZARD_FEET_OFFSET),
      z: Math.floor(point.z - HAZARD_BODY_REACH) },
    max: { x: Math.floor(point.x + HAZARD_BODY_REACH), y: Math.floor(point.y + HAZARD_HEAD_OFFSET),
      z: Math.floor(point.z + HAZARD_BODY_REACH) },
  };
}

function contactBounds(cell: Point, floor: boolean): Bounds {
  const reach = floor ? 0 : HAZARD_BODY_REACH;
  return {
    min: { x: cell.x - reach, y: floor ? cell.y + 1 - HAZARD_FEET_OFFSET : cell.y - HAZARD_HEAD_OFFSET,
      z: cell.z - reach },
    max: { x: cell.x + 1 + reach - EPS, y: floor ? cell.y + 2 - HAZARD_FEET_OFFSET - EPS
      : cell.y + 1 - HAZARD_FEET_OFFSET - EPS, z: cell.z + 1 + reach - EPS },
  };
}

function inside(point: Point, box: Bounds): boolean {
  return AXES.every((axis) => point[axis] >= box.min[axis] && point[axis] <= box.max[axis]);
}

function crosses(from: Point, to: Point, box: Bounds): boolean {
  let enter = 0;
  let leave = 1;
  for (const axis of AXES) {
    const delta = to[axis] - from[axis];
    if (delta === 0) {
      if (from[axis] < box.min[axis] || from[axis] > box.max[axis]) return false;
      continue;
    }
    const t0 = (box.min[axis] - from[axis]) / delta;
    const t1 = (box.max[axis] - from[axis]) / delta;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
    if (enter > leave) return false;
  }
  return true;
}

function exitsContact(from: Point, to: Point, box: Bounds): boolean {
  if (!inside(from, box) || inside(to, box)) return false;
  return AXES.some((axis) => {
    const middle = (box.min[axis] + box.max[axis]) / 2;
    return (to[axis] < box.min[axis] && from[axis] <= middle + EPS)
      || (to[axis] > box.max[axis] && from[axis] >= middle - EPS);
  });
}

/**
 * Inspect only cells intersecting one swept contact volume. Unknown cells have no hazard
 * classification; the caller retains its ordinary unloaded-terrain restrictions.
 * A body already touching a hazard may leave its near side, without entering another one.
 */
export function movementTouchesHazard(
  from: Point, to: Point, readName: (x: number, y: number, z: number) => string | undefined,
): boolean {
  const a = hazardBodyBounds(from);
  const b = hazardBodyBounds(to);
  for (let x = Math.min(a.min.x, b.min.x); x <= Math.max(a.max.x, b.max.x); x++) {
    for (let z = Math.min(a.min.z, b.min.z); z <= Math.max(a.max.z, b.max.z); z++) {
      for (let y = Math.min(a.min.y, b.min.y) - 1; y <= Math.max(a.max.y, b.max.y); y++) {
        const name = readName(x, y, z);
        if (name === undefined) continue;
        const floor = SCORCHING_FLOOR.has(name);
        if (!floor && !BURNING_BLOCKS.has(name)) continue;
        const box = contactBounds({ x, y, z }, floor);
        if (crosses(from, to, box) && !exitsContact(from, to, box)) return true;
      }
    }
  }
  return false;
}
