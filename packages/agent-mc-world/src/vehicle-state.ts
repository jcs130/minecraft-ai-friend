/** Client attachment facts only; no navigation or dismount policy. */
type VectorReading = { x: number; y: number; z: number };
export interface VehicleReading {
  entityId: number | null;
  name: string | null;
  position: VectorReading | null;
  velocity: VectorReading | null;
}

function vector(raw: unknown): VectorReading | null {
  const v = raw as Partial<VectorReading> | null | undefined;
  return v && [v.x, v.y, v.z].every(n => typeof n === 'number' && Number.isFinite(n))
    ? { x: v.x!, y: v.y!, z: v.z! } : null;
}

/** Undefined means no live self entity; null means no client-reported attachment. */
export function vehicleStateFromBot(bot: {
  entity?: unknown;
  vehicle?: { id?: number; name?: string; position?: unknown; velocity?: unknown } | null;
} | null | undefined): VehicleReading | null | undefined {
  if (!bot?.entity) return undefined;
  const v = bot.vehicle;
  if (!v) return null;
  return { entityId: Number.isSafeInteger(v.id) ? v.id! : null,
    name: typeof v.name === 'string' && v.name.length > 0 ? v.name : null,
    position: vector(v.position), velocity: vector(v.velocity) };
}

export function vehicleFingerprint(v: VehicleReading | null | undefined): string {
  return v === undefined ? 'vehicle:unknown' : v === null ? 'vehicle:none'
    : `vehicle:${v.entityId ?? '?'}:${v.name ?? '?'}`;
}

export function narrateVehicleState(v: VehicleReading | null | undefined): string {
  if (v === undefined) return '乘坐状态：未取得读数。';
  if (v === null) return '乘坐状态：客户端当前未报告乘坐载具。';
  const p = v.position;
  return `乘坐状态：正在乘坐 ${v.name ?? '未识别载具'}（实体 ${v.entityId ?? '未知'}）；` +
    `载具位置${p ? ` (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})` : '未知'}。` +
    '这是当前客户端附着读数，人物位置不能单独作为步行或试乘抵达的证明。';
}
