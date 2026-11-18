import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteColdStore } from './cold-store.ts';
import { GraphitiMemoryGraph, type GraphitiClientOptions } from './graphiti-client.ts';
import { LocalTemporalGraph } from './local-graph.ts';
import type { EpisodeDraft } from './minecraft-source.ts';
import { scopeKey } from './scope.ts';
import { openDatabase } from './sqlite.ts';
import type { Episode, EpisodeQuery, Fact, FactQuery, GraphHealth, MemoryGraph, MemoryScope, MergeResult } from './types.ts';

export type MemoryBackend = 'local' | 'hybrid';

export interface AgentMemoryOptions {
  /** Persistent directory; `:memory:` for tests. */
  dataDir: string;
  /**
   * `local`: cold log + in-process bi-temporal graph (default, no network, no model).
   * `hybrid`: additionally ingest every episode into the Graphiti sidecar asynchronously and merge its results
   * into reads; any sidecar failure degrades to local results.
   */
  backend?: MemoryBackend;
  graphiti?: GraphitiClientOptions;
  /** Maximum pending sidecar episodes before low-importance ones are dropped (cold log keeps them). */
  maxPending?: number;
  now?: () => Date;
  onWarning?: (message: string, data?: Record<string, unknown>) => void;
}

export interface IngestResult { episode: Episode; duplicate: boolean; local: MergeResult; queuedForGraphiti: boolean }
export interface QueryResult { facts: Fact[]; degraded?: string }

/** Hierarchical memory facade: Cold (episodes) + Warm (temporal graph). Hot context assembly is Phase 2. */
export class AgentMemory {
  readonly db: DatabaseSync;
  readonly cold: SqliteColdStore;
  readonly local: LocalTemporalGraph;
  readonly graphiti: GraphitiMemoryGraph | null;
  private readonly now: () => Date;
  private queue: Array<Pick<Episode, 'id' | 'scopeKey' | 'importance'>> = [];
  private scheduled = new Set<string>();
  private draining: Promise<void> | null = null;
  readonly stats = { ingested: 0, duplicates: 0, graphitiOk: 0, graphitiFailed: 0, graphitiDropped: 0 };

  constructor(private readonly options: AgentMemoryOptions) {
    if (options.maxPending !== undefined && (!Number.isSafeInteger(options.maxPending) || options.maxPending < 0))
      throw new RangeError('maxPending must be a non-negative integer');
    const backend = options.backend ?? 'local';
    if (backend === 'hybrid' && !options.graphiti) throw new Error('hybrid backend requires graphiti sidecar options');
    this.db = openDatabase(options.dataDir === ':memory:' ? ':memory:' : join(options.dataDir, 'agent-memory.sqlite'));
    this.now = options.now ?? (() => new Date());
    this.cold = new SqliteColdStore(this.db);
    this.local = new LocalTemporalGraph(this.db, { now: this.now });
    this.graphiti = backend === 'hybrid' ? new GraphitiMemoryGraph(options.graphiti!) : null;
    if (this.graphiti) this.db.exec(`CREATE TABLE IF NOT EXISTS graphiti_pending (
      scope_key TEXT NOT NULL, episode_id TEXT NOT NULL, hints TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope_key, episode_id),
      FOREIGN KEY(scope_key, episode_id) REFERENCES episodes(scope_key, id))`);
  }

  scope(scope: MemoryScope): ScopedMemory { return new ScopedMemory(this, scope, scopeKey(scope)); }

  /** @internal */
  async ingest(key: string, draft: EpisodeDraft): Promise<IngestResult> {
    const id = draft.source.ref
      ? `ep_${createHash('sha256').update(JSON.stringify([key, draft.source.type, draft.source.eventType, draft.source.ref, draft.occurredAt])).digest('hex').slice(0, 24)}`
      : `ep_${randomUUID()}`;
    const episode: Episode = { id, scopeKey: key, kind: draft.kind, occurredAt: new Date(draft.occurredAt).toISOString(),
      recordedAt: this.now().toISOString(), text: draft.text, actors: draft.actors, world: draft.world, data: draft.data,
      importance: draft.importance, source: draft.source };
    let local: MergeResult;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.cold.get(key, id);
      if (existing) {
        this.db.exec('COMMIT');
        this.stats.duplicates++;
        return { episode: existing, duplicate: true, local: { added: [], confirmed: [], invalidated: [] }, queuedForGraphiti: false };
      }
      this.cold.append(episode);
      local = this.local.mergeInTransaction(episode, draft.facts);
      if (this.graphiti) this.db.prepare('INSERT INTO graphiti_pending(scope_key, episode_id, hints) VALUES (?,?,?)')
        .run(key, id, JSON.stringify(draft.facts));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.stats.ingested++;
    let queued = false;
    if (this.graphiti) { queued = this.enqueue(episode); }
    return { episode, duplicate: false, local, queuedForGraphiti: queued };
  }

  private enqueue(episode: Pick<Episode, 'id' | 'scopeKey' | 'importance'>): boolean {
    if (this.scheduled.has(episode.id)) return false;
    const max = this.options.maxPending ?? 500;
    if (max === 0) { this.stats.graphitiDropped++; return false; }
    if (this.queue.length >= max) {
      const idx = this.queue.reduce((lo, item, i, all) => item.importance < all[lo]!.importance ? i : lo, 0);
      if (this.queue[idx]!.importance > episode.importance) { this.stats.graphitiDropped++; return false; }
      this.scheduled.delete(this.queue[idx]!.id);
      this.queue.splice(idx, 1); this.stats.graphitiDropped++;
    }
    this.scheduled.add(episode.id);
    this.queue.push({ id: episode.id, scopeKey: episode.scopeKey, importance: episode.importance });
    this.startDrain();
    return true;
  }

  private startDrain(): void {
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
      if (this.queue.length) this.startDrain();
    });
  }

  /** Graphiti episodes for one group must be processed in order; single background worker. */
  private async drain(): Promise<void> {
    while (this.queue.length) {
      const { id, scopeKey } = this.queue.shift()!;
      try {
        const pending = this.db.prepare('UPDATE graphiti_pending SET attempts = attempts + 1 WHERE scope_key=? AND episode_id=? RETURNING hints').get(scopeKey, id);
        if (!pending) continue; // Another process may have received the durable remote receipt.
        const original = this.cold.get(scopeKey, id)!; // both rows commit together, linked by a foreign key
        await this.graphiti!.addEpisode(original, JSON.parse(String(pending.hints)));
        this.db.prepare('DELETE FROM graphiti_pending WHERE scope_key=? AND episode_id=?').run(scopeKey, id);
        this.stats.graphitiOk++;
      }
      catch (error) {
        this.stats.graphitiFailed++;
        this.options.onWarning?.('graphiti ingest failed; episode kept in cold log', { episode: id, error: String(error).slice(0, 300) });
      } finally { this.scheduled.delete(id); }
    }
  }

  /** Wait for background Graphiti ingestion (tests, smoke, shutdown). */
  async flush(): Promise<void> { while (this.draining) await this.draining; }
  pending(): number { return this.queue.length; }

  /** Operator-initiated recovery. Reuses the original ID, contents and scope; never dispatches a body action. */
  retryGraphiti(key: string, limit: number): { queued: number; outstanding: number } {
    if (!this.graphiti) throw new Error('Graphiti recovery requires the hybrid backend');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RangeError('Recovery limit must be 1..200');
    const rows = this.db.prepare(`SELECT p.episode_id, e.importance FROM graphiti_pending p
      JOIN episodes e ON e.scope_key=p.scope_key AND e.id=p.episode_id
      WHERE p.scope_key=? ORDER BY p.attempts, p.rowid LIMIT ?`).all(key, limit);
    let queued = 0;
    for (const row of rows) {
      if (this.enqueue({ scopeKey: key, id: String(row.episode_id), importance: Number(row.importance) })) queued++;
    }
    const status = this.db.prepare('SELECT COUNT(*) AS n FROM graphiti_pending WHERE scope_key=?').get(key)!;
    return { queued, outstanding: Number(status.n) };
  }

  async health(): Promise<GraphHealth[]> {
    return [await this.local.health(), ...(this.graphiti ? [await this.graphiti.health()] : [])];
  }

  /** @internal merge local + Graphiti reads; sidecar failure never fails the read. */
  async read(fn: (g: MemoryGraph) => Promise<Fact[]>, limit: number, preferGraphiti: boolean): Promise<QueryResult> {
    const local = await fn(this.local);
    if (!this.graphiti || !preferGraphiti) return { facts: local.slice(0, limit) };
    try {
      const remote = await fn(this.graphiti);
      const seen = new Set(local.map(f => f.text.toLowerCase()));
      return { facts: [...local, ...remote.filter(f => !seen.has(f.text.toLowerCase()))].slice(0, limit) };
    } catch (error) {
      return { facts: local.slice(0, limit), degraded: `graphiti unavailable: ${String((error as Error).message ?? error).slice(0, 160)}` };
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.db.close();
  }
}

/** One agent/server partition. All reads and writes are confined to its scope key. */
export class ScopedMemory {
  constructor(private readonly memory: AgentMemory, readonly scope: MemoryScope, readonly key: string) {}
  ingest(draft: EpisodeDraft): Promise<IngestResult> { return this.memory.ingest(this.key, draft); }
  currentFacts(q: FactQuery = {}, opts: { graphiti?: boolean } = {}): Promise<QueryResult> {
    return this.memory.read(g => g.currentFacts(this.key, q), q.limit ?? 20, opts.graphiti ?? true);
  }
  factsAt(at: string, q: FactQuery = {}, opts: { knownAt?: string; graphiti?: boolean } = {}): Promise<QueryResult> {
    return this.memory.read(g => g.factsAt(this.key, at, q, { knownAt: opts.knownAt }), q.limit ?? 20, opts.graphiti ?? true);
  }
  history(q: FactQuery = {}, opts: { graphiti?: boolean } = {}): Promise<QueryResult> {
    return this.memory.read(g => g.history(this.key, q), q.limit ?? 50, opts.graphiti ?? false);
  }
  recentEpisodes(q: EpisodeQuery = {}): Episode[] { return this.memory.cold.recent(this.key, q); }
  episode(id: string): Episode | null { return this.memory.cold.get(this.key, id); }
  episodeCount(): number { return this.memory.cold.count(this.key); }
  retryPendingGraphiti(limit = 20): { queued: number; outstanding: number } { return this.memory.retryGraphiti(this.key, limit); }
}
