import type { DatabaseSync } from 'node:sqlite';
import type { ColdStore, Episode, EpisodeQuery } from './types.ts';

const MAX_LIMIT = 200;

/** Append-only raw episode log (cold layer). Rows are never updated or deleted. */
export class SqliteColdStore implements ColdStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS episodes (
      scope_key TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, text TEXT NOT NULL,
      actors TEXT NOT NULL, world TEXT, data TEXT NOT NULL, importance REAL NOT NULL, source TEXT NOT NULL,
      PRIMARY KEY (scope_key, id));
    CREATE INDEX IF NOT EXISTS episodes_time ON episodes(scope_key, occurred_at);
    CREATE TRIGGER IF NOT EXISTS episodes_append_only_update BEFORE UPDATE ON episodes
      BEGIN SELECT RAISE(ABORT, 'episodes are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS episodes_append_only_delete BEFORE DELETE ON episodes
      BEGIN SELECT RAISE(ABORT, 'episodes are append-only'); END;`);
  }

  append(e: Episode): void {
    this.db.prepare(`INSERT OR IGNORE INTO episodes VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      e.scopeKey, e.id, e.kind, e.occurredAt, e.recordedAt, e.text, JSON.stringify(e.actors),
      e.world ? JSON.stringify(e.world) : null, JSON.stringify(e.data), e.importance, JSON.stringify(e.source));
  }

  get(scopeKey: string, id: string): Episode | null {
    const row = this.db.prepare('SELECT * FROM episodes WHERE scope_key = ? AND id = ?').get(scopeKey, id);
    return row ? toEpisode(row as Row) : null;
  }

  recent(scopeKey: string, q: EpisodeQuery = {}): Episode[] {
    const where = ['scope_key = ?']; const args: (string | number)[] = [scopeKey];
    if (q.kinds?.length) { where.push(`kind IN (${q.kinds.map(() => '?').join(',')})`); args.push(...q.kinds); }
    if (q.actor) { where.push('lower(actors) LIKE ?'); args.push(`%${JSON.stringify(q.actor.toLowerCase())}%`); }
    if (q.text) { where.push('lower(text) LIKE ?'); args.push(`%${q.text.toLowerCase()}%`); }
    if (q.since) { where.push('occurred_at >= ?'); args.push(new Date(q.since).toISOString()); }
    if (q.until) { where.push('occurred_at <= ?'); args.push(new Date(q.until).toISOString()); }
    const limit = Math.max(1, Math.min(MAX_LIMIT, q.limit ?? 20));
    return (this.db.prepare(`SELECT * FROM episodes WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC, recorded_at DESC LIMIT ${limit}`)
      .all(...args) as Row[]).map(toEpisode);
  }

  count(scopeKey: string): number {
    return Number((this.db.prepare('SELECT count(*) AS n FROM episodes WHERE scope_key = ?').get(scopeKey) as { n: number }).n);
  }

  close(): void { /* database lifetime owned by AgentMemory */ }
}

type Row = Record<string, string | number | null>;
function toEpisode(r: Row): Episode {
  return {
    scopeKey: String(r.scope_key), id: String(r.id), kind: r.kind as Episode['kind'],
    occurredAt: String(r.occurred_at), recordedAt: String(r.recorded_at), text: String(r.text),
    actors: JSON.parse(String(r.actors)), world: r.world ? JSON.parse(String(r.world)) : null,
    data: JSON.parse(String(r.data)), importance: Number(r.importance), source: JSON.parse(String(r.source)),
  };
}
