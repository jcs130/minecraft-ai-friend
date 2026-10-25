import { CONTEXT_SCHEMA_ANNOTATIONS } from './schema-reading.ts';

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

/** Player conversation is visible by default; the host/model decides whether to answer. */
export const WAKE_DEFAULT: readonly WakeCategory[] = ['whisper', 'mention', 'chat-other', 'danger', 'connection'];
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
    return decide(mentioned ? 'mention' : 'chat-other');
  }
  if (event.trigger === 'piggyback') return { wake: false, category: 'piggyback' };
  if (kind === 'task' || kind.startsWith('task.')) return kind === 'task' ? decide('task') : { wake: false, category: 'ambient' };
  // A whole program finishes after its local substeps. Hosts waiting on that
  // program must receive its real terminal, without waking for every substep.
  if (kind === 'method') return event.execution?.kind === 'method' && event.execution.terminal === true
    ? decide('task') : { wake: false, category: 'ambient' };
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
/** HH:MM:SS of an ISO timestamp in `timeZone` (default: host zone); events carry mixed Z / +08:00 stamps. */
export function clockTime(ts: unknown, timeZone?: string): string {
  const ms = typeof ts === 'number' ? ts : Date.parse(String(ts));
  if (!Number.isFinite(ms)) return String(ts);
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).format(ms);
}

export function compactEvents(events: readonly EventEnvelope[], limit = 10, textChars = 200, timeZone?: string): CompactEvent[] {
  return events.slice(-limit).map(event => ({ cursor: event.cursor,
    at: clockTime(event.ts, timeZone), type: event.type,
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

/** Terse shape of a collapsed optional field: enums and array/tuple shapes the model must get right; undefined = omit. */
export function terseField(schema: unknown, depth = 0): Schema | undefined {
  if (!isObject(schema)) return undefined;
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants) && depth === 0) {
    const kept = variants.map(v => terseField(v, 1) ?? (isObject(v) && v.type ? { type: v.type } : undefined));
    return kept.every(Boolean) && kept.some(v => v!.enum || v!.type === 'array') ? { anyOf: kept } : undefined;
  }
  if (Array.isArray(schema.enum)) return { ...(schema.type ? { type: schema.type } : {}), enum: schema.enum };
  const isArray = schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'));
  if (!isArray) return undefined;
  const out: Schema = { type: schema.type };
  for (const k of ['minItems', 'maxItems']) if (schema[k] !== undefined) out[k] = schema[k];
  const items = schema.items;
  if (isObject(items)) {
    const inner = Array.isArray(items.enum) ? { enum: items.enum } : items.type === 'array' && depth < 2 ? terseField(items, depth + 1)
      : ['integer', 'number', 'string', 'boolean'].includes(items.type as string) ? { type: items.type } : undefined;
    if (inner) out.items = inner;
  }
  return out;
}

function collapse(schema: Schema): Schema {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  const kept: Schema = {};
  for (const [key, value] of Object.entries(properties)) {
    if (required.includes(key)) kept[key] = slim(value as Schema, 0, {});
    else { const terse = terseField(value); if (terse) kept[key] = terse; }
  }
  return { type: 'object', properties: kept, ...(required.length ? { required } : {}), additionalProperties: true };
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
    if (key === 'description' || key === 'title' || key === 'examples' || CONTEXT_SCHEMA_ANNOTATIONS.includes(key)) continue;
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
  /** Repeated request pattern, not proof of execution failure or absent world progress. */
  repetitive: boolean;
  /** Repeated ground modifier-key requests; verify actual movement before intervening. */
  kind?: 'control';
}

/** Digest of an observation's text with timestamps, coordinates and counters stripped. */
export function observationDigest(text: string): string {
  const norm = String(text).replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim().slice(0, 4000);
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) { h ^= norm.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** Control is movement-related, not automatically productive work or failed movement. */
const MOVEMENT_SKILLS = ['goto', 'look', 'observe', 'walk', 'wander', 'face', 'control'];
/** Ground modifier-key request patterns. Jump may change height; this is not outcome evidence. */
const IDLE_CONTROL_KEYS = new Set(['sneak', 'jump', 'sprint']);
const point = (value: unknown): [number, number, number] | undefined =>
  Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number') ? value as [number, number, number] : undefined;

export function isIdleControlStep(step: unknown): boolean {
  if (!isObject(step) || step.skill !== 'control') return false;
  if (step.mode !== undefined && step.mode !== 'ground') return false;
  if (step.yawDeg || step.pitchDeg) return false;
  return Array.isArray(step.keys) && step.keys.length > 0
    && step.keys.every(k => typeof k === 'string' && IDLE_CONTROL_KEYS.has(k));
}

/**
 * Host-side detector for wandering without progress: e.g. dozens of goto/look calls inside one plaza,
 * or repeated sneak/jump control bursts after a place. Feed it each action's steps; hosts decide how
 * to inspect actual receipts. This statistic never proves a goal complete or authorizes cancellation.
 */
export class MovementProgress {
  private readonly window: number;
  private readonly radius: number;
  private readonly cellSize: number;
  private readonly movement: Set<string>;
  private readonly cells = new Set<string>();
  // seen: observation digests
  private recent: { points: [number, number, number][]; newCells: number; idleControl: boolean; unknownMotion: boolean }[] = [];
  streak = 0;

  constructor(options: MovementProgressOptions = {}) {
    this.window = options.window ?? 6;
    this.radius = options.radius ?? 24;
    this.cellSize = options.cellSize ?? 16;
    this.movement = new Set(options.movementSkills ?? MOVEMENT_SKILLS);
  }

  reset(): void { this.streak = 0; this.recent = []; this.cells.clear(); this.seen.clear(); }

  private readonly seen = new Set<string>();

  /**
   * A look-around call (scout, visual, observe…). `digest` identifies what it reported, with volatile
   * numbers stripped by the caller or via observationDigest(). A repeat of something already seen
   * counts like an idle move; something new is neutral.
   */
  recordObservation(digest: string): MovementVerdict {
    if (this.seen.has(digest)) {
      this.streak++;
      this.recent = [...this.recent, { points: [], newCells: 0, idleControl: false, unknownMotion: false }].slice(-this.window);
    } else this.seen.add(digest);
    return this.verdict();
  }

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
    const idleControl = work.length > 0 && work.every(skill => skill === 'control')
      && steps.filter(s => isObject(s) && s.skill === 'control').every(isIdleControlStep);
    // Directional walking, swimming, diving and flying have no target coordinates
    // in this request contract. Missing coordinates cannot prove absent movement.
    const unknownMotion = steps.some(s => isObject(s) && s.skill === 'control' && !isIdleControlStep(s));
    this.streak++;
    this.recent = [...this.recent, { points, newCells, idleControl, unknownMotion }].slice(-this.window);
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
    const idleControlStreak = this.recent.length > 0 && this.recent.every(e => e.idleControl);
    return {
      streak: this.streak, spread, newCells,
      repetitive: full && !this.recent.some(entry => entry.unknownMotion)
        && (spread <= this.radius || newCells === 0 || idleControlStreak),
      ...(idleControlStreak && full ? { kind: 'control' as const } : {}),
    };
  }
}

export interface CompactFacts {
  run?: string;
  at?: string;
  dimension?: string | null;
  position?: number[];
  health?: number;
  food?: number;
  inventory?: unknown;
  [part: string]: unknown;
}

const round1 = (n: unknown) => typeof n === 'number' ? Math.round(n * 10) / 10 : n;

/**
 * Model-facing view of currentFacts(): drops host-only revision/origin hashes and the
 * decision-stability duplicate, inlines JSON part text (no double escaping), omits empty parts.
 * Hosts keep the full facts for verification; this is only what the model reads each step.
 */
export function compactFacts(facts: { run?: string; observation?: Record<string, unknown> | null; parts?: readonly { key: string; text: string }[] } | null | undefined): CompactFacts {
  const out: CompactFacts = {};
  if (!facts) return out;
  if (facts.run) out.run = facts.run;
  const o = facts.observation;
  if (o) {
    if (typeof o.at === 'string') out.at = o.at;
    if (o.dimension !== undefined) out.dimension = o.dimension as string | null;
    const p = o.position as { x?: number; y?: number; z?: number } | undefined;
    if (p) out.position = [p.x, p.y, p.z].map(round1) as number[];
    if (o.health !== undefined) out.health = o.health as number;
    if (o.food !== undefined) out.food = o.food as number;
    if (o.inventory !== undefined) out.inventory = o.inventory;
  }
  for (const part of facts.parts ?? []) {
    const text = String(part.text ?? '').trim();
    if (!text || text === '{}' || text === '[]' || text === 'null') continue;
    let value: unknown = text;
    if (/^[[{]/.test(text)) { try { value = JSON.parse(text); } catch { /* keep text */ } }
    out[part.key in out ? `part:${part.key}` : part.key] = value;
  }
  return out;
}
