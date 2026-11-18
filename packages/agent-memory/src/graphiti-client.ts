import { MEMORY_PROTOCOL, type EntityRef, type EntityType, type Episode, type Fact, type FactInput, type FactQuery, type GraphHealth, type MemoryGraph, type MergeResult } from './types.ts';

export interface GraphitiClientOptions {
  /** Sidecar base URL, loopback by default. */
  url: string;
  timeoutMs?: number;
  /** Name of an environment variable holding an optional bearer token. The value is never logged. */
  tokenEnv?: string;
  fetch?: typeof fetch;
}

interface EdgeOut {
  uuid: string; name: string; fact: string; group_id: string;
  source: { uuid: string; name: string; labels?: string[] }; target: { uuid: string; name: string; labels?: string[] };
  valid_at: string | null; invalid_at: string | null; created_at: string; expired_at: string | null; episodes?: string[];
}

const TYPES: readonly EntityType[] = ['Agent', 'Player', 'Location', 'Building', 'Skill', 'Item', 'Task', 'Topic', 'World'];

/**
 * Warm-layer client for the Graphiti sidecar (graphiti-sidecar/). Graphiti performs LLM entity/edge extraction,
 * deduplication and contradiction-driven invalidation itself; this client forwards the raw episode text plus the
 * rule-extracted facts as hints, and maps Graphiti EntityEdges back to the shared `Fact` shape.
 */
export class GraphitiMemoryGraph implements MemoryGraph {
  readonly backend = 'graphiti' as const;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: GraphitiClientOptions) {
    const url = new URL(options.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Graphiti sidecar URL');
    this.fetcher = options.fetch ?? fetch;
  }

  private async call<T>(path: string, body?: unknown, timeoutMs = this.options.timeoutMs ?? 120_000): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = this.options.tokenEnv ? process.env[this.options.tokenEnv] : undefined;
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await this.fetcher(new URL(path, this.options.url), {
      method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify({ protocol: MEMORY_PROTOCOL, ...body as object }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Graphiti sidecar ${path} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }

  async addEpisode(episode: Episode, facts: readonly FactInput[]): Promise<MergeResult> {
    const reply = await this.call<{ edges: EdgeOut[]; invalidated: EdgeOut[] }>('/episodes', {
      group_id: episode.scopeKey,
      episode: { id: episode.id, kind: episode.kind, name: `${episode.kind}:${episode.id}`, body: episode.text,
        source_description: `minecraft ${episode.kind} (${episode.source.type}${episode.source.eventType ? ` ${episode.source.eventType}` : ''})`,
        reference_time: episode.occurredAt, actors: episode.actors },
      hints: facts.map(f => `${f.negated ? 'NOT ' : ''}${f.subject.type}:${f.subject.name} ${f.relation} ${f.object ? `${f.object.type}:${f.object.name}` : ''}${f.value !== undefined && f.value !== null ? ` = ${f.value}` : ''}`),
    });
    return { added: reply.edges.map(e => toFact(e)), confirmed: [], invalidated: reply.invalidated.map(e => toFact(e)) };
  }

  async currentFacts(scopeKey: string, q: FactQuery): Promise<Fact[]> {
    return this.search(scopeKey, q, {});
  }
  async factsAt(scopeKey: string, at: string, q: FactQuery, options: { knownAt?: string } = {}): Promise<Fact[]> {
    return this.search(scopeKey, q, { at, known_at: options.knownAt });
  }
  async history(scopeKey: string, q: FactQuery): Promise<Fact[]> {
    return (await this.search(scopeKey, q, { history: true })).sort((a, b) => a.validAt.localeCompare(b.validAt));
  }
  private async search(scopeKey: string, q: FactQuery, extra: Record<string, unknown>): Promise<Fact[]> {
    const query = [q.text, q.entity?.replace(/^[A-Za-z]+:/, ''), q.relation].filter(Boolean).join(' ') || 'facts';
    const reply = await this.call<{ facts: EdgeOut[] }>('/search', { group_id: scopeKey, query, limit: q.limit ?? 20, ...extra },
      this.options.timeoutMs ?? 30_000);
    let facts = reply.facts.filter(e => e.group_id === scopeKey).map(e => toFact(e));
    if (q.relation) facts = facts.filter(f => f.relation === q.relation!.toUpperCase());
    return facts;
  }

  async health(): Promise<GraphHealth> {
    try {
      const h = await this.call<{ ok: boolean; driver?: string; llm?: string; embedder?: string }>('/health', undefined, 5_000);
      return { ok: h.ok, backend: 'graphiti', detail: `driver=${h.driver ?? '?'} llm=${h.llm ?? '?'} embedder=${h.embedder ?? '?'}` };
    } catch (error) {
      return { ok: false, backend: 'graphiti', detail: String((error as Error).message ?? error).slice(0, 200) };
    }
  }
  async close(): Promise<void> { /* stateless HTTP */ }
}

function entity(n: EdgeOut['source']): EntityRef {
  const label = n.labels?.find(l => (TYPES as readonly string[]).includes(l)) as EntityType | undefined;
  return { type: label ?? 'Topic', name: n.name };
}
function toFact(e: EdgeOut): Fact {
  return { id: e.uuid, factId: e.uuid, scopeKey: e.group_id, subject: entity(e.source), relation: e.name, object: entity(e.target),
    value: null, text: e.fact, validAt: e.valid_at ?? e.created_at, invalidAt: e.invalid_at, createdAt: e.created_at,
    expiredAt: e.expired_at, episodes: e.episodes ?? [], supersededBy: null, backend: 'graphiti' };
}
