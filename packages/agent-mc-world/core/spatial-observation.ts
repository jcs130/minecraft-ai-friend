import { observedBlock, observedEntity, observationTransparent } from './perception-sight.ts';
/** Native, bounded voxel and collision-ray observations of the current connection. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { AIR_NAMES, LIQUIDS } from './cell-facts.ts';
import { SkillBlocked } from './skill-context.ts';
import { spatialSites } from './spatial-site.ts';
import { signTextSnapshot, type SignTextSnapshot } from './sign-read.ts';
import {SPATIAL_QUERY_LIMITS,DEFAULT_VOXEL_BOUNDS,VOXEL_CURSOR_MAX_LENGTH,VOXEL_CURSOR_PATTERN} from './voxel-query-contract.ts';
export {DEFAULT_VOXEL_BOUNDS} from './voxel-query-contract.ts';
export {SPATIAL_QUERY_SCHEMA,SPATIAL_QUERY_EXAMPLE,spatialArgumentDiagnostic} from './spatial-query-schema.ts';
import { openVoxelQuery, voxelPage, visibleVoxelCells, voxelContinuation, type VoxelInput, type VoxelQuery } from './voxel-paging.ts';

type Point = [number, number, number];
type Box = [number, number, number, number, number, number];
export type SpatialRay = [pitchDeg: number, yawDeg: number, range: number];
export type SpatialObserveInput =
  | VoxelInput
  | { mode: 'rays'; rays: SpatialRay[] }
  | { mode: 'sites'; sites: Point[] };

export const SPATIAL_OBSERVATION_LIMITS = SPATIAL_QUERY_LIMITS;
export const DEFAULT_SPATIAL_RAYS: SpatialRay[] = [-15, 0, 15].flatMap(pitch =>
  [-30, -15, 0, 15, 30].map(yaw => [pitch, yaw, 24] as SpatialRay));

export function parseSpatialObservation(c: Record<string, unknown>): SpatialObserveInput | { error: string } {
  const unexpected=Object.keys(c).find(k=>!['mode','bounds','cursor','format','sites','rays','skill','needs','expect'].includes(k));
  if(unexpected)return {error:`observe 不收 ${unexpected}；没有改读为其他参数或选择目标`};
  if (c.format !== undefined && c.mode !== 'voxels') return { error: 'observe.format 只用于 mode:voxels' };
  if (c.cursor !== undefined && c.mode !== 'voxels') return { error: 'observe.cursor 只用于 mode:voxels；原样使用返回的 next.arguments，不与 sites/rays 混用' };
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
    if (c.format !== undefined && c.format !== 'visible' && c.format !== 'dense') return { error: 'observe.format 只认 visible（默认可见表面）或 dense（显式逐格碰撞读数）' };
    const format = c.format === undefined ? {} : { format: c.format as 'visible' | 'dense' };
    if (c.cursor !== undefined) {
      if (c.bounds !== undefined || typeof c.cursor !== 'string' || c.cursor.length > VOXEL_CURSOR_MAX_LENGTH || !VOXEL_CURSOR_PATTERN.test(c.cursor)) {
        return { error: 'observe.cursor 要返回的完整续读字符串（≤1024字符），与 bounds 互斥；例：原样提交 next.arguments' };
      }
      return { mode: 'voxels', cursor: c.cursor, ...format };
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
    return { mode: 'voxels', bounds: [...b] as Box, ...format };
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
  vision: 'transparent'|'shape-dependent'|'unknown';
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

interface VoxelCoverage {
  requestedBounds:number[]; requestedCount:number; origin:number[]; returnedCount:number; remainingCount:number;
  observedCount?:number; unknownCount?:number; invisibleCount?:number; unloadedCount?:number;
  omittedDetailCount?:number; airCount?:number; partialReasons:string[];
}
function surfaceRegions(blocks:number[][]):number[][] {
  const rows=new Map<string,{y:number;z:number;xs:number[]}>();
  for(const [x,y,z] of blocks){const key=`${y},${z}`;if(!rows.has(key))rows.set(key,{y,z,xs:[]});rows.get(key)!.xs.push(x);}
  const regions:number[][]=[];
  for(const {y,z,xs} of rows.values()){
    xs.sort((a,b)=>a-b);let lo=xs[0],hi=lo;
    for(const x of xs.slice(1)){if(x===hi+1)hi=x;else{regions.push([lo,y,z,hi,y,z]);lo=hi=x;}}
    regions.push([lo,y,z,hi,y,z]);
  }
  return regions;
}
/** Add one machine envelope to both upstream formats before their response-size check. */
function voxelReceipt<T extends {coverage:VoxelCoverage;observedAt:string;next:ReturnType<typeof voxelContinuation>;
  complete:boolean;bounds?:number[];blocks?:number[][]}>(result:T) {
  const c=result.coverage, observed=c.observedCount ?? c.returnedCount+(c.airCount??0);
  const unknown=c.unknownCount ?? (c.invisibleCount??0)+(c.unloadedCount??0)+(c.omittedDetailCount??0);
  const step=result.next?.arguments.steps[0];
  const next_safe_read=step ? {mode:step.mode,format:step.format,cursor:step.cursor} : null;
  return {...result, requested_bounds:c.requestedBounds,requested_count:c.requestedCount,
    returned_regions:result.bounds?[result.bounds]:surfaceRegions(result.blocks??[]),
    returned_count:c.returnedCount,observed_count:observed,partial_reason:c.partialReasons.join('+')||null,
    reason:c.partialReasons.join('+')||null,remaining_count:c.requestedCount-c.returnedCount,
    remaining_after_page:c.remainingCount,unobserved_count:c.requestedCount-observed,
    coordinate_system:'absolute_block',units:'blocks',query_anchor:c.origin,observed_at:result.observedAt,
    complete_scope:'scan_exhausted_and_current_page_readable',
    requested_offsets:c.requestedBounds.map((n,i)=>n-c.origin[i%3]),
    completed:{returned_count:c.returnedCount,observed_count:observed},
    remaining:{outside_page:c.requestedCount-c.returnedCount,unknown_in_page:unknown},
    retryable:false,retry_after:null,next_cursor:step?.cursor??null,next_safe_read};
}

/** Default Agent view: sparse visible non-air surfaces, no hidden/interior grid. */
function visibleVoxelObservation(q: VoxelQuery, common: { source: string; observedAt: string; dimension: string | null; frame: unknown }, read: (p: Point)=>Sample) {
  const all=visibleVoxelCells(q), samples: Array<{at:Point;sample:Sample}>=[];
  let visible=0;
  // Bounded local visibility checks; no chunk requests or automatic next call.
  const scanCap=SPATIAL_OBSERVATION_LIMITS.visibleScans;
  for(let i=q.offset;i<all.length && samples.length<scanCap && visible<SPATIAL_OBSERVATION_LIMITS.cells;i++) {
    const sample=read(all[i]);samples.push({at:all[i],sample});
    if('material' in sample && !sample.material.air)visible++;
  }
  let take=samples.length, textLimited=false, omitDetail=false;
  for(;;) {
    const palette:Material[]=[], ids=new Map<string,number>(), blocks:Array<[number,number,number,number]>=[];
    let invisibleCount=0,unloadedCount=0,airCount=0,omittedDetailCount=0;
    for(const {at,sample} of samples.slice(0,take)) {
      if('unknown' in sample){if(sample.unknown==='unloaded')unloadedCount++;else invisibleCount++;continue;}
      if(sample.material.air){airCount++;continue;}
      if(omitDetail){omittedDetailCount++;continue;}
      const key=JSON.stringify(sample.material);let id=ids.get(key);
      if(id===undefined){id=palette.length;ids.set(key,id);palette.push(sample.material);}
      blocks.push([...at,id]);
    }
    const end=q.offset+take,remaining=all.length-end;
    const partialReasons=[...(remaining?[textLimited?'text_budget':'scan_or_surface_budget']:[]),
      ...(invisibleCount?['不可见']:[]),...(unloadedCount?['未加载']:[]),...(omittedDetailCount?['细节未返回']:[])];
    const result=voxelReceipt({...common,kind:'voxels' as const,format:'visible' as const,
      status:partialReasons.length?'partial' as const:'complete' as const,complete:partialReasons.length===0,
      coverage:{coordinateFrame:'absolute block coordinates; inclusive bounds',origin:q.origin,
        requestedBounds:q.bounds.map((n,i)=>n+q.origin[i%3]),requestedCount:all.length,
        previouslyScannedCount:q.offset,scannedCount:take,remainingCount:remaining,
        returnedCount:blocks.length,invisibleCount,unloadedCount,airCount,omittedDetailCount,
        readAttemptedCount:samples.length,unreturnedAttemptedCount:samples.length-take,partialReasons},
      palette,order:'blocks:[absolute x,y,z,palette index]',blocks,next:voxelContinuation(q,end),
      note:'仅返回当前视线可见的非空气表面方块；遮挡/超距部分为不可见，不展开格子，不能据此断言不存在。未加载、细节未返回分别计数。空气数量不证明净空或安全通行。按原点由近到远检查，预算内最多512个表面；按需续读，每页新现场，非同刻快照。'});
    if(JSON.stringify(result).length<=SPATIAL_OBSERVATION_LIMITS.text)return result;
    textLimited=true;
    if(take>1){take=Math.max(1,Math.floor(take/2));continue;}
    omitDetail=true;
  }
}

export function observeSpatial(bot: Bot, input: SpatialObserveInput) {
  const parsed=parseSpatialObservation(input as unknown as Record<string,unknown>);
  if('error' in parsed)throw new SkillBlocked(parsed.error);
  input=parsed;
  // Validate cursor scope before any block/entity read. No reanchoring on failure.
  const query = input.mode === 'voxels' ? openVoxelQuery(bot, input) : null;
  const position = pointOf(bot.entity.position), feet = position.map(Math.floor) as Point;
  // Mineflayer supplies eyeHeight at runtime; prismarine-entity's declarations omit it.
  const { eyeHeight } = bot.entity as Bot['entity'] & { eyeHeight?: number };
  const eye: Point = [position[0], position[1] + (eyeHeight ?? 1.62), position[2]];
  const frame = { position, feet, eye, eyeHeightSource: eyeHeight === undefined ? 'standing-default' : 'client',
    yawDeg: round(bot.entity.yaw * 180 / Math.PI), pitchDeg: round(bot.entity.pitch * 180 / Math.PI) };
  const common = { source: 'client-visible-world' as const, observedAt: new Date().toISOString(), dimension: bot.game?.dimension ?? null, frame };
  const cache = new Map<string, Sample>();
  const attemptedCells = new Set<string>();
  const read = (cell: Point): Sample => {
    const key = cell.join(','), prior = cache.get(key);
    attemptedCells.add(key);
    if (prior) return prior;
    if (cache.size >= SPATIAL_OBSERVATION_LIMITS.reads) return { unknown: 'read-budget' };
    const block = bot.blockAt(new Vec3(...cell));
    if (block && input.mode !== 'rays' && !observedBlock(bot,{x:cell[0],y:cell[1],z:cell[2]})) return {unknown:'occluded'};
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
  if (query?.format === 'visible') return visibleVoxelObservation(query,common,read);
  const entities: EntityObservation[] = Object.values(bot.entities).filter(e => e !== bot.entity && e.id !== bot.entity.id && observedEntity(bot,e)).map(e => {
    const p = pointOf(e.position);
    const bounds: Box | null = Number.isFinite(e.width) && e.width > 0 && Number.isFinite(e.height) && e.height > 0
      ? [p[0] - e.width / 2, p[1], p[2] - e.width / 2, p[0] + e.width / 2, p[1] + e.height, p[2] + e.width / 2] : null;
    return { id: e.id, name: e.username ?? e.name ?? e.type, position: p, bounds };
  }).sort((a, b) => a.id - b.id);
  if (input.mode === 'rays' && entities.length > SPATIAL_OBSERVATION_LIMITS.entities) throw new SkillBlocked(`当前实体超过 ${SPATIAL_OBSERVATION_LIMITS.entities} 个，未返回不完整射线观测`);
  if (input.mode === 'voxels') {
    let cap: number = SPATIAL_OBSERVATION_LIMITS.cells, entityCap: number = SPATIAL_OBSERVATION_LIMITS.entities;
    let textLimited = false, omitDetail = false;
    for (;;) {
      const page = voxelPage(query!, cap), { bounds } = page;
      const palette: Material[] = [], paletteIds = new Map<string, number>(), cells: number[] = [];
      const counts: number[] = [], landmarks: Array<{ at: Point; palette: number; distance: number }> = [];
      let unknownCells = 0;
      for (let y = bounds[1]; y <= bounds[4]; y++) for (let z = bounds[2]; z <= bounds[5]; z++) for (let x = bounds[0]; x <= bounds[3]; x++) {
        const sample: Sample = omitDetail ? { unknown: 'read-budget' } : read([x, y, z]);
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
        unknownMeaning: '-1=不可见、未加载或细节未返回，不是空气或实心，也不能排除目标或通道；未返回区域不作地形判断',
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
      const partialReasons = [
        ...(page.coverage.remainingCount && !textLimited ? ['cell_budget'] : []),
        ...(textLimited ? ['text_budget'] : []), ...(unknownCells ? ['unknown_cells'] : []),
        ...(nearby.length > entityCap ? ['entity_budget'] : []),
      ];
      const result = voxelReceipt({ ...common, format:'dense' as const, kind: 'voxels' as const, status: partialReasons.length ? 'partial' as const : 'complete' as const,
        complete: partialReasons.length === 0, coverage: { ...page.coverage, observedCount: cells.length-unknownCells,
          unknownCount: unknownCells, readAttemptedCount: attemptedCells.size,
          unreturnedAttemptedCount: Math.max(0,attemptedCells.size-cells.length),
          partialReasons, omittedEntityCount: Math.max(0,nearby.length-entityCap) }, next: page.next,
        bounds, summary, order: 'y,z,x; x fastest', palette, cells, unknownCells, entities: nearby.slice(0,entityCap),
        geometry: 'collision boxes in local block coordinates; null=unread, []=no collision; liquids remain materials; no support/passability judgement' });
      if (JSON.stringify(result).length <= SPATIAL_OBSERVATION_LIMITS.text) return result;
      textLimited = true;
      if (entityCap && nearby.length) { entityCap = Math.floor(Math.min(entityCap,nearby.length)/2); continue; }
      if (cap > 1) { cap = Math.max(1,Math.floor(cap/2)); continue; }
      // A pathological single material cannot fit: retain its coordinate as unknown.
      omitDetail = true;
    }
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
