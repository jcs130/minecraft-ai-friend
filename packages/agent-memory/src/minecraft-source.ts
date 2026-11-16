import { formatPos, locationRef, type BlockPos } from './scope.ts';
import type { EntityRef, EpisodeKind, EpisodeSourceRef, FactInput, WorldRef } from './types.ts';

/**
 * EpisodeSource for Minecraft. Two entry points:
 * 1. `fromEvent` maps agent-mc-world host events (EventEnvelope-compatible) to episodes + rule-extracted facts.
 *    Only meaningful events are kept; snapshots, action bars, ambient notices and polls are ignored.
 * 2. Structured helpers (homeSet, locationVisit, skillLevel, task, note, InventoryDeltaTracker) for producers
 *    that already hold typed data.
 * Rule extraction is deliberately conservative; the Graphiti backend runs LLM extraction on the same raw text.
 */

/** Structural subset of agent-mc-world `EventEnvelope`; no package dependency. */
export interface McEventLike {
  type: string; ts: string; text: string; source?: string; cursor?: number; senderKey?: string;
  meta?: Record<string, unknown>;
  execution?: { kind: string; id: string; phase: string; terminal: boolean; evidence?: Record<string, unknown> };
}

export interface SourceContext {
  /** The agent's own Minecraft name (the body). */
  self: string;
  world: WorldRef | null;
}

export interface EpisodeDraft {
  kind: EpisodeKind;
  occurredAt: string;
  text: string;
  actors: string[];
  world: WorldRef | null;
  data: Record<string, unknown>;
  importance: number;
  source: EpisodeSourceRef;
  facts: FactInput[];
}

const agent = (self: string): EntityRef => ({ type: 'Agent', name: self });
const player = (name: string): EntityRef => ({ type: 'Player', name });

export function fromEvent(event: McEventLike, ctx: SourceContext): EpisodeDraft | null {
  const at = event.ts;
  const meta = event.meta ?? {};
  const uname = typeof meta.uname === 'string' ? meta.uname : null;
  const src: EpisodeSourceRef = { type: 'minecraft-event', eventType: event.type,
    ...(event.cursor !== undefined ? { ref: `cursor:${event.cursor}` } : {}) };
  const base = { occurredAt: at, text: event.text, world: ctx.world, source: src };

  if (event.type === 'minecraft.enter' && uname) {
    return { ...base, kind: 'player_join', actors: [uname], data: { player: uname }, importance: 0.4,
      facts: [{ subject: player(uname), relation: 'IS_ONLINE', object: null, value: true, text: `${uname} is online`, validAt: at }] };
  }
  if (event.type === 'minecraft.leave' && uname) {
    return { ...base, kind: 'player_leave', actors: [uname], data: { player: uname }, importance: 0.3,
      facts: [{ subject: player(uname), relation: 'IS_ONLINE', object: null, value: false, text: `${uname} is offline`, validAt: at }] };
  }
  if (event.type === 'minecraft.chat' && uname && meta.channel !== 'system' && meta.deliver !== false) {
    const whisper = /^\[MC 私聊\]/.test(event.text);
    const outgoing = /^\[MC 私聊发出\]/.test(event.text) || uname === ctx.self;
    const message = event.text.replace(/^\[[^\]]*\]\s*/, '').replace(new RegExp(`^${escapeRe(uname)}\\s*[:：]\\s*`), '');
    if (outgoing) return { ...base, kind: whisper ? 'whisper' : 'chat', actors: [ctx.self], data: { speaker: ctx.self, message, outgoing: true },
      importance: 0.2, facts: [] };
    const direct = whisper || message.toLowerCase().includes(ctx.self.toLowerCase());
    const facts: FactInput[] = direct
      ? [{ subject: agent(ctx.self), relation: 'KNOWS', object: player(uname), text: `${ctx.self} has talked with ${uname}`, validAt: at }]
      : [];
    facts.push(...preferenceFacts(uname, message, at));
    return { ...base, kind: whisper ? 'whisper' : 'chat', actors: [uname], data: { speaker: uname, message, direct },
      importance: facts.length ? 0.6 : direct ? 0.5 : 0.2, facts };
  }
  const death = meta.death as { id?: string; position?: (BlockPos & { dimension?: string }) | null; cause?: { text?: string } | null } | undefined;
  if (event.type === 'minecraft.event' && death && typeof death === 'object') {
    const pos = death.position ?? null;
    const place = pos ? locationRef(ctx.world, formatPos(pos)) : null;
    const cause = death.cause?.text ?? null;
    return { ...base, kind: 'death', actors: [ctx.self], data: { deathId: death.id ?? null, position: pos, cause }, importance: 0.9,
      facts: place ? [{ subject: agent(ctx.self), relation: 'DIED_AT', object: place, value: cause,
        text: `${ctx.self} died at ${place.name}${cause ? ` (${cause})` : ''}`, validAt: at }] : [] };
  }
  if (event.type === 'minecraft.event' && /已收到重生后的生命读数/.test(event.text)) {
    return { ...base, kind: 'respawn', actors: [ctx.self], data: {}, importance: 0.3, facts: [] };
  }
  const level = /(?:升到|当前)\s*(\d{1,5})\s*级/.exec(event.text);
  if (event.type === 'minecraft.event' && level) {
    const n = Number(level[1]);
    return { ...base, kind: 'skill', actors: [ctx.self], data: { skill: 'experience', level: n }, importance: 0.4,
      facts: [skillFact(ctx.self, 'Agent', 'experience', n, at)] };
  }
  const exec = event.execution;
  if (exec && exec.kind === 'task' && (exec.terminal || exec.phase === 'accepted')) {
    return { ...base, kind: 'task', actors: [ctx.self], data: { taskId: exec.id, phase: exec.phase, terminal: exec.terminal },
      importance: exec.terminal ? 0.5 : 0.3, facts: taskFacts(ctx.self, exec.id, exec.phase, at) };
  }
  return null;
}

function skillFact(who: string, type: 'Agent' | 'Player', skill: string, level: number, at: string): FactInput {
  return { subject: { type, name: who }, relation: 'HAS_LEVEL', object: { type: 'Skill', name: skill }, value: level,
    text: `${who} has ${skill} level ${level}`, validAt: at };
}
function taskFacts(self: string, id: string, phase: string, at: string, title?: string): FactInput[] {
  const task: EntityRef = { type: 'Task', name: id };
  return [
    { subject: agent(self), relation: 'PARTICIPATED_IN', object: task, text: `${self} worked on task ${title ?? id}`, validAt: at },
    { subject: task, relation: 'HAS_STATUS', object: null, value: phase, text: `task ${title ?? id} is ${phase}`, validAt: at },
  ];
}

// ---- conservative preference extraction (Chinese + English) ----
const STOP_TAIL = /[了的啊呀呢吧哦嘛~～\s]+$/u;
const CLAUSE = '([^，。,.!！?？;；\\n]{1,24})';
export function preferenceFacts(speaker: string, message: string, at: string): FactInput[] {
  const out: FactInput[] = [];
  const topic = (s: string) => s.trim().replace(STOP_TAIL, '').trim();
  const add = (relation: 'LIKES' | 'DISLIKES', raw: string, negated = false) => {
    const t = topic(raw); if (!t || t.length > 24) return;
    out.push({ subject: player(speaker), relation, object: { type: 'Topic', name: t }, negated,
      text: `${speaker} ${negated ? 'no longer likes' : relation === 'LIKES' ? 'likes' : 'dislikes'} ${t}`, validAt: at });
  };
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`我(?:已经)?不再(?:喜欢|爱)${CLAUSE}`).exec(message))) add('LIKES', m[1]!, true);
  else if ((m = new RegExp(`我(?:不太|不|很不|最不)喜欢${CLAUSE}`).exec(message)) || (m = new RegExp(`我(?:很|最|超)?讨厌${CLAUSE}`).exec(message))) add('DISLIKES', m[1]!);
  else if ((m = new RegExp(`我(?:最|很|超|也|真的|特别|还是)?(?:喜欢|爱)${CLAUSE}`).exec(message))) add('LIKES', m[1]!);
  if ((m = /\bi (?:no longer|don't|do not) (?:like|love) ([^,.!?;\n]{1,40})/i.exec(message)))
    /no longer/i.test(m[0]) ? add('LIKES', m[1]!, true) : add('DISLIKES', m[1]!);
  else if ((m = /\bi (?:hate|dislike) ([^,.!?;\n]{1,40})/i.exec(message))) add('DISLIKES', m[1]!);
  else if ((m = /\bi (?:really |also )?(?:like|love) ([^,.!?;\n]{1,40})/i.exec(message))) add('LIKES', m[1]!);
  return out;
}
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---- structured producers ----
export interface HomeSet { owner: string; ownerType?: 'Agent' | 'Player'; name: string; pos: BlockPos; world: WorldRef | null; at: string; text?: string }
export function homeSet(h: HomeSet): EpisodeDraft {
  const place = locationRef(h.world, `home:${h.name}`);
  const coords = formatPos(h.pos);
  return { kind: 'home', occurredAt: h.at, world: h.world, actors: [h.owner], importance: 0.8,
    text: h.text ?? `${h.owner} set home "${h.name}" at ${coords}`, data: { name: h.name, pos: h.pos },
    source: { type: 'structured', eventType: 'home.set' },
    facts: [{ subject: { type: h.ownerType ?? 'Player', name: h.owner }, relation: 'HOME_AT', object: place, value: coords,
      text: `${h.owner}'s home "${h.name}" is at ${coords} in ${place.name.split('|')[0]}`, validAt: h.at }] };
}

export interface LocationVisit { who: string; whoType?: 'Agent' | 'Player'; label?: string; pos: BlockPos; world: WorldRef | null; at: string }
/** Without a label the place is the 16x16 chunk, so walking around does not create a fact per block. */
export function locationVisit(v: LocationVisit): EpisodeDraft {
  const label = v.label ?? `chunk:${Math.floor(v.pos.x / 16)},${Math.floor(v.pos.z / 16)}`;
  const place = locationRef(v.world, label);
  return { kind: 'location', occurredAt: v.at, world: v.world, actors: [v.who], importance: v.label ? 0.5 : 0.2,
    text: `${v.who} is at ${label} (${formatPos(v.pos)})`, data: { label, pos: v.pos },
    source: { type: 'structured', eventType: 'location.visit' },
    facts: [{ subject: { type: v.whoType ?? 'Agent', name: v.who }, relation: 'LOCATED_AT', object: place,
      text: `${v.who} is at ${place.name}`, validAt: v.at }] };
}

export function skillLevel(who: string, whoType: 'Agent' | 'Player', skill: string, level: number, at: string, world: WorldRef | null = null): EpisodeDraft {
  return { kind: 'skill', occurredAt: at, world, actors: [who], importance: 0.5, text: `${who} reached ${skill} level ${level}`,
    data: { skill, level }, source: { type: 'structured', eventType: 'skill.level' }, facts: [skillFact(who, whoType, skill, level, at)] };
}

export function taskEpisode(self: string, id: string, phase: string, at: string, title?: string, world: WorldRef | null = null): EpisodeDraft {
  return { kind: 'task', occurredAt: at, world, actors: [self], importance: ['completed', 'blocked', 'partial'].includes(phase) ? 0.6 : 0.3,
    text: `task ${title ?? id}: ${phase}`, data: { taskId: id, phase, title: title ?? null },
    source: { type: 'structured', eventType: 'task' }, facts: taskFacts(self, id, phase, at, title) };
}

const COMMON = /(?:^|_)(dirt|cobblestone|stone|cobbled_deepslate|deepslate|gravel|sand|netherrack|andesite|diorite|granite|tuff|grass_block|rotten_flesh|stick|seeds|wheat_seeds)$/;
const NOTABLE = /(diamond|netherite|elytra|totem|emerald|ancient_debris|enchanted|beacon|nether_star|trident|shulker|golden_apple|ender_pearl|ender_eye|bed$|boat$|fishing_rod)/;

/**
 * Turns full inventory reads into meaningful deltas only (design §5: no full-inventory dumps).
 * Notable items: every count change. Other non-common items: only acquiring the first or losing the last one.
 * The first observation is a silent baseline.
 */
export class InventoryDeltaTracker {
  private last: Map<string, number> | null = null;
  constructor(private readonly self: string) {}

  observe(counts: Readonly<Record<string, number>>, at: string, world: WorldRef | null = null): EpisodeDraft | null {
    const next = new Map(Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => [k.replace(/^minecraft:/, ''), n] as const));
    const prev = this.last; this.last = next;
    if (!prev) return null;
    const facts: FactInput[] = []; const changes: string[] = [];
    for (const item of new Set([...prev.keys(), ...next.keys()])) {
      const a = prev.get(item) ?? 0, b = next.get(item) ?? 0;
      if (a === b || COMMON.test(item)) continue;
      const notable = NOTABLE.test(item);
      if (!notable && a > 0 && b > 0) continue;
      changes.push(`${item} ${a}→${b}`);
      const owns = { subject: agent(this.self), relation: 'OWNS', object: { type: 'Item' as const, name: item }, validAt: at };
      facts.push(b === 0 ? { ...owns, negated: true, text: `${this.self} no longer has ${item}` }
        : { ...owns, value: b, text: `${this.self} has ${b} ${item}` });
    }
    if (!facts.length) return null;
    return { kind: 'inventory', occurredAt: at, world, actors: [this.self], importance: facts.some(f => NOTABLE.test(f.object!.name)) ? 0.6 : 0.3,
      text: `inventory change: ${changes.join(', ')}`, data: { changes }, source: { type: 'structured', eventType: 'inventory.delta' }, facts };
  }
}

export function noteEpisode(author: string, text: string, at: string, world: WorldRef | null = null, facts: FactInput[] = []): EpisodeDraft {
  return { kind: 'note', occurredAt: at, world, actors: [author], importance: 0.6, text, data: {},
    source: { type: 'tool:memory_remember' }, facts };
}
