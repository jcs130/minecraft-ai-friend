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
  private queue: Array<{ episode: Episode; draft: EpisodeDraft }> = [];
  private draining: Promise<void> | null = null;
  readonly stats = { ingested: 0, duplicates: 0, graphitiOk: 0, graphitiFailed: 0, graphitiDropped: 0 };

  constructor(private readonly options: AgentMemoryOptions) {
    this.db = openDatabase(options.dataDir === ':memory:' ? ':memory:' : join(options.dataDir, 'agent-memory.sqlite'));
    this.now = options.now ?? (() => new Date());
    this.cold = new SqliteColdStore(this.db);
    this.local = new LocalTemporalGraph(this.db, { now: this.now });
    const backend = options.backend ?? 'local';
    if (backend === 'hybrid' && !options.graphiti) throw new Error('hybrid backend requires graphiti sidecar options');
    this.graphiti = backend === 'hybrid' ? new GraphitiMemoryGraph(options.graphiti!) : null;
  }

  scope(scope: MemoryScope): ScopedMemory { return new ScopedMemory(this, scope, scopeKey(scope)); }

  /** @internal */
  async ingest(key: string, draft: EpisodeDraft): Promise<IngestResult> {
    const id = draft.source.ref
      ? `ep_${createHash('sha256').update(JSON.stringify([key, draft.source.type, draft.source.eventType, draft.source.ref, draft.occurredAt])).digest('hex').slice(0, 24)}`
      : `ep_${randomUUID()}`;
    const existing = this.cold.get(key, id);
    if (existing) {
      this.stats.duplicates++;
      return { episode: existing, duplicate: true, local: { added: [], confirmed: [], invalidated: [] }, queuedForGraphiti: false };
    }
    const episode: Episode = { id, scopeKey: key, kind: draft.kind, occurredAt: new Date(draft.occurredAt).toISOString(),
      recordedAt: this.now().toISOString(), text: draft.text, actors: draft.actors, world: draft.world, data: draft.data,
      importance: draft.importance, source: draft.source };
    this.cold.append(episode);
    const local = await this.local.addEpisode(episode, draft.facts);
    this.stats.ingested++;
    let queued = false;
    if (this.graphiti) { queued = this.enqueue(episode, draft); }
    return { episode, duplicate: false, local, queuedForGraphiti: queued };
  }

  private enqueue(episode: Episode, draft: EpisodeDraft): boolean {
    const max = this.options.maxPending ?? 500;
    if (this.queue.length >= max) {
      const idx = this.queue.reduce((lo, item, i, all) => item.episode.importance < all[lo]!.episode.importance ? i : lo, 0);
      if (this.queue[idx]!.episode.importance > episode.importance) { this.stats.graphitiDropped++; return false; }
      this.queue.splice(idx, 1); this.stats.graphitiDropped++;
    }
    this.queue.push({ episode, draft });
    this.draining ??= this.drain().finally(() => { this.draining = null; });
    return true;
  }

  /** Graphiti episodes for one group must be processed in order; single background worker. */
  private async drain(): Promise<void> {
    while (this.queue.length) {
      const { episode, draft } = this.queue.shift()!;
      try { await this.graphiti!.addEpisode(episode, draft.facts); this.stats.graphitiOk++; }
      catch (error) {
        this.stats.graphitiFailed++;
        this.options.onWarning?.('graphiti ingest failed; episode kept in cold log', { episode: episode.id, error: String(error).slice(0, 300) });
      }
    }
  }

  /** Wait for background Graphiti ingestion (tests, smoke, shutdown). */
  async flush(): Promise<void> { while (this.draining) await this.draining; }
  pending(): number { return this.queue.length; }

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
}
