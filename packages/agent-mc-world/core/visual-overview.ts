/** Compact camera request. Geometry and labels are rendered by mc-visual-console. */
export interface OverviewOptions {
  center?: [number, number];
  span?: number;
  grid?: number | 'auto';
  labels?: 'auto' | 'full' | 'ids';
  markers?: Array<{ at: [number, number, number]; anchor?: 'block' | 'position'; label?: string }>;
}

export interface OverviewMetadata {
  schema: 'mc-overview/v2';
  capturedAt: string;
  dimension: string | null;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  grid: number; north: '-Z'; right: '+X'; width: number; height: number;
  coverage: { meshed: number; total: number };
  player: { at: [number, number, number]; pixel: [number, number]; inFrame: boolean };
  pins: Array<{ id: string; at: [number, number, number]; anchor: 'block' | 'position'; world: [number, number, number]; pixel: [number, number]; inFrame: boolean; label?: string }>;
  labels: { mode: 'full' | 'ids'; shown: number; hidden: number };
  source: 'loaded-renderer-scene'; layers: 'top-visible-only';
}

export const OVERVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  description: 'overview only. North-up image of loaded chunks; no movement or terrain loading. Defaults center=self, span=32, grid/labels=auto. Block pins use cell centers; position pins preserve exact XYZ. Heights are supplied, not measured.',
  properties: {
    center: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: -30_000_000, maximum: 30_000_000 }, description: 'Absolute [x,z] at image center.' },
    span: { type: 'number', minimum: 8, maximum: 2048, description: 'Image width in blocks; height follows image aspect ratio. Unloaded terrain remains unknown.' },
    grid: { anyOf: [{ type: 'string', enum: ['auto'] }, { type: 'integer', minimum: 0, maximum: 2048 }], description: 'Block boundary interval; auto scales with span, 0 hides lines.' },
    labels: { type: 'string', enum: ['auto', 'full', 'ids'], description: 'auto uses IDs for dense scenes. Full labels include coordinates; overlapping labels may be hidden, never the points.' },
    markers: { type: 'array', maxItems: 128, items: { type: 'object', additionalProperties: false, required: ['at'], properties: {
      at: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -30_000_000, maximum: 30_000_000 } },
      anchor: { type: 'string', enum: ['block', 'position'], description: 'Default block: integer XYZ cell, drawn at XYZ+0.5. position: exact continuous XYZ, no offset (including integer positions).' },
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
  if (Object.keys(o).some(key => !['center', 'span', 'grid', 'labels', 'markers'].includes(key))) return 'overview 含未知字段';
  const tuple = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 30_000_000);
  if (o.center !== undefined && !tuple(o.center, 2)) return 'overview.center 必须是有限绝对坐标 [x,z]';
  if (o.span !== undefined && (typeof o.span !== 'number' || !Number.isFinite(o.span) || o.span < 8 || o.span > 2048)) return 'overview.span 范围 8..2048 格';
  if (o.grid !== undefined && o.grid !== 'auto' && (typeof o.grid !== 'number' || !Number.isInteger(o.grid) || o.grid < 0 || o.grid > 2048)) return 'overview.grid 为 auto 或 0..2048 的整数间隔（0 隐藏）';
  if (o.labels !== undefined && !['auto', 'full', 'ids'].includes(o.labels as string)) return 'overview.labels 为 auto、full 或 ids';
  if (o.markers !== undefined && (!Array.isArray(o.markers) || o.markers.length > 128 || o.markers.some(m =>
    !m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(k => !['at', 'anchor', 'label'].includes(k)) || !tuple(m.at, 3) ||
    (m.anchor !== undefined && !['block', 'position'].includes(m.anchor)) ||
    (m.anchor !== 'position' && !m.at.every(Number.isInteger)) ||
    (m.label !== undefined && (typeof m.label !== 'string' || m.label.length > 24 || /[\u0000-\u001f\u007f]/u.test(m.label))))))
    return 'overview.markers 最多 128 个；at:[x,y,z]，默认 anchor:block 需整数格坐标；精确位置用 anchor:position，label 最多24字';
  return undefined;
}
