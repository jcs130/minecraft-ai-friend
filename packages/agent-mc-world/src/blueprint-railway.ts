/** Design evidence only. Reuses the live observer's reciprocal rail-port rules. */
import { parseBlockState, type NormalizedBlueprint } from '../core/blueprint.ts';
import { observeRailway, RAILWAY_LIMITS } from './railway.ts';

type Finding = { path: string; state: string; reason: string };
type Advisory = Finding & { cells: number };
const rails = new Set(['rail', 'powered_rail', 'detector_rail', 'activator_rail']);
const noSupport = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', ...rails]);

export function reviewBlueprintRailway(blueprint: NormalizedBlueprint): {
  failures: Finding[]; advisories: Advisory[];
} {
  const [sx, sy, sz] = blueprint.size_xyz;
  const failures = new Map<string, Finding & { cells: number }>();
  let first: Finding | null = null, railCount = 0, externalSupports = 0;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const state = blueprint.layers[y][z][x], parsed = parseBlockState(state);
    if (!parsed.id.startsWith('minecraft:') || !rails.has(parsed.id.slice(10))) continue;
    const path = `layers[${y}][${z}][${x}]`;
    first ??= { path, state, reason: '' }; railCount++;
    const below = y === 0 ? null : parseBlockState(blueprint.layers[y - 1][z][x]);
    if (!below || below.id === 'minecraft:structure_void') { externalSupports++; continue; }
    // Only reject definite contradictions. Other blocks, modded physics, ascending
    // high-end support and passenger clearance still need site validation.
    if (!below.id.startsWith('minecraft:') || !noSupport.has(below.id.slice(10))) continue;
    const key = `${state}|${below.id}`, previous = failures.get(key);
    if (previous) previous.cells++;
    else failures.set(key, { path, state, cells: 1,
      reason: `铁轨正下方是 ${below.id}，不能承托铁轨；侧面可点击不等于底部有支撑。请修订支撑层或线路高度` });
  }
  if (!first) return { failures: [], advisories: [] };
  const advisories: Advisory[] = [];
  if (externalSupports) advisories.push({ ...first, cells: externalSupports,
    reason: '铁轨底部在图外或 structure_void 中，现场支撑未知，不能按材料足够推断可以放置' });
  const withinBudget = sx * sy * sz <= RAILWAY_LIMITS.cells
    && Math.max(sx, sy, sz) <= RAILWAY_LIMITS.axis && railCount <= RAILWAY_LIMITS.rails;
  if (withinBudget) {
    const topology = observeRailway(([x, y, z]) => {
      const block = parseBlockState(blueprint.layers[y][z][x]);
      if (block.id === 'minecraft:structure_void') return null;
      return { name: block.id.startsWith('minecraft:') ? block.id.slice(10) : block.id,
        getProperties: () => block.properties };
    }, { bounds: [0, 0, 0, sx - 1, sy - 1, sz - 1] });
    advisories.push({ ...first, cells: railCount,
      reason: `设计态轨道 ${railCount} 格，按指定 shape 和接合高度分为 ${topology.componentCount} 个图内连通分量。`
        + '这不是当前世界读数；多个分量可能是独立股道，图外延续未知。需指定目标起终接头，施工后用 mc_railway 的 start/end 回读实际轨形，再试乘；方块全匹配不证明目标路线通车' });
  } else advisories.push({ ...first, cells: railCount,
    reason: `设计态轨道连通性未验证：超过 ${RAILWAY_LIMITS.cells} 格/${RAILWAY_LIMITS.rails} 轨道的单次观察预算。按路段拆分并核对共同接头，不能将未检查写成连通` });
  return { failures: [...failures.values()].map(({ cells, ...finding }) => ({ ...finding,
    reason: finding.reason + (cells > 1 ? `（同类 ${cells} 格）` : '') })), advisories };
}
