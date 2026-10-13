/** Bounded, coordinate-preserving sections of loaded block geometry. */
import type { Cell } from './geometry.ts';

export const SPATIAL_SLICE_AXES = ['x', 'y', 'z'] as const;
export type SpatialSliceAxis = typeof SPATIAL_SLICE_AXES[number];
export const PROBE_SLICE_CELL_CAP = 512;
export const PROBE_SLICE_TEXT_CAP = 12_000;

/** Inclusive integer bounds; chunk sizes describe a complete Cartesian partition. */
export function partitionSpatialBox(bounds: readonly number[], cap: number) {
  const sizes = [0, 1, 2].map(i => bounds[i + 3] - bounds[i] + 1);
  const chunkSizes = [...sizes];
  while (chunkSizes.reduce((a, b) => a * b, 1) > cap) {
    const axis = chunkSizes.indexOf(Math.max(...chunkSizes));
    chunkSizes[axis] = Math.ceil(chunkSizes[axis] / 2);
  }
  return { sizes, chunkSizes, cells: sizes.reduce((a, b) => a * b, 1),
    chunks: sizes.reduce((n, size, i) => n * Math.ceil(size / chunkSizes[i]), 1) };
}

export function spatialBoxBudgetNote(bounds: readonly number[], cap: number): string | null {
  const sizes = [0, 1, 2].map(i => bounds[i + 3] - bounds[i] + 1);
  const cells = sizes.reduce((a, b) => a * b, 1);
  if (cells <= cap) return null;
  const head = `请求尺寸 ${sizes.join('×')}=${cells} 格(含端点)，一单上限 ${cap}`;
  if (!Number.isSafeInteger(cells)) return head;
  const plan = partitionSpatialBox(bounds, cap);
  const axes = ['x', 'y', 'z'].map((axis, i) => `${axis}=${bounds[i]}..${bounds[i + 3]}，每段至多 ${plan.chunkSizes[i]} 格`);
  return `${head}。可保持原范围按区间组合分 ${plan.chunks} 批读取：${axes.join('；')}；各轴末段止于原上界。尚未读取；也可按问题缩小范围`;
}

export interface SpatialSliceCell {
  c: Cell;
  name: string | null;
  state: string;
  air: boolean;
  /** Local [minX,minY,minZ,maxX,maxY,maxZ] boxes; absent means unread. */
  collision?: readonly (readonly number[])[];
}

export interface SpatialSliceObservation {
  axis: SpatialSliceAxis;
  cells: readonly SpatialSliceCell[];
  observedAt: string;
  dimension: string | null;
  feet: Cell;
}

/** Missing samples remain unknown; sections keep world axes rather than camera axes. */
export function renderSpatialSlices(observation: SpatialSliceObservation): string | { error: string } {
  const { axis, cells, observedAt, dimension, feet } = observation;
  if (!cells.length || cells.length > PROBE_SLICE_CELL_CAP) {
    return { error: `空间切片每次须有 1-${PROBE_SLICE_CELL_CAP} 格；请缩小探查范围` };
  }
  const axes = SPATIAL_SLICE_AXES;
  const min = { ...cells[0].c }, max = { ...cells[0].c };
  for (const { c } of cells) {
    for (const a of axes) {
      min[a] = Math.min(min[a], c[a]);
      max[a] = Math.max(max[a], c[a]);
    }
  }
  if (axes.reduce((volume, a) => volume * (max[a] - min[a] + 1), 1) > PROBE_SLICE_CELL_CAP) {
    return { error: `空间切片包围范围超过 ${PROBE_SLICE_CELL_CAP} 格；请缩小探查范围` };
  }
  const column = axis === 'x' ? 'z' : 'x';
  const row = axis === 'y' ? 'z' : 'y';
  const legend = new Map<string, string>();
  const at = new Map<string, string>();
  for (const cell of cells) {
    let token = '??';
    if (cell.name !== null) {
      if (cell.air) token = '..';
      else {
        const label = `${cell.name}${cell.state};collision=${cell.collision === undefined ? '未读' : JSON.stringify(cell.collision)}`;
        token = legend.get(label) ?? legend.size.toString(36).padStart(2, '0');
        legend.set(label, token);
      }
    }
    at.set(`${cell.c.x},${cell.c.y},${cell.c.z}`, token);
  }
  const bounds = axes.map(a => `${a}=${min[a]}..${max[a]}`).join(',');
  const lines = [
    `空间切片(${cells.length}格);observedAt=${observedAt};dimension=${dimension ?? '未读'};feet=(${feet.x},${feet.y},${feet.z});${bounds}`,
    '来源=客户端已加载区块，不检查视线；每个记号=1方块；..=已读空气，??=未读。collision 为格内碰撞箱，[] 表示无碰撞箱；空气或无碰撞箱本身不证明有支撑或可通行。',
    `图例:${[...legend].map(([label, token]) => `${token}=${label}`).join(' | ') || '无已读非空气方块'}`,
    `切面 ${axis} 从 ${min[axis]} 到 ${max[axis]}；列 ${column} 从 ${min[column]} 到 ${max[column]}(递增)；行 ${row} ${row === 'y' ? '从高到低' : '递增'}。`,
  ];
  for (let slice = min[axis]; slice <= max[axis]; slice++) {
    lines.push(`[${axis}=${slice}]`);
    const descending = row === 'y';
    for (let r = descending ? max[row] : min[row]; descending ? r >= min[row] : r <= max[row]; r += descending ? -1 : 1) {
      const tokens: string[] = [];
      for (let c = min[column]; c <= max[column]; c++) {
        const point: Cell = { x: 0, y: 0, z: 0 };
        point[axis] = slice; point[row] = r; point[column] = c;
        tokens.push(at.get(`${point.x},${point.y},${point.z}`) ?? '??');
      }
      lines.push(`${row}=${r}: ${tokens.join(' ')}`);
    }
  }
  const text = lines.join('\n');
  return text.length <= PROBE_SLICE_TEXT_CAP ? text
    : { error: `空间切片超过 ${PROBE_SLICE_TEXT_CAP} 字符，未返回截断地图；请缩小范围或分层读取` };
}
