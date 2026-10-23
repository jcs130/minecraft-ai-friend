/**
 * mc_do 的契约面:技能注册表。
 *
 * 每个技能在 `SKILLS` 里声明一次字段(名/类型/必填/范围/默认值/一行文档)与文档段落,
 * 出口全部由这一份生成:`SKILL_NAMES`、mc_do / mc_scout 的 schema 与技能表、
 * `parseSteps` / `parseScoutSteps`。mc_scout 是同一张表的只读切片:probe/observe,以及
 * 声明了 dryRun 的技能(入队时一律按试算跑)。结构约束只有一个家,长出新技能时同步。
 *
 * 横向规则(build 的 shape-锚点数、use 的 at/target 互斥、craft 的 item/grid 二选一)
 * 不进表,走技能自己的 parse 钩子;钩子接管该步的全部校验与规范化。
 */
import {
  ANCHOR_COUNT, FACE_NAMES, SHAPE_NAMES,
  type Anchor, type BlockFace, type BoxFill, type ShapeName,
} from './geometry.ts';
import { DIRECTIONS, type Direction } from './terrain.ts';
import { collectTargetError } from '../src/collect-contract.ts';
import { normalizeDimension } from './escape.ts';
import type { PositionXYZ } from './blueprint.ts';
import { PROBE_SLICE_CELL_CAP, SPATIAL_SLICE_AXES, type SpatialSliceAxis } from './spatial-slices.ts';
import { parseSpatialObservation, SPATIAL_OBSERVATION_LIMITS, type SpatialObserveInput } from './spatial-observation.ts';
import { NAVIGATION_LIMITS } from './navigation-capabilities.ts';
import type { InventoryOrganization, InventoryDisposition } from './inventory-organization.ts';

/** 步骤依赖与验收的可选覆写；省略时使用执行器推导的因果依赖和验收规则。 */
export interface StepBounds {
  /**
   * 依赖的更早步骤，序号从 1 起；省略时按产出与消费关系推导，空数组表示独立。
   * 显式依赖仅在上游 ok 或 partial 时放行；自动依赖另允许所需入料已在背包时放行。
   * 执行始终按列表顺序，不按依赖重排。
   */
  needs?: number[];
  /**
   * 验收标准的**覆写**。缺省时判据由执行器按 `(skill, 参数)` 推(`deriveExpect`),
   * 推不出来的才信技能自己的裁决。被叫停/抢占的步不评估。
   */
  expect?: Expectation;
}

/**
 * 验收支持背包数量、位置、方块与手持物四种状态。
 * 锚点按评估时刻脚下解析，与技能参数的相对坐标约定一致。
 */
export type Expectation =
  | { has: { item: string; count: number } }
  | { near: Anchor; within?: number }
  | { block: string; at: Anchor }
  | { holding: { item: string } };

/** near 形态缺省的判定半径(格) */
export const NEAR_DEFAULT = 2;

/**
 * 新任务与队列的关系；afterCheckpoint 在当前任务的安全检查点先做新任务，再续做原任务。
 */
export type QueueMode = 'replace' | 'append' | 'now' | 'afterCheckpoint';

export const QUEUE_MODES: readonly QueueMode[] = ['replace', 'append', 'now', 'afterCheckpoint'];

/** mc_do / mc_scout 顶层的 queue 字段 */
export const QUEUE_SCHEMA: Record<string, unknown> = {
  type: 'string',
  enum: [...QUEUE_MODES],
  description:
    '这一单跟队列的关系。不写 = replace:撤掉排着的那些,接在正在做的那件后面(回执点名撤了谁);' +
    'append:排到队尾,排着的都保留;now:中断正在做的那件、插到队头立刻开做,排着的保留' +
    '(低血战斗可让位给首步 eat/flee/surface;已在执行的逃命、进食或环境自保不抢);' +
    'afterCheckpoint:当前任务到安全检查点后先做这一单,再续做原任务;容器存取、交易等完整操作段结束前等待,不抢救命动作',
};

/** queue 字段的校验;不写 = replace */
export function parseQueueMode(raw: unknown): { mode: QueueMode } | { error: string } {
  if (raw === undefined || raw === null) return { mode: 'replace' };
  const s = str(raw);
  if (!s || !(QUEUE_MODES as readonly string[]).includes(s)) {
    return { error: `queue 只认 ${QUEUE_MODES.join('/')}(不写 = replace)` };
  }
  return { mode: s as QueueMode };
}

/** 贴面放置以参照格 at 与表面 face 定义落点，参数与 use_item_on 协议对应。 */
interface PlaceOnFace { at: Anchor; face: BlockFace }

export type AttackMode = 'auto' | 'melee' | 'ranged' | 'kite';

/** 一步技能:动作参数,外加边界声明(StepBounds)。 */
export type SkillCall = StepBounds & (
  | { skill: 'goto'; at: Anchor; dimension?: string; groundY?: true; exact?: boolean; walkOnly?: boolean; dryRun?: boolean }
  | { skill: 'look'; at: Anchor }
  | { skill: 'control'; keys: ControlKey[]; durationMs: number; mode: 'ground' | 'water' | 'flight'; yawDeg?: number; pitchDeg?: number }
  | { skill: 'swim'; at: Anchor; dimension?: string; reserveOxygen: number; maxDurationMs: number; dryRun?: boolean }
  | { skill: 'transit'; at: Anchor }
  | { skill: 'goto_player'; name: string }
  | { skill: 'follow'; name: string }
  | { skill: 'find'; target: string; distance: number; direction?: Direction; until?: string[] }
  | { skill: 'flee'; distance: number }
  | { skill: 'surface' }
  | { skill: 'flight'; at: Anchor; land?: boolean; dryRun?: boolean }
  | { skill: 'land' }
  | { skill: 'cleanup'; dryRun?: boolean }
  | { skill: 'collect'; block: string; count: number; buried?: boolean; mature?: boolean; tool?: string }
  | { skill: 'harvest'; block: string; at: Anchor; replant?: boolean; tool?: string }
  | { skill: 'fish'; at?: Anchor }
  | { skill: 'build'; on: PlaceOnFace[]; material: string; temporary?: boolean; dryRun?: boolean }
  | { skill: 'build'; anchors: Anchor[]; material: string; shape?: ShapeName; fill?: BoxFill; temporary?: boolean; dryRun?: boolean }
  /**
   * 按已装载的蓝图施工(判别式的第三形态,判据是 `blueprint` 在不在)。
   * 形状与材料都在图里,所以这一形态一个 material 都不收;`at` 是蓝图 [0,0,0]
   * 落在世界的哪一格(首次要给,续建从施工绑定里取),`stopAfter` 是 y 层号。
   */
  | {
      skill: 'build';
      blueprint: string;
      at?: Anchor;
      /** 改绑工地时给出当前绑定的绝对锚点；执行时核对，防止旧调用改写新绑定。 */
      rebindFrom?: PositionXYZ;
      stopAfter?: number;
      /** retrofit 现场有冲突时，明确同意清掉冲突格后施工。 */
      confirm?: boolean;
      /** 冲突格原样留着，先把能放的放上;回执点名跳过了哪几格。与 confirm 二选一。 */
      skipConflicts?: boolean;
      dryRun?: boolean;
    }
  | { skill: 'excavate'; shape: ShapeName; anchors: Anchor[]; fill?: BoxFill; dryRun?: boolean; tool?: string }
  | { skill: 'tunnel'; at: Anchor; spiral?: boolean; dryRun?: boolean; until?: string[]; tool?: string }
  | { skill: 'probe'; shape: ShapeName; anchors: Anchor[]; fill?: BoxFill; where?: string[]; slice?: SpatialSliceAxis }
  | ({ skill: 'observe' } & SpatialObserveInput)
  | { skill: 'craft'; item?: string; count: number; grid?: string[][] }
  | { skill: 'smelt'; input: string; count: number; fuel: string; at?: Anchor }
  | { skill: 'brew'; at?: Anchor; input: string; bottle: string; count: number; fuel: string }
  | { skill: 'enchant'; at: Anchor; item: string; index?: number }
  | { skill: 'eat'; item: string }
  | { skill: 'attack'; target: string; mode?: AttackMode }
  | { skill: 'equip'; item?: string; pick?: string; hand?: 'main' | 'off' }
  | { skill: 'pickup'; item?: string }
  | { skill: 'toss'; item: string; count: number; at?: Anchor; target?: string; pick?: string }
  | { skill: 'stow'; item: string; count: number; pick?: string; at?: Anchor; into?: 'open' }
  | { skill: 'compact' }
  | ({ skill: 'organize' } & InventoryOrganization)
  | { skill: 'take'; item?: string; count?: number; at?: Anchor; all?: true; pick?: string; from?: 'open' }
  | { skill: 'server_travel'; command: string; at: Anchor; within: number; dimension?: string }
  | { skill: 'chat'; text: string }
  | { skill: 'gesture'; name: string; motion: 'wave' | 'bow' | 'nod' | 'beckon' | 'shake_head' }
  | {
      skill: 'use';
      item?: string;
      at?: Anchor;
      target?: string;
      /** 本连接里已观察到的实体 ID；不填时选择最近的同类实体。 */
      entityId?: number;
      index?: number;
      times?: number;
      /** 门、活板门与栅栏门的期望开启状态；已符合时不再点击。 */
      open?: boolean;
      /** 只对告示牌:右键打开编辑框之后把这几行字写上去(\n 分行,最多 4 行) */
      text?: string;
      /** 写在牌子背面(1.20 起两面各有一套字);缺省写正面 */
      back?: true;
      /** 右键落在哪一面;缺省顶面。贴墙的东西(展示框、画)靠它 */
      face?: BlockFace;
    }
  /** 骑上/驾驭/下坐骑。off 单独一态;target 上坐骑;to 驾着走(可与 target 同给) */
  | { skill: 'ride'; target?: string; entityId?: number; to?: Anchor; off?: true }
  /**
   * 拴绳:拴住一只活物,牵着走到 to,到了松开(keep 就继续牵着)、或系到 tie 那根栅栏上。
   * off 单独一态 = 松开现在牵着的那只。
   */
  | {
      skill: 'lead';
      target?: string;
      to?: Anchor;
      tolerance?: number;
      tie?: Anchor;
      keep?: true;
      off?: true;
    }
  /** 铁砧:合修/改名。repair 与 combine 同义(两件同种或本体+附魔书放一起) */
  | {
      skill: 'anvil';
      op: 'repair' | 'combine' | 'rename';
      item: string;
      with?: string;
      name?: string;
      at?: Anchor;
      pick?: string;
      withPick?: string;
    }
  /** 砂轮:除魔/合修,附魔按原版比例返经验 */
  | { skill: 'grindstone'; item: string; with?: string; at?: Anchor; pick?: string; withPick?: string }
);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

const CHAT_LENGTH_LIMIT = 256;
const CHAT_SPLIT_HINT = '长消息请拆成多条单行 chat 步骤；/msg 私聊每条重复完整命令和收件人，其他命令须缩短参数并保持完整';

export function chatInputError(text: string): string | null {
  if (/[\u0000-\u001f\u007f-\u009f\u00a7\u2028\u2029]/u.test(text)) {
    return `没有发送：聊天文本含换行或游戏不允许的字符；请去掉这些字符。${CHAT_SPLIT_HINT}`;
  }
  if (text.length > CHAT_LENGTH_LIMIT) {
    return `没有发送：聊天文本长 ${text.length} 个字符，单条最多 ${CHAT_LENGTH_LIMIT} 个（含 / 和命令参数）；${CHAT_SPLIT_HINT}`;
  }
  return null;
}

/** 返回 [lo,hi] 内的整数;缺省时用 fallback,越界时返回 null。 */
function intIn(v: unknown, lo: number, hi: number, fallback: number): number | null {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n >= lo && n <= hi ? n : null;
}

/**
 * 锚点结构校验:[x,y,z],分量是数字或非空字符串。相对值到执行时才解析。
 *
 * 光给一个字符串 = 路标名,当场查 mc_map 换成坐标。她已经维护着十几处路标并且
 * 自己在用航点分解走长途,写名字是那条习惯与工具面之间最后一块缺口。
 */
function anchorOf(v: unknown, marks?: MarkLookup): Anchor | null {
  if (typeof v === 'string') {
    const hit = v.trim() === '' ? null : marks?.(v.trim()) ?? null;
    return !Array.isArray(hit) ? null : [hit[0], hit[1], hit[2]];
  }
  if (!Array.isArray(v) || v.length !== 3) return null;
  for (const cc of v) {
    if (typeof cc === 'number' && Number.isFinite(cc)) continue;
    if (typeof cc === 'string' && cc.trim() !== '') continue;
    return null;
  }
  return [v[0], v[1], v[2]] as Anchor;
}

/**
 * `at` 写的是名字却没换出坐标时补的那句事实。分两种说法:路标表里查无此名,
 * 与这个部署根本没接路标表 —— 她要改的东西不一样。
 */
function markMissNote(v: unknown, marks?: MarkLookup): string {
  if (typeof v !== 'string' || v.trim() === '') return '';
  if (marks === undefined) return ';这一单没接路标表,at 只认坐标';
  const hit = marks(v.trim());
  return hit && !Array.isArray(hit)
    ? `;${hit.error}`
    : `;mc_map 里没有登记叫「${v.trim()}」的路标`;
}

function anchorsOf(v: unknown, n: number, marks?: MarkLookup): Anchor[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const out: Anchor[] = [];
  for (const a of v) {
    const anchor = anchorOf(a, marks);
    if (!anchor) return null;
    out.push(anchor);
  }
  return out;
}

/** 任意长度的锚点清单(1-max);形状不参与,给几个就是几个格子 */
function anchorListOf(v: unknown, max: number, marks?: MarkLookup): Anchor[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  return anchorsOf(v, v.length, marks);
}

/**
 * 她自己摆的合成格:按行写的名字二维数组,空位写 null/""。
 * 只校验形状(最多 3×3)与元素类型 —— 这几个名字配不配得出东西由服务端说了算。
 */
function gridOf(raw: unknown): string[][] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3) return null;
  const out: string[][] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length === 0 || row.length > 3) return null;
    const cells: string[] = [];
    for (const cell of row) {
      if (cell === null || cell === undefined || cell === '') { cells.push(''); continue; }
      if (typeof cell !== 'string') return null;
      if (cell.trim().toLowerCase() === 'null') return null;
      cells.push(cell.trim());
    }
    out.push(cells);
  }
  return out.some((r) => r.some((n) => n !== '')) ? out : null;
}

/** 一个物品栏装得下的上限:36 格 × 64 */
const HAS_COUNT_MAX = 2304;

/** expect 的结构校验:四形态有且只有一个;at 是错误文案里的「第 N 步」 */
function expectOf(v: unknown, at: string): { expect: Expectation } | { error: string } {
  const usage = `${at}的 expect 要 {"has":{"item","count"}} / {"near":[x,y,z],"within"} / ` +
    `{"block","at":[x,y,z]} / {"holding":{"item"}} 四种之一`;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { error: usage };
  const e = v as Record<string, unknown>;
  const forms = ['has', 'near', 'block', 'holding'].filter((k) => e[k] !== undefined);
  if (forms.length !== 1) return { error: usage };
  switch (forms[0]) {
    case 'has': {
      const h = e.has;
      if (typeof h !== 'object' || h === null || Array.isArray(h)) return { error: usage };
      const item = str((h as Record<string, unknown>).item);
      if (!item) return { error: `${at}的 expect.has 要 item(物品英文 id)` };
      const count = intIn((h as Record<string, unknown>).count, 1, HAS_COUNT_MAX, 0);
      if (!count) return { error: `${at}的 expect.has 的 count 要在 1-${HAS_COUNT_MAX} 之间` };
      return { expect: { has: { item, count } } };
    }
    case 'holding': {
      const h = e.holding;
      if (typeof h !== 'object' || h === null || Array.isArray(h)) return { error: usage };
      const item = str((h as Record<string, unknown>).item);
      if (!item) return { error: `${at}的 expect.holding 要 item(物品英文 id)` };
      return { expect: { holding: { item } } };
    }
    case 'near': {
      const near = anchorOf(e.near);
      if (!near) return { error: `${at}的 expect.near 要 [x,y,z](数字或 "~"/"~-3" 相对写法)` };
      const within = intIn(e.within, 1, 128, NEAR_DEFAULT);
      if (within === null) return { error: `${at}的 expect.within 要在 1-128 格之间` };
      return { expect: within === NEAR_DEFAULT ? { near } : { near, within } };
    }
    default: {
      const block = str(e.block);
      if (!block) return { error: `${at}的 expect.block 要方块英文 id` };
      const spot = anchorOf(e.at);
      if (!spot) return { error: `${at}的 expect 形态 block 还要 at:[x,y,z](数字或 "~"/"~-3" 相对写法)` };
      return { expect: { block, at: spot } };
    }
  }
}

/** needs 的结构校验:整数数组,只准引用更早的步(1 ≤ n < 当前序号) */
function needsOf(v: unknown, index: number, at: string): { needs: number[] } | { error: string } {
  if (!Array.isArray(v)) {
    return { error: `${at}的 needs 要是更早步骤的序号数组(1 起),[] = 不依赖任何步` };
  }
  if (index === 0 && v.length > 0) {
    return { error: `${at}前面没有可引用的步,needs 只能是 []` };
  }
  const needs: number[] = [];
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > index) {
      return { error: `${at}的 needs 只能引用更早的步(1 到 ${index}),给了 ${JSON.stringify(n)}` };
    }
    needs.push(n);
  }
  return { needs };
}

/**
 * 注册表字段:结构声明 + 进 schema 分支的一行文档。
 * kind 驱动表校验与默认 schema 片段;`schema` 覆盖默认生成(goto 的 at 收 2-3 分量这类特例)。
 * `opaque` 只进 schema,校验完全在技能的 parse 钩子里(anchors/grid/scaffold 这类复合结构)。
 */
type FieldSpec = {
  key: string;
  /** 进 schema 分支的 description;类型与枚举自明时不写 */
  doc?: string;
  schema?: Record<string, unknown>;
} & (
  | { kind: 'string'; required?: true; hint?: string }
  /** 一串英文 id(可带 `#类别`);空数组等于没写 */
  | { kind: 'names'; hint?: string }
  | { kind: 'int'; lo: number; hi: number; def: number; unit?: string }
  | { kind: 'anchor'; required?: true; error: string }
  | { kind: 'flag'; retainFalse?: true }
  | { kind: 'enum'; values: readonly string[]; required?: true; error: string }
  | { kind: 'opaque'; required?: true; schema: Record<string, unknown> }
);

/**
 * 解析对这一步做过的改动:某个字段被丢掉,或按别的意思收下了。
 * 校验通不过时整批退回,说的是错误本身,没有这个。
 */
type StepNote =
  | { field: string; given: unknown; kind: 'dropped'; why: string }
  | { field: string; given: unknown; kind: 'rewritten'; as: string };

/** 单步调整带从 1 起的编号；完整 JSON 解码是整批提示，不伪造步骤号。 */
export type ParseNote = (StepNote & { step: number })
  | { field: 'steps'; given: string; kind: 'decoded'; step?: never };

/** 这些改动只有一份渲染,回执与日志都用它。 */
export function parseNoteText(n: ParseNote): string {
  if (n.kind === 'decoded') return 'steps 原为 JSON 字符串，已完整解码为数组；没有猜补、删尾、重排或重试步骤';
  const wrote = `第 ${n.step} 步写的 ${n.field}:${JSON.stringify(n.given)}`;
  return n.kind === 'dropped' ? `${wrote},${n.why},忽略了` : `${wrote},按${n.as}理解`;
}

type ParseResult = { step: SkillCall; notes?: StepNote[] } | { error: string };

export const CONTROL_KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'] as const;
export type ControlKey = typeof CONTROL_KEYS[number];
export const CONTROL_DURATION = { minMs: 50, maxMs: 2_000, defaultMs: 500 } as const;

function parseControl(c: Record<string, unknown>, at: string): ParseResult {
  if (!Array.isArray(c.keys) || !c.keys.every(key => CONTROL_KEYS.includes(key as ControlKey))) {
    return { error: `${at} control 的 keys 要数组，成员为 ${CONTROL_KEYS.join('/')}` };
  }
  const keys = [...new Set(c.keys)] as ControlKey[];
  for (const [a, b] of [['forward', 'back'], ['left', 'right'], ['jump', 'sneak']] as const) {
    if (keys.includes(a) && keys.includes(b)) return { error: `${at} control 不能同时按 ${a} 和 ${b}` };
  }
  const durationMs = c.durationMs ?? CONTROL_DURATION.defaultMs;
  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs)
    || durationMs < CONTROL_DURATION.minMs || durationMs > CONTROL_DURATION.maxMs) {
    return { error: `${at} control 的 durationMs 要 ${CONTROL_DURATION.minMs}–${CONTROL_DURATION.maxMs} 之间的整数毫秒` };
  }
  const mode = c.mode ?? 'ground';
  if (mode !== 'ground' && mode !== 'water' && mode !== 'flight') return { error: `${at} control 的 mode 要 ground、water 或 flight` };
  for (const [field, limit] of [['yawDeg', 180], ['pitchDeg', 90]] as const) {
    const value = c[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit)) {
      return { error: `${at} control 的 ${field} 要 -${limit}–${limit} 之间的有限角度` };
    }
  }
  if (!keys.length && !c.yawDeg && !c.pitchDeg && mode !== 'water') return { error: `${at} control 至少提供一个按键或非零转角（水中 mode:water 可空 keys 自然下沉）` };
  return { step: { skill: 'control', keys, durationMs, mode,
    ...(c.yawDeg === undefined ? {} : { yawDeg: c.yawDeg as number }),
    ...(c.pitchDeg === undefined ? {} : { pitchDeg: c.pitchDeg as number }) } };
}

interface SkillSpec {
  name: SkillCall['skill'];
  /** 完整示例与执行条件，供按需帮助与解析错误引用。 */
  doc: string;
  /** 常见形态的短约束；签名、schema 与错误纠正共用，不常驻展开完整手册。 */
  inputHint?: string;
  fields: FieldSpec[];
  /** 横向规则钩子:接管整步校验与规范化;没给钩子的技能走表驱动 */
  parse?: (c: Record<string, unknown>, at: string, marks?: MarkLookup) => ParseResult;
}

/**
 * 路标名 → 坐标。 World 持有 mc_map 那张表,解析器只收这一个只读查询;
 * 不接(台架、纯结构测试)时 `at` 只认坐标数组。
 */
export type MarkLookup = (name: string) => [number, number, number] | { error: string } | null;

const RELATIVE_HINT = '数字或 "~"/"~-3" 相对写法';

/** 一步 use 里连着右键的次数上限 */
const USE_TIMES_MAX = 16;

/**
 * lead 的 tolerance:「牵到了」判到 to 多少格内算数。默认 3 —— 牵绳本来就是软的,
 * 原版把活物拉到落脚点上是做不到的事,给一个圈才说得出「到了没有」。
 */
const LEAD_TOL = { lo: 1, hi: 16, def: 3 } as const;

function parseGoto(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  // [x,z] 两分量 = 在对应水平位置找可达落脚点；不强制站上屋顶。
  const flat = Array.isArray(c.at) && c.at.length === 2;
  if (c.exact !== undefined && typeof c.exact !== 'boolean') return { error: `${at} goto 的 exact 要布尔值` };
  if (c.walkOnly !== undefined && typeof c.walkOnly !== 'boolean') return { error: `${at} goto 的 walkOnly 要布尔值` };
  if (flat && c.exact === true) return { error: `${at} goto 的 exact 需要完整 [x,y,z] 落脚格` };
  const to = anchorOf(flat ? [(c.at as unknown[])[0], 0, (c.at as unknown[])[1]] : c.at, marks);
  if (!to) {
    return {
      error: `${at} goto 要 at:[x,y,z] / [x,z](${RELATIVE_HINT}),或一个 mc_map 路标名`
        + markMissNote(c.at, marks),
    };
  }
  return {
    step: {
      skill: 'goto', at: to,
      ...(str(c.dimension) ? { dimension: normalizeDimension(str(c.dimension)) } : {}),
      ...(flat ? { groundY: true as const } : {}),
      ...(c.exact === true ? { exact: true } : {}),
      ...(c.walkOnly === true ? { walkOnly: true } : {}),
      ...(c.dryRun === true ? { dryRun: true } : {}),
    },
  };
}

/** 一步 build 里最多放几处(格子清单形态与贴面形态共用) */
const PLACE_SPOTS_MAX = 16;

/** 一处贴面放置的结构校验:{"at":[x,y,z],"face":"up"} */
function placeOnFaceOf(v: unknown): PlaceOnFace | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const spot = anchorOf(o.at);
  const face = str(o.face);
  if (!spot || !face || !(FACE_NAMES as string[]).includes(face)) return null;
  return { at: spot, face: face as BlockFace };
}

/**
 * build 的贴面形态。判别式的第二形态,判据是 `on` 在不在——**不重载 `anchors`**:
 * 同一个字段在有没有 face 时含义不同就是二义性字段。
 */
function parseBuildOnFaces(c: Record<string, unknown>, at: string): ParseResult {
  if (c.anchors !== undefined && c.anchors !== null) {
    return { error: `${at} build 的 on(贴着某一面放)与 anchors(直接点格子)只能给一个` };
  }
  const material = str(c.material);
  if (!material) return { error: `${at} build 要 material(方块英文 id)` };
  if (!Array.isArray(c.on) || c.on.length === 0 || c.on.length > PLACE_SPOTS_MAX) {
    return { error: `${at} build 的 on 要 1-${PLACE_SPOTS_MAX} 处,每处 {"at":[x,y,z],"face":"up"}` };
  }
  const on: PlaceOnFace[] = [];
  for (const [i, raw] of c.on.entries()) {
    const spot = placeOnFaceOf(raw);
    if (!spot) {
      return {
        error: `${at} on 的第 ${i + 1} 处要 {"at":[x,y,z],"face":…}` +
          `(at 是参照方块那一格,${RELATIVE_HINT};face 只认 ${FACE_NAMES.join('/')})`,
      };
    }
    on.push(spot);
  }
  const notes: StepNote[] = [];
  for (const key of ['shape', 'fill'] as const) {
    const given = c[key];
    if (given !== undefined && given !== null) {
      notes.push({ field: key, given, kind: 'dropped', why: '贴面放置是一处一处的,没有形状' });
    }
  }
  const step: SkillCall = { skill: 'build', material, on, ...(c.temporary === true ? { temporary: true } : {}), ...(c.dryRun === true ? { dryRun: true } : {}) };
  return notes.length > 0 ? { step, notes } : { step };
}

/**
 * build 的蓝图形态。判据是 `blueprint` 在不在 —— 形状、材料、每一格放什么都在
 * 图里,所以这一形态把 material/shape/fill/on/anchors 一概当误写丢掉并点名
 * (静默吃掉参数是这条链上最贵的一类失败)。
 */
function parseBuildBlueprint(c: Record<string, unknown>, at: string): ParseResult {
  const key = str(c.blueprint);
  if (!key) return { error: `${at} build 的 blueprint 要一个蓝图键(字符串)` };
  const notes: StepNote[] = [];
  for (const field of ['material', 'shape', 'fill', 'on', 'anchors'] as const) {
    const given = c[field];
    if (given !== undefined && given !== null) {
      notes.push({ field, given, kind: 'dropped', why: '按蓝图施工时形状与材料都在图里' });
    }
  }
  let anchor: Anchor | undefined;
  if (c.at !== undefined && c.at !== null) {
    const a = anchorOf(c.at);
    if (!a) {
      return {
        error: `${at} build 的 at 要 [x,y,z](蓝图 [0,0,0] 落在世界的哪一格;${RELATIVE_HINT})`,
      };
    }
    anchor = a;
  }
  let stopAfter: number | undefined;
  let rebindFrom: PositionXYZ | undefined;
  if (c.rebindFrom !== undefined && c.rebindFrom !== null) {
    if (!Array.isArray(c.rebindFrom) || c.rebindFrom.length !== 3
      || !c.rebindFrom.every((value) => typeof value === 'number' && Number.isSafeInteger(value))) {
      return { error: `${at} build 的 rebindFrom 要原绑定的绝对整数坐标 [x,y,z]` };
    }
    if (!anchor) return { error: `${at} build 改绑工地还要给新锚点 at` };
    rebindFrom = [...c.rebindFrom] as PositionXYZ;
  }
  if (c.stopAfter !== undefined && c.stopAfter !== null) {
    if (typeof c.stopAfter !== 'number' || !Number.isSafeInteger(c.stopAfter) || c.stopAfter < 0) {
      return { error: `${at} build 的 stopAfter 要一个非负整数 y 层号(0 是最低层)` };
    }
    stopAfter = c.stopAfter;
  }
  const step: SkillCall = {
    skill: 'build', blueprint: key,
    ...(anchor ? { at: anchor } : {}),
    ...(rebindFrom ? { rebindFrom } : {}),
    ...(stopAfter !== undefined ? { stopAfter } : {}),
    ...(c.confirm === true ? { confirm: true } : {}),
    ...(c.skipConflicts === true ? { skipConflicts: true } : {}),
    ...(c.dryRun === true ? { dryRun: true } : {}),
  };
  return notes.length > 0 ? { step, notes } : { step };
}

/**
 * find 站着扫的最远距离(格)。等于感知半径:再远的方块进不了 findBlocks 的区块索引,
 * 也谈不上"看得见"。要更远只能走过去 —— 那就得给 direction。
 */
export const FIND_STATIC_MAX = 48;

/** `until` 一次最多点几样(名单与类别合计) */
const UNTIL_NAMES_MAX = 12;

/** `probe` 的 `where` 每样最多列几处坐标(按远近);总数照实报 */
export const PROBE_WHERE_SHOWN = 6;

/**
 * `until` 支持的类别写法(`"#ores"` 这种)。
 *
 * 本该用 minecraft-data 的方块 tag 展开,但本仓库钉住的 registry(prismarine-registry
 * 1.12 / minecraft-data 3.112)**没有 tag 数据面** —— 逐版本核过,`blockTags` 不存在。
 * 于是退化成这几个内置类别;它们写成**名字谓词**而不是写死的 id 名单,换版本不会
 * 漏掉新方块。执行器先探一次 registry 的 tag 面(将来有了就走那条),取不到才落到这里。
 */
export const UNTIL_CATEGORIES: Readonly<Record<string, (name: string) => boolean>> = {
  ores: (n) => n.endsWith('_ore') || n === 'ancient_debris',
  logs: (n) => n.endsWith('_log') || n.endsWith('_stem'),
  leaves: (n) => n.endsWith('_leaves'),
  chests: (n) => n === 'chest' || n === 'trapped_chest' || n === 'barrel',
  liquids: (n) => n === 'water' || n === 'lava',
  beds: (n) => n.endsWith('_bed'),
};

/** 文档与错误文案里那一串类别名(带 `#`) */
export const UNTIL_CATEGORY_DOC = Object.keys(UNTIL_CATEGORIES).map((k) => `#${k}`).join('/');

function parseShaped(skill: 'build' | 'excavate' | 'probe') {
  return (c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult => {
    if (skill === 'build' && c.temporary !== undefined && typeof c.temporary !== 'boolean') {
      return { error: `${at} build.temporary 要布尔值；只对明确临时支撑写 true` };
    }
    if (skill === 'build' && c.blueprint != null && c.temporary === true) {
      return { error: `${at} 蓝图是作品；临时支撑请另用 build material/on/anchors 并写 temporary:true` };
    }
    // 判别式三形态,判据各是一个独占字段:blueprint(按图盖)→ on(贴面)→ anchors(点格子)
    if (skill === 'build' && c.blueprint !== undefined && c.blueprint !== null) {
      return parseBuildBlueprint(c, at);
    }
    // 单格 at 的含义唯一时才作为 anchors 别名；不盖过另一种目标或形状。
    const singleAt = skill === 'build' && c.at !== undefined && c.at !== null;
    if (singleAt && (c.on != null || c.anchors != null || c.shape != null)) {
      return { error: `${at} build 的单格 at 与 on/anchors/shape 不能同用；材料放置选一个目标形态，蓝图原点另用 blueprint+at` };
    }
    if (skill === 'build' && c.on !== undefined && c.on !== null) return parseBuildOnFaces(c, at);
    // build 不写 shape = 就这些格,一步放 N 处、各报各的;写了 shape 才按形状连片铺
    const listed = skill === 'build' && (c.shape === undefined || c.shape === null);
    const shape = listed ? null : str(c.shape);
    if (!listed && (!shape || !(SHAPE_NAMES as string[]).includes(shape))) {
      return { error: `${at} ${skill} 的 shape 要是 ${SHAPE_NAMES.join('/')} 之一` };
    }
    const anchors = listed
      ? anchorListOf(singleAt ? [c.at] : c.anchors, PLACE_SPOTS_MAX, marks)
      : anchorsOf(c.anchors, ANCHOR_COUNT[shape as ShapeName], marks);
    if (!anchors) {
      return {
        error: listed
          ? `${at} build 不写 shape 时 anchors 是 1-${PLACE_SPOTS_MAX} 个格子,` +
            `每个是 [x,y,z](${RELATIVE_HINT})`
          : `${at} ${shape} 要 ${ANCHOR_COUNT[shape as ShapeName]} 个锚点,` +
            `每个是 [x,y,z](${RELATIVE_HINT})`,
      };
    }
    let fill: BoxFill | undefined;
    if (c.fill !== undefined) {
      const f = str(c.fill);
      if (f !== 'solid' && f !== 'outline' && f !== 'edges') {
        // `hollow` 是原版 /fill 的模式名,含义是"外壳 + 内部清成空气",与这里的
        // outline(只动外壳)差一整个内部。收下它当别名等于把假朋友留着,所以退回
        // 并当场说清两者的分别 —— 这也是改名唯一的通知口。
        return {
          error: f === 'hollow'
            ? `${at} 只动外壳写 fill:"outline";原版 /fill 的 hollow 还会把内部清成空气,这里没有那个模式`
            : `${at} fill 只认 solid/outline/edges`,
        };
      }
      fill = f;
    }
    const dryRun = c.dryRun === true;
    if (skill === 'build') {
      const material = str(c.material);
      if (!material) return { error: `${at} build 要 material(方块英文 id)` };
      return {
        step: {
          skill, anchors, material,
          ...(shape ? { shape: shape as ShapeName } : {}),
          ...(fill ? { fill } : {}), ...(dryRun ? { dryRun } : {}), ...(c.temporary === true ? { temporary: true } : {}),
        },
        ...(singleAt ? { notes: [{ field: 'at', given: c.at, kind: 'rewritten' as const,
          as: `anchors:${JSON.stringify(anchors)}（单格材料放置）` }] } : {}),
      };
    }
    if (skill === 'excavate') {
      const tool = str(c.tool);
      if (c.tool !== undefined && c.tool !== null && !tool) {
        return { error: `${at} excavate 的 tool 要物品英文 id 或 "fastest"` };
      }
      return {
        step: {
          skill, shape: shape as ShapeName, anchors,
          ...(fill ? { fill } : {}), ...(dryRun ? { dryRun } : {}), ...(tool ? { tool } : {}),
        },
      };
    }
    const where = nameListOf(c.where, at, 'probe 的 where');
    if (where !== null && 'error' in where) return { error: where.error };
    let slice: SpatialSliceAxis | undefined;
    if (c.slice !== undefined) {
      if (!SPATIAL_SLICE_AXES.includes(c.slice as SpatialSliceAxis)) {
        return { error: `${at} probe 的 slice 只认 x/y/z` };
      }
      if (shape !== 'box' || (fill !== undefined && fill !== 'solid') || where) {
        return { error: `${at} probe.slice 须用 box、fill:solid(可省略)，且不与 where 同用` };
      }
      slice = c.slice as SpatialSliceAxis;
    }
    return {
      step: {
        skill, shape: shape as ShapeName, anchors,
        ...(fill ? { fill } : {}), ...(where ? { where: where.names } : {}), ...(slice ? { slice } : {}),
      },
      ...(where && JSON.stringify(c.where) !== JSON.stringify(where.names)
        ? { notes: [{ field: 'where', given: c.where, kind: 'rewritten' as const,
          as: `${JSON.stringify(where.names)}（去重后的过滤集合）` }] } : {}),
    };
  };
}

/** 一串英文 id:没写(或写了个空数组)给 null,写错给 error */
function nameListOf(
  v: unknown, at: string, what: string,
): { names: string[] } | { error: string } | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
    return { error: `${at} ${what} 要是一串英文 id(数组)` };
  }
  // where 是同一片有限区域的过滤集合，不是 until 的行动停止名单。
  // 区域体积、可见性和每种材质的坐标展示上限仍由探查执行器约束。
  const names = [...new Set((v as string[]).map((s) => s.trim()).filter(Boolean))];
  return names.length > 0 ? { names } : null;
}

function parseUse(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  const item = str(c.item);
  const useAt = c.at === undefined ? null : anchorOf(c.at, marks);
  if (c.at !== undefined && !useAt) {
    return { error: `${at} use 的 at 要 [x,y,z](${RELATIVE_HINT})${markMissNote(c.at, marks)}` };
  }
  const target = str(c.target);
  let entityId: number | undefined;
  if (c.entityId !== undefined) {
    if (!target || useAt) return { error: `${at} use 的 entityId 要与 target 一起给` };
    if (typeof c.entityId !== 'number' || !Number.isInteger(c.entityId) || c.entityId < 0 || c.entityId > 2_147_483_647) {
      return { error: `${at} use 的 entityId 要是本连接里观察到的非负整数实体 ID` };
    }
    entityId = c.entityId;
  }
  if (useAt && target) {
    return { error: `${at} use 的 at 与 target 只能给一个：at 点击方块，target 点击活物；点击方块只给 at，不填 target` };
  }
  // 空手又不说对哪儿使,右键不出任何东西
  if (!item && !useAt && !target) {
    return { error: `${at} use 至少要给 item,或 at/target` };
  }

  const times = intIn(c.times, 1, USE_TIMES_MAX, 1);
  if (times === null) return { error: `${at} use 的 times 要在 1-${USE_TIMES_MAX} 之间` };
  if (c.open !== undefined && (typeof c.open !== 'boolean' || !useAt || times !== 1)) {
    return { error: `${at} use 的 open 要布尔值，并与方块 at 一起给；明确开关状态只执行一次` };
  }
  let index: number | undefined;
  if (c.index !== undefined) {
    if (!target) return { error: `${at} use 的 index 是报价菜单序号,要和 target 一起给` };
    const i = intIn(c.index, 1, 99, 1);
    if (i === null) return { error: `${at} use 的 index 要是报价菜单里的序号(1 起)` };
    index = i;
  }
  // 牌子上的字:原版一块牌子四行、每行 45 个字符。超了当场说清楚超在哪一行,
  // 不交给下游 —— mineflayer 的 updateSign 越界时只 emit 一个 error 就静默返回。
  let text: string | undefined;
  let textNote: StepNote | undefined;
  if (c.text !== undefined && c.text !== null) {
    if (typeof c.text !== 'string') return { error: `${at} use 的 text 要是字符串(告示牌上的字,\\n 分行)` };
    if (!useAt) return { error: `${at} use 的 text 是写在某一块告示牌上的,要和 at 一起给` };
    // 仅含字面 \n 且没有真实换行时，尝试将其规范化为换行。
    // 规范化后不超过四行才采用，并以该文本继续校验。
    let given = c.text;
    if (!given.includes('\n') && given.includes('\\n')) {
      const unescaped = given.split('\\n').join('\n');
      if (unescaped.split('\n').length <= SIGN_LINES) {
        given = unescaped;
        textNote = { field: 'text', given: c.text, kind: 'rewritten', as: `字面「\\n」按分行符收下,归一成 ${given.split('\n').length} 行` };
      }
    }
    const lines = given.split('\n');
    if (lines.length > SIGN_LINES) {
      return { error: `${at} 告示牌一共 ${SIGN_LINES} 行,给了 ${lines.length} 行` };
    }
    const over = lines.findIndex((line) => line.length > SIGN_LINE_CHARS);
    if (over >= 0) {
      return { error: `${at} 告示牌每行最多 ${SIGN_LINE_CHARS} 个字符,第 ${over + 1} 行有 ${lines[over].length} 个` };
    }
    text = given;
  }
  if (c.back !== undefined && c.back !== null && text === undefined) {
    return { error: `${at} use 的 back 是"写在牌子背面",要和 text 一起给` };
  }
  const back = c.back === true;
  let face: BlockFace | undefined;
  if (c.face !== undefined && c.face !== null) {
    const f = str(c.face);
    if (!f || !(FACE_NAMES as string[]).includes(f)) {
      return { error: `${at} use 的 face 要是 ${FACE_NAMES.join('/')} 之一` };
    }
    if (!useAt) return { error: `${at} use 的 face 是"右键那一格的哪一面",要和 at 一起给` };
    face = f as BlockFace;
  }
  return {
    step: {
      skill: 'use',
      ...(item ? { item } : {}),
      ...(useAt ? { at: useAt } : {}),
      ...(target ? { target } : {}),
      ...(entityId !== undefined ? { entityId } : {}),
      ...(index !== undefined ? { index } : {}),
      ...(times > 1 ? { times } : {}),
      ...(typeof c.open === 'boolean' ? { open: c.open } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(back ? { back: true as const } : {}),
      ...(face ? { face } : {}),
    },
    ...(textNote ? { notes: [textNote] } : {}),
  };
}

/** 原版一块告示牌的行数与每行字符数上限(1.20.6 同 1.14 起未变)。 */
const SIGN_LINES = 4;
const SIGN_LINE_CHARS = 45;

/** 空着的那只手在游戏里就是 `air`:她照着游戏这么写,收下并回念成「空手」。 */
const EMPTY_HAND_NAMES = ['air', 'minecraft:air'];

function parseEquip(c: Record<string, unknown>, at: string): ParseResult {
  const item = str(c.item);
  const pick = str(c.pick);
  if (c.hand !== undefined && c.hand !== 'main' && c.hand !== 'off') {
    return { error: `${at} equip 的 hand 只认 main/off` };
  }
  const hand: { hand?: 'main' | 'off' } = c.hand === 'main' || c.hand === 'off' ? { hand: c.hand } : {};
  if (!item) {
    if (pick) return { error: `${at} equip 的 pick 是从同 id 的几件里挑一件,要和 item 一起给` };
    return { step: { skill: 'equip', ...hand } };
  }
  if (EMPTY_HAND_NAMES.includes(item)) {
    return {
      step: { skill: 'equip', ...hand },
      notes: [{ field: 'item', given: c.item, kind: 'rewritten', as: '空手' }],
    };
  }
  return { step: { skill: 'equip', item, ...(pick ? { pick } : {}), ...hand } };
}

/** 原版铁砧改名框的字符上限(ServerboundRenameItem 超长直接丢) */
const ANVIL_NAME_MAX = 50;

/**
 * 挑选词:同 id 的几件里点名哪一件。六个技能共用一句说法,匹配规则见 item-pick.ts。
 */
const PICK_DOC = '同 id 的几件里挑哪一件:写清单括号里的字(「无限」「效率IV」,英文附魔 id 也认);'
  + '不写 = 撞上哪件算哪件。按内容匹配,不是序号,存掉一件不影响其余几件怎么写';

/** 骑乘:off / target / to 三个入参的横向规则都在这儿说清,不静默吃字段。 */
function parseRide(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  const off = c.off === true;
  const target = str(c.target);
  const entityId = c.entityId;
  if(entityId!==undefined && (!Number.isSafeInteger(entityId) || Number(entityId)<0 || Number(entityId)>2_147_483_647 || !target || off)) {
    return {error:`${at} ride 的 entityId 须是非负实体ID，并与 target 一起给；不能用于下车`};
  }
  const to = c.to === undefined || c.to === null ? null : anchorOf(c.to, marks);
  if (c.to !== undefined && c.to !== null && !to) {
    return { error: `${at} ride 的 to 要 [x,y,z](${RELATIVE_HINT})${markMissNote(c.to, marks)}` };
  }
  if (c.off !== undefined && c.off !== true) {
    return { error: `${at} ride 的 off 只认 true(下坐骑写 {"skill":"ride","off":true})` };
  }
  if (off && (target || to)) {
    return { error: `${at} ride 的 off 是下来,不能和 target/to 一起给` };
  }
  if (!off && !target && !to) {
    return { error: `${at} ride 要 target(骑上哪种)或 to(骑着现在的坐骑去哪),下来写 off:true` };
  }
  return {
    step: {
      skill: 'ride',
      ...(target ? { target } : {}),
      ...(entityId===undefined ? {} : {entityId:Number(entityId)}),
      ...(to ? { to } : {}),
      ...(off ? { off: true as const } : {}),
    },
  };
}

/**
 * 拴绳:三种形态各自成立(只拴上／牵着走／松开),照 ride 的写法当场点名缺什么。
 * `tie` 是「牵到了就系在这根栅栏上」,单独给它而不给 to 也成立(人已经牵着的时候)。
 */
function parseLead(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  const target = str(c.target);
  const to = c.to === undefined || c.to === null ? null : anchorOf(c.to, marks);
  const tie = c.tie === undefined || c.tie === null ? null : anchorOf(c.tie, marks);
  const off = c.off === true;
  if (c.to !== undefined && c.to !== null && !to) {
    return { error: `${at} lead 的 to 要 [x,y,z](${RELATIVE_HINT})${markMissNote(c.to, marks)}` };
  }
  if (c.tie !== undefined && c.tie !== null && !tie) {
    return { error: `${at} lead 的 tie 要 [x,y,z](栅栏那一格;${RELATIVE_HINT})${markMissNote(c.tie, marks)}` };
  }
  if (c.off !== undefined && c.off !== true) {
    return { error: `${at} lead 的 off 只认 true(松开写 {"skill":"lead","off":true})` };
  }
  if (c.keep !== undefined && c.keep !== true) {
    return { error: `${at} lead 的 keep 只认 true` };
  }
  if (off && (target || to || tie || c.keep === true)) {
    return { error: `${at} lead 的 off 是松开,不能和 target/to/tie/keep 一起给` };
  }
  if (!off && !target && !to && !tie) {
    return { error: `${at} lead 要 target(拴哪只)或 to(把现在牵着的牵去哪),松开写 off:true` };
  }
  const tol = intIn(c.tolerance, LEAD_TOL.lo, LEAD_TOL.hi, LEAD_TOL.def);
  if (tol === null) {
    return { error: `${at} lead 的 tolerance 要在 ${LEAD_TOL.lo}-${LEAD_TOL.hi} 格之间` };
  }
  return {
    step: {
      skill: 'lead',
      ...(target ? { target } : {}),
      ...(to ? { to, tolerance: tol } : {}),
      ...(tie ? { tie } : {}),
      ...(c.keep === true ? { keep: true as const } : {}),
      ...(off ? { off: true as const } : {}),
    },
  };
}

/** 铁砧:op 决定哪些字段成立;缺什么当场点名,不留到执行期。 */
function parseAnvil(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  const op = str(c.op);
  if (!op || !['repair', 'combine', 'rename'].includes(op)) {
    return { error: `${at} anvil 的 op 只认 repair/combine/rename` };
  }
  const item = str(c.item);
  if (!item) return { error: `${at} anvil 要 item(左格那件东西的物品英文 id)` };
  const withItem = str(c.with);
  const name = str(c.name);
  if ((op === 'repair' || op === 'combine') && !withItem) {
    return { error: `${at} anvil 的 op:"${op}" 要 with(右格放什么:同种的另一件、附魔书或修补材料)` };
  }
  if (op === 'rename') {
    if (!name) return { error: `${at} anvil 的 op:"rename" 要 name(新名字)` };
  }
  if (name && name.length > ANVIL_NAME_MAX) {
    return { error: `${at} anvil 的 name 最多 ${ANVIL_NAME_MAX} 个字符,给了 ${name.length} 个` };
  }
  const anvilAt = c.at === undefined || c.at === null ? null : anchorOf(c.at, marks);
  if (c.at !== undefined && c.at !== null && !anvilAt) {
    return { error: `${at} anvil 的 at 要 [x,y,z](${RELATIVE_HINT})${markMissNote(c.at, marks)}` };
  }
  const pick = str(c.pick);
  const withPick = str(c.withPick);
  if (withPick && !withItem) {
    return { error: `${at} anvil 的 withPick 是给 with 挑哪一件,要和 with 一起给` };
  }
  return {
    step: {
      skill: 'anvil', op: op as 'repair' | 'combine' | 'rename', item,
      ...(withItem ? { with: withItem } : {}),
      ...(name ? { name } : {}),
      ...(anvilAt ? { at: anvilAt } : {}),
      ...(pick ? { pick } : {}),
      ...(withPick ? { withPick } : {}),
    },
  };
}

function parseGrindstone(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  const item = str(c.item);
  if (!item) return { error: `${at} grindstone 要 item(要磨的那件东西的物品英文 id)` };
  const withItem = str(c.with);
  const gsAt = c.at === undefined || c.at === null ? null : anchorOf(c.at, marks);
  if (c.at !== undefined && c.at !== null && !gsAt) {
    return { error: `${at} grindstone 的 at 要 [x,y,z](${RELATIVE_HINT})${markMissNote(c.at, marks)}` };
  }
  const pick = str(c.pick);
  const withPick = str(c.withPick);
  if (withPick && !withItem) {
    return { error: `${at} grindstone 的 withPick 是给 with 挑哪一件,要和 with 一起给` };
  }
  return {
    step: {
      skill: 'grindstone', item,
      ...(withItem ? { with: withItem } : {}),
      ...(gsAt ? { at: gsAt } : {}),
      ...(pick ? { pick } : {}),
      ...(withPick ? { withPick } : {}),
    },
  };
}

/** Explicit disposition rules are atomic input: do not silently drop a retention condition. */
function parseOrganize(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  const out: Extract<SkillCall, { skill: 'organize' }> = { skill: 'organize' };
  if (c.target != null) {
    if (c.target !== 'inventory' && c.target !== 'open') return { error: `${at} organize 的 target 只认 inventory 或 open` };
    out.target = c.target;
  }
  for (const flag of ['includeHotbar', 'sort', 'dryRun'] as const) if (c[flag] != null) {
    if (typeof c[flag] !== 'boolean') return { error: `${at} organize 的 ${flag} 要布尔值` };
    out[flag] = c[flag] as boolean;
  }
  if (c.rules != null) {
    if (!Array.isArray(c.rules)) return { error: `${at} organize 的 rules 要数组` };
    const rules: InventoryDisposition[] = [];
    for (const [index, raw] of c.rules.entries()) {
      const err = (why: string): ParseResult => ({ error: `${at} organize rules[${index}] ${why}` });
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err('要 item、keep 和 action');
      const r = raw as Record<string, unknown>, item = str(r.item), pick = str(r.pick);
      if (Object.keys(r).some(k => !['item', 'keep', 'action', 'pick'].includes(k))) return err('包含不支持的字段；取舍规则不能忽略字段');
      if (!item) return err('item 要物品 id 或类别');
      if (!Number.isSafeInteger(r.keep) || (r.keep as number) < 0) return err('keep 要大于等于 0 的整数');
      if (r.action !== 'stow' && r.action !== 'toss') return err('action 只认 stow 或 toss');
      if (r.pick != null && !pick) return err('pick 要非空挑选词');
      rules.push({ item, keep: r.keep as number, action: r.action, ...(pick ? { pick } : {}) });
    }
    if (rules.length) out.rules = rules;
  }
  if (c.at != null) {
    const a = anchorOf(c.at, marks);
    if (!a) return { error: `${at} organize 的 at 要 [x,y,z](${RELATIVE_HINT})${markMissNote(c.at, marks)}` };
    out.at = a;
  }
  if (c.into != null) {
    if (c.into !== 'open') return { error: `${at} organize 的 into 只认 open` };
    out.into = 'open';
  }
  if (out.at && out.into) return { error: `${at} organize 的 at 与 into:open 只能选一个` };
  if (out.target === 'open' && (out.rules?.length || out.at || out.into || out.includeHotbar !== undefined))
    return { error: `${at} target:open 只整理已打开容器，不收玩家取舍 rules、at、into 或 includeHotbar` };
  if ((out.at || out.into) && !out.rules?.some(r => r.action === 'stow'))
    return { error: `${at} organize 的 at/into 只用于 rules 中的 stow` };
  return { step: out };
}

/** `take` 的两种操作必须显式区分：定量取物，或取指定容器的可取物。 */
function parseTake(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  const item = str(c.item);
  if (c.from !== undefined && c.from !== 'open') {
    return { error: `${at} take 的 from 只认 open(当前打开的容器窗口)` };
  }
  const fromOpen = c.from === 'open';
  const takeAt = c.at === undefined || c.at === null ? null : anchorOf(c.at, marks);
  if (c.at !== undefined && c.at !== null && !takeAt) {
    return { error: `${at} take 的 at 要 [x,y,z](${RELATIVE_HINT})${markMissNote(c.at, marks)}` };
  }
  const all = c.all === true;
  if (fromOpen && (takeAt || all)) {
    return { error: `${at} take 的 from:open 不能与 at 或 all:true 一起用` };
  }
  if (c.all !== undefined && c.all !== true) {
    return { error: `${at} take 的 all 只认 true;取指定容器的可取物写 all:true` };
  }
  if (all) {
    if (!takeAt) return { error: `${at} take 的 all:true 必须同时给 at:[x,y,z]` };
    if (item || c.count !== undefined || c.pick !== undefined) {
      return { error: `${at} take 的 all:true 不能再给 item、count 或 pick` };
    }
    return { step: { skill: 'take', at: takeAt, all: true } };
  }
  if (!item) {
    return { error: takeAt
      ? `${at} take 点名容器后还要说明操作:定量取物写 item+count;取当前可取物写 all:true`
      : `${at} take 要 item+count(定量取物),或 at+all:true(取指定容器的可取物)` };
  }
  if (c.count === undefined || c.count === null) {
    return { error: `${at} take 定量取物必须写 count(1-64),不再默认成 1` };
  }
  const count = intIn(c.count, 1, 64, 1);
  if (count === null) return { error: `${at} take 的 count 要在 1-64 之间` };
  const pick = str(c.pick);
  return {
    step: {
      skill: 'take',
      item,
      count,
      ...(takeAt ? { at: takeAt } : {}),
      ...(pick ? { pick } : {}),
      ...(fromOpen ? { from: 'open' as const } : {}),
    },
  };
}

/**
 * enchant 的 `index` 有三态:不写 = 只看报价;1/2/3 = 按那一档下手。
 * 表驱动的 int 字段必带默认值,而这里「没写」本身是一种语义,只能走钩子。
 */
function parseEnchant(c: Record<string, unknown>, at: string, marks?: MarkLookup): ParseResult {
  const table = anchorOf(c.at, marks);
  if (!table) {
    return { error: `${at} enchant 要 at:[x,y,z](${RELATIVE_HINT}),指着附魔台那一格${markMissNote(c.at, marks)}` };
  }
  const item = str(c.item);
  if (!item) return { error: `${at} enchant 要 item(要给哪样东西附魔,英文 id)` };
  if (c.index === undefined || c.index === null) return { step: { skill: 'enchant', at: table, item } };
  const index = intIn(c.index, 1, 3, 1);
  if (index === null) return { error: `${at} enchant 的 index 要 1/2/3(上中下三格),不写就是只看报价` };
  return { step: { skill: 'enchant', at: table, item, index } };
}

function parseCraft(c: Record<string, unknown>, at: string): ParseResult {
  const count = intIn(c.count, 1, 64, 1);
  if (count === null) return { error: `${at} craft 的 count 要在 1-64 之间` };
  const item = str(c.item);
  if (item && c.grid !== undefined) {
    return { error: `${at} craft 的 item 和 grid 只能选一个；做${item}只写 item 走配方表，自摆配方只写 grid` };
  }
  if (c.grid !== undefined) {
    const grid = gridOf(c.grid);
    if (!grid) {
      return {
        error: `${at} craft 的 grid 要是按行写的名字二维数组(空位写 null),最多 3 行 3 列`,
      };
    }
    return { step: { skill: 'craft', grid, count } };
  }
  if (!item) return { error: `${at} craft 要 item(物品英文 id)或 grid(自己摆的格子)` };
  return { step: { skill: 'craft', item, count } };
}

/** 锚点的 schema 片段([x,y,z],分量数字或 "~" 相对写法;整个给一个字符串 = mc_map 路标名) */
const ANCHOR_SCHEMA = {
  type: ['array', 'string'], items: { type: ['number', 'string'] }, minItems: 3, maxItems: 3,
} as const;

/** 注册表本体。顺序即 SKILL_NAMES 与 SKILL_DOC 的出场顺序 */
const SKILLS: readonly SkillSpec[] = [
  {
    name: 'control',
    doc: `{"skill":"control","keys":["forward","jump"],"durationMs":500,"mode":"ground"} 短时直接按键，不计算寻路、不挖方块。每步 50–2000 毫秒，结束或中断松开按键；跳跃、服务端跃空的冲量由普通游戏物理处理。
{"skill":"control","mode":"water","keys":[],"durationMs":1000} 已在水中时松开上浮键自然下沉；jump 上浮、WASD 水平游动。仍用原有物理和碰撞，不改坐标/速度；当前物理不支持俯仰驱动潜泳或 sneak 加速下潜。自动踩水与防溺水共用 reflex.antiDrown 开关，关闭后结束也不自动上浮；启用时低氧/环境自救仍可接管。回执核对实际高度、头部浸水与氧气，未知不算满氧。不能替代水下绕障寻路。
{"skill":"control","keys":["forward","jump"],"durationMs":1000,"mode":"flight","yawDeg":30} 先相对当前视角左转 30 度，再向前上方斜飞。飞行必须已有服务端许可，可与授予许可的 chat 同单用 needs 连接；最多等待许可 2 秒。
keys: forward/back/left/right/jump/sneak/sprint；相反方向不能同按。flight 中 WASD 水平移动，jump 上升、sneak 下降，可边平移边升降；forward+sprint 水平加速，升降速度不翻倍。方向按当前视角水平朝向，pitch 不改变升降。受控短时飞行使用服务端能力速度及保守步长，不复刻完整创造模式惯性。yawDeg 正数左转、pitchDeg 正数抬头；单位度。空 keys 配转角可原地转头。
ground 使用普通物理，飞行悬停时先 land 或改用 flight。flight 检查身位碰撞和区块加载，遇遮挡停止；不会绕路。位置修正、死亡、断线或身体被其他任务接管时结束本步，不从旧坐标继续移动。
施法仅授予许可，不会自动按键起飞。先用 state 的 flight 检查许可/期限，再 control(mode:flight) 起飞。已知路线优先施法前 flight_plan，再把施法与移动/作业用 needs 成批提交；模型等待也会消耗许可时间，预留落地余量。坐标 flight 是路线控制，网页不应伪装成 WASD 按键。
回执给实际起终点、位移和中断原因；按完键不证明到达目的地。已知连续步骤可同单排队，needs 串联、expect 检查实际终态；被打断的 control 不自动重放，重新观察后再排。`,
    fields: [
      { key: 'keys', kind: 'opaque', required: true, schema: { type: 'array', items: { type: 'string', enum: [...CONTROL_KEYS] } } },
      { key: 'durationMs', kind: 'int', lo: CONTROL_DURATION.minMs, hi: CONTROL_DURATION.maxMs, def: CONTROL_DURATION.defaultMs, unit: '毫秒' },
      { key: 'mode', kind: 'enum', values: ['ground', 'water', 'flight'], error: 'control 的 mode 要 ground、water 或 flight' },
      { key: 'yawDeg', kind: 'opaque', schema: { type: 'number', minimum: -180, maximum: 180 }, doc: '相对视角，正数左转，单位度' },
      { key: 'pitchDeg', kind: 'opaque', schema: { type: 'number', minimum: -90, maximum: 90 }, doc: '相对视角，正数抬头，单位度' },
    ],
    parse: parseControl,
  },
  {
    name: 'look',
    doc: `{"skill":"look","at":[100,68,-20]} 原地转头看向目标格中心，不移动、不右键或挖掘。换观察方向后可用 mc_visual 拍摄。
                                                 朝向目标不证明目标可见；墙和遮挡仍须由实际画面核对。若目标是当前可见告示牌，回执附已收到的正反面原文，null 是未收到，不是空白；读字不要 use 打开编辑框。`,
    fields: [{ key: 'at', kind: 'anchor', required: true,
      error: `look 要 at:[x,y,z](${RELATIVE_HINT}),或一个 mc_map 路标名`,
      doc: '要面向的目标格，支持相对坐标和已登记路标。' }],
  },
  {
    name: 'goto',
    doc: `{"skill":"goto","at":[100,-20],"dimension":"overworld"} 去坐标。dimension 是当前维度前置条件,不符就不动。
                                                 **只写 [x,z] = 按水平距离到那儿附近**，高度不进到达判据，也不保证站上陆地；长途按近处航段推进，不必猜未加载终点的高度。途中受阻会报告实际位置。
                                                 要指定楼层或高度,请给完整 [x,y,z]。
                                                 水路按水面通行；当前不规划主动下潜，填水下 Y 不能补齐这项能力。已入水可用 control(mode:water) 短步游动/下沉，核验高度与氧气；surface 换气。
                                                 完整坐标的到达判定允许离目标格 1 格，回执给出实际落脚格；到门旁不代表已经进屋。
                                                 exact:true 要完整 [x,y,z]，脚下必须到该格；用于穿过门洞或精确站位，不会把门外邻格当作进屋。
                                                 后续螺旋楼梯需要起点 X/Z 对齐时，使用精确站位并核对实际脚格；普通邻域到达不能证明对齐。
                                                 dryRun 只计算路线，不移动身体。穿过门洞要选择门另一侧的可站立空气格，并核对实际位置。
                                                 at 也收 mc_map 的路标名:{"skill":"goto","at":"家"}。
                                                 Mineflayer普通赶路每段优先走现有通路（可开门，不挖掘或垫脚）；本次现路搜索明确无路时才退回已配置的挖掘/搭路能力。
                                                 超时、未知、受击或取消不等于没有现路，不触发自动挖路；已选现路执行后明确无路时最多退回一次。长途按当前短段重新选择，不拿远处未知终点替途中判路。
                                                 已绑定蓝图范围内不生成挖掘或搭路动作，完工后仍生效；tunnel等明确施工动作保持自身契约。
                                                 walkOnly:true 只沿现有通路走，不挖掘或垫脚；只靠走试算可达时，可用同一目标加此字段实际执行。与 dryRun 同用时只试算这条走法。
                                                 单步规划落差最多 ${NAVIGATION_LIMITS.maxDropDown} 格，跑酷${NAVIGATION_LIMITS.allowParkour ? '开启' : '关闭'}；三种路线试算共享这些限制。挖掘按走法及实际可挖/保护规则，搭路依赖背包内可用垫脚料，诊断分别报告。
                                                 算不出路仅表示在所列能力下未找到路线，不证明所有移动方式或显式改结构都不可行，也不确定是哪项限制导致失败。
                                                 梯子用可达下端进入，再沿连续梯段到出口平台；use 右键不爬梯。看见一格梯子不证明它已接到地面或通向顶部，probe 可核对整段。
                                                 走不通时核对门洞、通道与落点；改结构用显式 excavate/build，按现场和权限核验。`,
    parse: parseGoto,
    fields: [
      {
        key: 'at', kind: 'anchor', required: true,
        error: `goto 要 at:[x,y,z] / [x,z](${RELATIVE_HINT}),或一个 mc_map 路标名`,
        schema: { type: ['array', 'string'], items: { type: ['number', 'string'] }, minItems: 2, maxItems: 3 },
        doc: '只写 [x,z] = 到附近可达落脚点(不强制爬屋顶);指定楼层请给 [x,y,z];给字符串 = mc_map 路标名',
      },
      { key: 'dimension', kind: 'string', doc: '可选的当前维度前置条件(overworld/the_nether/the_end)' },
      { key: 'exact', kind: 'flag', doc: '完整 [x,y,z] 的精确落脚格；缺省允许邻格到达' },
      { key: 'walkOnly', kind: 'flag', doc: '只沿现有通路走，不挖掘或垫脚；dryRun 也只试算这条走法' },
      { key: 'dryRun', kind: 'flag' },
    ],
  },
  {
    name: 'transit',
    doc: `{"skill":"transit","at":[-228,73,58]}          穿过这一格的传送门:nether_portal、end_portal(框中间地面那层)、
                                                 end_gateway(末地外岛的折跃门)。会先走到门边,再明确踏进门里,
                                                 等维度(折跃门是落点)切换后才算完成。普通寻路永远绕开这三种门。goto 只到门边，use 只右键；穿门后重新核对当前维度和落点`,
    fields: [
      {
        key: 'at', kind: 'anchor', required: true,
        error: `transit 要 at:[x,y,z](传送门方块;${RELATIVE_HINT}),或一个当前维度的 mc_map 路标名`,
        doc: '当前维度里的一格传送门方块;给字符串 = 当前维度的 mc_map 路标名',
      },
    ],
  },
  {
    name:'swim',
    doc:'{"skill":"swim","at":[10,61,20],"dimension":"overworld"} 在已加载水体内规划并执行三维绕障路线；只用普通游泳物理，不挖路、不修改位置。\n'
      + '                                                 干跑 dryRun:true 只返回路线/氧气预算。最多32格、4096搜索节点；未知格不通行，六向邻接不跳过中间障碍。\n'
      + '                                                 自动核验换气点与实际进展，最多两次有限重算；每段氧气保留reserveOxygen（默认6/20）。\n'
      + '                                                 完整结果在mc.state().lastSwim，包含实际位置、路径节点数、输入次数、重算次数和耗时；失败不自动重放。',
    fields:[{key:'at',kind:'anchor',required:true,error:`swim 要 at:[x,y,z](${RELATIVE_HINT})`},
      {key:'dimension',kind:'string',doc:'当前维度前置条件，不符不移动'},
      {key:'reserveOxygen',kind:'int',lo:6,hi:16,def:6,unit:'氧气'},
      {key:'maxDurationMs',kind:'int',lo:1000,hi:90000,def:45000,unit:'毫秒'},
      {key:'dryRun',kind:'flag'}],
  },
  {
    name: 'goto_player',
    doc: '{"skill":"goto_player","name":"Alice"}           去某玩家身边',
    fields: [{ key: 'name', kind: 'string', required: true, hint: '在线玩家名' }],
  },
  {
    name: 'follow',
    doc: '{"skill":"follow","name":"Alice"}                持续跟随明确指定的同伴（约3格、不拆搭）；战斗临时接管后续跟，mc_stop或新任务可取消；跟随不等于确认队友关系',
    fields: [{ key: 'name', kind: 'string', required: true, hint: '在线玩家名' }],
  },
  {
    name: 'find',
    doc: `{"skill":"find","target":"chest","distance":32}  找东西,方块和活物都认,只报看得见的(隔玻璃算看得见)。
                                                 不给 direction = 站着扫一圈,最远 ${FIND_STATIC_MAX} 格,不挪地方。
                                                 找采集物时跳过已知受保护的方块；箱子等可交互设施仍可作为观察目标找到。
                                                 回执里的 blockAt 是目标方块占用格,不是可站落点;seenAt 是活物被看见那一刻的位置。
                                                 当前没看见只说明当前观察面没命中,不表示目标不存在。旧位置只在真实看见过时出现,并带年龄。
                                                 给了 direction = 朝那个方向边走边找,看见就停下报坐标;走满没看见也算做完。
                                                 定向找采集物会跳过 collect 保留的已开工蓝图材料；站着扫仍可看见这些材料，并注明来源。
                                                 对小麦等有生长阶段的作物，定向搜索只把成熟植株当作命中；站着扫仍报告幼苗及 age。
                                                 若出发点全向扫描先命中,回执会明确请求方向尚未搜索,不能把命中叫作该方向的结果
{"skill":"find","target":"cow","distance":64,"direction":"east","until":["#ores","water"]}
                                                 边走边找时加 "until" = 路上看见这里头任何一样就停下来报坐标(算做完)。
                                                 名单写方块英文 id,也认类别 ${UNTIL_CATEGORY_DOC};站着扫用不上它`,
    fields: [
      { key: 'target', kind: 'string', required: true, hint: '要找的方块或活物英文 id', doc: '当前连接的方块或实体英文 id，方块可用 log 等名称匹配；不支持 hostile/tree 类别，# 名单只用于 until；未命中不能证明区域安全' },
      {
        key: 'direction', kind: 'enum', values: Object.keys(DIRECTIONS),
        error: `find 的 direction 要是 ${Object.keys(DIRECTIONS).join('/')} 之一`,
        doc: '给了就边走边找;不给就站着扫',
      },
      { key: 'distance', kind: 'int', lo: 1, hi: 1024, def: FIND_STATIC_MAX, unit: '格' },
      {
        key: 'until', kind: 'names', hint: `方块英文 id 或类别 ${UNTIL_CATEGORY_DOC}`,
        doc: '边走边找时:路上碰到这里头任何一样就停',
      },
    ],
  },
  {
    name: 'flee',
    doc: '{"skill":"flee","distance":24}                   远离最近的敌对生物',
    fields: [{ key: 'distance', kind: 'int', lo: 1, hi: 128, def: 24, unit: '格' }],
  },
  {
    name: 'surface',
    doc: `{"skill":"surface"}                              脱离水体或向上到露天:在水里=浮上水面并站到干燥落脚格,回执另报 sky_visible;
                                                 只换到气、没找到岸或游不到岸都算没完成;在陆上=挖+垫上行至头顶已知无遮盖并稳定落脚。
                                                 天空柱未加载则陆上受阻;可见天空不保证已走出通天井或到周围地面,横向出口另行探路`,
    fields: [],
  },
  {
    name: 'flight',
    doc: `{"skill":"flight","at":[103,68,-31]}       服务端授予飞行权限后，飞到 12 格内已核对的平台并落地。
{"skill":"flight","at":[103,71,-31],"land":false}  飞至空中并悬停，供就近施工、转头或视觉观察；坐标是脚底格中心。
{"skill":"flight","at":["~6","~3","~6"],"land":false} 相对本步起点近移；12 格按起点到终点的三维直线距离计算，不是每轴各 12 格。
                                                 路径和身位须已加载且无遮挡。取得权限的方法由当前服务器说明提供。
                                                 dryRun:true 在施法前从当前位置试算碰撞、落点和单段耗时；不施法、不移动，不要求已有许可。
                                                 整段路线用 mc_flight_plan(points,budgetMs?)；依次投影各段起点、累计耗时并核验末段落点，施法前比较实际可用时长。
                                                 远目标加 subdivide:true 自动分成客户端12格内的斜向/垂直段，回传可整体提交的steps及needs；总耗时仍须符合服务端许可。起点改变后重算。
                                                 限时许可的已知后续移动可与授予许可的 chat 命令同单排队，用 needs 连接各段；不在施法后逐段等模型。
{"skill":"land"}                                从悬停位置沿下方已加载、安全的落脚面下降落地，再进行普通地面寻路。`,
    fields: [
      { key: 'at', kind: 'anchor', required: true,
        error: `flight 要 at:[x,y,z](落脚格；${RELATIVE_HINT})` },
      { key: 'land', kind: 'flag', retainFalse: true, doc: 'false=抵达后悬停；省略或true=平台落地' },
      { key: 'dryRun', kind: 'flag', doc: '只试算当前已加载路线；回报预计毫秒、速度来源和当前许可' },
    ],
  },
  { name: 'land', doc: '{"skill":"land"}  从飞行悬停位置下降到下方已加载的安全地面，恢复普通地面动作。', fields: [] },
  { name: 'cleanup',
    doc: `{"skill":"cleanup","dryRun":true} 检查本连接确认由自己临时放置、尚未收尾的垫脚，给出坐标和保留原因。
{"skill":"cleanup"} 从当前安全站位尝试拆除这些垫脚；不走路、不搭新块、不拆永久建筑。实体脚下、承重/依附、液体邻接、卸载或重连后无法确认来源的方块均保留。拆除与捡回分开回报；未全部清理不算工地收尾完成。`,
    fields: [{ key: 'dryRun', kind: 'flag' }] },
  {
    name: 'collect',
    doc: `{"skill":"collect","block":"oak_log","count":3}  采集方块,只挖看得见的——埋在石头里的看不见,得先挖开或者找暴露的。
                                                 加 "buried":true = 看得见但走不过去时,允许挖条路过去(最多 4 次)。
                                                 作物默认只收 age 到顶的,没长成的留着；mature:true 也可显式写出。
                                                 已开工蓝图中材质已对上的非作物格不作为采集来源；明确拆改用 excavate 指定形状和 anchors；单格用 shape:"box" 加两个相同坐标。
                                                 collect 不支持 at，带指定坐标时整单拒绝；精确挖掘用 excavate 或 mymc_script 的原生 bot.dig。
                                                 tool 不写=节约耐久;"fastest"=本步最快;物品 id=本步精确指定,都不改长期设置`,
    fields: [
      { key: 'block', kind: 'string', required: true, hint: '方块英文 id' },
      { key: 'count', kind: 'int', lo: 1, hi: 64, def: 1 },
      { key: 'buried', kind: 'flag' },
      { key: 'mature', kind: 'flag' },
      { key: 'tool', kind: 'string', hint: '物品英文 id 或 fastest', doc: '只覆盖本步;不写时节约耐久' },
    ],
  },
  {
    name: 'harvest',
    doc: `{"skill":"harvest","block":"wheat","at":[10,64,20],"replant":true} 精确收割这一个成熟作物格并补种；at 是作物格，不是土格。
                                                 补种支持 wheat/carrots/potatoes/beetroots，须事先预留一个种子或对应作物。实际核验成熟度、土壤、掉落与 age=0。
{"skill":"harvest","block":"oak_log","at":[12,64,20]} 指定格采木或采集；只用步行通路，不挖路，不改采附近同类。
                                                 未加载、不可见、目标变化、登记建筑或受保护时受阻；不拆登记建筑材料。未成熟作物保留。
                                                 取消可能已收割但尚未补种，须读现场后继续，不自动重放。tool 与 collect 相同。`,
    fields: [
      { key: 'block', kind: 'string', required: true, hint: '精确方块英文 id；不接受类别' },
      { key: 'at', kind: 'anchor', required: true, error: `harvest 要 at:[x,y,z](${RELATIVE_HINT})` },
      { key: 'replant', kind: 'flag' },
      { key: 'tool', kind: 'string' },
    ],
  },
  {
    name: 'fish',
    doc: `{"skill":"fish"}                                 钓一竿:12 格内的水面里优先选开阔水域(周围 5×5 至少 2 格深、离岸 ≥3 格,宝藏只在这种水里出),没有才钓岸边并说明;
                                                 从干燥岸上抛竿；人在水中时会先择岸，找不到岸就停。不必先 goto 水格。45 秒没上钩就收竿(浮标头顶看不到天时 60 秒);
                                                 加 "at":[x,y,z] = 指定水面方块，不是岸上站位或河底；不写则根据当前观察选水面。浮标归属按服务端确认，不认其他玩家的浮标。
                                                 抛竿角度按弹道计算，浮标未落水会换角度；收线后最多观察6秒，核对本人拾取与背包稳定净增。失败回执区分无咬钩、收竿未确认与鱼获未入包，并给出附近掉落物及站位事实。
                                                 鱼获滞留4格内时，最多用2.5秒沿已加载干燥短路走近回收，不挖、不搭、不下水；无安全路径则返回具体现场，不自行重抛。
                                                 多竿批次要根据上一竿结果调整时，用 needs 声明依赖，或先提交一竿等回执；不要把失败后仍继续执行的独立步骤当作已经复盘`,
    fields: [
      { key: 'at', kind: 'anchor', error: `fish 的 at 要 [x,y,z](水面那一格;${RELATIVE_HINT})` },
    ],
  },
  {
    name: 'tunnel',
    doc: `{"skill":"tunnel","at":["~","~-10","~30"]}       从脚下朝那一格挖一条 1 宽 2 高的通道,斜着自动成楼梯;
                                                 坡度超 45° 不接。走到终点才算挖通,没走到就报断在哪一格。
{"skill":"tunnel","at":["~","~-30","~"]}         终点在正下方 = 竖井,一格一格往下挖(下面塌空就停,不往下掉;竖井是单程的,回不来)
{"skill":"tunnel","at":["~","~12","~"]}          终点在正上方 = 塔,一格一格垫上去(垫脚料见 mc_policy)
{"skill":"tunnel","at":["~","~-30","~"],"spiral":true}
                                                 正上/正下 + "spiral" = 螺旋楼梯:绕脚下 2×2 井筒边挖边转,每格升降 1,
                                                 挖完上下都能走——下矿要能自己走回来就用这个,别用竖井
{"skill":"tunnel","at":["~","~-30","~"],"until":["#ores"]}
                                                 加 "until" = 挖的路上周围碰到这里头任何一样就停下来报坐标(算做完,
                                                 不再往终点挖)。名单写方块英文 id,也认类别 ${UNTIL_CATEGORY_DOC}。
                                                 tool 不写=节约耐久;"fastest"=本步最快;物品 id=本步精确指定`,
    fields: [
      { key: 'at', kind: 'anchor', required: true, error: `tunnel 要 at:[x,y,z](通道终点;${RELATIVE_HINT})`, doc: '通道终点' },
      { key: 'spiral', kind: 'flag', doc: '正上/正下时改挖 2×2 螺旋楼梯(上下都能走)' },
      { key: 'dryRun', kind: 'flag' },
      { key: 'tool', kind: 'string', hint: '物品英文 id 或 fastest', doc: '只覆盖本步;不写时节约耐久' },
      {
        key: 'until', kind: 'names', hint: `方块英文 id 或类别 ${UNTIL_CATEGORY_DOC}`,
        doc: '挖的路上碰到这里头任何一样就停',
      },
    ],
  },
  {
    name: 'build',
    inputHint: '材料放置：material+anchors（坐标数组）或 material+on（参照格/面）；单格可用 material+at，不能再给 anchors/on/shape。蓝图施工：blueprint+at，at 是蓝图原点。',
    doc: `{"skill":"build","material":"torch","on":[{"at":[103,63,-31],"face":"up"}]}
                                                 贴着 at 那一格的 face 面放,新方块落在那一面的外侧;
                                                 face 认 ${FACE_NAMES.join('/')},一步最多 ${PLACE_SPOTS_MAX} 处
{"skill":"build","material":"torch","anchors":[[103,64,-31]]}
                                                 直接点格子:**不写 shape = 就这些格**(1-${PLACE_SPOTS_MAX} 个),贴哪一面由我挑;
                                                 单格也收 material+at:[x,y,z]，受理时明说转成 anchors；不与 anchors/on/shape 同用。
                                                 那一格已经是这个方块就直接算做好。
                                                 给 shape + 多锚点就按形状连片搭:line 2 个、rect 2 个(轴对齐的面,
                                                 两锚点须有一轴相等)、triangle 3 个、arc 3 个(过三点的弧)、
                                                 box 2 个(对角,fill: solid 实心/outline 只有外壳/edges 只有 12 条棱;
                                                 outline 不清内部,原版 /fill 的 hollow 那个模式这里没有)。
                                                 一单最多 256 块;材料用完或贴不住就停在那。
                                                 dryRun 试算:要动几块、材料够不够
                                                 临时支撑另加 temporary:true；只登记本次确认放成的实心方块，已有方块不接管。
                                                 使用完移到稳定地面后 cleanup；仍承重、够不到或来源失效的保留并回报。
{"skill":"build","blueprint":"home-v2","at":[100,64,-30]}
                                                 按 mc_blueprint 装载着的那张图施工。**at 是蓝图 [0,0,0] 落在世界的哪一格**,
                                                 第一次要给,续建省略(接着上次那个锚点往下施工)。
                                                 改绑到新位置须给 "rebindFrom":[旧x,旧y,旧z]，执行时与当前绑定核对；confirm 只确认清场。
                                                 开工前先跟世界对一遍账:已经对上的格子跳过,只做差的那些;
                                                 料用完就停在那儿。完成(或阶段停)会逐格回读验收。
                                                 加 "stopAfter":2 = 施工到第 2 层(y 层号,0 是最低层)就收工;
                                                 retrofit 初探报出冲突后,审阅无误可加 "confirm":true 清掉那些冲突格再施工;
                                                 或加 "skipConflicts":true 把冲突格原样留着、先放能放的(回执点名跳过了哪几格);
                                                 dryRun 试算:冲突格、在箱/随身/还缺三分账单、手上的料能连着施工到第几步`,
    parse: parseShaped('build'),
    fields: [
      {
        key: 'blueprint', kind: 'string',
        hint: 'mc_blueprint 装载着的键', doc: '按蓝图施工;形状与材料都在图里',
      },
      {
        key: 'stopAfter', kind: 'int', lo: 0, hi: Number.MAX_SAFE_INTEGER, def: 0,
        doc: '按蓝图施工时:做到这个 y 层就收工(0 是最低层)',
      },
      {
        key: 'rebindFrom', kind: 'opaque',
        schema: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 },
        doc: '按蓝图施工改绑到新 at 时，给出当前绑定的绝对锚点；dryRun 可先试算新位置',
      },
      { key: 'confirm', kind: 'flag', doc: 'retrofit 有冲突时:确认清掉冲突格后施工' },
      { key: 'skipConflicts', kind: 'flag', doc: 'retrofit 有冲突时:留着冲突格,先放能放的' },
      {
        key: 'shape', kind: 'enum', values: SHAPE_NAMES,
        error: `build 的 shape 要是 ${SHAPE_NAMES.join('/')} 之一`, doc: '不写 = 就 anchors 那些格',
      },
      {
        key: 'on', kind: 'opaque',
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: { at: { ...ANCHOR_SCHEMA }, face: { type: 'string', enum: [...FACE_NAMES] } },
            required: ['at', 'face'],
          },
          minItems: 1, maxItems: PLACE_SPOTS_MAX,
        },
        doc: '贴着 at 那一格的 face 面放;与 anchors 二选一',
      },
      {
        key: 'anchors', kind: 'opaque',
        schema: { type: 'array', items: { ...ANCHOR_SCHEMA }, minItems: 1, maxItems: PLACE_SPOTS_MAX },
        doc: '不写 shape = 就这些格;与 on 二选一',
      },
      // 三形态里两形态必填;蓝图形态一个都不收,由 parse 钩子裁决(required 只进文档)
      { key: 'material', kind: 'string', required: true, hint: '方块英文 id' },
      { key: 'temporary', kind: 'flag', doc: '只用于材料/锚点或贴面形态；本次确认的临时支撑用完后 cleanup，已有方块不接管' },
      {
        key: 'at', kind: 'anchor',
        error: `build 的 at 要 [x,y,z](蓝图 [0,0,0] 落在世界的哪一格;${RELATIVE_HINT})`,
        doc: '蓝图施工时是原点；无 blueprint 的单格材料放置可作 anchors:[at] 别名，不与 anchors/on/shape 同用',
      },
      { key: 'fill', kind: 'enum', values: ['solid', 'outline', 'edges'], error: 'fill 只认 solid/outline/edges', doc: '只对 box 有意义' },
      { key: 'dryRun', kind: 'flag' },
    ],
  },
  {
    name: 'excavate',
    doc: `{"skill":"excavate","shape":"box","anchors":[[160,-58,95],[168,-52,102]]}
                                                 按形状挖空间,shape/锚点同 build。一单最多 512 块;
                                                 紧贴液体的格子不挖。tool 不写=节约耐久;"fastest"=本步最快;
                                                 物品 id=本步精确指定,都不改长期设置`,
    parse: parseShaped('excavate'),
    fields: [
      {
        key: 'shape', kind: 'enum', values: SHAPE_NAMES, required: true,
        error: `excavate 的 shape 要是 ${SHAPE_NAMES.join('/')} 之一`,
      },
      {
        key: 'anchors', kind: 'opaque', required: true,
        schema: { type: 'array', items: { ...ANCHOR_SCHEMA }, minItems: 2, maxItems: 3 },
        doc: '数量由 shape 定',
      },
      { key: 'fill', kind: 'enum', values: ['solid', 'outline', 'edges'], error: 'fill 只认 solid/outline/edges' },
      { key: 'dryRun', kind: 'flag' },
      { key: 'tool', kind: 'string', hint: '物品英文 id 或 fastest', doc: '只覆盖本步;不写时节约耐久' },
    ],
  },
  {
    name: 'probe',
    inputHint: '定位目标用 shape+anchors+where；空间切片用 shape:"box"+anchors+slice（x/y/z），不带 where，fill 省略或 solid。不要把两种观察混在同一步。',
    doc: `{"skill":"probe","shape":"line","anchors":[["~","~2","~"],["~","~80","~"]]}
                                                 只看不动:读出你圈的这片形状里的材质构成与液体;27 格以内
                                                 逐格报「(x,y,z):方块」,作物带 age，耕地带 moisture，水/岩浆带 level/source；梯子、台阶、门等带朝向、开合等已读通行属性。短 line 同时列空气坐标，可核对梯段或支撑的断档。
                                                 大区域与 where 另列 level=0 的源方块坐标；空桶装液体先核对源格。圈哪片由你定
{"skill":"probe","shape":"box","anchors":[["~-2","~","~-2"],["~2","~4","~2"]],"slice":"y"}
                                                 slice 保留每格位置：y=水平各层，z=各正截面，x=各侧截面；世界坐标轴，不随镜头转。
                                                 须用 box、fill:solid(可省略)，不与 where 同用，每次最多 ${PROBE_SLICE_CELL_CAP} 格；过长时缩小范围。
                                                 附读取时间、维度、脚下坐标和碰撞箱；.. 是已读空气，?? 是未观察（遮挡、超距或未加载），不能当成空气。
{"skill":"probe","shape":"box","anchors":[[-40,40,-120],[-8,60,-88]],"where":["spawner","#chests"]}
                                                 加 "where" = 只报这几样在这片里的坐标(按远近,每样最多 ${PROBE_WHERE_SHOWN} 处)。
                                                 同样受视线和观察距离约束；未见的箱子、矿脉等保持未知，不含特殊探测技能结果。名单认 ${UNTIL_CATEGORY_DOC}`,
    parse: parseShaped('probe'),
    fields: [
      {
        key: 'shape', kind: 'enum', values: SHAPE_NAMES, required: true,
        error: `probe 的 shape 要是 ${SHAPE_NAMES.join('/')} 之一`,
      },
      {
        key: 'anchors', kind: 'opaque', required: true,
        schema: { type: 'array', items: { ...ANCHOR_SCHEMA }, minItems: 2, maxItems: 3 },
        doc: '数量由 shape 定',
      },
      { key: 'fill', kind: 'enum', values: ['solid', 'outline', 'edges'], error: 'fill 只认 solid/outline/edges', doc: '只对 box 有意义' },
      { key: 'slice', kind: 'enum', values: SPATIAL_SLICE_AXES, error: 'slice 只认 x/y/z', doc: `box 空间切片；体积=(|dx|+1)(|dy|+1)(|dz|+1)≤${PROBE_SLICE_CELL_CAP}，不与 where 同用` },
      {
        key: 'where', kind: 'names', hint: `方块英文 id 或类别 ${UNTIL_CATEGORY_DOC};实体 id 按收到的实体表报`,
        schema: { type: 'array', items: { type: 'string' } },
        doc: '定位模式：只报指定种类在范围内当前可见的坐标，不与 slice 同用；名单去重，不套用 until 的项数上限；遮挡、超距或未加载保持未知',
      },
    ],
  },
  {
    name: 'observe',
    doc: `{"skill":"observe","mode":"sites","sites":[[103,64,-31],[104,65,-31]]}
                                                 施工/落脚前的短诊断，1-${SPATIAL_OBSERVATION_LIMITS.sites} 个绝对整数格：target 实际占用，below.topY 下格最高碰撞面，topArea 在目标底面的面积比。
                                                 告示牌目标另附 sign：已收到的正反面原文；null 未收到/不支持，不是空白。只读，不开编辑框、不写字。
                                                 faces 是邻格碰撞面：ref+face方向=目标格；area 为格边界上的面积比，0 省略，null 未知。几何面积不代替物品放置规则或权限。
                                                 body 是以目标格水平中心为脚点的 0.6×1.8 净空；计入邻格延伸形状，clear:null 表示未知。blockers/fluids 为总数，hits/fluidHits 各最多3项；液体按格另报，实体不在此检查。
                                                 不试走、不试放、不验证支撑稳定性；每格检查当前实况，不投影先前施工。需要原始形状再查 voxels，长距离遮挡用 rays，地形剖面用 probe.slice，外观用 mc_visual。
{"skill":"observe","mode":"voxels","bounds":[-2,-1,-2,2,3,2]}
                                                 按 MineDojo 的局部体素观测方式，直接读当前连接已加载方块，不需图像估深。
                                                 bounds 是相对执行时脚下格的 [xmin,ymin,zmin,xmax,ymax,zmax]，含端点；省略为 [-1,-1,-1,1,2,1]。
                                                 默认 format:visible，只返回实际视线可见的非空气表面，不展开遮挡内部格或空气格。blocks 每项 [绝对x,y,z,palette索引]，palette 保存实际材质/状态/碰撞形状。
                                                 遮挡/超距说明为“不可见”，invisibleCount 汇总；未加载 unloadedCount、细节未返回 omittedDetailCount 单列。不因未返回而推断目标不存在或路线安全。
                                                 按固定原点由近到远检查，每页最多${SPATIAL_OBSERVATION_LIMITS.visibleScans}格可见性、最多${SPATIAL_OBSERVATION_LIMITS.cells}个表面；coverage 的 scanned/remaining/returnedCount 与 next 明示覆盖，不自动续读。
                                                 需要逐格碰撞数组时显式 format:dense：以下连续长方体/ dense cells 说明仅适用于该格式。默认表面格式不返回 cells/-1网格。
                                                 每项 ±${SPATIAL_OBSERVATION_LIMITS.offset}；一次返回最多${SPATIAL_OBSERVATION_LIMITS.cells}格的连续区域。体积超限直接返回真实部分数据 status:partial，不需先失败重试；文本预算不足时区域更小。
                                                 coverage 报原请求/本页绝对边界、固定 origin、请求/已返回/本页/剩余格数与 partialReasons；bounds 对应本页 dense cells，未返回部分不作地形判断。complete 只说明本页后是否还有剩余且本页无不可见/未加载/省略，不证明整个世界已知或游戏目标完成。
                                                 next 为可直接调用的 mc_scout 参数；续读仅给 mode:voxels,cursor，不带 bounds。按问题决定是否续读，不自动读全。cursor 绑定原点和本连接/维度/重生，移动不会改原点；作用域变化会明确拒绝，不自动重定位。
                                                 每页 observedAt 是该页实际读取时间，不是同一时刻快照；回执另附当前眼位、朝向。读取顺序为原区域 y,z,x 递增（x最快），先返回剩余扫描序列的连续长方体，不保证恰好${SPATIAL_OBSERVATION_LIMITS.cells}格。
                                                 palette 保留方块状态、属性与真实格内碰撞箱；cells 按 y,z,x 展开(x 最快)，-1 是不可见、未加载或细节未返回；无碰撞不证明安全可走或有支撑。
{"skill":"observe","mode":"rays","rays":[[0,0,24],[15,30,16],[-15,-30,16]]}
                                                 从执行时眼位发射碰撞射线，每组 [相对pitch角,相对yaw角,最大距离]；角度用度，相对执行时身体朝向叠加，pitch 正值向上，yaw 正值向左，yaw=0 沿当前朝向。
                                                 pitch ±90、yaw ±180；最多 ${SPATIAL_OBSERVATION_LIMITS.rays} 条，每条距离 >0 且 ≤${SPATIAL_OBSERVATION_LIMITS.range} 格；省略 rays 为三行五列、24 格的扇面。
                                                 terrain 报首个方块碰撞或未知，entity 报本连接已知实体的最近包围箱交点，first 比较两者；未知区不能当无遮挡。
                                                 计入相邻格延伸的碰撞形状，邻格未知也停止确认；液体和纹理不遮挡碰撞射线，实体箱不是皮肤模型深度。
                                                 所有模式均只读，按需缩小范围；数据只在本次调用复用，不常驻全量地图。`,
    parse: (c, at) => {
      const parsed = parseSpatialObservation(c);
      return 'error' in parsed ? { error: `${at} ${parsed.error}` } : { step: { skill: 'observe', ...parsed } };
    },
    fields: [
      { key: 'mode', kind: 'enum', values: ['sites', 'voxels', 'rays'], required: true, error: 'mode 要 sites/voxels/rays' },
      { key: 'format', kind: 'enum', values: ['visible', 'dense'], error: 'format 要 visible/dense',
        doc: '仅 voxels，默认 visible：稀疏可见表面，过滤空气与遮挡内部格，非可见说明为不可见；显式 dense 才返回逐格数组。cursor 续读保持原格式' },
      { key: 'sites', kind: 'opaque', schema: { type: 'array', minItems: 1, maxItems: SPATIAL_OBSERVATION_LIMITS.sites,
        items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: -30_000_000, maximum: 30_000_000 } } },
        doc: 'sites：绝对格 [x,y,z] 列表，短报占用/支撑高度/邻接面/0.6×1.8方块净空；非可达或放置许可' },
      { key: 'bounds', kind: 'opaque', schema: { type: 'array', minItems: 6, maxItems: 6,
        items: { type: 'integer', minimum: -SPATIAL_OBSERVATION_LIMITS.offset, maximum: SPATIAL_OBSERVATION_LIMITS.offset } }, doc: `voxels 相对执行时脚下格 [xmin,ymin,zmin,xmax,ymax,zmax]，含端点；超${SPATIAL_OBSERVATION_LIMITS.cells}格直接返回 partial 与 next，非整单失败；与 cursor 互斥` },
      { key: 'cursor', kind: 'opaque', schema: { type: 'string', maxLength: 1024 },
        doc: '仅 voxels：原样使用 next.arguments 中的续读字符串，与 bounds 互斥；固定原区域，逐页新现场，不自动续读或重定位' },
      { key: 'rays', kind: 'opaque', schema: { type: 'array', minItems: 1, maxItems: SPATIAL_OBSERVATION_LIMITS.rays,
        // The MCP validator uses draft-07 tuples; declare the nested dialect so
        // newer host validators interpret these positional bounds identically.
        items: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', minItems: 3, maxItems: 3,
          items: [{ type: 'number', minimum: -90, maximum: 90 }, { type: 'number', minimum: -180, maximum: 180 },
            { type: 'number', exclusiveMinimum: 0, maximum: SPATIAL_OBSERVATION_LIMITS.range }] } },
        doc: `rays 的 [相对pitch角±90,相对yaw角±180,距离>0且≤${SPATIAL_OBSERVATION_LIMITS.range}] 列表；相对执行时身体朝向，yaw=0 沿当前朝向` },
    ],
  },
  {
    name: 'use',
    doc: `{"skill":"use","at":[103,64,-31]}
                                                 右键世界里已有的那一格:开门、拉杆、按钮、开箱子看一眼、点床睡觉。优先空手；满包时功能方块可用普通无自定义名称的工具，不丢主手物品。
                                                 门、活板门或栅栏门可给 open:true 开启、open:false 关闭；已符合就保持，不反复翻转。回执核验期望状态。
                                                 at 是要点击的方块坐标；item 是从背包拿在手里的物品，不是被点击方块的名字。
                                                 点击已有方块不要求包里有同名物品。查看方块容器后会关窗；要取物直接用 take at 点名方块。
{"skill":"use","item":"flint_and_steel","at":[103,64,-31]}
                                                 拿着打火石右键那一格；其他手持工具同理，如空桶装水、锄头翻地、骨粉催熟。
                                                  炉子装料点火用 smelt(input 原料、fuel 燃料、at 炉位)；手持材料右键炉子只打开窗口，不会装入槽位。
                                                  物品打开的自定义容器也会在每单结束时关闭；搬运须在同一 mc_do.steps 内先 use 再 take/stow/compact。
                                                  给 at 且不写 item = 腾空主手后右键方块；满包无法腾手时受阻，不丢物品。
                                                 加 "times":5 = 连着右键 5 次(最多 16)。
                                                 at 是被点击的参照格，face 是其表面；上面一格是 at+[0,1,0]，下面一格是 at+[0,-1,0]。
                                                 use 是右键交互，不能挖掉石头、苔藓或其他方块；破坏方块用 dig 并查其帮助。
                                                 右键完成只证明点击流程已结束。重复操作先核对 observedEffect 可见变化；需要验证具体结果时给 expect（如 block:"air",at:[x,y,z]），未知读数不是空气。放方块/床用 build 的 anchors 指定目标格并核验；船/竹筏是物品生成实体，走下面的 use，不走 build。
{"skill":"use","item":"oak_boat","at":[103,64,-31]}
                                                 放船：at 指已观察的水面/落点；回执分别核对背包船数量与附近船实体。没有船时先 craft 对应物品；水域、空位或区块未知时先观察。上船、驾驶、下船读 ride 帮助。
{"skill":"use","item":"water_bucket","at":[-185,70,61]}
                                                 满桶由服务端沿视线选落点。at 是瞄准参照格；实心格瞄其 face 表面，顶面通常落在 at+[0,1,0]，不是参照格本身。
                                                 灌溉先挖田边水槽，把水放在槽内；对种着作物的耕地顶面倒水可能冲掉作物。先供水并核验，再播种。
                                                 回执分别报告空桶库存与点击格、面外格前后读数；桶倒空不证明落点正确或农田已灌溉。
                                                 水坑坐标为[x,y,z]时，对坑底[x,y-1,z]的up面放水；同高土层围住水坑，放水后核验坑格为water且level=0。
                                                 收水用空桶点水源格本身；level>0是流水，点下方耕地不能收上方水。作物格被水覆盖时先收源水，不继续播种。
                                                 倒水走这条,build 的 material 不认水桶
{"skill":"use","item":"shears","target":"sheep"} 右键活物:剪毛、挤奶、喂食、上鞍。
                                                 target 不写 item = 用手上现在拿着的。写 villager/wandering_trader = 看报价菜单(只看不买);
                                                 再带 "index":1,"times":2 = 按菜单 1 号成交 2 次
                                                 喂鸡用 wheat_seeds，驯狼用 bone、喂狼用肉，驯猫/喂猫用 cod 或 salmon。
                                                 多只同类可带现场读到的 entityId 精确点一只；ID 只在当前连接有效，失效后重新观察，不会改点别只。
{"skill":"use","item":"potion"}                  只给 item:对自己/面前用,喝药水。
                                                 投掷类(喷溅药水、末影珍珠、雪球、鸡蛋、三叉戟)再给 at = 朝那一格扔
{"skill":"use","item":"bow","at":[12,70,-5]}     满弓朝那一格的中心射一支普通箭,不用走过去。回执报箭插在哪、
                                                 那一格变没变;路上有别的方块挡着就受阻
{"skill":"use","item":"ender_eye"}               扔末影之眼:回执报扔出点、飞了多远、方位角(正北 0°、正东 90°)、落没落地。
                                                 at 指末地传送门框架 = 把眼放进框,回执报这一圈几个框放了眼、门开没开
{"skill":"use","at":[-147,72,101],"text":"欢迎来我家\\n可缇"}
                                                 **往告示牌上写字**:先 build 把牌子放上,再用这条写。
                                                 \\n 分行,最多 4 行、每行 45 字符;写完读回牌子上的字进回执。
                                                 手上拿着染料/墨囊/蜂巢时右键做的是改色/发光/上蜡,先空手
{"skill":"use","item":"item_frame","at":[-147,72,101],"face":"north"}
                                                 face = 右键那一格的哪一面(缺省顶面)。画只能贴侧面`,
    parse: parseUse,
    fields: [
      { key: 'item', kind: 'string', doc: '从背包拿在手里使用的物品，不是被点击对象的名字。填原版英文 id 或 mc_bag 的自定义显示名；有 at 时不写 = 腾空主手右键方块，有 target 时不写 = 用当前手持物' },
      { key: 'at', kind: 'anchor', error: `use 的 at 要 [x,y,z](${RELATIVE_HINT})`, doc: '世界里要点击的方块绝对坐标，点击已有方块不要求背包有同名物品；face 指它的表面；放置目标用 build.anchors；与 target 二选一' },
      { key: 'target', kind: 'string', doc: '要右键的活物名称，不是方块或背包物品；与 at 二选一。点击世界里的方块只给 at，不填 target' },
      { key: 'entityId', kind: 'int', lo: 0, hi: 2_147_483_647, def: 0, doc: '可选；本连接里观察到的实体 ID，与 target 一起给，精确点该实体，不退回最近者' },
      { key: 'index', kind: 'int', lo: 1, hi: 99, def: 1 },
      { key: 'times', kind: 'int', lo: 1, hi: USE_TIMES_MAX, def: 1, doc: '连着右键几次;带 index 时是成交几次' },
      { key: 'open', kind: 'flag', doc: '门、活板门、栅栏门的期望状态；true 开、false 关，已符合不点击；与 at 一起给' },
      { key: 'text', kind: 'string', doc: `写在告示牌上的字,\\n 分行;最多 ${SIGN_LINES} 行、每行 ${SIGN_LINE_CHARS} 字符` },
      { key: 'back', kind: 'flag', doc: '写在牌子背面;缺省正面' },
      { key: 'face', kind: 'enum', values: FACE_NAMES, error: `use 的 face 要是 ${FACE_NAMES.join('/')} 之一`, doc: '右键那一格的哪一面;缺省顶面' },
    ],
  },
  {
    name: 'ride',
    doc: `{"skill":"ride","target":"pig","to":[120,64,-30]}
                                                 骑上坐骑并驾着走。能驾的是猪(要鞍、胡萝卜钓竿)、炽足兽(要鞍、诡异菌钓竿)和船。
                                                 马/驴/骡可空手上骑、尝试驯服和下车；尚不支持驾驶。坐上去不证明驯服成功。
                                                 to 只认水平目的地,到目标 2.5 格内算到;20 秒零推进会自己下来并报走到哪。
{"skill":"ride","target":"boat"}                 只骑上不走;之后驾驭再来一步 {"skill":"ride","to":[x,y,z]}
                                                 较长水路可比较乘船、游泳、走桥或绕行；已有船先用，没有再核对 craft 材料和工作台，用 use 放船。1.21.1 的 oak_boat 是物品，boat 是实体；target 以当前版本与现场观察为准。
                                                 先选已观察的水路与上岸点，分段驾到岸边再下船；骑着时 goto 不会驾船。放船、乘上、驶过水面和安全上岸分别核验，不把接口存在当作已经学会。
{"skill":"ride","off":true}                      从坐骑上下来。骑着的时候寻路器不管坐骑,goto 走不了`,
    parse: parseRide,
    fields: [
      { key: 'target', kind: 'string', doc: '骑上哪种(实体英文 id:pig/boat/horse…);已骑着时可省' },
      { key: 'entityId', kind: 'int', lo:0,hi:2_147_483_647,def:0,doc:'与target一起指定本连接实体ID；只骑这只，不退回同类最近者' },
      { key: 'to', kind: 'anchor', error: `ride 的 to 要 [x,y,z](${RELATIVE_HINT})`, doc: '驾着去哪;猪、炽足兽和船能驾，马科暂不支持驾驶' },
      { key: 'off', kind: 'flag', doc: '下坐骑;与 target/to 互斥' },
    ],
  },
  {
    name: 'lead',
    doc: `{"skill":"lead","target":"cow","to":[-146,71,103],"tolerance":3}
                                                 **拴绳牵动物**:包里要有拴绳(lead)。走到最近的那只跟前拴上,
                                                 分段牵着走到 to,到了就松开,它留在那儿。
                                                 tolerance = 牵到 to 多少格内算到(缺省 3;绳是软的,拉不到落脚点上)。
                                                 路上它掉队会停下等;绳绷断(超 10 格)当场停下报断在哪儿。
                                                 拴不上的:村民、幼崽以外的敌对生物、别人已经牵着的
{"skill":"lead","target":"cow","to":[...],"tie":[-145,67,103]}
                                                 牵到了再**系到 tie 那一格的栅栏上**——这样它才真的圈住了,
                                                 松开只是它暂时站那儿
{"skill":"lead","target":"cow"}                  只拴上不牵走(之后再来一步给 to)
{"skill":"lead","to":[...],"keep":true}          把现在牵着的牵过去,到了继续牵着不松
{"skill":"lead","off":true}                      松开现在牵着的那只(绳掉在地上,记得 pickup)`,
    parse: parseLead,
    fields: [
      { key: 'target', kind: 'string', doc: '拴哪种(实体英文 id);已经牵着时可省' },
      { key: 'to', kind: 'anchor', error: `lead 的 to 要 [x,y,z](${RELATIVE_HINT})`, doc: '牵去哪' },
      {
        key: 'tolerance', kind: 'int', lo: LEAD_TOL.lo, hi: LEAD_TOL.hi, def: LEAD_TOL.def, unit: '格',
        doc: '牵到 to 多少格内算到',
      },
      { key: 'tie', kind: 'anchor', error: `lead 的 tie 要 [x,y,z](${RELATIVE_HINT})`, doc: '到了系在这一格的栅栏上' },
      { key: 'keep', kind: 'flag', doc: '到了继续牵着,不松开' },
      { key: 'off', kind: 'flag', doc: '松开;与 target/to/tie/keep 互斥' },
    ],
  },
  {
    name: 'craft',
    doc: `{"skill":"craft","item":"chest","count":1}
                                                 已知目标物品优先写 item,按游戏配方表选可用材料和摆位;1.20.6 木板等标签材料可混用不同种类。**中间材料不会自动补**。
                                                 item 模式的 count 是本次要新增的产物个数,不是原料数或合成次数;按配方产量向上取整。例如要 12 块木板写 count:12,通常用 3 根原木。材料不足时先按回执补材料,不要靠猜 grid 消耗库存。
{"skill":"craft","grid":[["charcoal"],["stick"]],"count":4}
                                                 grid 模式的 count 是重复配方次数,每次产量由实际配方决定;仅用于已知的自定合成格配方:按行写物品 ID 二维数组,空位写 null;产出槽出什么算什么。烧炼使用 smelt，不在合成格制作熟食。
                                                 2 行 2 列以内徒手就能做,更大要工作台。够得着的工作台直接用;够不着就放一个自己带的,包里没有才走去现成的。
                                                 下界合金装备走锻造台:每件要下界合金升级模板、同种钻石件、下界合金锭各 1 个，钻石件附魔与耐久保留`,
    parse: parseCraft,
    fields: [
      { key: 'item', kind: 'string', doc: '已知目标物品优先使用;按游戏配方表摆;与 grid 二选一' },
      {
        key: 'grid', kind: 'opaque',
        schema: { type: 'array', items: { type: 'array', items: { type: ['string', 'null'] } } },
        doc: '与 item 二选一',
      },
      { key: 'count', kind: 'int', lo: 1, hi: 64, def: 1, doc: 'item=要新增的产物个数(按配方产量向上取整);grid=配方重复次数。不是原料数。' },
    ],
  },
  {
    name: 'smelt',
    doc: `{"skill":"smelt","input":"raw_iron","count":8,"fuel":"charcoal"}
                                                 走到炉边下料点火就走,input 与 fuel 都必写。炉子自己烧
                                                 input 与 fuel 是从背包放入炉槽的物品；use 只查看炉子，take 取出炉中已有物品。
                                                 先确认燃料槽有物品或炉火仍在烧，再放入本次原料；未确认燃料时保留原料并报告指定物品。
                                                 入槽后等待短暂回读；有烧炼进度或新产物才确认启动，未启动则受阻并保留炉中物品。
                                                 (熔炉一件约 10 秒),烧好会有事件提醒;输出槽有成品时用 take 的 at 指着炉子取货。
                                                 够得着的炉子直接用;够不着就放一个自己带的,包里没有才走去现成的。
                                                 还烧着别的东西的炉子不挑,几座炉子可以同时各烧各的;
                                                 加 "at":[x,y,z] = 指定用那一座炉子`,
    fields: [
      { key: 'input', kind: 'string', required: true, hint: '原料英文 id' },
      { key: 'count', kind: 'int', lo: 1, hi: 64, def: 1 },
      { key: 'fuel', kind: 'string', required: true, hint: '燃料英文 id' },
      { key: 'at', kind: 'anchor', error: `smelt 的 at 要 [x,y,z](${RELATIVE_HINT})`, doc: '指定用哪一座炉子' },
    ],
  },
  {
    name: 'brew',
    doc: `{"skill":"brew","at":[x,y,z],"input":"nether_wart","bottle":"potion","count":3,"fuel":"blaze_powder"}
                                                 下料点火就走,酿一轮约 20 秒,好了有事件提醒;取货用 take 的 at 指着酿造台。
                                                 **水瓶与所有药水的物品 id 都是 potion**;包里和回执在括号里写装的是什么(水瓶、粗制的药水、抗火·延长)。
                                                 回执报台里燃料还能烧几轮、在不在酿;下完料没开酿会直接受阻。
                                                 燃料只吃烈焰粉(一份烧 20 轮),煤不行。
                                                 材料链三段跳不过:水瓶 →(地狱疣)→ 粗制药水 →(效果材料)→ 基础药水
                                                 →(红石延时 / 萤石粉加强 / 火药变喷溅 / 龙息变滞留)。
                                                 红石与萤石粉互斥,同一瓶不能既加强又延时。
                                                 玻璃瓶装水:{"skill":"use","item":"glass_bottle","at":水源那一格}`,
    fields: [
      { key: 'input', kind: 'string', required: true, hint: '这一轮加的材料英文 id' },
      { key: 'bottle', kind: 'string', required: true, hint: '瓶子英文 id(水瓶和药水都是 potion;空玻璃瓶放进去酿不出东西)' },
      { key: 'count', kind: 'int', lo: 1, hi: 3, def: 3, doc: '放几瓶(三个瓶位)' },
      { key: 'fuel', kind: 'string', required: true, hint: '燃料英文 id(原版只吃 blaze_powder)' },
      { key: 'at', kind: 'anchor', error: `brew 的 at 要 [x,y,z](${RELATIVE_HINT})`, doc: '指定用哪一座酿造台' },
    ],
  },
  {
    name: 'enchant',
    doc: `{"skill":"enchant","at":[x,y,z],"item":"diamond_pickaxe"}
                                                 走到附魔台边,把东西放上去**只看三档报价,不下手**。
                                                 回执报三档各要多少级、多少青金石、显示出来的那条附魔,以及周围有效书架。
{"skill":"enchant","at":[x,y,z],"item":"diamond_pickaxe","index":3}
                                                 按第 N 档下手(1/2/3 = 上中下三格)。
                                                 「需 N 级」是**门槛**;真扣掉的是档位号那么多级与同样多的青金石(1/2/3)。
                                                 原版下手前每档只显示一条附魔,别的要下手才知道。
                                                 已经附过魔的东西附魔台不接;书架要隔一格、同高或高一格,中间那格必须空着`,
    parse: parseEnchant,
    fields: [
      {
        key: 'at', kind: 'anchor', required: true,
        error: `enchant 要 at:[x,y,z](${RELATIVE_HINT}),指着附魔台那一格`,
      },
      { key: 'item', kind: 'string', required: true, hint: '要附魔的物品英文 id' },
      { key: 'index', kind: 'int', lo: 1, hi: 3, def: 1, doc: '不写 = 只看报价;写了 = 按那一档下手' },
    ],
  },
  {
    name: 'anvil',
    doc: `{"skill":"anvil","op":"combine","item":"iron_pickaxe","with":"iron_pickaxe"}
                                                 铁砧:两件同种合修(耐久相加+12%),或本体+附魔书。
                                                 op:"repair" 与 combine 同义。**花的是经验等级**,回执报实扣几级;
                                                 已有名字不限制修理；用 pick 点名那件装备，不填 name 保留服务端原名和属性。
                                                 repair/combine 可同时填 name 改名，不必拆成两次。产物、附魔和花费以服务端为准。
                                                 等级不够时产出拿不走,回执会说门槛。铁砧每用一次有 12% 概率磨损一级
{"skill":"anvil","op":"rename","item":"iron_sword","name":"新名字"}
                                                 改名(最多 ${ANVIL_NAME_MAX} 字符)。at 不写就用附近 16 格内的铁砧
{"skill":"anvil","op":"combine","item":"bow","with":"enchanted_book","withPick":"无限"}
                                                 包里有好几本附魔书(同一个 id)时,靠 pick/withPick 点名要哪一本:
                                                 写清单括号里的字。不点名 = 撞上哪件算哪件`,
    parse: parseAnvil,
    fields: [
      { key: 'op', kind: 'enum', values: ['repair', 'combine', 'rename'], required: true, error: 'anvil 的 op 只认 repair/combine/rename' },
      { key: 'item', kind: 'string', required: true, hint: '左格物品英文 id 或当前完整显示名' },
      { key: 'with', kind: 'string', doc: 'repair/combine 必写:右格放什么' },
      { key: 'name', kind: 'string', doc: 'rename 必写；repair/combine 可选:同时改成此名字，不写保留原名' },
      // 挑选词的说明只挂第一处:字段池按 (技能, doc) 逐条印,六个技能各写一遍就是印六遍
      { key: 'pick', kind: 'string', doc: PICK_DOC },
      { key: 'withPick', kind: 'string', doc: '同 pick,筛的是 with 那一格' },
      { key: 'at', kind: 'anchor', error: `anvil 的 at 要 [x,y,z](${RELATIVE_HINT})`, doc: '指定用哪一座铁砧;不写用最近的' },
    ],
  },
  {
    name: 'grindstone',
    doc: `{"skill":"grindstone","item":"iron_sword"}       砂轮:磨掉普通附魔并按原版比例**返还经验**(诅咒磨不掉);
                                                 再给 with(同种工具)= 两件合修成一件。回执报磨前磨后的耐久与附魔、
                                                 返了多少点经验。at 不写就用附近 16 格内的砂轮`,
    parse: parseGrindstone,
    fields: [
      { key: 'item', kind: 'string', required: true, hint: '要磨的物品英文 id' },
      { key: 'with', kind: 'string', doc: '合修:同种的另一件' },
      { key: 'pick', kind: 'string' },
      { key: 'withPick', kind: 'string' },
      { key: 'at', kind: 'anchor', error: `grindstone 的 at 要 [x,y,z](${RELATIVE_HINT})`, doc: '指定用哪一座砂轮;不写用最近的' },
    ],
  },
  {
    name: 'eat',
    doc: `{"skill":"eat","item":"bread"}                 吃点名的食物;item 必须写完整英文 id。食物先补饥饿；若服务端开启自然回血，饥饿达到 18/20 后生命才会逐渐恢复。低血且饥饿不足时脱离危险后吃。
                                                 战斗或撤退占用身体时这一步会排队，等脱身后执行。
                                                 回执给出进食前后的饱食度和新增或延长的状态效果。吃成功仅说明动作完成；是否有助于恢复，要结合副作用和身体读数判断，并在下次选食物时复用已验证的经验。
                                                 milk_bucket 也走这条:喝掉清光身上的状态效果,不管饱,剩个空桶`,
    fields: [{ key: 'item', kind: 'string', required: true, hint: '食物英文 id(牛奶桶写 milk_bucket)' }],
  },
  {
    name: 'attack',
    doc: `{"skill":"attack","target":"zombie"}             攻击最近的该目标。mode 不写/auto = 距离判断近战或弓(8 格切弓、5.5 格切回近战);
                                                 melee = 只近战;ranged = 只用弓;kite = 用弓并尽量保持 8–14 格。
                                                 ranged/kite 没有可用弓箭或看不见目标时会受阻,不会暗换近战;
                                                 auto 在 8 格外这一箭射不出(被挡、没弹道等)也受阻收手,换站位再下单。
                                                 end_crystal / ender_dragon 在 128 格内找,其余 32 格`,
    fields: [
      { key: 'target', kind: 'string', required: true, hint: '实体英文 id 或玩家名' },
      {
        key: 'mode', kind: 'enum', values: ['auto', 'melee', 'ranged', 'kite'],
        error: 'attack 的 mode 只认 auto/melee/ranged/kite',
        doc: '不写 = auto',
      },
    ],
  },
  {
    name: 'equip',
    doc: `{"skill":"equip","item":"stone_sword"}           手持物品;盔甲、鞘翅、盾牌和不死图腾会自动放进对应装备槽。
{"skill":"equip","item":"filled_map","hand":"off"}  hand 指定哪只手:off = 副手,main = 主手;写了就不按物品自动分槽。
                                                 不写 item = 把那只手腾空(默认主手;骑马、上鞍这类要空手的动作用它)`,
    parse: parseEquip,
    fields: [
      { key: 'item', kind: 'string', hint: '物品英文 id 或背包显示名', doc: '自定义物品可用 mc_bag 中的显示名;不写 = 把指定手腾空，默认主手' },
      { key: 'pick', kind: 'string' },
      { key: 'hand', kind: 'enum', values: ['main', 'off'], error: 'equip 的 hand 只认 main/off', doc: '不写 = 按物品分槽' },
    ],
  },
  {
    name: 'pickup',
    doc: '{"skill":"pickup","item":"cobblestone"}          拾取附近掉落物;item 可选,不写就近扫;按目标物品实际入包验收,靠近后零入包报受阻',
    fields: [{ key: 'item', kind: 'string', doc: '不写就近扫并避开2分钟内刚主动丢弃的已识别掉落物；明确写物品可取回' }],
  },
  {
    name: 'toss',
    doc: `{"skill":"toss","item":"cobblestone","count":64} 把物品抛到地上,不会销毁。不写 at = 优先朝已测较开阔方向抛,
                                                 由你判断保留、储存或丢弃哪些物品；可连续丢弃多类不再需要的物品，不必先存箱子。
                                                 实际落点由服务端计算;走近仍可能自动捡回。用库存净减少与空槽变化核验腾格，不把抛出当销毁。
                                                 未点名玩家的主动抛物会暂时排除于未指定物品的 pickup；明确点名物品可取回。
{"skill":"toss","item":"gold_ingot","at":[12,32,10]}
                                                 **朝那一格扔**:以物易物把金锭扔到猪灵脚边、
                                                 把东西放到指定的地方。最远约 8 格,远了先走近。
                                                 抛物线的落点由服务端算,回执只说朝哪儿扔的。
{"skill":"toss","item":"cobblestone","count":8,"target":"玩家名"}
                                                 赠物点名当前可见玩家，距离2–4格；与at互斥。领取须拾取事件确认，未知不重投。
                                                 普通丢弃不要求4格空隙，也允许近距离at；没有已测空隙时按当前朝向丢弃并明确报告未知，可能碰壁或捡回。
                                                 赠物target仍按可见性和2–4格距离核对。不代表放置矿车/方块。`,
    fields: [
      { key: 'item', kind: 'string', required: true, hint: '物品英文 id' },
      { key: 'count', kind: 'int', lo: 1, hi: 64, def: 1 },
      {
        key: 'at', kind: 'anchor', error: `toss 的 at 要 [x,y,z](${RELATIVE_HINT})`,
        doc: '朝那一格扔；不写优先选已测较开阔方向，没有已测空隙则按当前朝向丢弃并报告未知',
      },
      { key: 'pick', kind: 'string' },
      { key: 'target', kind: 'string', doc: '可见玩家的完整名字；与at互斥' },
    ],
  },
  {
    name: 'stow',
    doc: `{"skill":"stow","item":"cobblestone","count":64} 存进附近箱子(32 格内)。先找上次看见还有空位的,没有就开最近没开过的;放不下的换下一口接着存
{"skill":"stow","item":"cobblestone","count":64,"at":[103,63,-31]} 只存进点名坐标的箱子;目标须在已加载的 32 格内,不会改投别的箱子
{"skill":"use","item":"大背包"},{"skill":"stow","item":"bread","count":32,"into":"open"}
                                                 先右键打开服务端自定义容器,再存进当前打开的窗口;into:open 不会去找地上的箱子
{"skill":"stow","item":"enchanted_book","pick":"精准采集","count":1}
                                                 同 id 的几件可按附魔、自定义名称或「耐久1550/1561」挑选。先用 mc_bag 看完整标签；同一单连续指向同一个箱子的 stow 会共用一次开窗。
                                                 仓库已满时，可自己决定保留哪些随身物、存哪些装备；有材料可合成并放置新箱子，再存放。决定舍弃的物品可用 toss，之后核对背包净变化。`,
    fields: [
      { key: 'item', kind: 'string', required: true, hint: '物品英文 id' },
      { key: 'count', kind: 'int', lo: 1, hi: 64, def: 1 },
      { key: 'pick', kind: 'string' },
      { key: 'at', kind: 'anchor', error: `stow 的 at 要 [x,y,z](${RELATIVE_HINT})`, doc: '只存进指定箱子;与 into:open 二选一' },
      { key: 'into', kind: 'enum', values: ['open'], error: 'into 只认 open', doc: 'open = 存进当前打开的窗口;不写 = 找附近箱子' },
    ],
  },
  {
    name: 'compact',
    doc: `{"skill":"use","at":[103,63,-31]},{"skill":"compact"}
                                                 整理当前打开的真实容器:只将组件完全相同、允许堆叠的物品合堆。不会碰玩家背包或把不同附魔装备混在一起；若仍满，取出多余装备另存。`,
    fields: [],
  },
  {
    name: 'organize',
    doc: `{"skill":"organize"} 自动合堆并按物品 id 和数据排序随身背包；默认不动快捷栏、装备、副手及合成格，不丢东西。
{"skill":"organize","sort":false,"includeHotbar":true} 只合堆，包含快捷栏。
{"skill":"organize","rules":[{"item":"cobblestone","keep":64,"action":"stow"},{"item":"rotten_flesh","keep":0,"action":"toss"}],"at":[103,63,-31]}
                                                 仅按给出的顺序处理指定多余物品，不额外挪动其它物品；keep 是此选择范围的保留数量，核心没有垃圾名单。存放默认附近箱子，可给 at 点名箱子，或在同一单 use 后 into:open 存进自定义背包。
                                                 带 rules 还要合堆须显式 sort:false；还要合堆并排序须显式 sort:true。服务器可能固定入口道具的位置，不应为一次取舍附带整包排序。
                                                 规则可按 pick 选具体标签；取舍会使用随身所有主背包槽（包括快捷栏），不脱装备或副手。没有规则就不会存放或丢弃。
{"skill":"use","item":"大背包"},{"skill":"organize","target":"open"} 整理当前真实储物容器，不是选择菜单或工作站输入/输出格；不自动跨容器搬物。
                                                 dryRun:true 只读当前方案；正式执行重读槽位。每次交换等待服务端槽位和光标确认，取消或确认不明会停止，保留已发生的结果；终态核对空位及物品总量。`,
    parse: parseOrganize,
    fields: [
      { key: 'target', kind: 'enum', values: ['inventory', 'open'], error: 'target 只认 inventory/open', doc: '默认 inventory；open 整理当前真实储物窗口' },
      { key: 'includeHotbar', kind: 'flag', retainFalse: true, doc: '默认 false：只整理 27 格背包；true 包含 9 格快捷栏' },
      { key: 'sort', kind: 'flag', retainFalse: true, doc: '无 rules 默认 true；有 rules 时省略则只取舍；显式 false 额外合堆、true 额外合堆和排序' },
      { key: 'dryRun', kind: 'flag', retainFalse: true, doc: '只读计划，不点击、不存放或丢弃' },
      { key: 'rules', kind: 'opaque', schema: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['item', 'keep', 'action'], properties: { item: { type: 'string', minLength: 1 },
          keep: { type: 'integer', minimum: 0 }, action: { type: 'string', enum: ['stow', 'toss'] }, pick: { type: 'string', minLength: 1 } } } },
        doc: '按顺序执行显式取舍；未指定的物品不会存放或丢弃' },
      { key: 'at', kind: 'anchor', error: 'at 要 [x,y,z]', doc: 'rules 的 stow 只存指定箱子；与 into 互斥' },
      { key: 'into', kind: 'enum', values: ['open'], error: 'into 只认 open', doc: 'rules 的 stow 存进当前容器；不写则找附近箱子' },
    ],
  },
  {
    name: 'take',
    doc: `{"skill":"take","item":"coal","count":16}        从当前楼层附近箱子或运输矿车取出。先查近处有货/未查的箱子，再去较远有货的；最多 3 个
 {"skill":"take","item":"iron_ingot","count":1,"at":[103,63,-31]} 从指定熔炉/箱子直接取；无需先 use at 开窗
 {"skill":"take","item":"furnace","count":1,"from": "open"} 只用于仍开着的自定义容器窗口,不会走向附近的箱子。同一单连续从这个窗口取多类物品,只在最后关窗
                                                 单独 use 查看结束后窗口已关闭；下一单须重新开窗，例如 steps:[{skill:"use",item:"背包显示名"},{skill:"take",item:"furnace",count:1,from:"open"}]
{"skill":"take","at":[103,63,-31],"all":true}    箱子整箱取;炉子输入槽有原料时只取输出,原料烧完后连剩余燃料一同取。要收回未烧完的原料或燃料,用 item+count 点名。
                                                 定量取物必须同时写 item 和 count,不默认数量`,
    parse: parseTake,
    fields: [
      { key: 'item', kind: 'string', hint: '物品英文 id', doc: '定量取物时与 count 一起写' },
      { key: 'count', kind: 'int', lo: 1, hi: 64, def: 1, doc: '定量取物必须显式写;不再默认成 1' },
      { key: 'at', kind: 'anchor', error: `take 的 at 要 [x,y,z](${RELATIVE_HINT})`, doc: '点名哪一格容器' },
      { key: 'from', kind: 'enum', values: ['open'], error: 'from 只认 open', doc: '从当前打开的容器窗口取;不写 = 找附近箱子' },
      { key: 'all', kind: 'flag', doc: 'at+all:true 取指定容器;炉子有原料时保留原料和燃料' },
      { key: 'pick', kind: 'string' },
    ],
  },
  {
    name: 'server_travel',
    inputHint: '核验已知传送落点；已在范围内时命令未发送。查询、加入、启动等非传送命令用 chat.text，不用当前位置充当落点。',
    doc: `{"skill":"server_travel","command":"/spawn","at":[103,64,-31],"within":3}
                                                 只在尚未抵达时发服务端传送命令并等待位置确认；成功后下一步才开始。已在目标范围内时命令未发送，只证明位置满足条件。at:["~","~","~"] 是本步开始时的当前位置，不能用来要求命令必发。查询、加入、启动等非传送命令用 chat.text，发送后仍需读服务端回执。dimension 可声明落点维度，避免另一维度同坐标误算抵达；省略时仅核对坐标。仅使用服务端已验证可用的单行命令，最多 256 字符。`,
    fields: [
      { key: 'command', kind: 'string', required: true, schema: { type: 'string', maxLength: CHAT_LENGTH_LIMIT } },
      { key: 'at', kind: 'anchor', required: true, error: `server_travel 的 at 要 [x,y,z](${RELATIVE_HINT})` },
      { key: 'within', kind: 'int', lo: 1, hi: 16, def: 3 },
      { key: 'dimension', kind: 'string', doc: '可选的落点维度(overworld/the_nether/the_end)；与 goto 的当前维度前置条件不同' },
    ],
  },
  {
    name: 'chat',
    doc: `{"skill":"chat","text":"大家好"}               发送游戏内公屏聊天，其他玩家能否收到以服务端与对方客户端为准
{"skill":"chat","text":"/msg PlayerName 你好"} 私聊指定玩家；姓名用游戏里显示的完整登录名，含跨版玩家前缀
{"skill":"chat","text":"/help"}               在游戏聊天栏输入服务端命令，结果看随后服务端消息
单条最多 256 个字符（含 / 和命令参数），不收换行或控制字符；长内容分成多条单行 chat 步骤，私聊每条重复完整的 /msg 玩家名。`,
    fields: [{ key: 'text', kind: 'string', required: true, schema: { type: 'string', maxLength: CHAT_LENGTH_LIMIT } }],
  },
  {
    name: 'gesture',
    doc: `{"skill":"gesture","name":"Alice","motion":"wave"} 朝 6 格内看得见的玩家挥手，只播放手臂动画，不攻击。
{"skill":"gesture","name":"Alice","motion":"bow"}  面向玩家短暂蹲下致意。
{"skill":"gesture","name":"Alice","motion":"nod"}  面向玩家点头。
{"skill":"gesture","name":"Alice","motion":"beckon"} 向玩家招手并短暂蹲下，表达“跟我来”；之后可接 chat 和 goto 指明目的地。
{"skill":"gesture","name":"Alice","motion":"shake_head"} 面向玩家摇头。动作需要玩家在本客户端视野内；不会移动过去，也不会发送聊天。`,
    fields: [
      { key: 'name', kind: 'string', required: true, hint: '在线玩家名' },
      { key: 'motion', kind: 'enum', required: true, values: ['wave', 'bow', 'nod', 'beckon', 'shake_head'],
        error: 'gesture 的 motion 只认 wave/bow/nod/beckon/shake_head' },
    ],
  },
];

const SKILL_INDEX = new Map(SKILLS.map((s) => [s.name as string, s]));

function specIsScout(s: SkillSpec): boolean {
  return s.name === 'probe' || s.name === 'observe' || s.fields.some((f) => f.key === 'dryRun');
}

const SCOUT_SKILLS = SKILLS.filter(specIsScout);

/** 技能名清单:mc_do 参数 schema 的 enum;顺序即注册表出场顺序 */
export const SKILL_NAMES: ReadonlyArray<SkillCall['skill']> = SKILLS.map((s) => s.name);

/** mc_scout 收的技能名;与 schema enum、parseScoutSteps 同源 */
export const SCOUT_SKILL_NAMES: ReadonlyArray<SkillCall['skill']> = SCOUT_SKILLS.map((s) => s.name);

const SKILL_DOC_TAIL = `坐标写成 [x,y,z];at 是一个坐标,anchors 是一串坐标。
每个分量是绝对数字,或 "~"/"~-3" 相对写法——原点是**这一步开始执行那一刻**我脚下那一格,
所以 goto 之后接 "~" 指的是那个 goto 的落点。没有前后左右的写法。
回执一律报解析后的绝对坐标。
方块/物品/实体一律用英文 id(oak_log、cobblestone、skeleton);target 也收玩家名。
类别名有两套:target/block/material 认 log、planks、ore、wool 这样的裸名(它们本身不是物品 id),把所有同类算进去;
until 名单认带井号的 ${UNTIL_CATEGORY_DOC}。
**写一个真实物品 id 就只认它自己**:obsidian 不会拿哭泣的黑曜石顶,torch 不是灵魂火把,
chest 不是末影箱,dirt 不是土径 —— 要"随便哪种木板"就写裸类别名 planks。
count 一律 1-64;distance:flee 1-128,find 1-1024(不给 direction 时站着扫,最远 ${FIND_STATIC_MAX})。
"needs" 声明这一步依赖哪些更早的步(序号 1 起);"needs":[] = 独立步。缺省见字段说明。
容器窗口在每单结束时关闭；from/into:"open" 的搬运和开窗步骤须在同一次 mc_do.steps 中，不能跨单沿用窗口。
每一步都会核验:判据由执行器按 (skill, 参数) 推,达成与落空都写进回执
(「该步按『背包内原木 ≥5』核验:达成(实测 7)」)。`;

function skillDocOf(skills: readonly SkillSpec[], lead: string): string {
  return [lead, ...skills.map((s) => [s.inputHint, s.doc].filter(Boolean).join('\n')), SKILL_DOC_TAIL].join('\n');
}

/** 全部技能的完整说明；按需帮助与注册表共用原文。 */
export const SKILL_DOC = skillDocOf(SKILLS, '一步一个对象,按顺序执行:');

function skillSignature(skill: SkillSpec): string {
  const fields = skill.fields.map((field) => field.key
    + ('required' in field && field.required ? '*' : '?'));
  return `${skill.name}(${fields.join(',')})${skill.inputHint ? ' — ' + skill.inputHint : ''}`;
}

/** 常驻目录保留字段签名；完整示例与执行条件按技能查询。 */
export const SKILL_SIGNATURE_DOC = [
  'steps 必须是实际 JSON 数组 [{"skill":...},...]，不要 stringify 成字符串。一步一个对象,skill 写技能名。* = 该字段适用的形态必填;? = 可选或条件参数。',
  '复杂形态、执行条件和完整示例用 mc_help {"skill":"技能名"} 查询。',
  ...SKILLS.map(skillSignature),
  SKILL_DOC_TAIL,
].join('\n');

export const SKILL_HELP_MAX_SKILLS = 4;

/** 只读取注册表，不读取连接、排队或执行技能。 */
export function readSkillHelp(args: Record<string, unknown>): { text: string } | { error: string } {
  if (args.skill !== undefined && args.skills !== undefined) {
    return { error: 'skill 与 skills 只能写一个' };
  }
  const requested = args.skill === undefined ? args.skills : [args.skill];
  if (requested === undefined || (Array.isArray(requested) && requested.length === 0)) {
    return { text: SKILL_SIGNATURE_DOC };
  }
  if (!Array.isArray(requested) || requested.length > SKILL_HELP_MAX_SKILLS
    || requested.some((name) => typeof name !== 'string' || !name.trim())) {
    return { error: `skill 要技能名;skills 要 1-${SKILL_HELP_MAX_SKILLS} 个技能名` };
  }
  const names = [...new Set(requested as string[])];
  const unknown = names.filter((name) => !SKILL_INDEX.has(name));
  if (unknown.length) return { error: `未知技能:${unknown.join('、')};mc_help {} 可查看目录` };
  return { text: skillDocOf(names.map((name) => SKILL_INDEX.get(name)!), '技能完整说明:') };
}

/** 试算目录只列支持的技能；完整动作说明由 mc_help 读取。 */
export const SCOUT_SKILL_DOC = [
  'steps 使用实际 JSON 数组，不要写成转义字符串。',
  '一步一个对象,按顺序读取真实现场并试算,不动世界。每步从当时真实位置开始，不推进假定位置或材料；needs 只判断前步试算结果，不表示前步已执行。',
  `收 ${SCOUT_SKILLS.map((s) => s.name).join(' / ')} 这几个技能,写法与参数跟 mc_do 的 steps 完全一样`,
  '完整示例和条件用 mc_help 按技能查询;一律按试算跑,不用自己写 dryRun。',
].join('');

function defaultFieldSchema(f: FieldSpec): Record<string, unknown> {
  switch (f.kind) {
    case 'string': return { type: 'string' };
    case 'names': return { type: 'array', items: { type: 'string' }, maxItems: UNTIL_NAMES_MAX };
    case 'int': return { type: 'integer', minimum: f.lo, maximum: f.hi };
    case 'anchor': return { ...ANCHOR_SCHEMA };
    case 'flag': return { type: 'boolean' };
    case 'enum': return { type: 'string', enum: [...f.values] };
    case 'opaque': return { ...f.schema };
  }
}

/** 字段的结构片段;description 不在这儿,合并后按用处列表另生成。 */
function fieldSchema(f: FieldSpec): Record<string, unknown> {
  const base = f.schema ? { ...f.schema } : defaultFieldSchema(f);
  delete base.description;
  return base;
}

/**
 * 同名字段跨技能的合并:区间取并集,枚举取并集;任一技能未限制则保持未限制。
 * 其余(type/items)本就一致,
 * 留先出场的那份。放宽到并集不丢约束——真校验在 parseSteps,schema 只管别把
 * 合法值挡在门外。
 */
function widenField(
  into: Record<string, unknown>,
  add: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...into };
  for (const [k, v] of Object.entries(add)) {
    const prev = out[k];
    if (['minimum', 'maximum', 'minItems', 'maxItems', 'enum'].includes(k)) continue;
    if (prev === undefined) out[k] = v;
  }
  for (const k of ['minimum', 'minItems', 'maximum', 'maxItems', 'enum']) {
    const prev = into[k], next = add[k];
    // Missing means unrestricted, not that a later skill may add a restriction.
    // In particular organize.target must not restrict find/attack/use targets.
    if (prev === undefined || next === undefined) delete out[k];
    else if (k === 'minimum' || k === 'minItems') out[k] = Math.min(prev as number, next as number);
    else if (k === 'maximum' || k === 'maxItems') out[k] = Math.max(prev as number, next as number);
    else out[k] = [...new Set([...(prev as unknown[]), ...(next as unknown[])])];
  }
  return out;
}

/** 一个字段在某技能下的用处标注:「smelt」「goto(只写 [x,z] …)」「flee(1-128)」 */
function fieldUse(skill: string, f: FieldSpec, merged: Record<string, unknown>): string {
  const bits: string[] = [];
  // 区间被别的技能撑宽了才写出来,否则 schema 自身就说清楚了
  if (f.kind === 'int' && (merged.minimum !== f.lo || merged.maximum !== f.hi)) {
    bits.push(`${f.lo}-${f.hi}`);
  }
  if (f.doc) bits.push(f.doc);
  return bits.length ? `${skill}(${bits.join(';')})` : skill;
}

/** Generation-only alternatives for providers that explicitly support unions.
 * Legacy schemas/parsing remain unchanged; facts, permissions and queue policy
 * are never inferred here. Other providers must keep using the flat contract.
 */
function skillGenerationContracts(skills: readonly SkillSpec[]): Record<string, Record<string, unknown>[]> {
  return Object.fromEntries(skills.map(spec => {
    const fields = Object.fromEntries(spec.fields.map(f => [f.key, {
      ...fieldSchema(f), ...(f.kind === 'string' ? { minLength: 1 } : {}),
      ...(f.doc ? { description: f.doc } : {}),
    }]));
    const variant = (keys: string[], required: string[], overrides: Record<string, unknown> = {}) => ({
      type: 'object',
      properties: {
        skill: { type: 'string', const: spec.name },
        ...Object.fromEntries(keys.map(key => [key, fields[key]])),
        needs: { type: 'array', items: { type: 'integer', minimum: 1 } },
        ...overrides,
      },
      required: ['skill', ...required], additionalProperties: false,
    });
    let variants: Record<string, unknown>[];
    if (spec.name === 'craft') {
      variants = [variant(['item', 'count'], ['item']), variant(['grid', 'count'], ['grid'])];
    } else if (spec.name === 'observe') {
      variants = [
        variant(['mode', 'sites'], ['mode', 'sites'], { mode: { type: 'string', const: 'sites' } }),
        variant(['mode', 'format', 'bounds'], ['mode'], { mode: { type: 'string', const: 'voxels' } }),
        variant(['mode', 'format', 'cursor'], ['mode', 'cursor'], { mode: { type: 'string', const: 'voxels' } }),
        variant(['mode', 'rays'], ['mode'], { mode: { type: 'string', const: 'rays' } }),
      ];
    } else if (spec.name === 'build') {
      variants = [
        variant(['material', 'anchors', 'temporary', 'dryRun'], ['material', 'anchors']),
        variant(['material', 'on', 'temporary', 'dryRun'], ['material', 'on']),
        variant(['material', 'at', 'temporary', 'dryRun'], ['material', 'at']),
        // A bound blueprint may be resumed without a new origin.
        variant(['blueprint', 'at', 'stopAfter', 'confirm', 'skipConflicts', 'rebindFrom', 'dryRun'], ['blueprint']),
        ...SHAPE_NAMES.map(shape => variant(
          ['material', 'shape', 'anchors', 'temporary', 'dryRun', ...(shape === 'box' ? ['fill'] : [])],
          ['material', 'shape', 'anchors'],
          { shape: { type: 'string', const: shape }, anchors: {
            ...fields.anchors, minItems: ANCHOR_COUNT[shape], maxItems: ANCHOR_COUNT[shape],
          } },
        )),
      ];
    } else {
      // Custom parsers may have alternatives (e.g. item versus entity target).
      // Do not mistake their documentary required flags for unconditional rules.
      variants = [variant(Object.keys(fields), spec.parse ? [] : spec.fields.filter(f => 'required' in f && f.required).map(f => f.key))];
    }
    return [spec.name, variants];
  }));
}

/**
 * steps.items schema:一份扁平字段池,description 写明每个字段用于哪些技能。
 * 每技能自己的必填与横向规则不进 schema:判别式 oneOf 不能用,有的 provider 解工具参数
 * 约束只认顶层 properties,分支里的字段会被整个吃掉,她填了也传不出来。硬约束改由
 * 注册表签名与按需说明陈述、parseSteps 裁决；报错只带相关技能的短约束和帮助入口。
 */
function stepSchemaOf(skills: readonly SkillSpec[]): Record<string, unknown> {
  const pool = new Map<string, { schema: Record<string, unknown>; uses: Array<[string, FieldSpec]> }>();
  for (const s of skills) {
    for (const f of s.fields) {
      const prev = pool.get(f.key);
      pool.set(f.key, {
        schema: prev ? widenField(prev.schema, fieldSchema(f)) : fieldSchema(f),
        uses: [...(prev?.uses ?? []), [s.name, f]],
      });
    }
  }
  const fields = [...pool].map(([key, { schema, uses }]) => {
    const notes = uses.map(([skill, f]) => fieldUse(skill, f, schema));
    return [key, { ...schema, description: `用于 ${notes.join(' / ')}` }] as const;
  });
  return {
    type: 'object',
    description: skills.filter(s => s.inputHint).map(s => `${s.name}: ${s.inputHint}`).join('\n'),
    properties: {
      skill: { type: 'string', enum: skills.map((s) => s.name) },
      ...Object.fromEntries(fields),
      needs: {
        type: 'array', items: { type: 'integer' },
        description: '任何技能都可带:依赖本次 steps 数组内哪些更早的步(每次调用重新从 1 起，第一步只能省略或写 [])。' +
          '不写=只拦因果:要用更早某步的产出、那一步又没做成时才跳过,其余照跑;[]=独立步',
      },
      // `expect` 不进 schema、也不进技能表:两轮实验(0821 给回显、0822 回显 791 次
      // 而声明 0/5440)之后放弃「让她自己声明验收标准」这条路,只留自动推导 + 回执回显。
      // 解析仍然收(见 `parseSteps`),写了照样覆写判据 —— 撤的是广告,不是能力。
    },
    required: ['skill'],
    // Annotation, not a native validation rule. Opt-in model projections may
    // replace the wide field pool with these registry-derived alternatives.
    'x-agent-mc-skill-contracts': skillGenerationContracts(skills),
  };
}

export const SKILL_STEP_SCHEMA: Record<string, unknown> = stepSchemaOf(SKILLS);
export const SCOUT_STEP_SCHEMA: Record<string, unknown> = stepSchemaOf(SCOUT_SKILLS);

/** 表驱动的结构校验:按字段声明逐个过,规范对象只收声明过的键 */
function parseByFields(
  spec: SkillSpec,
  c: Record<string, unknown>,
  at: string,
  marks?: MarkLookup,
): ParseResult {
  const out: Record<string, unknown> = { skill: spec.name };
  const notes: StepNote[] = [];
  for (const f of spec.fields) {
    const v = c[f.key];
    switch (f.kind) {
      case 'string': {
        const s = str(v);
        if (!s) {
          if (f.required) return { error: `${at} ${spec.name} 要 ${f.key}${f.hint ? `(${f.hint})` : ''}` };
          if (v !== undefined && v !== null) {
            notes.push({ field: f.key, given: v, kind: 'dropped', why: '不是一个名字' });
          }
          break;
        }
        out[f.key] = s;
        break;
      }
      case 'names': {
        if (v === undefined || v === null) break;
        if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
          return { error: `${at} ${spec.name} 的 ${f.key} 要是一串英文 id(数组)${f.hint ? `,${f.hint}` : ''}` };
        }
        if (v.length > UNTIL_NAMES_MAX) {
          return { error: `${at} ${spec.name} 的 ${f.key} 最多 ${UNTIL_NAMES_MAX} 项` };
        }
        const names = (v as string[]).map((s) => s.trim()).filter(Boolean);
        // 空数组不是「关掉」也不是错写:这一格本来就可以不给,收成没写
        if (names.length > 0) out[f.key] = names;
        else if (v.length > 0) notes.push({ field: f.key, given: v, kind: 'dropped', why: '全是空名字' });
        break;
      }
      case 'int': {
        const n = intIn(v, f.lo, f.hi, f.def);
        if (n === null) return { error: `${at} ${spec.name} 的 ${f.key} 要在 ${f.lo}-${f.hi} ${f.unit ?? ''}之间` };
        out[f.key] = n;
        break;
      }
      case 'anchor': {
        if (v === undefined) {
          if (f.required) return { error: `${at} ${f.error}` };
          break;
        }
        const a = anchorOf(v, marks);
        if (!a) return { error: `${at} ${f.error}${markMissNote(v, marks)}` };
        out[f.key] = a;
        break;
      }
      case 'flag': {
        if (v === true) out[f.key] = true;
        else if (v === false && f.retainFalse) out[f.key] = false;
        else if (v !== undefined && v !== null && v !== false) {
          notes.push({ field: f.key, given: v, kind: 'dropped', why: f.retainFalse ? '只认布尔值' : '只认 true' });
        }
        break;
      }
      case 'enum': {
        if (v === undefined && !f.required) break;
        const s = str(v);
        if (!s || !f.values.includes(s)) return { error: `${at} ${f.error}` };
        out[f.key] = s;
        break;
      }
      case 'opaque':
        // 复合结构只出现在带 parse 钩子的技能里,不会走到表驱动这条路
        break;
    }
  }
  return { step: out as unknown as SkillCall, ...(notes.length > 0 ? { notes } : {}) };
}

/**
 * 这个技能不收、被整个丢掉的键。值是 null/undefined 的不算:schema 是一份扁平
 * 字段池,模型把用不上的字段填成 null 是照 schema 写的,不是她想说什么。
 */
function strayKeys(spec: SkillSpec, c: Record<string, unknown>): StepNote[] {
  const known = new Set(['skill', 'needs', 'expect', ...spec.fields.map((f) => f.key)]);
  return Object.entries(c)
    .filter(([k, v]) => !known.has(k) && v !== undefined && v !== null)
    .map(([field, given]) => ({
      field, given, kind: 'dropped' as const, why: `${spec.name} 不收这个字段`,
    }));
}

/**
 * mc_do 的边界校验采用整批原子语义;任一步非法时返回步骤索引和原因。
 * 有效步骤重建为规范对象,额外字段不进入技能实现。
 *
 * 规范化不是无声的:被丢掉的字段与被改读的写法进 `notes`(没有就不带这个键),
 * 由受理回执回念 —— 「解析后的调用与她写的不一致时明说」这条规矩的出口。
 */
export function parseSteps(
  raw: unknown,
  marks?: MarkLookup,
): { steps: SkillCall[]; notes?: ParseNote[] } | { error: string } {
  const serialized = typeof raw === 'string' ? raw : null;
  if (serialized !== null) {
    try { raw = JSON.parse(serialized); }
    catch { return { error: 'steps 字符串不是完整 JSON 数组；请发送实际数组，不要 stringify，也不要带多余括号或代码围栏。没有修剪或执行合法前缀' }; }
  }
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'steps 要是一个非空的技能数组' };
  const steps: SkillCall[] = [];
  const notes: ParseNote[] = serialized === null ? [] : [{ field: 'steps', given: serialized, kind: 'decoded' }];
  for (const [i, item] of raw.entries()) {
    const at = `第 ${i + 1} 步`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { error: `${at}不是一个对象` };
    }
    const c = item as Record<string, unknown>;
    const name = str(c.skill);
    const spec = name ? SKILL_INDEX.get(name) : undefined;
    if (!spec) {
      return { error: `${at}的 skill「${String(c.skill)}」不是技能表里的动作` };
    }
    if (spec.name === 'chat' || spec.name === 'server_travel') {
      const text = spec.name === 'chat' ? c.text : c.command;
      if (typeof text === 'string') {
        const error = chatInputError(text);
        if (error) return { error: `${at} ${error}` };
      }
    }
    const targetError = collectTargetError(c);
    if (targetError) return { error: `${at} ${targetError}` };
    const parsed = spec.parse ? spec.parse(c, at, marks) : parseByFields(spec, c, at, marks);
    if ('error' in parsed) return parsed;
    const step = parsed.step;
    for (const n of [...(parsed.notes ?? []), ...strayKeys(spec, c)]) notes.push({ ...n, step: i + 1 });
    // 边界声明骑在规范步骤上;结构非法同样整批退回
    if (c.needs !== undefined) {
      const needs = needsOf(c.needs, i, at);
      if ('error' in needs) return needs;
      step.needs = needs.needs;
    }
    if (c.expect !== undefined) {
      const expect = expectOf(c.expect, at);
      if ('error' in expect) return expect;
      step.expect = expect.expect;
    }
    steps.push(step);
  }
  return notes.length > 0 ? { steps, notes } : { steps };
}

/** Read-only diagnosis from the same registry; never edits, submits or retries an action. */
export function describeSkillInputCorrection(raw: unknown, error: string): {
  path: string; hint: string; helpArguments: { skill?: SkillCall['skill'] }; suppliedExcerpt: string;
  inputSchema?: Record<string, unknown>;
} {
  let value = raw;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* Keep malformed input opaque. */ } }
  const match = /^第 (\d+) 步/.exec(error), index = match ? Number(match[1]) - 1 : -1;
  const item = Array.isArray(value) && index >= 0 ? value[index] : null;
  const spec = item && typeof item === 'object' && !Array.isArray(item)
    ? SKILL_INDEX.get(String(item.skill)) : undefined;
  const hint = spec ? spec.inputHint ?? skillSignature(spec)
    : 'steps 写成真正的 JSON 数组；只可完整解码一次，损坏的 JSON 不补括号、不截取前缀。保留原来全部步骤的顺序和依赖，再纠正参数。';
  const supplied = JSON.stringify(raw) ?? String(raw);
  return { path: index >= 0 ? `/steps/${index}` : '/steps', hint,
    ...(spec ? { inputSchema: { anyOf: skillGenerationContracts([spec])[spec.name] } } : {}),
    helpArguments: spec ? { skill: spec.name } : {},
    suppliedExcerpt: supplied.length <= 180 ? supplied
      : `${supplied.slice(0, 180)}…（原参数 ${supplied.length} 字符，完整值保留在本次调用记录）` };
}

function asScoutStep(step: SkillCall): SkillCall {
  switch (step.skill) {
    case 'goto':
    case 'flight':
    case 'build':
    case 'excavate':
    case 'tunnel':
    case 'cleanup':
    case 'organize':
      return { ...step, dryRun: true };
    default:
      return step;
  }
}

/**
 * mc_scout 的入参:先走 parseSteps,再留下试算能做的步,并把 dryRun 补上。
 * 会动世界的技能整批退回——这是入口过滤,不是「没试算就不许动手」。
 */
export function parseScoutSteps(
  raw: unknown,
  marks?: MarkLookup,
): { steps: SkillCall[]; notes?: ParseNote[] } | { error: string } {
  const parsed = parseSteps(raw, marks);
  if ('error' in parsed) return parsed;
  const scout = new Set<string>(SCOUT_SKILL_NAMES);
  const steps: SkillCall[] = [];
  for (const [i, step] of parsed.steps.entries()) {
    if (!scout.has(step.skill)) {
      return { error: `第 ${i + 1} 步「${step.skill}」会动世界,试算只收 probe/observe 和带 dryRun 的技能` };
    }
    steps.push(asScoutStep(step));
  }
  return parsed.notes ? { steps, notes: parsed.notes } : { steps };
}
