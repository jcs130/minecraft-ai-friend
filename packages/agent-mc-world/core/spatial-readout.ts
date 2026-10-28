import { createHash } from 'node:crypto';
export const SPATIAL_READOUT_TEXT_RESERVE = 1200;

/** Current read evidence only. This never authorizes a body action or retry. */
export interface SpatialReadout {
  protocol: 'agent-mc-spatial-read/v1';
  historical: false;
  kind: 'voxels' | 'sites' | 'rays';
  selection: string;
  revision: string;
  scanComplete: boolean | null;
  knownComplete: boolean | null;
  remainingCount: number | null;
  unknownCount: number | null;
  unknownUnit: 'cells' | 'sites' | null;
  retryable: boolean | null;
  continuationAvailable: boolean;
  interpretation: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

/** Summarize actual coverage before a host's prose cap, retaining real values.
 * Only sampling timestamps and opaque continuation handles are excluded from
 * the revision. Coordinates, counts, geometry and numeric block states stay.
 */
export function spatialReadout(data: Record<string, unknown>): SpatialReadout | null {
  if (data.source !== 'client-visible-world' || !['voxels', 'sites', 'rays'].includes(String(data.kind))) return null;
  const coverage = record(data.coverage) ? data.coverage : {};
  const frame = record(data.frame) ? data.frame : {};
  const kind = data.kind as SpatialReadout['kind'];
  const remainingCount = count(coverage.remainingCount);
  const scanComplete = typeof coverage.coverageComplete === 'boolean' ? coverage.coverageComplete
    : remainingCount === null ? null : remainingCount === 0;
  const unknownCount = kind === 'voxels' ? count(coverage.unknownCount)
    ?? (count(coverage.invisibleCount) !== null && count(coverage.unloadedCount) !== null && count(coverage.omittedDetailCount) !== null
      ? Number(coverage.invisibleCount) + Number(coverage.unloadedCount) + Number(coverage.omittedDetailCount) : null)
    : kind === 'sites' ? count(coverage.unknownTargets) : null;
  const content = Object.fromEntries(Object.entries(data).filter(([key]) =>
    !['observedAt', 'observed_at', 'next', 'next_cursor', 'next_safe_read', 'readout'].includes(key)));
  const selection = { kind, format: data.format ?? null, dimension: data.dimension ?? null,
    origin: coverage.origin ?? frame.feet ?? null, bounds: data.bounds ?? coverage.requestedBounds ?? null,
    sites: Array.isArray(data.sites) ? data.sites.map(site => record(site) ? site.at : null) : null,
    rays: Array.isArray(data.rays) ? data.rays.map(ray => record(ray) ? [ray.pitchDeg, ray.yawDeg, ray.range] : null) : null };
  return {
    protocol: 'agent-mc-spatial-read/v1', historical: false, kind,
    selection: hash(selection), revision: hash(content), scanComplete,
    knownComplete: typeof data.complete === 'boolean' ? data.complete : null,
    remainingCount, unknownCount, unknownUnit: kind === 'voxels' ? 'cells' : kind === 'sites' ? 'sites' : null,
    retryable: typeof data.retryable === 'boolean' ? data.retryable : null,
    continuationAvailable: !!(data.next_safe_read || data.next),
    interpretation: kind === 'voxels' && data.format === 'visible' && scanComplete === true
      ? '当前可见表面扫描已读完。遮挡、未加载或未核实范围不展开格子，不是排队结果或尚未返回的下一页；原地重复同一读取不保证补全。仅根据实际可见表面作判断，相关现场或视角变化后再按需读取。'
      : kind === 'voxels' && scanComplete === true
      ? '当前请求的扫描已读完。未知格是遮挡、未加载或未核实，不是排队结果或尚未返回的下一页；原地重复同一读取不保证补全。仅根据已知读数作判断，相关现场或视角变化后再按需读取。'
      : kind === 'voxels' && data.format === 'visible'
        ? '可见表面扫描覆盖与可见信息是否完整是两件事。仅按实际返回的续页入口读取未读区域；遮挡和未加载范围不展开格子，也不证明净空。'
      : kind === 'voxels'
        ? '扫描覆盖与可见信息是否完整是两件事。仅按实际返回的续页入口读取未读区域；未知格不是空气或安全通道。'
        : '这是当前可观察范围内的读数，未知不等于空气、失败动作或待执行任务。',
  };
}
