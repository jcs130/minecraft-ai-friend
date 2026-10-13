/** Compact geometry facts for a few candidate build/standing cells. No actions. */
import { BLOCK_FACES } from './geometry.ts';

type Point = [number, number, number];
type Box = [number, number, number, number, number, number];
type Coverage = number | null;
type Material = {
  name: string;
  properties: Record<string, string | number | boolean> | null;
  collision: Box[] | null;
  liquid: boolean;
};
type Sample = { material: Material } | { unknown: string };
type Read = (cell: Point) => Sample;
const EPS = 1e-8;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const shapesOf = (s: Sample): Box[] | null => 'material' in s && s.material.collision?.every(b =>
  b.length === 6 && b.every(Number.isFinite) && [0, 1, 2].every(i => b[i] <= b[i + 3])) ? s.material.collision : null;

/** Union area on a unit face; overlapping boxes must not inflate coverage. */
function faceArea(shapes: Box[] | null, axis: number, positive: boolean): Coverage {
  if (shapes === null) return null;
  const [a, b] = [0, 1, 2].filter(i => i !== axis);
  const rects = shapes.filter(s => s[axis + 3] - s[axis] > EPS
    && Math.abs(s[axis + (positive ? 3 : 0)] - (positive ? 1 : 0)) < EPS)
    .map(s => [Math.max(0, s[a]), Math.max(0, s[b]), Math.min(1, s[a + 3]), Math.min(1, s[b + 3])])
    .filter(r => r[2] > r[0] && r[3] > r[1]);
  const edges = [...new Set(rects.flatMap(r => [r[0], r[2]]))].sort((x, y) => x - y);
  let area = 0;
  for (let i = 1; i < edges.length; i++) {
    const x = (edges[i - 1] + edges[i]) / 2;
    const intervals = rects.filter(r => r[0] <= x && r[2] >= x).map(r => [r[1], r[3]]).sort((u, v) => u[0] - v[0]);
    let end = 0, length = 0;
    for (const [lo, hi] of intervals) { length += Math.max(0, hi - Math.max(lo, end)); end = Math.max(end, hi); }
    area += (edges[i] - edges[i - 1]) * length;
  }
  return round(area);
}

const overlaps = (a: Box, b: Box) => [0, 1, 2].every(i => a[i] < b[i + 3] - EPS && a[i + 3] > b[i] + EPS);

export function spatialSites(read: Read, sites: Point[]) {
  return sites.map(at => {
    const target = read(at), belowAt: Point = [at[0], at[1] - 1, at[2]], below = read(belowAt);
    const belowShapes = shapesOf(below);
    const faces = Object.entries(BLOCK_FACES).flatMap(([face, delta]) => {
      const direction = delta, axis = direction.findIndex(n => n !== 0);
      const ref = at.map((n, i) => n - direction[i]) as Point;
      const sample = read(ref), area = faceArea(shapesOf(sample), axis, direction[axis] > 0);
      // Known zero-area faces add no useful candidates; unknown faces remain explicit.
      return area === 0 ? [] : [{ ref, face, block: 'material' in sample ? sample.material.name : null, area }];
    });
    const bodyBox: Box = [at[0] + .2, at[1], at[2] + .2, at[0] + .8, at[1] + 1.8, at[2] + .8];
    const blockers: { at: Point; block: string }[] = [], fluids: { at: Point; block: string }[] = [];
    let unknown = 0;
    // Owner-cell collar includes fences/walls protruding above their own cell.
    for (let x = at[0] - 1; x <= at[0] + 1; x++) for (let y = at[1] - 1; y <= at[1] + 2; y++) for (let z = at[2] - 1; z <= at[2] + 1; z++) {
      const cell: Point = [x, y, z], sample = read(cell), shapes = shapesOf(sample);
      if (shapes === null) unknown++;
      if (!('material' in sample)) continue;
      const block = sample.material;
      if (shapes?.some(s => overlaps(bodyBox, s.map((n, i) => n + cell[i % 3]) as Box))) blockers.push({ at: cell, block: block.name });
      if ((block.liquid || block.properties?.waterlogged === true || block.properties?.waterlogged === 'true')
        && overlaps(bodyBox, [x, y, z, x + 1, y + 1, z + 1])) fluids.push({ at: cell, block: block.name });
    }
    return {
      at,
      target: 'material' in target ? { block: target.material.name,
        ...(target.material.properties && Object.keys(target.material.properties).length ? { properties: target.material.properties } : {}) } : null,
      below: { block: 'material' in below ? below.material.name : null,
        topY: belowShapes?.length ? round(belowAt[1] + Math.max(...belowShapes.map(s => s[4]))) : null,
        topArea: faceArea(belowShapes, 1, true) },
      faces,
      body: { clear: blockers.length ? false : unknown ? null : true,
        blockers: blockers.length, hits: blockers.slice(0, 3), unknown,
        fluids: fluids.length, fluidHits: fluids.slice(0, 3) },
    };
  });
}
