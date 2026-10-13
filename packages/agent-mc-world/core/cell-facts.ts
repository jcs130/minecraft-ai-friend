/**
 * 格的读法:锚点落到哪一格、脚下与参照面、区域扫描、方块名指纹。
 *
 * 纯读,不改世界也不发包;`geometry.ts` 算形状,这里把形状对到活着的 bot 上。
 */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import {
  BLOCK_FACES, rasterize, resolveAnchors,
  type Anchor, type BlockFace, type BoxFill, type Cell, type ShapeName,
} from './geometry.ts';
import { SkillBlocked } from './skill-context.ts';
import { WATER_BLOCKS, cropAgeAt } from './terrain.ts';
import { spatialBoxBudgetNote } from './spatial-slices.ts';

/** 竖井遇到这些方块时停止下挖。 */
export const LIQUIDS = new Set(['water', 'lava', 'bubble_column']);

export const BUILD_CELL_CAP = 256;
export const EXCAVATE_CELL_CAP = 512;
export const PROBE_CELL_CAP = 2048;
/** probe.where 的格数上限；只逐格读取，不生成材质构成或完整逐格报告。 */
export const PROBE_WHERE_CELL_CAP = 8192;

/** 放置的稳妥手长:服务端上限 5.1,留出身位余量 */
export const PLACE_REACH = 4;

/** 一格的六个邻格偏移;与六个面同一批向量,只是这里问的是"周围有没有",不问哪一面 */
export const NEIGHBORS6 = Object.values(BLOCK_FACES);

/** 检查目标格的六个正交相邻格是否有岩浆；不包含斜对角或隔一格的位置。 */
export function nearLavaAt(bot: Bot, c: Cell): boolean {
  return NEIGHBORS6.some(([dx, dy, dz]) => blockAtCell(bot, { x: c.x + dx, y: c.y + dy, z: c.z + dz })?.name === 'lava');
}

export const FACE_ZH: Record<BlockFace, string> = {
  up: '上', down: '下', north: '北', south: '南', west: '西', east: '东',
};

/**
 * 没指定面时挨个试的次序:先脚下那一块的上面(地上的火把、路面、垫脚全走这一条),
 * 再头顶那一块的下面,最后四个侧面按原版 Direction 的序。
 */
export const FACE_TRY_ORDER: readonly BlockFace[] = ['up', 'down', 'north', 'south', 'west', 'east'];

/** 「贴着 (x,y,z) 的北面」:回执里点名这一次贴的是谁的哪一面 */
export function faceText(ref: Cell, face: BlockFace): string {
  return `贴着 ${cellText(ref)} 的${FACE_ZH[face]}面`;
}

/** 贴某一面放时的参照方块:新方块那一格沿面的反方向退一格 */
export function refCellOf(cell: Cell, face: BlockFace): Cell {
  const [dx, dy, dz] = BLOCK_FACES[face];
  return { x: cell.x - dx, y: cell.y - dy, z: cell.z - dz };
}

export function feetOf(bot: Bot): Cell {
  const p = bot.entity.position.floored();
  return { x: p.x, y: p.y, z: p.z };
}

/** 单个锚点 → 绝对格坐标(相对写法以执行这一刻我脚下那一格为原点) */
export function resolveAt(bot: Bot, at: Anchor): Cell {
  const resolved = resolveAnchors([at], feetOf(bot));
  if (!Array.isArray(resolved)) throw new SkillBlocked(resolved.error);
  return resolved[0];
}

export function blockAtCell(bot: Bot, c: Cell): ReturnType<Bot['blockAt']> {
  return bot.blockAt(new Vec3(c.x, c.y, c.z));
}

export const cellKeyOf = (c: Cell): string => `${c.x},${c.y},${c.z}`;

/** goto [x,z] 的地面落脚格；树冠与树干不作为地面，水面报告高度和水深，区块未加载受阻。 */
export function surfaceFeetAt(bot: Bot, at: Anchor): Cell {
  const c = resolveAt(bot, at);
  const game = bot.game as { minY?: number; height?: number } | undefined;
  const minY = game?.minY ?? -64;
  const top = minY + (game?.height ?? 384);
  for (let y = top - 1; y >= minY; y--) {
    const b = bot.blockAt(new Vec3(c.x, y, c.z));
    if (!b) {
      throw new SkillBlocked(
        `(${c.x}, ${c.z}) 那里还没加载,先走近些再用 [x,z];或者直接给 y`,
      );
    }
    if (b.boundingBox === 'block'
      && !b.name.endsWith('_leaves')
      && !b.name.endsWith('_log')
      && !b.name.endsWith('_wood')) return { x: c.x, y: y + 1, z: c.z };
    if (WATER_BLOCKS.has(b.name)) {
      let floor = y - 1;
      while (floor >= minY && bot.blockAt(new Vec3(c.x, floor, c.z))?.boundingBox !== 'block') floor--;
      throw new SkillBlocked(
        `(${c.x}, ${c.z}) 是水面:水面那格 y=${y},水深 ${y - floor} 格;要站到水上就写 [x,y,z] 给 y,`
        + `不然挑岸上的一格`,
      );
    }
  }
  throw new SkillBlocked(`(${c.x}, ${c.z}) 整柱都没有可作为地面的实心方块,落不了脚`);
}

export function solidAt(bot: Bot, c: Cell): boolean {
  const b = blockAtCell(bot, c);
  return b != null && b.boundingBox === 'block';
}

/** 客户端可用参照面；是否接受放置仍须读取服务端结果。 */
export function refAt(bot: Bot, c: Cell): boolean {
  const b = blockAtCell(bot, c);
  return b != null && b.boundingBox === 'block' && !NO_PLACE_REFERENCE.has(b.name);
}

/** 锚点解析 + 栅格化 + 规模上限,一步到位;错误一律按受阻交回 agent */
export function shapeCells(
  bot: Bot,
  shape: ShapeName | undefined,
  anchors: readonly Anchor[],
  fill: BoxFill | undefined,
  cap: number,
): Cell[] {
  const resolved = resolveAnchors(anchors, feetOf(bot));
  if (!Array.isArray(resolved)) throw new SkillBlocked(resolved.error);
  // 不写形状 = 就这些格,各是各的,不连成片(build 一步放 N 处走的就是这条)
  if (!shape) return resolved;
  if (shape === 'box' && (fill === undefined || fill === 'solid') && resolved.length === 2) {
    const [a, b] = resolved;
    const volume = (Math.abs(a.x - b.x) + 1) * (Math.abs(a.y - b.y) + 1) * (Math.abs(a.z - b.z) + 1);
    if (volume > cap) {
      const bounds = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z),
        Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)];
      throw new SkillBlocked(spatialBoxBudgetNote(bounds, cap)!);
    }
  }
  const cells = rasterize(shape, resolved, fill ?? 'solid');
  if (!Array.isArray(cells)) throw new SkillBlocked(cells.error);
  if (cells.length > cap) {
    throw new SkillBlocked(`这个${SHAPE_ZH[shape]}有 ${cells.length} 格,一单上限 ${cap}`);
  }
  return cells;
}

export interface RegionReading {
  /** 按方块名计数;sample 是该材质任一 Block(用于工具适配判断),nearest 是离我最近的一格 */
  counts: Map<string, { n: number; nearest: Cell; nearestD: number; sample: NonNullable<ReturnType<Bot['blockAt']>> }>;
  /** 真空气(air/cave_air/void_air)。作物/火把等无碰撞箱方块按名字进 counts */
  air: Cell[];
  unloaded: number;
}

export function readRegion(bot: Bot, cells: Cell[]): RegionReading {
  const me = bot.entity.position;
  const counts: RegionReading['counts'] = new Map();
  const air: Cell[] = [];
  let unloaded = 0;
  for (const c of cells) {
    const b = blockAtCell(bot, c);
    if (!b) { unloaded++; continue; }
    if (AIR_NAMES.has(b.name)) { air.push(c); continue; }
    const d = Math.hypot(c.x - me.x, c.y - me.y, c.z - me.z);
    const e = counts.get(b.name);
    if (!e) counts.set(b.name, { n: 1, nearest: c, nearestD: d, sample: b });
    else {
      e.n++;
      if (d < e.nearestD) { e.nearest = c; e.nearestD = d; }
    }
  }
  return { counts, air, unloaded };
}

/** 这个体积以内逐格报「(x,y,z):方块」,再大只报聚合构成 */
export const PROBE_CELLWISE_MAX = 27;
export const AIR_NAMES = new Set(['air', 'cave_air', 'void_air']);

/** FNV-1a;probe 差分只比对指纹,不留整片读数 */
export function fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** matchBlockIds 的 id 集换成名字集,供按名读格 */
export function blockNamesOf(bot: Bot, ids: number[]): Set<string> {
  const wanted = new Set(ids);
  const byName = bot.registry.blocksByName as Record<string, { id: number; name: string }>;
  const names = new Set<string>();
  for (const b of Object.values(byName)) if (wanted.has(b.id)) names.add(b.name);
  return names;
}

/** 已加载的竖直柱是否无遮盖；未加载格使天空读数未知。 */
export function skyVisibleAt(bot: Bot, x: number, yFrom: number, z: number): boolean | null {
  const game = bot.game as { minY?: number; height?: number } | undefined;
  const top = (game?.minY ?? -64) + (game?.height ?? 384);
  for (let y = yFrom; y < top; y++) {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (!b) return null;
    if (b.boundingBox === 'block') return false;
  }
  return true;
}

/** 只在实际读到实心遮盖时为 true；false 不证明天空可见。 */
export function skyBlocked(bot: Bot, x: number, yFrom: number, z: number): boolean {
  return skyVisibleAt(bot, x, yFrom, z) === false;
}

/** 读取作物 age 前构造 Vec3；真实 Mineflayer 的 blockAt 需要坐标的 floored()。 */
export function cropAgeOfCell(bot: Bot, c: Cell): { value: number; max: number } | null {
  return cropAgeAt(bot, new Vec3(c.x, c.y, c.z));
}

export function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

export const SHAPE_ZH: Record<ShapeName, string> = {
  line: '直线', rect: '平面', triangle: '三角面', arc: '弧线', box: '长方体',
};

/** 格坐标进回执的样子 */
export function cellText(c: Cell): string {
  return `(${c.x}, ${c.y}, ${c.z})`;
}

/**
 * 此实现不选作普通施工参照的作物格。耕地虽不是完整立方体，仍可点击顶面种植。
 * 参照面过滤不是服务端保护判决，也不替代目标格的放置回读。
 */
export const NO_PLACE_REFERENCE = new Set([
  'wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart',
  'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem',
  'torchflower_crop', 'pitcher_crop',
]);

export function dimensionOf(bot: Bot): string {
  return String(bot.game?.dimension ?? 'overworld');
}

/** 方块状态属性的原值;prismarine 不给 `getProperties` 时返回 null */
export function blockProp(b: ReturnType<Bot['blockAt']>, key: string): string | null {
  if (!b || typeof b.getProperties !== 'function') return null;
  const v = b.getProperties()[key];
  return v === undefined ? null : String(v);
}

