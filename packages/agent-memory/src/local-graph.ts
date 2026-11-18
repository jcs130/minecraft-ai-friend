import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { entityId, normalizeName, parseEntitySelector } from './scope.ts';
import { normalizeRelation, relationPolicy } from './relations.ts';
import type { EntityRef, Episode, Fact, FactInput, FactQuery, GraphHealth, MemoryGraph, MergeResult } from './types.ts';

const MAX_LIMIT = 200;
type Row = Record<string, string | number | null>;
type Value = string | number | boolean | null;

export interface LocalGraphOptions { now?: () => Date }

/**
 * In-process bi-temporal knowledge graph over SQLite. Same contract as the Graphiti backend, but with
 * deterministic, rule-based merging (no LLM): used as the default backend, as the fallback when the
 * sidecar is down, and for deterministic tests.
 *
 * Versioning: a fact row is immutable except for `expired_at`. Invalidating a fact expires the current
 * version and writes a new version carrying `invalid_at`, so "what did we believe at system time K"
 * (`knownAt`) stays answerable.
 */
export class LocalTemporalGraph implements MemoryGraph {
  readonly backend = 'local' as const;
  private readonly now: () => Date;

  constructor(private readonly db: DatabaseSync, options: LocalGraphOptions = {}) {
    this.now = options.now ?? (() => new Date());
    db.exec(`CREATE TABLE IF NOT EXISTS entities (
      scope_key TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, name_norm TEXT NOT NULL,
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (scope_key, id));
    CREATE TABLE IF NOT EXISTS facts (
      scope_key TEXT NOT NULL, id TEXT NOT NULL PRIMARY KEY, fact_id TEXT NOT NULL,
      subject_id TEXT NOT NULL, subject_type TEXT NOT NULL, subject_name TEXT NOT NULL, subject_norm TEXT NOT NULL,
      relation TEXT NOT NULL,
      object_id TEXT NOT NULL, object_type TEXT, object_name TEXT, object_norm TEXT,
      value TEXT, text TEXT NOT NULL,
      valid_at TEXT NOT NULL, invalid_at TEXT, created_at TEXT NOT NULL, expired_at TEXT,
      episodes TEXT NOT NULL, superseded_by TEXT);
    CREATE INDEX IF NOT EXISTS facts_key ON facts(scope_key, subject_id, relation, object_id);
    CREATE INDEX IF NOT EXISTS facts_live ON facts(scope_key, expired_at, invalid_at);
    CREATE INDEX IF NOT EXISTS facts_lineage ON facts(fact_id);`);
  }

  async addEpisode(episode: Episode, facts: readonly FactInput[]): Promise<MergeResult> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.mergeInTransaction(episode, facts);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** @internal The caller owns the transaction when archiving the episode alongside its facts. */
  mergeInTransaction(episode: Episode, facts: readonly FactInput[]): MergeResult {
    const result: MergeResult = { added: [], confirmed: [], invalidated: [] };
    for (const input of facts) this.merge(episode, input, result);
    return result;
  }

  private merge(episode: Episode, raw: FactInput, out: MergeResult): void {
    const scope = episode.scopeKey;
    const relation = normalizeRelation(raw.relation);
    const policy = relationPolicy(relation);
    const t = iso(raw.validAt);
    const value = raw.value ?? null;
    const subjectId = entityId(raw.subject), objectId = raw.object ? entityId(raw.object) : '';
    this.touch(scope, raw.subject, t);
    if (raw.object) this.touch(scope, raw.object, t);
    const live = (where: string, ...args: (string | null)[]) => this.db.prepare(
      `SELECT * FROM facts WHERE scope_key = ? AND expired_at IS NULL AND ${where}`).all(scope, ...args) as Row[];
    const activeAt = (r: Row) => String(r.valid_at) <= t && (r.invalid_at === null || String(r.invalid_at) > t);
    const same = live('subject_id = ? AND relation = ? AND object_id = ?', subjectId, relation, objectId);

    if (raw.negated) {
      for (const r of same) if (activeAt(r)) out.invalidated.push(this.closeRow(r, t, null, episode.id));
      return;
    }
    const encoded = encodeValue(value);
    if (policy.event) {
      const dup = same.find(r => r.value === encoded && r.valid_at === t);
      if (dup) out.confirmed.push(this.confirm(dup, episode.id));
      else out.added.push(this.insert(scope, raw, relation, t, raw.invalidAt ? iso(raw.invalidAt) : null, episode.id));
      return;
    }
    const identical = same.filter(r => r.value === encoded && r.invalid_at === null);
    const identicalActive = identical.find(activeAt);
    if (identicalActive) { out.confirmed.push(this.confirm(identicalActive, episode.id)); return; }

    let contradicting: Row[] = [];
    if (policy.exclusive === 'subject')
      contradicting = live('subject_id = ? AND relation = ?', subjectId, relation)
        .filter(r => r.object_id !== objectId || r.value !== encoded);
    else if (policy.exclusive === 'subject-object')
      contradicting = same.filter(r => r.value !== encoded);
    for (const other of policy.conflicts ?? [])
      contradicting.push(...live('subject_id = ? AND relation = ? AND object_id = ?', subjectId, other, objectId));

    const factId = `f_${randomUUID()}`;
    let invalidAt = raw.invalidAt ? iso(raw.invalidAt) : null;
    for (const r of contradicting) {
      if (activeAt(r)) out.invalidated.push(this.closeRow(r, t, factId, episode.id));
      else if (String(r.valid_at) > t) invalidAt = invalidAt && invalidAt < String(r.valid_at) ? invalidAt : String(r.valid_at);
    }
    // Identical assertion known only from a later time: extend it backwards instead of duplicating.
    const later = identical.find(r => String(r.valid_at) > t && (invalidAt === null || invalidAt >= String(r.valid_at)));
    if (later) { out.confirmed.push(this.reversion(later, { valid_at: t }, episode.id)); return; }
    out.added.push(this.insert(scope, raw, relation, t, invalidAt, episode.id, factId));
  }

  private touch(scope: string, ref: EntityRef, at: string): void {
    this.db.prepare(`INSERT INTO entities VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(scope_key, id) DO UPDATE SET
        first_seen = min(first_seen, excluded.first_seen), last_seen = max(last_seen, excluded.last_seen)`)
      .run(scope, entityId(ref), ref.type, ref.name, normalizeName(ref.name), at, at);
  }

  private insert(scope: string, f: FactInput, relation: string, validAt: string, invalidAt: string | null,
    episodeId: string, factId = `f_${randomUUID()}`): Fact {
    const id = `v_${randomUUID()}`;
    this.db.prepare(`INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      scope, id, factId, entityId(f.subject), f.subject.type, f.subject.name, normalizeName(f.subject.name), relation,
      f.object ? entityId(f.object) : '', f.object?.type ?? null, f.object?.name ?? null, f.object ? normalizeName(f.object.name) : null,
      encodeValue(f.value ?? null), f.text, validAt, invalidAt, this.stamp(), null, JSON.stringify([episodeId]), null);
    return this.read(id);
  }

  /** Expire `row` and write its successor version with the given changes. */
  private reversion(row: Row, changes: Partial<Record<'valid_at' | 'invalid_at' | 'superseded_by', string | null>>, episodeId: string): Fact {
    const now = this.stamp();
    const episodes = [...new Set([...JSON.parse(String(row.episodes)) as string[], episodeId])];
    const id = `v_${randomUUID()}`;
    this.db.prepare('UPDATE facts SET expired_at = ? WHERE id = ?').run(now, String(row.id));
    const next: Row = { ...row, ...changes, id, created_at: now, expired_at: null, episodes: JSON.stringify(episodes) };
    this.db.prepare(`INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      next.scope_key, next.id, next.fact_id, next.subject_id, next.subject_type, next.subject_name, next.subject_norm, next.relation,
      next.object_id, next.object_type, next.object_name, next.object_norm, next.value, next.text, next.valid_at, next.invalid_at,
      next.created_at, next.expired_at, next.episodes, next.superseded_by);
    return this.read(id);
  }

  private closeRow(row: Row, at: string, supersededBy: string | null, episodeId: string): Fact {
    return this.reversion(row, { invalid_at: at, superseded_by: supersededBy }, episodeId);
  }

  /** Re-confirmation only appends provenance; it does not change belief, so no new version. */
  private confirm(row: Row, episodeId: string): Fact {
    const episodes = [...new Set([...JSON.parse(String(row.episodes)) as string[], episodeId])];
    this.db.prepare('UPDATE facts SET episodes = ? WHERE id = ?').run(JSON.stringify(episodes), String(row.id));
    return this.read(String(row.id));
  }

  private read(id: string): Fact { return toFact(this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as Row); }

  private stamp(): string {
    // Strictly increasing system time so that expire/create ordering is total within one process.
    let now = this.now().toISOString();
    if (this.lastStamp && now <= this.lastStamp) now = new Date(Date.parse(this.lastStamp) + 1).toISOString();
    this.lastStamp = now;
    return now;
  }
  private lastStamp: string | null = null;

  async currentFacts(scopeKey: string, q: FactQuery): Promise<Fact[]> {
    return this.select(scopeKey, q, 'expired_at IS NULL AND invalid_at IS NULL', []);
  }

  async factsAt(scopeKey: string, at: string, q: FactQuery, options: { knownAt?: string } = {}): Promise<Fact[]> {
    const t = iso(at);
    const valid = 'valid_at <= ? AND (invalid_at IS NULL OR invalid_at > ?)';
    if (!options.knownAt) return this.select(scopeKey, q, `expired_at IS NULL AND ${valid}`, [t, t]);
    const k = iso(options.knownAt);
    return this.select(scopeKey, q, `created_at <= ? AND (expired_at IS NULL OR expired_at > ?) AND ${valid}`, [k, k, t, t]);
  }

  async history(scopeKey: string, q: FactQuery): Promise<Fact[]> {
    return (await this.select(scopeKey, { ...q, limit: q.limit ?? MAX_LIMIT }, 'expired_at IS NULL', []))
      .sort((a, b) => a.validAt.localeCompare(b.validAt));
  }

  private async select(scopeKey: string, q: FactQuery, temporal: string, temporalArgs: string[]): Promise<Fact[]> {
    const where = ['scope_key = ?', temporal]; const args: string[] = [scopeKey, ...temporalArgs];
    if (q.entity) {
      const sel = parseEntitySelector(q.entity);
      const typed = sel.type ? ' AND subject_type = ?' : '', typedObj = sel.type ? ' AND object_type = ?' : '';
      where.push(`((subject_norm = ? OR subject_norm LIKE ?)${typed} OR (object_norm = ? OR object_norm LIKE ?)${typedObj})`);
      args.push(sel.name, `%|${sel.name}`, ...(sel.type ? [sel.type] : []), sel.name, `%|${sel.name}`, ...(sel.type ? [sel.type] : []));
    }
    if (q.relation) { where.push('relation = ?'); args.push(normalizeRelation(q.relation)); }
    const rows = (this.db.prepare(`SELECT * FROM facts WHERE ${where.join(' AND ')} ORDER BY valid_at DESC, created_at DESC`)
      .all(...args) as Row[]).map(toFact);
    const limit = Math.max(1, Math.min(MAX_LIMIT, q.limit ?? 20));
    if (!q.text) return rows.slice(0, limit);
    const terms = tokenize(q.text);
    return rows.map(f => ({ f, score: lexicalScore(terms, `${f.text} ${f.subject.name} ${f.relation} ${f.object?.name ?? ''} ${f.value ?? ''}`) }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.f);
  }

  async health(): Promise<GraphHealth> { return { ok: true, backend: 'local' }; }
  async close(): Promise<void> { /* database lifetime owned by AgentMemory */ }
}

/** Lowercased word tokens plus CJK bigrams, so Chinese queries match without a segmenter. */
export function tokenize(text: string): string[] {
  const lower = text.normalize('NFKC').toLowerCase();
  const words = lower.match(/[a-z0-9_:.-]+/g) ?? [];
  const cjk = [...lower.matchAll(/[\u3400-\u9fff]+/g)].flatMap(m => {
    const s = m[0]; if (s.length === 1) return [s];
    return Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
  });
  return [...new Set([...words, ...cjk])];
}
export function lexicalScore(terms: readonly string[], haystack: string): number {
  const h = haystack.normalize('NFKC').toLowerCase();
  return terms.reduce((n, term) => n + (h.includes(term) ? 1 : 0), 0);
}

function iso(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Invalid timestamp: ${value}`);
  return new Date(ms).toISOString();
}
function encodeValue(v: Value | undefined): string | null { return v === null || v === undefined ? null : JSON.stringify(v); }
function toFact(r: Row): Fact {
  return {
    id: String(r.id), factId: String(r.fact_id), scopeKey: String(r.scope_key),
    subject: { type: r.subject_type as EntityRef['type'], name: String(r.subject_name) },
    relation: String(r.relation),
    object: r.object_type ? { type: r.object_type as EntityRef['type'], name: String(r.object_name) } : null,
    value: r.value === null ? null : JSON.parse(String(r.value)), text: String(r.text),
    validAt: String(r.valid_at), invalidAt: r.invalid_at === null ? null : String(r.invalid_at),
    createdAt: String(r.created_at), expiredAt: r.expired_at === null ? null : String(r.expired_at),
    episodes: JSON.parse(String(r.episodes)), supersededBy: r.superseded_by === null ? null : String(r.superseded_by), backend: 'local',
  };
}
