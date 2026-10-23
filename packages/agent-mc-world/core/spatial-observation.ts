import { observedBlock, observedEntity, observationTransparent } from './perception-sight.ts';
/** Native, bounded voxel and collision-ray observations of the current connection. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { AIR_NAMES, LIQUIDS } from './cell-facts.ts';
import { SkillBlocked } from './skill-context.ts';
import { DEFAULT_VOXEL_BOUNDS, VOXEL_BOUNDS_SCHEMA, VOXEL_CURSOR_SCHEMA, VOXEL_QUERY_DOC, VOXEL_BUDGET, VOXEL_OFFSET, VOXEL_RESPONSE_TEXT_CAP, takeVoxelRegion, voxelVolume, voxelCursorError, type VoxelCursor } from './voxel-query-contract.ts';
export { DEFAULT_VOXEL_BOUNDS } from './voxel-query-contract.ts';
import { spatialSites } from './spatial-site.ts';
import { signTextSnapshot, type SignTextSnapshot } from './sign-read.ts';

type Point = [number, number, number];
type Box = [number, number, number, number, number, number];
export type SpatialRay = [pitchDeg: number, yawDeg: number, range: number];
export type SpatialObserveInput =
  | { mode: 'voxels'; bounds: Box }
  | { mode: 'voxels'; cursor: VoxelCursor }
  | { mode: 'rays'; rays: SpatialRay[] }
  | { mode: 'sites'; sites: Point[] };

export const SPATIAL_OBSERVATION_LIMITS = {
  cells: VOXEL_BUDGET, offset: VOXEL_OFFSET, rays: 64, range: 64, reads: 16_384, entities: 512, text: VOXEL_RESPONSE_TEXT_CAP, sites: 4,
} as const;
export const DEFAULT_SPATIAL_RAYS: SpatialRay[] = [-15, 0, 15].flatMap(pitch =>
  [-30, -15, 0, 15, 30].map(yaw => [pitch, yaw, 24] as SpatialRay));
export const SPATIAL_QUERY_EXAMPLE = { mode: 'voxels', bounds: [0,0,0,0,0,0] };
export const SPATIAL_QUERY_SCHEMA = { type: 'object', required: ['mode'], additionalProperties: false,
  examples: [SPATIAL_QUERY_EXAMPLE],
  allOf: [
    { if: { required:['mode'], properties: {mode:{const:'sites'}} }, then: { required:['sites'], properties:{bounds:false,rays:false,cursor:false} } },
    { if: { required:['mode'], properties: {mode:{const:'rays'}} }, then: { properties:{bounds:false,sites:false,cursor:false} } },
    { if: { required:['mode'], properties: {mode:{const:'voxels'}} }, then: { properties:{rays:false,sites:false} } },
    { if: { required:['cursor'] }, then: { properties:{bounds:false} } },
  ], properties: {
  mode: { type: 'string', enum: ['voxels','sites','rays'] },
  bounds: { ...VOXEL_BOUNDS_SCHEMA, description: VOXEL_QUERY_DOC },
  cursor: { ...VOXEL_CURSOR_SCHEMA, description: 'Exact next_cursor from the prior page; mutually exclusive with bounds; absolute, dimension pinned. No automatic continuation.' },
  sites: { type: 'array', minItems: 1, maxItems: SPATIAL_OBSERVATION_LIMITS.sites, uniqueItems: true,
    items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: -30_000_000, maximum: 30_000_000 } },
    description: 'sites only: 1..4 absolute integer block cells [x,y,z], no default. body.clear tests 0.6×1.8 clearance, not permission or reachability.' },
  rays: { type: 'array', minItems: 1, maxItems: SPATIAL_OBSERVATION_LIMITS.rays,
    items: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', minItems: 3, maxItems: 3,
      items: [{ type: 'number', minimum: -90, maximum: 90 }, { type: 'number', minimum: -180, maximum: 180 },
        { type: 'number', exclusiveMinimum: 0, maximum: SPATIAL_OBSERVATION_LIMITS.range }] },
    description: 'rays only: [relative pitch degrees,relative yaw degrees,range blocks]; default 3×5 fan at 24 blocks. Collision rays stop at glass even though vision can pass through it.' },
} };

export function spatialArgumentDiagnostic(args: Record<string,unknown>, problem: string) {
  const fields = ['cursor','bounds','rays','sites','mode'];
  const field = Object.keys(args).find(k => !(k in SPATIAL_QUERY_SCHEMA.properties))
    ?? fields.find(f => problem.includes(f)) ?? 'mode';
  return { status: 'invalid_arguments', reason: 'invalid_spatial_query', completed: 0, remaining: null,
    retryable: false, retry_after: null, next_safe_read: null,
    errors: [{ path: `/${field}`, expected: SPATIAL_QUERY_SCHEMA.properties[field as keyof typeof SPATIAL_QUERY_SCHEMA.properties]
      ?? { allowed_fields: Object.keys(SPATIAL_QUERY_SCHEMA.properties), additionalProperties: false },
      problem, actual: args[field] ?? null }],
    minimal_legal_example: SPATIAL_QUERY_EXAMPLE, executed: false };
}

export function parseSpatialObservation(c: Record<string, unknown>): SpatialObserveInput | { error: string } {
  const unexpected = Object.keys(c).find(k => !['mode','bounds','cursor','sites','rays','skill','needs','expect'].includes(k));
  if (unexpected) return { error: `observe 不收 ${unexpected}；没有改读为其他参数或选择目标` };
  if (c.cursor !== undefined && c.mode !== 'voxels') return { error: 'cursor 只用于 mode:voxels' };
  if (c.mode === 'sites') {
    if (c.bounds != null || c.rays != null) return { error: 'sites 不收 bounds/rays；sites 是绝对方块坐标' };
    if (!Array.isArray(c.sites) || !c.sites.length || c.sites.length > SPATIAL_OBSERVATION_LIMITS.sites
      || c.sites.some(p => !Array.isArray(p) || p.length !== 3 || p.some(n => !Number.isSafeInteger(n) || Math.abs(n) > 30_000_000))) {
      return { error: `sites 要 1-${SPATIAL_OBSERVATION_LIMITS.sites} 组绝对整数坐标 [x,y,z]（每项 ±30000000）；每格分别检查，不投影前一步改造` };
    }
    if (new Set(c.sites.map(p => p.join(','))).size !== c.sites.length) return { error: 'sites 含重复坐标；同一格只查一次' };
    return { mode: 'sites', sites: c.sites.map(p => [...p] as Point) };
  }
  if (c.sites != null) return { error: 'sites 只用于 mode:sites' };
  if (c.mode === 'voxels') {
    if (c.rays !== undefined) return { error: 'voxels 不收 rays' };
    if (c.cursor !== undefined) {
      if (c.bounds !== undefined) return { error: 'cursor 与 bounds 互斥；续读只发送原样 cursor' };
      const error = voxelCursorError(c.cursor);
      return error ? { error } : { mode: 'voxels', cursor: structuredClone(c.cursor) as VoxelCursor };
    }
    const b = c.bounds ?? DEFAULT_VOXEL_BOUNDS;
    if (!Array.isArray(b) || b.length !== 6 || b.some(n => !Number.isInteger(n) || Math.abs(n) > SPATIAL_OBSERVATION_LIMITS.offset)) {
      return { error: `bounds 要六个 -${SPATIAL_OBSERVATION_LIMITS.offset}..${SPATIAL_OBSERVATION_LIMITS.offset} 的整数，顺序 xmin,ymin,zmin,xmax,ymax,zmax；相对脚下格` };
    }
    if (b.slice(0, 3).some((n, i) => n > b[i + 3])) {
      const ordered = [0, 1, 2].map(i => Math.min(b[i], b[i + 3]))
        .concat([0, 1, 2].map(i => Math.max(b[i], b[i + 3])));
      return { error: `bounds 的最小值不能大于最大值；同一区域的升序边界为 ${JSON.stringify(ordered)}，请核对相对坐标后重新提交；尚未读取` };
    }
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
  return { error: 'observe 的 mode 要 sites/voxels/rays' };
}

interface Material {
  name: string;
  stateId: number;
  properties: Record<string, string | number | boolean> | null;
  air: boolean;
  liquid: boolean;
  /** Local boxes; null means the collision geometry was not supplied. */
  collision: Box[] | null;
  /** Vision is independent of body collision and never establishes safe passage. */
  vision: 'transparent' | 'shape-dependent' | 'unknown';
  sign?: SignTextSnapshot;
}
type Sample = { material: Material } | { unknown: 'unloaded' | 'read-budget' | 'occluded' };
interface EntityObservation {
  id: number;
  name: string;
  position: Point;
  bounds: Box | null;
}
type BlockHit = { kind: 'block'; distance: number; point: Point; cell: Point; material: Material; bounds: Box };
type EntityHit = { kind: 'entity'; distance: number; point: Point; entity: EntityObservation };
type UnknownHit = { kind: 'unknown'; distance: number; cell: Point; reason: 'unloaded' | 'collision-unread' | 'read-budget' | 'occluded' };
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
  // Also guard SDK/direct callers: limits do not depend on the MCP transport.
  const checked = parseSpatialObservation(input as unknown as Record<string, unknown>);
  if ('error' in checked) throw new SkillBlocked(checked.error);
  input = checked;
  const position = pointOf(bot.entity.position), feet = position.map(Math.floor) as Point;
  // Mineflayer supplies eyeHeight at runtime; prismarine-entity's declarations omit it.
  const { eyeHeight } = bot.entity as Bot['entity'] & { eyeHeight?: number };
  const eye: Point = [position[0], position[1] + (eyeHeight ?? 1.62), position[2]];
  const frame = { position, feet, eye, eyeHeightSource: eyeHeight === undefined ? 'standing-default' : 'client',
    yawDeg: round(bot.entity.yaw * 180 / Math.PI), pitchDeg: round(bot.entity.pitch * 180 / Math.PI) };
  const common = { source: 'client-visible-world' as const, observedAt: new Date().toISOString(), dimension: bot.game?.dimension ?? null, frame };
  const cache = new Map<string, Sample>();
  const read = (cell: Point): Sample => {
    const key = cell.join(','), prior = cache.get(key);
    if (prior) return prior;
    if (cache.size >= SPATIAL_OBSERVATION_LIMITS.reads) return { unknown: 'read-budget' };
    if (input.mode !== 'rays' && !observedBlock(bot,{x:cell[0],y:cell[1],z:cell[2]})) return {unknown:'occluded'};
    const block = bot.blockAt(new Vec3(...cell));
    const sign = input.mode === 'sites' ? signTextSnapshot(block) : null;
    const sample: Sample = block ? { material: {
      name: block.name, stateId: block.stateId,
      properties: typeof block.getProperties === 'function' ? block.getProperties() : null,
      air: AIR_NAMES.has(block.name), liquid: LIQUIDS.has(block.name),
      collision: block.shapes === undefined ? null : block.shapes.map(s => [...s] as Box),
      vision: observationTransparent(block.name) ? 'transparent' : block.shapes === undefined ? 'unknown' : 'shape-dependent',
      ...(sign ? { sign } : {}),
    } } : { unknown: 'unloaded' };
    cache.set(key, sample);
    return sample;
  };
  if (input.mode === 'sites') return {
    source: common.source, observedAt: common.observedAt, dimension: common.dimension, position,
    kind: 'sites' as const, sites: spatialSites(read, input.sites).map(site => {
      const target = read(site.at), sign = 'material' in target ? target.material.sign : null;
      return sign ? { ...site, sign } : site;
    }), blockReads: cache.size,
    geometry: 'absolute cells; faces: ref+face=target, boundary area 0..1 (0 omitted, null unknown); body=0.6x1.8 centered, block collisions + 1-cell collar, first 3 hits/count, fluids by cell; not reachability, placement permission or safe footing',
  };
  const entities: EntityObservation[] = Object.values(bot.entities).filter(e => e !== bot.entity && e.id !== bot.entity.id && observedEntity(bot,e)).map(e => {
    const p = pointOf(e.position);
    const bounds: Box | null = Number.isFinite(e.width) && e.width > 0 && Number.isFinite(e.height) && e.height > 0
      ? [p[0] - e.width / 2, p[1], p[2] - e.width / 2, p[0] + e.width / 2, p[1] + e.height, p[2] + e.width / 2] : null;
    return { id: e.id, name: e.username ?? e.name ?? e.type, position: p, bounds };
  }).sort((a, b) => a.id - b.id);
  if (input.mode === 'rays' && entities.length > SPATIAL_OBSERVATION_LIMITS.entities) throw new SkillBlocked(`当前实体超过 ${SPATIAL_OBSERVATION_LIMITS.entities} 个，未返回不完整射线观测`);
  if (input.mode === 'voxels') {
    const query: VoxelCursor = 'cursor' in input ? input.cursor : { version: 1, anchor: feet,
      requested_bounds: input.bounds.map((n, i) => n + feet[i % 3]) as Box,
      dimension: common.dimension, pending_regions: [input.bounds.map((n, i) => n + feet[i % 3]) as Box] };
    if (query.dimension !== common.dimension) throw new SkillBlocked('cursor 维度已改变；未读取，不能把原坐标当成新维度的区域');
    const page = takeVoxelRegion(query.pending_regions);
    const makePage = (bounds: Box, rest: Box[]) => {
    const palette: Material[] = [], paletteIds = new Map<string, number>(), cells: number[] = [];
    const counts: number[] = [], landmarks: Array<{ at: Point; palette: number; distance: number }> = [];
    let unknownCells = 0;
    for (let y = bounds[1]; y <= bounds[4]; y++) for (let z = bounds[2]; z <= bounds[5]; z++) for (let x = bounds[0]; x <= bounds[3]; x++) {
      const sample = read([x, y, z]);
      if ('unknown' in sample) { cells.push(-1); unknownCells++; continue; }
      const key = JSON.stringify(sample.material);
      let id = paletteIds.get(key);
      if (id === undefined) { id = palette.length; paletteIds.set(key, id); palette.push(sample.material); }
      cells.push(id);
      counts[id] = (counts[id] ?? 0) + 1;
      if (/(?:^|_)(?:stairs|slab|ladder|door|trapdoor|fence_gate|sign)$/.test(sample.material.name)) {
        landmarks.push({ at: [x,y,z], palette: id, distance: round(Math.hypot(x-feet[0],y-feet[1],z-feet[2])) });
      }
    }
    const region = [...bounds] as Box;
    for (let i = 3; i < 6; i++) region[i]++;
    const nearby = entities.filter(e => e.bounds
      ? [0, 1, 2].every(i => e.bounds![i] < region[i + 3] && e.bounds![i + 3] > region[i])
      : [0, 1, 2].every(i => e.position[i] >= region[i] && e.position[i] < region[i + 3]));
    landmarks.sort((a,b) => a.distance-b.distance || a.at[1]-b.at[1] || a.at[2]-b.at[2] || a.at[0]-b.at[0]);
    const materialCounts = palette.map((p,id) => ({ palette:id, name:p.name, cells:counts[id] })).sort((a,b) => b.cells-a.cells);
    let signPreviews = 0;
    const summary = { observedCells: cells.length-unknownCells, totalCells: cells.length, unknownCells,
      unknownMeaning: '-1=未观察（遮挡或未加载），不是空气或实心，也不能排除目标或通道',
      headLayerIncluded: bounds[1] <= feet[1]+1 && bounds[4] >= feet[1]+1,
      materials: materialCounts.slice(0,16), omittedMaterials: Math.max(0,materialCounts.length-16),
      landmarks: landmarks.slice(0,12).map(({ at,palette:id }) => {
        const sign = /(?:^|_)sign$/.test(palette[id].name) && signPreviews++ < 3
          ? signTextSnapshot(bot.blockAt(new Vec3(...at))) : null;
        return { at, name:palette[id].name, properties:palette[id].properties,
          ...(sign ? { sign:{...sign,front:sign.front?.slice(0,160)??null,back:sign.back?.slice(0,160)??null,
            truncated:sign.truncated||(sign.front?.length??0)>160||(sign.back?.length??0)>160} } : {}) };
      }),
      omittedLandmarks: Math.max(0,landmarks.length-12),
      note: '仅列实际观察到的地标；门、楼梯、牌子是核验线索，不证明入口、整条路线可达或施工权限。' };
    const requested_count = voxelVolume(query.requested_bounds), returned_count = cells.length;
    const next_cursor = rest.length ? { ...query, pending_regions: rest } : null;
    const complete = requested_count === returned_count && unknownCells === 0;
    const reasons = [...(requested_count > SPATIAL_OBSERVATION_LIMITS.cells ? ['cell_budget']
      : requested_count > returned_count ? ['paged_query'] : []), ...(unknownCells ? ['unknown_cells'] : [])];
    return { ...common, kind: 'voxels' as const, bounds, summary, order: 'y,z,x; x fastest', palette, cells, unknownCells,
      entities: nearby.slice(0, SPATIAL_OBSERVATION_LIMITS.entities), omitted_entities: Math.max(0,nearby.length-SPATIAL_OBSERVATION_LIMITS.entities),
      status: complete ? 'complete' : 'partial', reason: reasons.join('+') || null,
      requested_bounds: query.requested_bounds, requested_count, returned_regions: [bounds], returned_count,
      complete, partial_reason: reasons.join('+') || null, remaining_count: requested_count-returned_count,
      remaining_after_page: rest.reduce((n,b) => n+voxelVolume(b),0), observed_count: returned_count-unknownCells,
      unobserved_count: requested_count-returned_count+unknownCells,
      coordinate_system: 'absolute_block', units: 'blocks', query_anchor: query.anchor, observed_at: common.observedAt,
      requested_offsets: query.requested_bounds.map((n,i)=>n-query.anchor[i%3]),
      completed: { returned_count, observed_count: returned_count-unknownCells },
      remaining: { outside_page: requested_count-returned_count, unknown_in_page: unknownCells },
      retryable: false, retry_after: null, next_cursor,
      next_safe_read: next_cursor ? { mode: 'voxels', cursor: next_cursor } : null,
      geometry: 'vision=transparent is optical only; collision boxes in local block coordinates, null=unread, []=no collision; body clearance requires sites; no support/permission/safety judgement' };
    };
    // Keep a whole cuboid and a valid continuation even for unusually verbose mod geometry.
    // Shrinking reuses this call's cache; it never reads outside the original <=512-cell page.
    let selected = page, result = makePage(selected.bounds, selected.rest);
    while (JSON.stringify(result).length > SPATIAL_OBSERVATION_LIMITS.text && voxelVolume(selected.bounds) > 1) {
      selected = takeVoxelRegion([selected.bounds, ...selected.rest], Math.ceil(voxelVolume(selected.bounds)/2));
      result = makePage(selected.bounds, selected.rest);
      result.partial_reason = result.reason = [result.partial_reason, 'response_budget'].filter(Boolean).join('+');
    }
    // A single pathological material may exceed the text budget: preserve the cell as unknown.
    if (JSON.stringify(result).length > SPATIAL_OBSERVATION_LIMITS.text) {
      result.palette = []; result.cells = [-1]; result.unknownCells = 1; result.observed_count = 0;
      result.summary = { ...result.summary, observedCells: 0, unknownCells: 1, materials: [], landmarks: [] };
      result.completed.observed_count = 0; result.remaining.unknown_in_page = 1;
      result.unobserved_count = result.requested_count; result.omitted_entities += result.entities.length;
      result.entities = []; result.complete = false;
      result.status = 'partial'; result.partial_reason = result.reason = 'response_budget+unknown_cells';
    }
    return result;
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
    if (entity && (terrain.kind === 'unknown' || (terrain.kind !== 'clear' && entity.distance >= terrain.distance))) entity = null;
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
  if (text.length > SPATIAL_OBSERVATION_LIMITS.text) throw new SkillBlocked(`空间观测超过 ${SPATIAL_OBSERVATION_LIMITS.text} 字符，未返回截断数据；请减少 sites/rays 或缩小 bounds`);
  return text;
}
