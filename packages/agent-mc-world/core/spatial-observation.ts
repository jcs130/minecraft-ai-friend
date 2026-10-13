/** Native, bounded voxel and collision-ray observations of the current connection. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { AIR_NAMES, LIQUIDS } from './cell-facts.ts';
import { SkillBlocked } from './skill-context.ts';
import { spatialBoxBudgetNote } from './spatial-slices.ts';

type Point = [number, number, number];
type Box = [number, number, number, number, number, number];
export type SpatialRay = [pitchDeg: number, yawDeg: number, range: number];
export type SpatialObserveInput =
  | { mode: 'voxels'; bounds: Box }
  | { mode: 'rays'; rays: SpatialRay[] };

export const SPATIAL_OBSERVATION_LIMITS = {
  cells: 512, offset: 16, rays: 64, range: 64, reads: 16_384, entities: 512, text: 24_000,
} as const;
export const DEFAULT_VOXEL_BOUNDS: Box = [-1, -1, -1, 1, 2, 1];
export const DEFAULT_SPATIAL_RAYS: SpatialRay[] = [-15, 0, 15].flatMap(pitch =>
  [-30, -15, 0, 15, 30].map(yaw => [pitch, yaw, 24] as SpatialRay));

export function parseSpatialObservation(c: Record<string, unknown>): SpatialObserveInput | { error: string } {
  if (c.mode === 'voxels') {
    if (c.rays !== undefined) return { error: 'voxels 不收 rays' };
    const b = c.bounds ?? DEFAULT_VOXEL_BOUNDS;
    if (!Array.isArray(b) || b.length !== 6 || b.some(n => !Number.isInteger(n) || Math.abs(n) > SPATIAL_OBSERVATION_LIMITS.offset)) {
      return { error: `bounds 要六个 -${SPATIAL_OBSERVATION_LIMITS.offset}..${SPATIAL_OBSERVATION_LIMITS.offset} 的整数，顺序 xmin,ymin,zmin,xmax,ymax,zmax；相对脚下格` };
    }
    if (b.slice(0, 3).some((n, i) => n > b[i + 3])) {
      const ordered = [0, 1, 2].map(i => Math.min(b[i], b[i + 3]))
        .concat([0, 1, 2].map(i => Math.max(b[i], b[i + 3])));
      return { error: `bounds 的最小值不能大于最大值；同一区域的升序边界为 ${JSON.stringify(ordered)}，请核对相对坐标后重新提交；尚未读取` };
    }
    const budget = spatialBoxBudgetNote(b, SPATIAL_OBSERVATION_LIMITS.cells);
    if (budget) return { error: `voxels ${budget}` };
    return { mode: 'voxels', bounds: [...b] as Box };
  }
  if (c.mode === 'rays') {
    if (c.bounds !== undefined) return { error: 'rays 不收 bounds' };
    const rays = c.rays ?? DEFAULT_SPATIAL_RAYS;
    if (!Array.isArray(rays) || !rays.length || rays.length > SPATIAL_OBSERVATION_LIMITS.rays
      || rays.some(r => !Array.isArray(r) || r.length !== 3 || r.some(n => typeof n !== 'number' || !Number.isFinite(n))
        || Math.abs(r[0]) > 90 || Math.abs(r[1]) > 180 || r[2] <= 0 || r[2] > SPATIAL_OBSERVATION_LIMITS.range)) {
      return { error: `rays 要 1-${SPATIAL_OBSERVATION_LIMITS.rays} 组 [相对pitch角,相对yaw角,距离]；角度范围 ±90/±180，距离 >0 且 ≤${SPATIAL_OBSERVATION_LIMITS.range} 格` };
    }
    return { mode: 'rays', rays: rays.map(r => [...r] as SpatialRay) };
  }
  return { error: 'observe 的 mode 要 voxels/rays' };
}

interface Material {
  name: string;
  stateId: number;
  properties: Record<string, string | number | boolean> | null;
  air: boolean;
  liquid: boolean;
  /** Local boxes; null means the collision geometry was not supplied. */
  collision: Box[] | null;
}
type Sample = { material: Material } | { unknown: 'unloaded' | 'read-budget' };
interface EntityObservation {
  id: number;
  name: string;
  position: Point;
  bounds: Box | null;
}
type BlockHit = { kind: 'block'; distance: number; point: Point; cell: Point; material: Material; bounds: Box };
type EntityHit = { kind: 'entity'; distance: number; point: Point; entity: EntityObservation };
type UnknownHit = { kind: 'unknown'; distance: number; cell: Point; reason: 'unloaded' | 'collision-unread' | 'read-budget' };
type ClearHit = { kind: 'clear'; distance: number };

const EPSILON = 1e-8;
const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const pointOf = (p: { x: number; y: number; z: number }): Point => [p.x, p.y, p.z];
const atDistance = (o: Point, d: Point, t: number): Point => o.map((n, i) => round(n + d[i] * t)) as Point;
const worldBox = (local: Box, cell: Point): Box => local.map((n, i) => n + cell[i % 3]) as Box;

/** Slab intersection, including an eye already inside a collision box. */
function intersect(origin: Point, direction: Point, box: Box, range: number): number | null {
  let near = 0, far = range;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < EPSILON) {
      if (origin[i] < box[i] || origin[i] > box[i + 3]) return null;
    } else {
      const a = (box[i] - origin[i]) / direction[i], b = (box[i + 3] - origin[i]) / direction[i];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far + EPSILON) return null;
    }
  }
  return near <= range ? near : null;
}

function rayDirection(yaw: number, pitch: number): Point {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

function collisionRay(origin: Point, direction: Point, range: number, read: (cell: Point) => Sample): BlockHit | UnknownHit | ClearHit {
  const cell = origin.map(Math.floor) as Point;
  const step = direction.map(n => n < -EPSILON ? -1 : n > EPSILON ? 1 : 0);
  const delta = direction.map((n, i) => step[i] ? Math.abs(1 / n) : Infinity);
  const edge = cell.map((n, i) => step[i] ? ((step[i] > 0 ? n + 1 : n) - origin[i]) / direction[i] : Infinity);
  let entered = 0;
  while (entered <= range) {
    const end = Math.min(range, ...edge);
    let hit: BlockHit | null = null, unknown: UnknownHit | null = null;
    // Fences and moving shapes can extend outside their owner cell. Include a
    // one-cell collar; unknown geometry there makes this interval unverified.
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const owner: Point = [cell[0] + x, cell[1] + y, cell[2] + z];
      const sample = read(owner);
      const reason = 'unknown' in sample ? sample.unknown : sample.material.collision === null ? 'collision-unread' : null;
      if (reason) {
        unknown ??= { kind: 'unknown', distance: round(entered), cell: owner, reason };
        continue;
      }
      if (!('material' in sample)) continue;
      for (const shape of sample.material.collision!) {
        const bounds = worldBox(shape, owner), distance = intersect(origin, direction, bounds, range);
        if (distance !== null && distance + EPSILON >= entered && distance <= end + EPSILON && (!hit || distance < hit.distance)) {
          hit = { kind: 'block', distance, point: atDistance(origin, direction, distance), cell: owner, material: sample.material, bounds };
        }
      }
    }
    if (unknown) return unknown;
    if (hit) return { ...hit, distance: round(hit.distance) };
    if (end >= range) return { kind: 'clear', distance: range };
    // Cross all tied faces, so negative coordinates and diagonal corners do not
    // leave the ray in a cell it has already exited.
    for (let i = 0; i < 3; i++) if (edge[i] <= end + EPSILON) { cell[i] += step[i]; edge[i] += delta[i]; }
    entered = end;
  }
  return { kind: 'clear', distance: range };
}

export function observeSpatial(bot: Bot, input: SpatialObserveInput) {
  const position = pointOf(bot.entity.position), feet = position.map(Math.floor) as Point;
  // Mineflayer supplies eyeHeight at runtime; prismarine-entity's declarations omit it.
  const { eyeHeight } = bot.entity as Bot['entity'] & { eyeHeight?: number };
  const eye: Point = [position[0], position[1] + (eyeHeight ?? 1.62), position[2]];
  const frame = { position, feet, eye, eyeHeightSource: eyeHeight === undefined ? 'standing-default' : 'client',
    yawDeg: round(bot.entity.yaw * 180 / Math.PI), pitchDeg: round(bot.entity.pitch * 180 / Math.PI) };
  const entities: EntityObservation[] = Object.values(bot.entities).filter(e => e !== bot.entity && e.id !== bot.entity.id).map(e => {
    const p = pointOf(e.position);
    const bounds: Box | null = Number.isFinite(e.width) && e.width > 0 && Number.isFinite(e.height) && e.height > 0
      ? [p[0] - e.width / 2, p[1], p[2] - e.width / 2, p[0] + e.width / 2, p[1] + e.height, p[2] + e.width / 2] : null;
    return { id: e.id, name: e.username ?? e.name ?? e.type, position: p, bounds };
  }).sort((a, b) => a.id - b.id);
  if (entities.length > SPATIAL_OBSERVATION_LIMITS.entities) throw new SkillBlocked(`当前实体超过 ${SPATIAL_OBSERVATION_LIMITS.entities} 个，未返回不完整射线观测`);
  const common = { source: 'client-loaded-world' as const, observedAt: new Date().toISOString(), dimension: bot.game?.dimension ?? null, frame };
  const cache = new Map<string, Sample>();
  const read = (cell: Point): Sample => {
    const key = cell.join(','), prior = cache.get(key);
    if (prior) return prior;
    if (cache.size >= SPATIAL_OBSERVATION_LIMITS.reads) return { unknown: 'read-budget' };
    const block = bot.blockAt(new Vec3(...cell));
    const sample: Sample = block ? { material: {
      name: block.name, stateId: block.stateId,
      properties: typeof block.getProperties === 'function' ? block.getProperties() : null,
      air: AIR_NAMES.has(block.name), liquid: LIQUIDS.has(block.name),
      collision: block.shapes === undefined ? null : block.shapes.map(s => [...s] as Box),
    } } : { unknown: 'unloaded' };
    cache.set(key, sample);
    return sample;
  };
  if (input.mode === 'voxels') {
    const bounds = input.bounds.map((n, i) => n + feet[i % 3]) as Box;
    const palette: Material[] = [], paletteIds = new Map<string, number>(), cells: number[] = [];
    let unknownCells = 0;
    for (let y = bounds[1]; y <= bounds[4]; y++) for (let z = bounds[2]; z <= bounds[5]; z++) for (let x = bounds[0]; x <= bounds[3]; x++) {
      const sample = read([x, y, z]);
      if ('unknown' in sample) { cells.push(-1); unknownCells++; continue; }
      const key = JSON.stringify(sample.material);
      let id = paletteIds.get(key);
      if (id === undefined) { id = palette.length; paletteIds.set(key, id); palette.push(sample.material); }
      cells.push(id);
    }
    const region = [...bounds] as Box;
    for (let i = 3; i < 6; i++) region[i]++;
    const nearby = entities.filter(e => e.bounds
      ? [0, 1, 2].every(i => e.bounds![i] < region[i + 3] && e.bounds![i + 3] > region[i])
      : [0, 1, 2].every(i => e.position[i] >= region[i] && e.position[i] < region[i + 3]));
    return { ...common, kind: 'voxels' as const, bounds, order: 'y,z,x; x fastest', palette, cells, unknownCells, entities: nearby,
      geometry: 'collision boxes in local block coordinates; null=unread, []=no collision; liquids remain materials; no support/passability judgement' };
  }
  const unreadEntityIds = entities.filter(e => !e.bounds).map(e => e.id);
  const rays = input.rays.map(([pitchDeg, yawDeg, range]) => {
    const direction = rayDirection(bot.entity.yaw + yawDeg * Math.PI / 180, Math.max(-Math.PI / 2, Math.min(Math.PI / 2, bot.entity.pitch + pitchDeg * Math.PI / 180)));
    const terrain = collisionRay(eye, direction, range, read);
    let entity: EntityHit | null = null;
    for (const e of entities) {
      const distance = e.bounds ? intersect(eye, direction, e.bounds, range) : null;
      if (distance !== null && (!entity || distance < entity.distance)) entity = { kind: 'entity', distance, point: atDistance(eye, direction, distance), entity: e };
    }
    if (entity) entity.distance = round(entity.distance);
    const entityBeforeTerrain = entity ? (entity.distance < terrain.distance || terrain.kind === 'clear' && entity.distance <= range
      ? true : terrain.kind === 'unknown' ? null : false) : null;
    const first = entityBeforeTerrain ? 'entity' : terrain.kind;
    return { pitchDeg, yawDeg, range, direction: direction.map(round), terrain, entity,
      entityBeforeTerrain, first };
  });
  return { ...common, kind: 'rays' as const, rays, blockReads: cache.size, unreadEntityIds,
    geometry: 'eye-origin collision rays; yaw 0=north, positive yaw=left, positive pitch=up; offsets are degrees; one-cell shape collar; unknown collar stops verification; liquids and textures do not occlude; entity boxes from this connection, not rendered meshes' };
}

export function spatialObservationText(bot: Bot, input: SpatialObserveInput): string {
  const text = JSON.stringify(observeSpatial(bot, input));
  if (text.length > SPATIAL_OBSERVATION_LIMITS.text) throw new SkillBlocked(`空间观测超过 ${SPATIAL_OBSERVATION_LIMITS.text} 字符，未返回截断数据；请缩小 bounds 或减少 rays`);
  return text;
}
