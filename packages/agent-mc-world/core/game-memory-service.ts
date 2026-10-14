/** Optional retrieval providers. The local notebook remains the revision/evidence authority. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameMemoryBook, type GameMemoryContext, type MemoryCandidate } from './game-memory.ts';

export interface GameMemoryConfig {
  mode: 'local' | 'vector' | 'remote';
  endpoint: string; model: string; apiKeyEnv: string; timeoutMs: number;
  provider: 'http' | 'mem0-oss' | 'mem0-platform' | 'bailian' | 'powercontext';
  libraryId: string; projectId: string; scopeId: string;
  searchMode: 'text' | 'vector' | 'hybrid';
}
export const GAME_MEMORY_DEFAULTS: GameMemoryConfig = {
  mode: 'local', endpoint: '', model: '', apiKeyEnv: '', timeoutMs: 3000,
  provider: 'http', libraryId: '', projectId: 'agent-mc', scopeId: '', searchMode: 'text',
};
export const GAME_MEMORY_CONFIG_SCHEMA = Object.fromEntries(Object.entries({
  mode: { type: 'string', enum: ['local', 'vector', 'remote'], title: '游戏记忆检索', description: '本地关键词 / 本地向量混合 / 外挂记忆服务。外部服务故障时回退关键词，并报告降级。' },
  endpoint: { type: 'string', title: '记忆服务地址', description: '向量模式填完整 embeddings URL；远端模式填服务根地址。留空不连接。' },
  model: { type: 'string', title: '向量模型名称', description: '仅向量模式使用，调用兼容 embeddings 的接口。更换后需要按需重新索引旧笔记。' },
  apiKeyEnv: { type: 'string', title: '记忆服务密钥环境变量', description: '填写环境变量名称，不填写密钥本身。' },
  timeoutMs: { type: 'integer', minimum: 100, maximum: 30000, title: '记忆服务超时（毫秒）' },
  provider: { type: 'string', enum: ['http', 'mem0-oss', 'mem0-platform', 'bailian', 'powercontext'], title: '外挂记忆接口' },
  libraryId: { type: 'string', title: '百炼记忆库 ID', description: '可选，空值使用服务端默认记忆库。' },
  projectId: { type: 'string', title: '记忆项目 ID', description: '外挂服务使用的项目隔离名称；角色与服务器继续单独隔离。' },
  scopeId: { type: 'string', title: 'PowerContext Scope ID', description: '填写已配置且有权访问的 Scope；插件不会创建或枚举 Scope。游戏记录仍按服务器与角色隔离。' },
  searchMode: { type: 'string', enum: ['text', 'vector', 'hybrid'], title: 'PowerContext 检索方式', description: '默认全文检索，不要求向量模型。服务端支持后可选向量或混合检索。' },
}).map(([key, schema]) => [`worlds.minecraft.memory.${key}`, { ...schema, 'x-hot': true }]));

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const idOf = (e: Pick<MemoryCandidate, 'id' | 'revision'>) => `${e.id}:${e.revision}`;
const digest = (e: MemoryCandidate) => hash(JSON.stringify([e.id, e.revision, e.recordedAt, e.kind, e.summary, e.content,
  e.dimension, e.tags, e.source.kind, e.source.reference, e.source.speaker, e.source.observedAt, e.expiresAt, e.archived]));
const vector = (v: unknown): number[] => {
  if (!Array.isArray(v) || v.length < 1 || v.length > 8192 || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Invalid embedding vector');
  const norm = Math.hypot(...v);
  if (!norm || !Number.isFinite(norm)) throw new Error('Invalid embedding norm');
  return v.map(n => n / norm);
};

export class GameMemoryService {
  constructor(private readonly book: GameMemoryBook, private readonly directory: string | null,
    private readonly request: typeof fetch = fetch) {}

  private powerScope(cfg: GameMemoryConfig): string {
    if (!cfg.scopeId.trim() || cfg.scopeId.length > 256) throw new Error('Configure an existing PowerContext scopeId');
    return cfg.scopeId;
  }

  private async post(cfg: GameMemoryConfig, suffix: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!cfg.endpoint.trim()) throw new Error('Memory endpoint is not configured');
    const url = new URL(cfg.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Memory endpoint must be HTTP(S), without embedded credentials or query');
    if (!Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs < 100 || cfg.timeoutMs > 30000) throw new Error('Invalid memory timeout');
    if (suffix) url.pathname = url.pathname.replace(/\/$/, '') + suffix;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (cfg.apiKeyEnv) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cfg.apiKeyEnv)) throw new Error('Invalid API key environment variable name');
      const key = process.env[cfg.apiKeyEnv];
      if (!key) throw new Error('Configured memory API key environment variable is missing');
      if (cfg.mode === 'remote' && cfg.provider === 'mem0-oss') headers['X-API-Key'] = key;
      else headers.Authorization = `${cfg.mode === 'remote' && cfg.provider === 'mem0-platform' ? 'Token' : 'Bearer'} ${key}`;
    }
    const abort = AbortSignal.any([AbortSignal.timeout(cfg.timeoutMs), ...(signal ? [signal] : [])]);
    // Explicit endpoint only. No redirects, discovery, automatic retries or response bodies in errors.
    try {
      const response = await this.request(url, { method: 'POST', headers, body: JSON.stringify(body), signal: abort, redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Memory service HTTP ${response.status}`); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty memory service response');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
          if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Memory service response exceeds 1 MiB'); } chunks.push(part.value); }
      } finally { reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid memory service response');
      return data;
    } catch (e) {
      if (signal?.aborted) throw new Error('Memory request cancelled');
      if (abort.aborted) throw new Error('Memory service timeout; write outcome may be unknown');
      if (e instanceof Error && /^Memory service (HTTP|response)/.test(e.message)) throw e;
      throw new Error('Memory service request failed; no automatic retry');
    }
  }

  private async embed(cfg: GameMemoryConfig, input: string, signal?: AbortSignal): Promise<number[]> {
    if (!cfg.model.trim()) throw new Error('Configure an embedding model');
    const data = await this.post(cfg, '', { model: cfg.model, input, encoding_format: 'float' }, signal);
    const rows = data.data as Array<{ embedding?: unknown; index?: number }>;
    if (!Array.isArray(rows) || rows.length !== 1 || (rows[0].index !== undefined && rows[0].index !== 0)) throw new Error('Invalid embedding response');
    return vector(rows[0].embedding);
  }

  private vectorPath(cfg: GameMemoryConfig, scope: string, id: string): string {
    if (!this.directory || !/^[a-f0-9]{64}$/.test(scope) || !/^[\w-]{36}$/.test(id)) throw new Error('Invalid vector storage scope');
    return join(this.directory, 'vectors', hash(cfg.endpoint + '\n' + cfg.model), scope, id + '.json');
  }

  private async index(cfg: GameMemoryConfig, scope: string, entry: MemoryCandidate, signal?: AbortSignal) {
    if (cfg.mode === 'vector') {
      const values = await this.embed(cfg, entry.summary + '\n' + entry.content, signal);
      signal?.throwIfAborted();
      const file = this.vectorPath(cfg, scope, entry.id), temp = file + '.' + randomUUID() + '.tmp';
      mkdirSync(join(file, '..'), { recursive: true });
      try { writeFileSync(temp, JSON.stringify({ hash: digest(entry), revision: entry.revision, values }), { mode: 0o600, flag: 'wx' }); renameSync(temp, file); }
      finally { rmSync(temp, { force: true }); }
      return { status: 'indexed', mode: 'vector' };
    }
    if (cfg.mode !== 'remote') return { status: 'local-only' };
    const meta = { mc_scope: scope, mc_id: entry.id, mc_revision: entry.revision, mc_hash: digest(entry) };
    const serialized = JSON.stringify({ protocol: 'agent-mc-memory/v1', ...meta, entry });
    const common = { user_id: scope, ...(cfg.libraryId ? { memory_library_id: cfg.libraryId } : {}), ...(cfg.projectId ? { project_id: cfg.projectId } : {}) };
    let reply: Record<string, unknown>;
    if (cfg.provider === 'powercontext') {
      if (Buffer.byteLength(serialized, 'utf8') > 8192) throw new Error('PowerContext memory exceeds 8192 UTF-8 bytes; local note preserved');
      reply = await this.post(cfg, '/v1/memory/remember', {
        scope_id: this.powerScope(cfg), kind: `agent-mc:${scope}`, text: serialized,
      }, signal);
    } else if (cfg.provider === 'bailian') reply = await this.post(cfg, '/add', { ...common, custom_content: serialized, meta_data: meta }, signal);
    else if (cfg.provider === 'http') reply = await this.post(cfg, '/upsert', { protocol: 'agent-mc-memory/v1', namespace: scope, key: idOf(entry), entry, metadata: meta }, signal);
    else if (['mem0-oss', 'mem0-platform'].includes(cfg.provider)) reply = await this.post(cfg,
      cfg.provider === 'mem0-oss' ? '/memories' : '/v3/memories/add/',
      { user_id: scope, messages: [{ role: 'user', content: serialized }], metadata: meta, infer: false }, signal);
    else throw new Error('Unknown memory provider');
    const pending = reply.status === 'PENDING';
    if (reply.status === 'FAILED' || reply.error) throw new Error('Remote memory write rejected');
    const confirmed = cfg.provider === 'powercontext' ? Array.isArray(reply.records) && reply.records.some(r => r?.text === serialized)
      : cfg.provider === 'http' ? reply.status === 'stored'
      : cfg.provider === 'bailian' ? Array.isArray(reply.memory_nodes) && reply.memory_nodes.length > 0
        : Array.isArray(reply.results) && reply.results.length > 0;
    return { mode: 'remote', provider: cfg.provider, status: pending ? 'pending' : confirmed ? 'stored' : 'unverified',
      eventId: typeof reply.event_id === 'string' ? reply.event_id.slice(0, 120) : null, searchVerified: false };
  }

  private async remoteSearch(cfg: GameMemoryConfig, scope: string, query: string, candidates: MemoryCandidate[], signal?: AbortSignal) {
    let reply: Record<string, unknown>;
    if (cfg.provider === 'powercontext') {
      if (!['text', 'vector', 'hybrid'].includes(cfg.searchMode)) throw new Error('Invalid PowerContext search mode');
      reply = await this.post(cfg, '/v1/atomic-memory/search', {
        scope_id: this.powerScope(cfg), kind: `agent-mc:${scope}`, query, limit: 40, mode: cfg.searchMode,
      }, signal);
    }
    else if (cfg.provider === 'bailian') reply = await this.post(cfg, '/memory_nodes/search', { user_id: scope,
      messages: [{ role: 'user', content: query }], top_k: 40, ...(cfg.libraryId ? { memory_library_id: cfg.libraryId } : {}),
      ...(cfg.projectId ? { project_id: cfg.projectId } : {}) }, signal);
    else if (cfg.provider === 'http') reply = await this.post(cfg, '/search', { protocol: 'agent-mc-memory/v1', namespace: scope, query, limit: 40 }, signal);
    else if (['mem0-oss', 'mem0-platform'].includes(cfg.provider)) reply = await this.post(cfg,
      cfg.provider === 'mem0-oss' ? '/search' : '/v3/memories/search/', { query, filters: { user_id: scope }, top_k: 40 }, signal);
    else throw new Error('Unknown memory provider');
    const rows = cfg.provider === 'powercontext' ? reply.hits : cfg.provider === 'bailian' ? reply.memory_nodes : reply.results;
    if (!Array.isArray(rows)) throw new Error('Memory service search returned no result list');
    const byId = new Map(candidates.map(e => [idOf(e), e]));
    return [...new Set(rows.slice(0, 100).flatMap(row => {
      let meta = row?.metadata ?? row?.meta_data;
      if (cfg.provider === 'powercontext') {
        if (row?.memory?.artifact?.family !== 'atomic-memory' || row?.memory?.kind !== `agent-mc:${scope}`
          || row?.memory?.state !== 'active' || typeof row.memory.text !== 'string') return [];
        try { const data = JSON.parse(row.memory.text); if (data.protocol !== 'agent-mc-memory/v1') return []; meta = data; }
        catch { return []; }
      }
      const entry = meta && byId.get(`${meta.mc_id}:${meta.mc_revision}`);
      return entry && meta.mc_scope === scope && meta.mc_hash === digest(entry) ? [idOf(entry)] : [];
    }))];
  }

  async execute(args: Record<string, unknown>, ctx: GameMemoryContext, config: Partial<GameMemoryConfig> = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    const cfg = { ...GAME_MEMORY_DEFAULTS, ...config };
    if (!['local', 'vector', 'remote'].includes(cfg.mode)) throw new Error('Unknown memory mode');
    if (args.action === 'sync') {
      if (Object.keys(args).some(k => !['action', 'id', 'expectedRevision'].includes(k))) throw new Error('sync only accepts id and expectedRevision');
      const result = this.book.execute({ action: 'get', id: args.id }, ctx);
      const current = result.entry as MemoryCandidate;
      if (args.expectedRevision !== current.revision) throw new Error('Revision conflict; get current note before sync');
      return { ...result, index: await this.tryIndex(cfg, String(result.scopeKey), this.canonical(current), signal) };
    }
    let candidates: MemoryCandidate[] = [], lexical: MemoryCandidate[] = [];
    const result = this.book.execute(args, ctx, { candidates: entries => { candidates = entries; }, lexical: entries => { lexical = entries; } });
    if (args.action === 'help' || !args.action) return { ...result, retrievalMode: cfg.mode,
      retrievalHelp: 'Optional vector or remote retrieval preserves local revision/evidence authority. Only game notes are sent. sync(id,expectedRevision) explicitly indexes a pre-existing note. Failed/unknown external writes are never automatically replayed. Remote results must match local scope, revision and content hash; restore/migrate local notebooks to reuse them on another machine.' };
    if (cfg.mode === 'local') return result;
    if (result.saved) return { ...result, index: await this.tryIndex(cfg, String(result.scopeKey), this.canonical(result.entry as MemoryCandidate), signal) };
    if (args.action !== 'search' || !String(args.query ?? '').trim()) return result;
    const scope = String(result.scopeKey);
    try {
      let semantic: string[], indexed = 0;
      if (cfg.mode === 'vector') {
        const query = await this.embed(cfg, String(args.query), signal);
        semantic = candidates.flatMap(e => {
          try { const item = JSON.parse(readFileSync(this.vectorPath(cfg, scope, e.id), 'utf8'));
            if (item.hash !== digest(e) || item.revision !== e.revision) return [];
            const values = vector(item.values); if (values.length !== query.length) return []; indexed++;
            const score = values.reduce((n, v, i) => n + v * query[i], 0);
            return score > 0 ? [{ id: idOf(e), score }] : [];
          } catch { return []; }
        }).sort((a, b) => b.score - a.score).map(e => e.id);
      } else semantic = await this.remoteSearch(cfg, scope, String(args.query), candidates, signal);
      signal?.throwIfAborted();
      const ranks = new Map<string, number>();
      for (const list of [lexical.map(idOf), semantic]) list.forEach((id, i) => ranks.set(id, (ranks.get(id) ?? 0) + 1 / (60 + i + 1)));
      // Re-read after network wait: revisions/archives may have changed. Never return old remote copies as current notes.
      return { ...this.book.execute(args, ctx, { ranks }), retrieval: { mode: cfg.mode, fusion: 'reciprocal-rank',
        ...(cfg.mode === 'vector' ? { indexed, candidates: candidates.length, incompleteIndex: indexed < candidates.length } : { acceptedRemoteMatches: semantic.length }) } };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ...this.book.execute(args, ctx), retrieval: { mode: 'local', requested: cfg.mode, degraded: true, reason: String(error) } };
    }
  }

  private canonical(e: MemoryCandidate): MemoryCandidate {
    const { id, revision, recordedAt, kind, summary, content, dimension, tags, source, expiresAt, archived } = e;
    return { id, revision, recordedAt, kind, summary, content, dimension, tags, source, expiresAt, archived };
  }

  private async tryIndex(cfg: GameMemoryConfig, scope: string, e: MemoryCandidate, signal?: AbortSignal) {
    try { return await this.index(cfg, scope, e, signal); }
    catch (error) { return { status: 'unverified', mode: cfg.mode, reason: String(error), localSaved: true, automaticRetry: false }; }
  }
}
