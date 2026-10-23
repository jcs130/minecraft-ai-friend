import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { shapeCells } from '../core/cell-facts.ts';
import { parseSpatialObservation, SPATIAL_OBSERVATION_LIMITS } from '../core/spatial-observation.ts';
import { partitionSpatialBox, spatialBoxBudgetNote } from '../core/spatial-slices.ts';

const cap = SPATIAL_OBSERVATION_LIMITS.cells;

describe('bounded spatial request recovery', () => {
  it('accepts an oversize read without rewriting the requested region', () => {
    const input = { mode: 'voxels', bounds: [-10, -2, -10, 10, 2, 10] };
    const before = structuredClone(input);
    expect(parseSpatialObservation(input)).toEqual(input);
    expect(input).toEqual(before);
  });
  it.each([
    [-8, -2, -8, 0, 4, 8],
    [-6, 0, -6, 6, 3, 6],
    [-16, -16, -16, 16, 16, 16],
  ])('partitions an accepted voxel region without dropping or repeating cells: %j', (...bounds) => {
    const issue = parseSpatialObservation({ mode: 'voxels', bounds });
    expect(issue).not.toHaveProperty('error');
    const plan = partitionSpatialBox(bounds, cap);
    const seen = new Set<string>();
    const intervals = plan.chunkSizes.map((size, axis) => {
      const ranges: number[][] = [];
      for (let start = bounds[axis]; start <= bounds[axis + 3]; start += size) {
        ranges.push([start, Math.min(start + size - 1, bounds[axis + 3])]);
      }
      return ranges;
    });
    for (const x of intervals[0]) for (const y of intervals[1]) for (const z of intervals[2]) {
      const chunk = [x[0], y[0], z[0], x[1], y[1], z[1]];
      expect(parseSpatialObservation({ mode: 'voxels', bounds: chunk })).not.toHaveProperty('error');
      for (let a = x[0]; a <= x[1]; a++) for (let b = y[0]; b <= y[1]; b++) for (let c = z[0]; c <= z[1]; c++) {
        const key = `${a},${b},${c}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(plan.cells);
    expect(plan.cells).toBe((bounds[3] - bounds[0] + 1) * (bounds[4] - bounds[1] + 1) * (bounds[5] - bounds[2] + 1));

  });

  it('keeps an exact-limit request intact', () => {
    const bounds = [-4, -4, -4, 3, 3, 3];
    expect(spatialBoxBudgetNote(bounds, cap)).toBeNull();
    expect(parseSpatialObservation({ mode: 'voxels', bounds })).toEqual({ mode: 'voxels', bounds });
  });

  it('explains reversed voxel endpoints without executing the corrected region', () => {
    const input = { mode: 'voxels', bounds: [0, -1, 0, -12, 8, -12] };
    const before = structuredClone(input);
    expect(parseSpatialObservation(input)).toEqual({ error: expect.stringContaining('[-12,-1,-12,0,8,0]') });
    expect(input).toEqual(before);
  });

  it('reports the actual slice volume and a partition before reading any blocks', () => {
    let reads = 0;
    const bot = { entity: { position: new Vec3(-370.2, 64, -525.2) },
      blockAt: () => { reads++; throw new Error('must not read oversized region'); } } as unknown as Bot;
    expect(() => shapeCells(bot, 'box', [[-372, 54, -530], [-364, 68, -524]], 'solid', cap))
      .toThrow(/945.*区间组合/);
    expect(reads).toBe(0);
    const cells = shapeCells(bot, 'box', [[-372, 54, -530], [-370, 56, -528]], 'solid', cap);
    expect(cells).toHaveLength(27);
    expect(cells).toContainEqual({ x: -372, y: 54, z: -530 });
    expect(cells).toContainEqual({ x: -370, y: 56, z: -528 });
  });
});
