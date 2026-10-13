// Geometry calculations are independent of the visibility gate, exercised in perception.test.ts.
vi.mock('../core/perception-sight.ts', async (load) => ({ ...await load<typeof import('../core/perception-sight.ts')>(), observedBlock: () => true }));
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { observeSpatial, parseSpatialObservation, spatialObservationText } from '../core/spatial-observation.ts';
import { parseScoutSteps } from '../core/skills.ts';
import { describeSkill } from '../core/receipt.ts';

type Box = [number, number, number, number, number, number];
type Block = { name: string; stateId: number; shapes?: Box[]; getProperties: () => Record<string, string | number | boolean> };
const full: Box[] = [[0, 0, 0, 1, 1, 1]];
const block = (name: string, shapes: Box[] | undefined = full, properties = {}): Block => ({ name, stateId: 1, shapes, getProperties: () => properties });
function scene(cells: Record<string, Block | null>) {
  let reads = 0;
  const bot = { entity: { id: 1, position: new Vec3(-20.5, 64, -10.5), yaw: 0, pitch: 0 }, entities: {}, game: { dimension: 'overworld' },
    blockAt: (p: Vec3) => { reads++; const key = [p.x, p.y, p.z].join(','); return key in cells ? cells[key] : block('air', []); } } as unknown as Bot;
  return { bot, reads: () => reads };
}
function inspect(cells: Record<string, Block | null>, at: [number, number, number] = [0, 64, 0]) {
  const { bot } = scene(cells), result = observeSpatial(bot, { mode: 'sites', sites: [at] });
  if (result.kind !== 'sites') throw new Error('Expected site observation');
  return result.sites[0];
}

describe('compact site observations', () => {
  it('exposes absolute targets through the existing read-only scout contract', () => {
    const step = { skill: 'observe', mode: 'sites', sites: [[-530, 64, -378]] };
    expect(parseScoutSteps([step])).toEqual({ steps: [step] });
    const s = inspect({ '-530,63,-378': block('stone') }, [-530, 64, -378]);
    expect(s.below).toEqual({ block: 'stone', topY: 64, topArea: 1 });
    expect(s.faces).toContainEqual({ ref: [-530, 63, -378], face: 'up', block: 'stone', area: 1 });
    expect(s.body.clear).toBe(true);
    expect(describeSkill({ skill: 'observe', mode: 'sites', sites: [[-530, 64, -378]] })).toContain('检查落点');
  });

  it.each([[], [[0, 1.5, 0]], [['~', 64, 0]], [[0, 64, Infinity]], [[0, 64, 0], [0, 64, 0]],
    Array.from({ length: 5 }, (_, x) => [x, 64, 0])])('rejects ambiguous or excessive sites: %j', sites => {
    expect(parseSpatialObservation({ mode: 'sites', sites })).toHaveProperty('error');
  });

  it('rejects mixed coordinate modes', () => {
    expect(parseSpatialObservation({ mode: 'sites', sites: [[0, 64, 0]], bounds: [0, 0, 0, 0, 0, 0] })).toHaveProperty('error');
    expect(parseSpatialObservation({ mode: 'voxels', sites: [[0, 64, 0]] })).toHaveProperty('error');
    expect(parseSpatialObservation({ mode: 'voxels', sites: null })).not.toHaveProperty('error');
    expect(parseSpatialObservation({ mode: 'sites', sites: [[0, 64, 0]], bounds: null, rays: null })).not.toHaveProperty('error');
  });

  it('separates an empty target from missing support and occupied non-colliding rails', () => {
    const air = inspect({});
    expect(air.target).toEqual({ block: 'air' });
    expect(air.below).toEqual({ block: 'air', topY: null, topArea: 0 });
    expect(air.faces).toEqual([]);
    expect(air.body.clear).toBe(true);
    const rail = inspect({ '0,64,0': block('rail', [], { shape: 'ascending_north' }), '0,63,0': block('dirt') });
    expect(rail.target).toEqual({ block: 'rail', properties: { shape: 'ascending_north' } });
    expect(rail.body.clear).toBe(true); // No collision is not an empty placement cell.
    expect(inspect({ '0,64,0': block('dirt') }).body.clear).toBe(false);
  });

  it.each([['dirt_path', .9375], ['stone_slab', .5]] as const)('measures %s below the target plane', (name, height) => {
    const s = inspect({ '0,63,0': block(name, [[0, 0, 0, 1, height, 1]]) });
    expect(s.below).toEqual({ block: name, topY: 63 + height, topArea: 0 });
    expect(s.faces).toEqual([]);
  });

  it('measures a top slab and unions overlapping multipart faces without double-counting', () => {
    expect(inspect({ '0,63,0': block('stone_slab', [[0, .5, 0, 1, 1, 1]]) }).below.topArea).toBe(1);
    expect(inspect({ '0,63,0': block('multipart', [[0, 0, 0, .6, 1, 1], [.4, 0, 0, 1, 1, 1]]) }).below.topArea).toBe(1);
    const stair = inspect({ '0,63,0': block('oak_stairs', [[0, 0, 0, 1, .5, 1], [0, .5, .5, 1, 1, 1]]) });
    expect(stair.below.topArea).toBe(.5);
    expect(stair.faces[0].area).toBe(.5);
  });

  it('keeps all six reference face directions unambiguous', () => {
    const s = inspect(Object.fromEntries(['0,63,0', '0,65,0', '0,64,-1', '0,64,1', '-1,64,0', '1,64,0'].map(p => [p, block('stone')])));
    expect(s.faces).toEqual([
      { face: 'down', ref: [0, 65, 0], block: 'stone', area: 1 },
      { face: 'up', ref: [0, 63, 0], block: 'stone', area: 1 },
      { face: 'north', ref: [0, 64, 1], block: 'stone', area: 1 },
      { face: 'south', ref: [0, 64, -1], block: 'stone', area: 1 },
      { face: 'west', ref: [1, 64, 0], block: 'stone', area: 1 },
      { face: 'east', ref: [-1, 64, 0], block: 'stone', area: 1 },
    ]);
  });

  it('detects a fence protruding from below and a low ceiling', () => {
    const fence = inspect({ '0,63,0': block('oak_fence', [[.375, 0, .375, .625, 1.5, .625]]) });
    expect(fence.below).toEqual({ block: 'oak_fence', topY: 64.5, topArea: 0 });
    expect(fence.body).toMatchObject({ clear: false, blockers: 1, hits: [{ at: [0, 63, 0], block: 'oak_fence' }] });
    expect(inspect({ '0,65,0': block('stone') }).body.clear).toBe(false);
    expect(inspect({ '0,66,0': block('stone') }).body.clear).toBe(true);
  });

  it('keeps missing or malformed collision data unknown, including the owner collar', () => {
    const unread = block('unread'); delete unread.shapes;
    const s = inspect({ '0,63,0': unread, '-1,64,0': null, '0,64,0': null });
    expect(s.target).toBeNull();
    expect(s.below).toEqual({ block: 'unread', topY: null, topArea: null });
    expect(s.faces).toContainEqual({ face: 'up', ref: [0, 63, 0], block: 'unread', area: null });
    expect(s.body).toMatchObject({ clear: null, unknown: 3 });
    expect(inspect({ '0,63,0': block('bad', [[0, 0, 0, NaN, 1, 1]]) }).body.clear).toBeNull();
    expect(inspect({ '-1,64,0': null, '0,65,0': block('stone') }).body).toMatchObject({ clear: false, unknown: 1 });
  });

  it('reports liquid and waterlogged cells separately from collision clearance', () => {
    const water = inspect({ '0,64,0': block('water', [], { level: 0 }) });
    expect(water.body).toMatchObject({ clear: true, fluids: 1, fluidHits: [{ at: [0, 64, 0], block: 'water' }] });
    expect(inspect({ '0,64,0': block('oak_stairs', full, { waterlogged: true }) }).body).toMatchObject({ clear: false, fluids: 1 });
  });

  it('bounds reads and output, reuses overlapping cells, and reports fresh facts on the next call', () => {
    const cells = { '0,63,0': block('dirt') }, s = scene(cells);
    const input = { mode: 'sites' as const, sites: [[0, 64, 0], [1, 64, 0], [2, 64, 0], [3, 64, 0]] as [number, number, number][] };
    const text = spatialObservationText(s.bot, input), r = JSON.parse(text);
    expect(r.blockReads).toBe(72); // 6 x 4 x 3 unique owners, not 4 x 36 repeated reads.
    expect(s.reads()).toBe(72);
    expect(text.length).toBeLessThan(2600);
    expect(r.position).toEqual([-20.5, 64, -10.5]);
    expect(r.observedAt).toEqual(expect.any(String));
    cells['0,63,0'] = block('air', []);
    expect(JSON.parse(spatialObservationText(s.bot, input)).sites[0].below.block).toBe('air');
  });
});
