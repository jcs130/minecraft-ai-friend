import { noteEpisode, type SourceContext } from './minecraft-source.ts';
import { normalizeRelation } from './relations.ts';
import type { ScopedMemory } from './memory.ts';
import type { EntityType, Episode, EpisodeKind, Fact, FactInput } from './types.ts';

/** Structural subset of agent-mc-world `ToolDef`; assignable to it without importing that package. */
export interface MemoryToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  tags: readonly ('read' | 'write')[];
  bodyControl: 'independent';
  readOnlyCall?(args: Record<string, unknown>): boolean;
  handler(args: Record<string, unknown>, context?: unknown): Promise<{ text: string; data?: Record<string, unknown>; failed?: true }>;
}

/** Resolves the memory partition for the current connection; null while scope/world is unknown. */
export type MemoryResolver = () => { memory: ScopedMemory; context: SourceContext } | null;

const ENTITY_TYPES: EntityType[] = ['Agent', 'Player', 'Location', 'Building', 'Skill', 'Item', 'Task', 'Topic', 'World'];
const KINDS: EpisodeKind[] = ['chat', 'whisper', 'player_join', 'player_leave', 'death', 'respawn', 'inventory', 'task', 'location', 'home', 'skill', 'note', 'event'];
const query = {
  entity: { type: 'string', description: 'Entity name or Type:name, e.g. "Steve", "Player:Steve", "home:base"' },
  relation: { type: 'string', description: 'Relation, e.g. LIKES, HOME_AT, KNOWS, OWNS, HAS_LEVEL, DIED_AT' },
  text: { type: 'string', description: 'Free-text search over remembered facts' },
  limit: { type: 'integer', minimum: 1, maximum: 50 },
};

export function renderFact(f: Fact): string {
  const span = `${f.validAt.slice(0, 16)}Z→${f.invalidAt ? `${f.invalidAt.slice(0, 16)}Z` : 'now'}`;
  const object = f.object ? ` ${f.object.name}` : '';
  const value = f.value !== null ? ` = ${f.value}` : '';
  return `- [${span}] ${f.subject.name} ${f.relation}${object}${value} — ${f.text} (${f.backend}, ${f.episodes.length} ep)`;
}
function renderEpisode(e: Episode): string { return `- ${e.occurredAt.slice(0, 19)}Z [${e.kind}] ${e.text.slice(0, 200)} (id ${e.id})`; }
function str(v: unknown): string | undefined { return typeof v === 'string' && v.trim() ? v.trim() : undefined; }
function lim(v: unknown, d: number): number { return typeof v === 'number' && Number.isInteger(v) ? Math.max(1, Math.min(50, v)) : d; }
const unavailable = { text: 'Memory is not ready: game scope or world identity not yet observed. Retry after the body is connected.', failed: true as const };

export function createMemoryTools(resolve: MemoryResolver): MemoryToolDef[] {
  return [
    {
      name: 'memory_query', tags: ['read'], bodyControl: 'independent', readOnlyCall: () => true,
      description: 'Recall what you currently believe about players, places, items, skills and tasks in this server (long-term memory). '
        + 'Returns only facts still valid now, newest first, with provenance. Historical memory may be stale: re-observe the world before acting on positions or inventory.',
      parameters: { type: 'object', properties: { ...query, history: { type: 'boolean', description: 'Include superseded versions (full timeline)' } }, additionalProperties: false },
      handler: async args => {
        const r = resolve(); if (!r) return unavailable;
        const q = { entity: str(args.entity), relation: str(args.relation), text: str(args.text), limit: lim(args.limit, 12) };
        const res = args.history === true ? await r.memory.history(q) : await r.memory.currentFacts(q);
        const head = res.facts.length ? `${res.facts.length} remembered fact(s):` : 'No matching memory (absence is not proof of a first meeting).';
        return { text: [head, ...res.facts.map(renderFact), ...(res.degraded ? [`(degraded: ${res.degraded})`] : [])].join('\n'),
          data: { facts: res.facts, degraded: res.degraded ?? null } };
      },
    },
    {
      name: 'memory_recall_at', tags: ['read'], bodyControl: 'independent', readOnlyCall: () => true,
      description: 'Point-in-time recall: what was true at a past moment (ISO time). Optional known_at answers "what did I believe back then".',
      parameters: { type: 'object', required: ['at'], properties: { at: { type: 'string', description: 'ISO-8601 time' },
        known_at: { type: 'string', description: 'ISO-8601 system time of belief (optional)' }, ...query }, additionalProperties: false },
      handler: async args => {
        const r = resolve(); if (!r) return unavailable;
        const at = str(args.at); if (!at || !Number.isFinite(Date.parse(at))) return { text: 'at must be an ISO-8601 time', failed: true };
        const knownAt = str(args.known_at);
        if (knownAt && !Number.isFinite(Date.parse(knownAt))) return { text: 'known_at must be an ISO-8601 time', failed: true };
        const res = await r.memory.factsAt(at, { entity: str(args.entity), relation: str(args.relation), text: str(args.text), limit: lim(args.limit, 12) }, { knownAt });
        return { text: [`Facts valid at ${new Date(at).toISOString()}${knownAt ? ` as believed at ${knownAt}` : ''}: ${res.facts.length}`,
          ...res.facts.map(renderFact), ...(res.degraded ? [`(degraded: ${res.degraded})`] : [])].join('\n'), data: { facts: res.facts } };
      },
    },
    {
      name: 'memory_recent', tags: ['read'], bodyControl: 'independent', readOnlyCall: () => true,
      description: 'Read recent raw episodes (chat, joins, deaths, homes, tasks, notes) from the cold log, with original text as evidence.',
      parameters: { type: 'object', properties: { kinds: { type: 'array', items: { enum: KINDS } }, actor: { type: 'string' },
        text: { type: 'string' }, since: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
      handler: async args => {
        const r = resolve(); if (!r) return unavailable;
        const kinds = Array.isArray(args.kinds) ? args.kinds.filter((k): k is EpisodeKind => KINDS.includes(k as EpisodeKind)) : undefined;
        const eps = r.memory.recentEpisodes({ kinds, actor: str(args.actor), text: str(args.text), since: str(args.since), limit: lim(args.limit, 10) });
        return { text: [`${eps.length} episode(s):`, ...eps.map(renderEpisode)].join('\n'), data: { episodes: eps } };
      },
    },
    {
      name: 'memory_remember', tags: ['write'], bodyControl: 'independent', readOnlyCall: () => false,
      description: 'Write a note into long-term memory, optionally with one structured fact (subject relation object/value). '
        + 'A new fact that contradicts an old one (e.g. a moved home) supersedes it; the old one stays in history. Use negate to record that something stopped being true.',
      parameters: { type: 'object', required: ['text'], additionalProperties: false, properties: {
        text: { type: 'string', maxLength: 1000, description: 'What to remember, in your own words' },
        speaker: { type: 'string', description: 'Who reported it (player name) if not your own observation' },
        fact: { type: 'object', additionalProperties: false, required: ['subject', 'relation'], properties: {
          subject: { type: 'string', description: 'Type:name, e.g. Player:Steve' }, relation: { type: 'string' },
          object: { type: 'string', description: 'Type:name (optional)' }, value: { type: ['string', 'number', 'boolean'] },
          negate: { type: 'boolean' }, valid_at: { type: 'string', description: 'ISO time it became true; default now' } } } } },
      handler: async args => {
        const r = resolve(); if (!r) return unavailable;
        const text = str(args.text); if (!text || text.length > 1000) return { text: 'text is required (≤1000 chars)', failed: true };
        const now = new Date().toISOString();
        const facts: FactInput[] = [];
        const f = args.fact as Record<string, unknown> | undefined;
        if (f) {
          const subject = entityArg(f.subject), object = f.object === undefined ? null : entityArg(f.object);
          if (!subject || (f.object !== undefined && !object)) return { text: 'fact.subject/object must be Type:name with Type in ' + ENTITY_TYPES.join('|'), failed: true };
          let relation: string; try { relation = normalizeRelation(String(f.relation)); } catch { return { text: 'invalid fact.relation', failed: true }; }
          const validAt = str(f.valid_at) ?? now;
          if (!Number.isFinite(Date.parse(validAt))) return { text: 'fact.valid_at must be ISO-8601', failed: true };
          const value = ['string', 'number', 'boolean'].includes(typeof f.value) ? f.value as string | number | boolean : null;
          facts.push({ subject, relation, object, value, negated: f.negate === true, validAt, text });
        }
        const speaker = str(args.speaker);
        const draft = noteEpisode(speaker ?? r.context.self, speaker ? `${speaker} reported: ${text}` : text, now, r.context.world, facts);
        const res = await r.memory.ingest(draft);
        return { text: `Remembered (episode ${res.episode.id}); added ${res.local.added.length}, confirmed ${res.local.confirmed.length}, superseded ${res.local.invalidated.length}.`,
          data: { episode: res.episode.id, added: res.local.added, invalidated: res.local.invalidated } };
      },
    },
  ];
}

function entityArg(v: unknown): { type: EntityType; name: string } | null {
  if (typeof v !== 'string') return null;
  const m = /^([A-Za-z]+):(.{1,200})$/.exec(v.trim());
  if (!m) return null;
  const type = ENTITY_TYPES.find(t => t.toLowerCase() === m[1]!.toLowerCase());
  return type ? { type, name: m[2]!.trim() } : null;
}
