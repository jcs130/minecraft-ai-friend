/** Read-only rail topology from loaded block states; no route design or construction policy. */
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';

type Point = [number, number, number];
type Box = [number, number, number, number, number, number];
type Port = { dx: number; dz: number; rise: number; direction: string };
type BlockReading = { name: string; getProperties(): Record<string, unknown>; shapes?: number[][] };
type Reader = (at: Point) => BlockReading | null;
const RAILS = new Set(['rail', 'powered_rail', 'detector_rail', 'activator_rail']);
const N: Port = { dx: 0, dz: -1, rise: 0, direction: 'north' };
const S: Port = { dx: 0, dz: 1, rise: 0, direction: 'south' };
const E: Port = { dx: 1, dz: 0, rise: 0, direction: 'east' };
const W: Port = { dx: -1, dz: 0, rise: 0, direction: 'west' };
const PORTS: Record<string, readonly Port[]> = {
  north_south: [N, S], east_west: [E, W],
  ascending_east: [W, { ...E, rise: 1 }], ascending_west: [E, { ...W, rise: 1 }],
  ascending_north: [S, { ...N, rise: 1 }], ascending_south: [N, { ...S, rise: 1 }],
  south_east: [S, E], south_west: [S, W], north_west: [N, W], north_east: [N, E],
};
export const RAILWAY_LIMITS = { cells: 4096, axis: 128, rails: 256, examples: 24, summaryExamples: 6, text: 7_500 } as const;

export const RAILWAY_TOOL_DECL = {
  name: 'mc_railway', tags: ['read'] as const,
  description: 'Read rail shapes and height-compatible reciprocal connections in an absolute inclusive bounds box of the currently loaded world. No movement, queue changes, redstone activation or building. At most 4096 cells, 128 per axis and 256 rails. Optional start/end rail cells test connectivity within this sample and return the complete path. The default summary bounds examples and reports omitted counts; narrow bounds to inspect another section. Counts and adjacency alone never certify connection; unobserved continuations remain unknown. powered=false is a current reading, not proof of a failed circuit. detail adds rail/edge and nearby collision data; oversized detail fails with instructions to narrow bounds. This is static topology, not a passenger clearance, launch or round-trip test. Use mc_guide railway for interpretation and design.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    bounds: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'integer' }, description: 'Absolute [xmin,ymin,zmin,xmax,ymax,zmax], inclusive. Read only the corridor needed; unloaded cells are unknown.' },
    start: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer' }, description: 'Optional start rail cell inside bounds; requires end.' },
    end: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer' }, description: 'Optional destination rail cell inside bounds; requires start.' },
    detail: { type: 'boolean', description: 'Include compact rails/edges and bounded examples of support/overhead collision readings.' },
  }, required: ['bounds'] },
};

function point(value: unknown, size: number, name: string): number[] {
  if (!Array.isArray(value) || value.length !== size || !value.every(Number.isSafeInteger))
    throw new Error(`${name} 须为 ${size} 个安全整数坐标`);
  return value;
}
function inside(at: Point, b: Box): boolean { return at.every((v, i) => v >= b[i] && v <= b[i + 3]); }
const key = (p: Point) => p.join(',');

/** Accepts live native block readings. Tests use real prismarine-block states. */
export function observeRailway(read: Reader, args: Record<string, unknown>, dimension: string | null = null) {
  if (Object.keys(args).some(k => !['bounds', 'start', 'end', 'detail'].includes(k))) throw new Error('不支持的铁路查询字段');
  const b = point(args.bounds, 6, 'bounds') as Box;
  const size = [0, 1, 2].map(i => b[i + 3] - b[i] + 1);
  if (size.some(n => n <= 0 || n > RAILWAY_LIMITS.axis) || size.reduce((a, n) => a * n, 1) > RAILWAY_LIMITS.cells)
    throw new Error(`bounds 须有序；每轴最多 ${RAILWAY_LIMITS.axis} 格、总体积最多 ${RAILWAY_LIMITS.cells} 格`);
  if ((args.start === undefined) !== (args.end === undefined)) throw new Error('start 与 end 须一起提供');
  const start = args.start === undefined ? null : point(args.start, 3, 'start') as Point;
  const end = args.end === undefined ? null : point(args.end, 3, 'end') as Point;
  if ([start, end].some(p => p && !inside(p, b))) throw new Error('start/end 须在 bounds 内');
  if (args.detail !== undefined && typeof args.detail !== 'boolean') throw new Error('detail 须为布尔值');
  const observedAt = new Date().toISOString();
  type Rail = { at: Point; name: string; shape: string | null; powered: boolean | null; ports: readonly Port[] | null };
  const cells = new Map<string, BlockReading | null>(), rails: Rail[] = [], ids = new Map<string, number>();
  let unknownCells = 0;
  for (let y = b[1]; y <= b[4]; y++) for (let z = b[2]; z <= b[5]; z++) for (let x = b[0]; x <= b[3]; x++) {
    const at: Point = [x, y, z], block = read(at); cells.set(key(at), block);
    if (!block) { unknownCells++; continue; }
    if (!RAILS.has(block.name)) continue;
    const props = block.getProperties(), shape = typeof props.shape === 'string' ? props.shape : null;
    // Only ordinary rail has curved states in the Java 1.20.6 registry.
    const ports = shape && PORTS[shape] && (block.name === 'rail' || !/^(north|south)_(east|west)$/.test(shape)) ? PORTS[shape] : null;
    ids.set(key(at), rails.length);
    rails.push({ at, name: block.name, shape, powered: typeof props.powered === 'boolean' ? props.powered : null, ports });
    if (rails.length > RAILWAY_LIMITS.rails) throw new Error(`超过 ${RAILWAY_LIMITS.rails} 根轨道，请缩小查询范围`);
  }
  // Stacked rails can expose more than one reciprocal port at the same height.
  // Do not silently invent a three-way junction or choose the engine's vehicle route.
  const matches = rails.map(rail => (rail.ports ?? []).map(p => {
    const height = rail.at[1] + p.rise, found: Array<{ id: number; port: number }> = [];
    for (const y of [height - 1, height]) {
      const id = ids.get(key([rail.at[0] + p.dx, y, rail.at[2] + p.dz]));
      if (id === undefined) continue;
      rails[id].ports?.forEach((q, port) => {
        if (q.dx === -p.dx && q.dz === -p.dz && rails[id].at[1] + q.rise === height) found.push({ id, port });
      });
    }
    return found;
  }));
  const edges = rails.map(() => new Set<number>()), openPorts: Array<Record<string, unknown>> = [];
  const uncertainNodes = new Set<number>();
  for (const [id, rail] of rails.entries()) {
    if (!rail.ports) { uncertainNodes.add(id); openPorts.push({ at: rail.at, reason: 'unknown_rail_state', name: rail.name, shape: rail.shape }); continue; }
    for (const [port, p] of rail.ports.entries()) {
      const height = rail.at[1] + p.rise;
      const candidates: Point[] = [height - 1, height].map(y => [rail.at[0] + p.dx, y, rail.at[2] + p.dz]);
      const found = matches[id][port], only = found.length === 1 ? found[0] : null;
      if (only && matches[only.id][only.port].length === 1) { edges[id].add(only.id); edges[only.id].add(id); continue; }
      const ambiguous = found.length > 0;
      const readings = candidates.map(at => ({ at, name: cells.get(key(at))?.name ?? null,
        status: !inside(at, b) ? 'outside_sample' : cells.get(key(at)) === null ? 'unloaded' : 'loaded' }));
      const unknown = readings.find(v => v.status !== 'loaded');
      const unknownShape = candidates.some(at => { const n = ids.get(key(at)); return n !== undefined && !rails[n].ports; });
      if (unknown || unknownShape || ambiguous) uncertainNodes.add(id);
      const adjacentRails = [-1, 0, 1].flatMap(dy => {
        const n = ids.get(key([rail.at[0] + p.dx, rail.at[1] + dy, rail.at[2] + p.dz]));
        return n === undefined ? [] : [{ at: rails[n].at, shape: rails[n].shape }];
      });
      openPorts.push({ at: rail.at, direction: p.direction, endpointY: height,
        reason: ambiguous ? 'ambiguous_height_connection' : unknown?.status ?? (unknownShape ? 'unknown_rail_state' : adjacentRails.length ? 'no_reciprocal_port' : 'no_rail'),
        candidates: readings, ...(adjacentRails.length ? { adjacentRails } : {}) });
    }
  }
  const componentOf = rails.map(() => -1), components: Array<{ id: number; railCount: number; uncertainContinuation: boolean }> = [];
  for (let root = 0; root < rails.length; root++) {
    if (componentOf[root] !== -1) continue;
    const id = components.length, todo = [root]; componentOf[root] = id;
    let uncertainContinuation = false;
    for (let i = 0; i < todo.length; i++) {
      const n = todo[i]; uncertainContinuation ||= uncertainNodes.has(n);
      for (const next of edges[n]) if (componentOf[next] === -1) { componentOf[next] = id; todo.push(next); }
    }
    components.push({ id, railCount: todo.length, uncertainContinuation });
  }
  let route: { start: Point; end: Point; status: string; path: Point[] | null; reason?: string } | null = null;
  if (start && end) {
    const a = ids.get(key(start)), z = ids.get(key(end));
    if (a === undefined || z === undefined) {
      const endpoints = [start, end].map(p => ({ at: p, block: cells.get(key(p)) }));
      const knownNonRail = endpoints.some(({ block }) => block && !RAILS.has(block.name));
      route = { start, end, status: knownNonRail ? 'not_connected_in_sample' : 'unknown', path: null,
        reason: knownNonRail ? 'endpoint_is_not_rail' : 'endpoint_unloaded' };
    } else if (!rails[a].ports || !rails[z].ports) {
      route = { start, end, status: 'unknown', path: null, reason: 'endpoint_shape_unknown' };
    } else if (componentOf[a] !== componentOf[z]) {
      route = { start, end, status: components[componentOf[a]].uncertainContinuation ? 'unknown' : 'not_connected_in_sample', path: null,
        reason: 'no_reciprocal_shape_path_observed' };
    } else {
      const previous = new Map<number, number | null>([[a, null]]), todo = [a];
      for (let i = 0; i < todo.length && !previous.has(z); i++) for (const next of edges[todo[i]]) {
        if (previous.has(next)) continue;
        previous.set(next, todo[i]); todo.push(next);
      }
      const path: Point[] = [];
      for (let n: number | null = z; n !== null; n = previous.get(n) ?? null) path.push(rails[n].at);
      route = { start, end, status: 'connected_in_sample', path: path.reverse() };
    }
  }
  const power = rails.filter(r => r.name === 'powered_rail');
  const collisionExamples: Array<Record<string, unknown>> = [];
  let collisionExampleCount = 0;
  if (args.detail) for (const rail of rails) {
    const nearby = [-1, 1, 2].map(dy => {
      const at: Point = [rail.at[0], rail.at[1] + dy, rail.at[2]];
      const block = inside(at, b) ? cells.get(key(at)) : undefined;
      return { at, relation: dy === -1 ? 'below' : 'above', status: !inside(at, b) ? 'outside_sample' : block === null ? 'unloaded' : 'loaded',
        name: block?.name ?? null, collision: block?.shapes ?? null };
    });
    // Report uncertain/non-cube supports and overhead shapes as measurements, not a passability verdict.
    const interesting = nearby.filter(v => v.relation === 'below'
      ? !v.collision?.some(s => s.length === 6 && s.every((n, i) => n === (i < 3 ? 0 : 1)))
      : v.status !== 'loaded' || v.collision === null || v.collision.length > 0);
    if (interesting.length) { collisionExampleCount++; if (collisionExamples.length < RAILWAY_LIMITS.examples) collisionExamples.push({ rail: rail.at, cells: interesting }); }
  }
  const palette: Array<{ name: string; shape: string | null; powered: boolean | null }> = [], paletteIds = new Map<string, number>();
  const compactRails = rails.map((r, id) => {
    const material = { name: r.name, shape: r.shape, powered: r.powered }, k = JSON.stringify(material);
    let p = paletteIds.get(k); if (p === undefined) { p = palette.length; paletteIds.set(k, p); palette.push(material); }
    return [...r.at, p, componentOf[id]];
  });
  return { source: 'client-loaded-world', observedAt, dimension, bounds: b, cells: cells.size, unknownCells,
    railCount: rails.length, componentCount: components.length, components, route,
    openPortCount: openPorts.length, openPorts: openPorts.slice(0, RAILWAY_LIMITS.examples), openPortsOmitted: Math.max(0, openPorts.length - RAILWAY_LIMITS.examples),
    power: { poweredRails: power.length, poweredNow: power.filter(r => r.powered === true).length, unpoweredNow: power.filter(r => r.powered === false).length,
      unknownPower: power.filter(r => r.powered === null).length, unpoweredExamples: power.filter(r => r.powered === false).slice(0, RAILWAY_LIMITS.examples).map(r => r.at) },
    ...(args.detail ? { railColumns: ['x', 'y', 'z', 'palette', 'component'], railPalette: palette, rails: compactRails,
      edgeIndex: 'zero-based rails array indices', edges: edges.flatMap((set, id) => [...set].filter(n => n > id).map(n => [id, n])),
      collisionExamples, collisionExamplesOmitted: collisionExampleCount - collisionExamples.length } : {}),
    evidenceBoundary: 'Static reciprocal shape/height paths in this sampled box only. Open ports may be intended terminal ends. No track switch prediction, passenger swept-volume test, launch test, speed guarantee, appearance judgment or global unreachability claim. Outside bounds and unloaded blocks are unknown; powered state may change after sampling.',
  };
}

export function railwayReadout(bot: Bot | null, args: Record<string, unknown>) {
  try {
    if (!bot?.entity) throw new Error('Minecraft 尚未连接，未读取铁路');
    const result = observeRailway(at => bot.blockAt(new Vec3(...at), false), args, bot.game?.dimension ?? null);
    const prefix = '[mc_railway] ';
    if (args.detail) {
      const text = prefix + JSON.stringify(result);
      if (text.length > RAILWAY_LIMITS.text) throw new Error('铁路明细超过回执上限；缩小 bounds 后重查，或用 detail:false 先读连通性摘要。本次未返回截断明细');
      return { text };
    }
    let shown = RAILWAY_LIMITS.summaryExamples as number;
    for (;;) {
      const summary = { ...result,
        components: result.components.slice(0, shown), componentsOmitted: Math.max(0, result.components.length - shown),
        openPorts: result.openPorts.slice(0, shown), openPortsOmitted: result.openPortCount - Math.min(shown, result.openPorts.length),
        power: { ...result.power, unpoweredExamples: result.power.unpoweredExamples.slice(0, shown),
          unpoweredExamplesOmitted: result.power.unpoweredNow - Math.min(shown, result.power.unpoweredExamples.length) },
        readHint: 'Counts and the requested route path are complete within bounds. Listed components/ports/power cells are bounded examples; narrow bounds or request detail:true for a specific section.',
      };
      const text = prefix + JSON.stringify(summary);
      if (text.length <= RAILWAY_LIMITS.text) return { text };
      if (shown === 0) throw new Error('铁路路径超过回执上限；缩小 bounds 与 start/end 分段读取。本次未返回截断路径');
      shown = Math.floor(shown / 2);
    }
  } catch (error) { return { text: `[mc_railway 失败] ${String(error)}`, failed: true as const }; }
}
