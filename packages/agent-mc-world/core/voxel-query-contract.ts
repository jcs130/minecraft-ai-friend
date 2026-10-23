/** Shared by discovery, semantic validation and the bounded reader. No world reads here. */
export type VoxelPoint = [number, number, number];
export type VoxelBox = [number, number, number, number, number, number];
export const VOXEL_BUDGET = 512;
export const VOXEL_OFFSET = 16;
export const VOXEL_RESPONSE_TEXT_CAP = 24_000;
export const DEFAULT_VOXEL_BOUNDS: VoxelBox = [-1, -1, -1, 1, 2, 1];
export interface VoxelCursor {
  version: 1;
  anchor: VoxelPoint;
  requested_bounds: VoxelBox;
  dimension: string | null;
  pending_regions: VoxelBox[];
}
const integer = { type: 'integer', minimum: -30_000_000, maximum: 30_000_000 };
const tuple = (size: number, item = integer) => ({ type: 'array', minItems: size, maxItems: size, items: item });
export const VOXEL_BOUNDS_SCHEMA = { ...tuple(6, { type: 'integer', minimum: -VOXEL_OFFSET, maximum: VOXEL_OFFSET }),
  default: DEFAULT_VOXEL_BOUNDS };
export const VOXEL_CURSOR_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['version', 'anchor', 'requested_bounds', 'dimension', 'pending_regions'], properties: {
    version: { type: 'integer', const: 1 }, anchor: tuple(3), requested_bounds: tuple(6),
    dimension: { anyOf: [{ type: 'string', maxLength: 128 }, { type: 'null' }] },
    pending_regions: { type: 'array', minItems: 1, maxItems: 64, items: tuple(6) },
  } };
export const VOXEL_QUERY_DOC = `voxels: bounds=[xmin,ymin,zmin,xmax,ymax,zmax], inclusive integer block offsets ±${VOXEL_OFFSET} from floor(feet) at the first read; default=${JSON.stringify(DEFAULT_VOXEL_BOUNDS)}. `
  + `At most ${VOXEL_BUDGET} cells per call. Oversize reads return status=partial with real data, never automatic continuation. `
  + `Responses have a ${VOXEL_RESPONSE_TEXT_CAP} UTF-16 character budget; verbose geometry further bisects the cuboid, and an oversized single material stays unknown. `
  + 'Selection: bisect the longest axis (ties x,y,z), lower half first (ceil length/2), until one contiguous cuboid fits; depth-first continuation. '
  + 'cursor replaces bounds and pins the original absolute block coordinates, anchor and dimension; it is not a snapshot or permission. '
  + 'Results: requested_bounds/count, returned_regions/count, complete/partial_reason, remaining_count (outside this page), remaining_after_page (in cursor), query_anchor, coordinate_system=absolute_block, observed_at, next_cursor and next_safe_read. '
  + 'Each page has a fresh time and current visibility; -1 and omitted cells are UNKNOWN, never air or safe. vision transparency is independent of collision; use sites body.clear for body clearance, not a visibility ray.';
export const voxelVolume = (b: readonly number[]): number => (b[3] - b[0] + 1) * (b[4] - b[1] + 1) * (b[5] - b[2] + 1);
const isTuple = (v: unknown, size: number): v is number[] => Array.isArray(v) && v.length === size
  && v.every(n => Number.isSafeInteger(n) && Math.abs(n) <= 30_000_000);
const ordered = (b: number[]) => b.slice(0, 3).every((n, i) => n <= b[i + 3]);
export function voxelCursorError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'cursor must be the returned object';
  const c = value as VoxelCursor;
  if (Object.keys(c).some(k => !['version','anchor','requested_bounds','dimension','pending_regions'].includes(k))) return 'cursor has unknown fields';
  if (c.version !== 1 || !isTuple(c.anchor, 3) || !isTuple(c.requested_bounds, 6) || !ordered(c.requested_bounds)
    || !(c.dimension === null || typeof c.dimension === 'string' && c.dimension.length <= 128)) return 'cursor requires version=1, anchor, ordered requested_bounds and dimension';
  if (c.requested_bounds.some((n, i) => Math.abs(n - c.anchor[i % 3]) > VOXEL_OFFSET)) return 'cursor requested_bounds exceed the original anchor ±16';
  if (!Array.isArray(c.pending_regions) || !c.pending_regions.length || c.pending_regions.length > 64) return 'cursor.pending_regions must contain 1..64 regions';
  for (const [i, b] of c.pending_regions.entries()) {
    if (!isTuple(b, 6) || !ordered(b) || b.some((n, axis) => axis < 3 ? n < c.requested_bounds[axis] : n > c.requested_bounds[axis])) return `cursor.pending_regions/${i} must be inside requested_bounds`;
    if (c.pending_regions.slice(0, i).some(p => [0,1,2].every(a => b[a] <= p[a+3] && p[a] <= b[a+3]))) return `cursor.pending_regions/${i} overlaps an earlier region`;
  }
  return null;
}
/** Return the first fitting cuboid, leaving disjoint continuations. Never reads them. */
export function takeVoxelRegion(pending: readonly VoxelBox[], cap = VOXEL_BUDGET): { bounds: VoxelBox; rest: VoxelBox[] } {
  let [bounds, ...rest] = pending.map(b => [...b] as VoxelBox);
  while (voxelVolume(bounds) > cap) {
    const sizes = [0,1,2].map(i => bounds[i+3]-bounds[i]+1);
    const axis = sizes.indexOf(Math.max(...sizes));
    const split = bounds[axis] + Math.ceil(sizes[axis]/2);
    const upper = [...bounds] as VoxelBox; upper[axis] = split;
    bounds[axis+3] = split-1; rest = [upper, ...rest];
  }
  return { bounds, rest };
}
