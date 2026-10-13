/** Compact camera request. Geometry and labels are rendered by mc-visual-console. */
export interface OverviewOptions {
  center?: [number, number];
  span?: number;
  grid?: 0 | 1 | 2 | 4 | 8 | 16;
  markers?: Array<{ at: [number, number, number]; label?: string }>;
}

export interface OverviewMetadata {
  schema: 'mc-overview/v1';
  capturedAt: string;
  dimension: string | null;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  grid: number; north: '-Z'; right: '+X'; width: number; height: number;
  coverage: { meshed: number; total: number };
  player: { at: [number, number, number]; pixel: [number, number]; inFrame: boolean };
  pins: Array<{ id: string; at: [number, number, number]; pixel: [number, number]; inFrame: boolean; label?: string }>;
  source: 'loaded-renderer-scene'; layers: 'top-visible-only';
}

export const OVERVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  description: 'overview only. North-up image of already loaded chunks; no movement or terrain loading. Defaults center=self, span=32 blocks wide, grid=4. Pins are supplied coordinates, not verified surface heights.',
  properties: {
    center: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: -30_000_000, maximum: 30_000_000 }, description: 'Absolute [x,z] at image center.' },
    span: { type: 'number', minimum: 8, maximum: 96, description: 'Image width in blocks; height follows image aspect ratio.' },
    grid: { type: 'number', enum: [0, 1, 2, 4, 8, 16], description: 'Block boundary grid interval; 0 hides grid.' },
    markers: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['at'], properties: {
      at: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -30_000_000, maximum: 30_000_000 } },
      label: { type: 'string', maxLength: 24 },
    } } },
  },
};

export function overviewArgumentError(mode: unknown, overview: unknown, includeHud: unknown): string | undefined {
  if (mode !== 'overview') return overview === undefined ? undefined : 'overview 参数只用于 mode=overview';
  if (includeHud === true) return 'overview 不支持 include_hud；坐标标注始终包含在图中';
  if (overview === undefined) return undefined;
  if (!overview || typeof overview !== 'object' || Array.isArray(overview)) return 'overview 必须是对象';
  const o = overview as Record<string, unknown>;
  if (Object.keys(o).some(key => !['center', 'span', 'grid', 'markers'].includes(key))) return 'overview 含未知字段';
  const tuple = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 30_000_000);
  if (o.center !== undefined && !tuple(o.center, 2)) return 'overview.center 必须是有限绝对坐标 [x,z]';
  if (o.span !== undefined && (typeof o.span !== 'number' || !Number.isFinite(o.span) || o.span < 8 || o.span > 96)) return 'overview.span 范围 8..96 格';
  if (o.grid !== undefined && ![0, 1, 2, 4, 8, 16].includes(o.grid as number)) return 'overview.grid 只能是 0、1、2、4、8、16';
  if (o.markers !== undefined && (!Array.isArray(o.markers) || o.markers.length > 8 || o.markers.some(m =>
    !m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(k => !['at', 'label'].includes(k)) || !tuple(m.at, 3) ||
    (m.label !== undefined && (typeof m.label !== 'string' || m.label.length > 24 || /[\u0000-\u001f\u007f]/u.test(m.label))))))
    return 'overview.markers 最多 8 个 {at:[x,y,z],label?:24字内名称}';
  return undefined;
}
