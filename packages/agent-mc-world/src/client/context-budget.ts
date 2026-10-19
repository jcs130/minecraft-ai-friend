/**
 * Host-neutral context budget helpers: which game events deserve a model wake-up,
 * a bounded event tail for per-request snapshots, model-visible text caps and a
 * compact tool catalogue. Exact schemas/full text always remain available on demand.
 */
import type { EventEnvelope } from './contracts.ts';

export type WakeCategory = 'whisper' | 'mention' | 'danger' | 'connection' | 'task' | 'goal'
  | 'chat-other' | 'system' | 'ambient' | 'piggyback' | 'self';

export interface WakeOptions {
  /** Names the body answers to (account name, display name, nicknames). Case-insensitive. */
  selfNames?: readonly string[];
  /** Categories that wake the model. Defaults to WAKE_DEFAULT (idle-safe). */
  wakeOn?: readonly WakeCategory[];
}

export interface WakeDecision { wake: boolean; category: WakeCategory }

/** Idle-safe default: only things a person would interrupt you for. */
export const WAKE_DEFAULT: readonly WakeCategory[] = ['whisper', 'mention', 'danger', 'connection'];
/** While a goal is running, the body's own task receipts also matter. */
export const WAKE_ACTIVE_GOAL: readonly WakeCategory[] = [...WAKE_DEFAULT, 'task', 'goal'];

const DANGER = /濒死|生命 ?\d+\/20|受到|被.{0,12}(攻击|打|伤)|敌对|有害|中了「|死了[^(（]|你死|重生点失效|溺水|着火|岩浆|服务器(停|出问题)|下线|断开|Boss 血条/u;
const CONNECTION = /disconnect|lifecycle|kicked|leave_self/i;

/** Classify one journal event for wake-up purposes. Pure; never reads the world. */
export function classifyWake(event: Pick<EventEnvelope, 'type' | 'text'> & Partial<EventEnvelope>, options: WakeOptions = {}): WakeDecision {
  const wakeOn = new Set(options.wakeOn ?? WAKE_DEFAULT);
  const decide = (category: WakeCategory): WakeDecision => ({ wake: wakeOn.has(category), category });
  const kind = event.type.slice(event.type.indexOf('.') + 1); // "minecraft.chat" / "mymc.chat" -> "chat"
  const text = String(event.text ?? '');
  const names = (options.selfNames ?? []).filter(Boolean).map(name => name.toLocaleLowerCase());
  if (event.contextDelivery === 'archive-only') return { wake: false, category: 'piggyback' };
  if (CONNECTION.test(kind)) return decide('connection');
  if (kind === 'chat') {
    if (text.startsWith('[MC 私聊发出]')) return { wake: false, category: 'self' };
    if (text.startsWith('[MC 私聊]')) return decide('whisper');
    const speaker = typeof event.meta?.uname === 'string' ? event.meta.uname : undefined;
    if (!speaker) return { wake: false, category: 'system' };
    if (names.includes(speaker.toLocaleLowerCase())) return { wake: false, category: 'self' };
    const body = text.replace(/^\[MC[^\]]*\]\s*[^:：]*[:：]\s*/u, '').toLocaleLowerCase();
    const mentioned = names.some(name => body.includes(name) || body.includes('@' + name));
    return mentioned ? decide('mention') : { wake: false, category: 'chat-other' };
  }
  if (event.trigger === 'piggyback') return { wake: false, category: 'piggyback' };
  if (kind === 'task' || kind.startsWith('task.')) return kind === 'task' ? decide('task') : { wake: false, category: 'ambient' };
  if (kind.startsWith('goal')) return decide('goal');
  if ((kind === 'event' || kind === 'body') && event.trigger === 'flush' && DANGER.test(text)) return decide('danger');
  return { wake: false, category: 'ambient' };
}

/** Cut prose at a sentence boundary. */
export function condenseText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const cut = Math.max(...['。', '. ', '；', '\n'].map(p => head.lastIndexOf(p)));
  return (cut > max * 0.4 ? head.slice(0, cut + 1) : head).trimEnd() + '…';
}

export interface CompactEvent { cursor: number; at: string; type: string; from?: string; text?: string }
/** Bounded, readable event tail for a per-request snapshot; full events stay in the journal. */
export function compactEvents(events: readonly EventEnvelope[], limit = 10, textChars = 200): CompactEvent[] {
  return events.slice(-limit).map(event => ({ cursor: event.cursor,
    at: typeof event.ts === 'string' ? event.ts.slice(11, 19) : String(event.ts), type: event.type,
    ...(event.senderKey ? { from: event.senderKey } : {}),
    ...(event.text ? { text: condenseText(event.text.replace(/\s+/g, ' '), textChars) } : {}) }));
}

/** Model-visible cap; callers keep the full value durably and point to it. */
export function capModelText(text: string, max = 1500, pointer = 'full receipt is archived'): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated ${text.length - max} chars; ${pointer}]`;
}

export interface CompactCatalogOptions {
  /** Tool description budget in characters. Default 300. */
  descriptionChars?: number;
  /** Top-level parameter note budget. Nested notes are dropped. Default 80. */
  parameterChars?: number;
  /** Object schemas with more properties than this collapse to required/enum discriminators. Default 24. */
  collapseProperties?: number;
  /** Objects nested at least nestedLevel property levels deep with more properties than this collapse too. Default 8. */
  nestedCollapseProperties?: number;
  /** Property depth at which nestedCollapseProperties applies (add.plan[].verify is level 3). Default 3. */
  nestedLevel?: number;
  /** Description kept on a node whose items collapsed (e.g. a skill signature list). Default 3000. */
  signatureChars?: number;
  /** Tool that serves the exact schema and full text. */
  helpTool?: string;
}

interface Schema { [key: string]: unknown }
const isObject = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value);

function collapse(schema: Schema): Schema {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  const kept = Object.fromEntries(Object.entries(properties).filter(([key, value]) =>
    required.includes(key) || (isObject(value) && Array.isArray(value.enum) && key === required[0])));
  return { type: 'object', properties: Object.fromEntries(Object.entries(kept).map(([key, value]) =>
    [key, slim(value as Schema, 0, {})])), ...(required.length ? { required } : {}), additionalProperties: true };
}

/** Deep wide object (e.g. a verify condition union): keep type, required/discriminator fields, and the same for items. */
function collapseNested(schema: Schema): Schema {
  const out = collapse(schema);
  if (schema.type !== undefined) out.type = schema.type;
  if (isObject(schema.items)) out.items = isObject(schema.items.properties) ? collapse(schema.items) : slim(schema.items, 0, {});
  return out;
}

type SlimOptions = Required<Omit<CompactCatalogOptions, 'helpTool'>> | Record<string, never>;
function slim(schema: unknown, depth: number, o: SlimOptions, level = 0): unknown {
  if (Array.isArray(schema)) return schema.map(item => slim(item, depth, o, level));
  if (!isObject(schema)) return schema;
  if ('nestedLevel' in o && level >= o.nestedLevel && isObject(schema.properties)
    && Object.keys(schema.properties).length > o.nestedCollapseProperties) return collapseNested(schema);
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'description' || key === 'title' || key === 'examples') continue;
    if (['const', 'enum', 'default'].includes(key)) { out[key] = value; continue; }
    if (key === 'properties' && isObject(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, slim(child, depth + 1, o, level + 1)]));
      continue;
    }
    out[key] = slim(value, depth + 1, o, level);
  }
  if ('collapseProperties' in o && isObject(schema.items) && isObject(schema.items.properties)
    && Object.keys(schema.items.properties).length > o.collapseProperties) {
    out.items = collapse(schema.items);
    if (typeof schema.description === 'string') out.description = condenseText(schema.description, o.signatureChars);
  } else if ('parameterChars' in o && depth === 1 && typeof schema.description === 'string' && o.parameterChars > 0) {
    out.description = condenseText(schema.description, o.parameterChars);
  }
  return out;
}

/**
 * Advertised catalogue for context-constrained models. Constraints the model needs to form a call
 * (types, enums, required, bounds) stay inline; prose and very wide field pools move behind helpTool.
 * Hosts must still validate against the original schema.
 */
export function compactToolSchema<T extends { name: string; description?: string }>(tool: T, schema: unknown, options: CompactCatalogOptions = {}): { description: string; schema: unknown } {
  const o = { descriptionChars: options.descriptionChars ?? 300, parameterChars: options.parameterChars ?? 80,
    collapseProperties: options.collapseProperties ?? 24,
    nestedCollapseProperties: options.nestedCollapseProperties ?? 8, nestedLevel: options.nestedLevel ?? 3, signatureChars: options.signatureChars ?? 3000 };
  const full = tool.description ?? '';
  const short = condenseText(full, o.descriptionChars);
  const help = options.helpTool && tool.name !== options.helpTool ? `（完整说明与参数：${options.helpTool} {"name":"${tool.name}"}）` : '';
  return { description: short === full ? full : short + help, schema: slim(schema, 0, o) };
}

export interface MovementProgressOptions {
  /** Consecutive movement-only calls before a verdict. Default 6. */
  window?: number;
  /** Points of the last `window` calls all within this distance of their centroid count as one area. Default 24. */
  radius?: number;
  /** Grid cell size used to detect newly visited ground. Default 16. */
  cellSize?: number;
  /** Skills that only move or look. Anything else (except chat) is real work and resets the streak. */
  movementSkills?: readonly string[];
}

export interface MovementVerdict {
  /** Consecutive movement-only calls. */
  streak: number;
  /** Max distance of recent targets from their centroid, in blocks. */
  spread: number;
  /** Grid cells first visited within the last `window` movement calls. */
  newCells: number;
  /** Many movement-only calls with no new ground or within one small area. */
  repetitive: boolean;
}

const MOVEMENT_SKILLS = ['goto', 'look', 'observe', 'walk', 'wander', 'face'];
const point = (value: unknown): [number, number, number] | undefined =>
  Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number') ? value as [number, number, number] : undefined;

/**
 * Host-side detector for wandering without progress: e.g. dozens of goto/look calls inside one plaza.
 * Feed it each action's steps; hosts decide how to nudge or close the goal.
 */
export class MovementProgress {
  private readonly window: number;
  private readonly radius: number;
  private readonly cellSize: number;
  private readonly movement: Set<string>;
  private readonly cells = new Set<string>();
  private recent: { points: [number, number, number][]; newCells: number }[] = [];
  streak = 0;

  constructor(options: MovementProgressOptions = {}) {
    this.window = options.window ?? 6;
    this.radius = options.radius ?? 24;
    this.cellSize = options.cellSize ?? 16;
    this.movement = new Set(options.movementSkills ?? MOVEMENT_SKILLS);
  }

  reset(): void { this.streak = 0; this.recent = []; this.cells.clear(); }

  record(steps: readonly unknown[]): MovementVerdict {
    const skills = steps.map(step => isObject(step) && typeof step.skill === 'string' ? step.skill : '');
    const work = skills.filter(skill => skill !== 'chat');
    if (!work.length || work.some(skill => !this.movement.has(skill))) {
      if (work.length) { this.streak = 0; this.recent = []; }
      return this.verdict();
    }
    const points = steps.map(step => isObject(step) ? point(step.at) : undefined).filter((p): p is [number, number, number] => !!p);
    let newCells = 0;
    for (const [x, , z] of points) {
      const key = `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
      if (!this.cells.has(key)) { this.cells.add(key); newCells++; }
    }
    this.streak++;
    this.recent = [...this.recent, { points, newCells }].slice(-this.window);
    return this.verdict();
  }

  private verdict(): MovementVerdict {
    const points = this.recent.flatMap(entry => entry.points);
    const newCells = this.recent.reduce((sum, entry) => sum + entry.newCells, 0);
    let spread = 0;
    if (points.length) {
      const cx = points.reduce((s, p) => s + p[0], 0) / points.length, cz = points.reduce((s, p) => s + p[2], 0) / points.length;
      spread = Math.round(Math.max(...points.map(p => Math.hypot(p[0] - cx, p[2] - cz))));
    }
    const full = this.streak >= this.window;
    return { streak: this.streak, spread, newCells, repetitive: full && (spread <= this.radius || newCells === 0) };
  }
}
