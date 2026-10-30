/** Optional retrieval providers. The local notebook remains the revision/evidence authority. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameMemoryLearning } from './game-memory-learning.ts';
import { OperationExperienceBook } from './operation-experience.ts';
import { artifactRef } from './game-memory-learning-contract.ts';
import { memoryRequest, validateMemoryTransport } from './game-memory-http.ts';
import { CPU_MEMORY_VECTOR_VERSION, cpuMemoryVector, cpuMemorySimilarity } from './memory-cpu-vector.ts';
import { GameMemoryBook, type GameMemoryContext, type MemoryCandidate } from './game-memory.ts';
import { MemoryKnowledgeCache, MemoryReplicaLedger, memoryKnowledgeBinding, memoryTarget, type ReplicaReceipt } from './game-memory-redundancy.ts';
import { revisePowerNotebook } from './powercontext-notebook-native.ts';

export interface GameMemoryConfig {
  mode: 'local' | 'local-vector' | 'vector' | 'remote';
  endpoint: string; model: string; apiKeyEnv: string; timeoutMs: number;
  provider: 'http' | 'mem0-oss' | 'mem0-platform' | 'bailian' | 'powercontext';
  libraryId: string; projectId: string; scopeId: string;
  searchMode: 'text' | 'vector' | 'hybrid';
  learningEnabled: boolean;
  readPreference: 'local-first' | 'balanced' | 'remote-first';
}
export const GAME_MEMORY_DEFAULTS: GameMemoryConfig = {
  mode: 'local', endpoint: '', model: '', apiKeyEnv: '', timeoutMs: 3000,
  provider: 'http', libraryId: '', projectId: 'agent-mc', scopeId: '', searchMode: 'text', learningEnabled: false, readPreference: 'balanced',
};
export const GAME_MEMORY_CONFIG_SCHEMA = Object.fromEntries(Object.entries({
  mode: { type: 'string', enum: ['local', 'local-vector', 'vector', 'remote'], title: '游戏记忆检索', description: '本地关键词 / 离线 CPU 词元向量混合（不下载模型，不是神经语义模型）/ embeddings 向量 / 外挂记忆服务。外部服务故障时回退关键词，并报告降级。' },
  endpoint: { type: 'string', title: '记忆服务地址', description: '向量模式填完整 embeddings URL；远端模式填服务根地址。留空不连接。' },
  model: { type: 'string', title: '向量模型名称', description: '仅向量模式使用，调用兼容 embeddings 的接口。更换后需要按需重新索引旧笔记。' },
  apiKeyEnv: { type: 'string', title: '记忆服务密钥环境变量', description: '填写环境变量名称，不填写密钥本身。' },
  timeoutMs: { type: 'integer', minimum: 100, maximum: 30000, title: '记忆服务超时（毫秒）' },
  provider: { type: 'string', enum: ['http', 'mem0-oss', 'mem0-platform', 'bailian', 'powercontext'], title: '外挂记忆接口' },
  libraryId: { type: 'string', title: '百炼记忆库 ID', description: '可选，空值使用服务端默认记忆库。' },
  projectId: { type: 'string', title: '记忆项目 ID', description: '外挂服务使用的项目隔离名称；角色与服务器继续单独隔离。' },
  scopeId: { type: 'string', title: 'PowerContext Scope ID', description: '填写已配置且有权访问的 Scope；插件不会创建或枚举 Scope。游戏记录仍按服务器与角色隔离。' },
  learningEnabled: { type: 'boolean', title: '启用服务端经验整理', description: '仅 PowerContext 或通用 HTTP 桥接。需绑定该服务器、账号和角色专用的已有 Scope；允许显式提交游戏证据和生成待审核候选，人工审核在记忆服务完成。默认关闭。' },
  searchMode: { type: 'string', enum: ['text', 'vector', 'hybrid'], title: 'PowerContext 检索方式', description: '默认全文检索，不要求向量模型。服务端支持后可选向量或混合检索。' },
  readPreference: { type: 'string', enum: ['local-first', 'balanced', 'remote-first'], title: '本地与云端记忆侧重', description: '本地始终保存原始记录及版本。默认两端并用，Agent 可在每次 search 的 preference 按任务选择侧重。云端故障回退本地，不把历史当当前事实。' },
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
    return (await memoryRequest(this.request, cfg, suffix, body, signal)).data;
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

  private async index(cfg: GameMemoryConfig, scope: string, entry: MemoryCandidate, ctx: GameMemoryContext, signal?: AbortSignal, known?: ReplicaReceipt['artifacts'], allowInitial = false) {
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
      if (entry.revision > 1) {
        const versions = Array.from({ length: entry.revision }, (_, i) => {
          const version = this.canonical(this.book.execute({ action: 'get', id: entry.id, revision: i + 1 },
            ctx).entry as MemoryCandidate);
          return { revision: version.revision, hash: digest(version), text: JSON.stringify({ protocol: 'agent-mc-memory/v1',
            mc_scope: scope, mc_id: version.id, mc_revision: version.revision, mc_hash: digest(version), entry: version }) };
        });
        const corrected = await revisePowerNotebook(this.request, cfg, scope, entry.id, versions, signal, known, allowInitial);
        return { mode: 'remote', provider: cfg.provider, status: 'stored', scopeId: cfg.scopeId, ...corrected, searchVerified: false };
      }
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
    const powerRecords = cfg.provider === 'powercontext' && Array.isArray(reply.records) ? reply.records.filter(r => r?.text === serialized
      && r?.artifact?.family === 'atomic-memory' && artifactRef.safeParse(r.artifact).success).slice(0, 100) : [];
    const confirmed = cfg.provider === 'powercontext' ? powerRecords.length > 0
      : cfg.provider === 'http' ? reply.status === 'stored'
      : cfg.provider === 'bailian' ? Array.isArray(reply.memory_nodes) && reply.memory_nodes.length > 0
        : Array.isArray(reply.results) && reply.results.length > 0;
    return { mode: 'remote', provider: cfg.provider, status: pending ? 'pending' : confirmed ? 'stored' : 'unverified',
      ...(cfg.provider === 'powercontext' ? { artifacts: powerRecords.map(r => r.artifact), scopeId: cfg.scopeId } : {}),
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
    if (args.action === 'experience') {
      if (!this.directory) throw new Error('Persistent dataDir is required for operation experience');
      return new OperationExperienceBook(this.directory).query(args, ctx, this.book);
    }
    if (args.action === 'search' && args.preference !== undefined) cfg.readPreference = args.preference as GameMemoryConfig['readPreference'];
    if (!['local', 'local-vector', 'vector', 'remote'].includes(cfg.mode)) throw new Error('Unknown memory mode');
    if (!['local-first', 'balanced', 'remote-first'].includes(cfg.readPreference)) throw new Error('Unknown memory read preference');
    if (args.action === 'service') {
      if (ctx.serviceScope && (ctx.serviceScope.account !== ctx.scope.account || ctx.serviceScope.agent !== ctx.scope.agent))
        throw new Error('Service scope must retain the active game account and agent');
      const serviceContext = ctx.serviceScope ? { ...ctx, scope: ctx.serviceScope } : ctx;
      const scope = this.book.execute({ action: 'search', limit: 1, query: '' }, serviceContext).scopeKey;
      const localScope = this.book.execute({ action: 'search', limit: 1, query: '' }, ctx).scopeKey;
      if (args.operation === 'prepare' && cfg.mode === 'remote' && cfg.provider === 'powercontext'
        && (this.hasPendingPowerCorrection(cfg, String(scope), serviceContext)
          || (scope !== localScope && this.hasPendingPowerCorrection(cfg, String(localScope), ctx))))
        throw new Error('A local notebook correction has unconfirmed remote replication; use local search and explicitly reconcile sync before prepared remote recall');
      return new GameMemoryLearning(this.directory, this.request).execute(args, String(scope), cfg, signal);
    }
    if (args.action === 'replication') {
      if (Object.keys(args).some(k => !['action', 'limit', 'offset'].includes(k))) throw new Error('replication only accepts limit and offset');
      const result = this.book.execute({ action: 'search', dimension: '*', includeArchived: true, limit: args.limit, offset: args.offset }, ctx);
      const scope = String(result.scopeKey), ledger = cfg.mode === 'remote' ? new MemoryReplicaLedger(this.directory).entries(memoryTarget(cfg, scope), scope) : {};
      const entries = (result.entries as MemoryCandidate[]).map(entry => {
        const full = this.canonical(this.book.execute({ action: 'get', id: entry.id }, ctx).entry as MemoryCandidate);
        const receipt = ledger[entry.id], matches = receipt?.revision === entry.revision && receipt.contentHash === digest(full);
        return { id: entry.id, revision: entry.revision, summary: entry.summary, archived: entry.archived,
          state: cfg.mode !== 'remote' ? 'local-only' : matches ? receipt.status : 'not-recorded',
          receipt: receipt ?? null, currentRevisionConfirmed: !!matches && receipt.status === 'stored' };
      });
      return { ...result, entries, remoteConfigured: cfg.mode === 'remote', localAuthoritative: true,
        recovery: 'sync one id with expectedRevision. Pending/unknown dispatches are reconciled by an exact remote match, never automatically re-sent. not-recorded may include pre-ledger writes. This is replication of current notes, not a full disaster-recovery backup.' };
    }
    if (args.action === 'sync') {
      if (Object.keys(args).some(k => !['action', 'id', 'expectedRevision'].includes(k))) throw new Error('sync only accepts id and expectedRevision');
      const result = this.book.execute({ action: 'get', id: args.id }, ctx);
      const current = result.entry as MemoryCandidate;
      if (args.expectedRevision !== current.revision) throw new Error('Revision conflict; get current note before sync');
      return { ...result, index: await this.tryIndex(cfg, String(result.scopeKey), this.canonical(current), ctx, signal, true) };
    }
    let candidates: MemoryCandidate[] = [], lexical: MemoryCandidate[] = [];
    const result = this.book.execute(args, ctx, { candidates: entries => { candidates = entries; }, lexical: entries => { lexical = entries; } });
    if (args.action === 'help' || !args.action) return { ...result, retrievalMode: cfg.mode, serviceLearning: { enabled: cfg.learningEnabled, help: 'Use action:service,operation:help for optional evidence, reviewed experience and bounded context workflows.' },
      redundancy: { local: 'authoritative versioned evidence and offline retrieval', remote: 'replica, semantic retrieval and explicitly requested learning', readPreference: cfg.readPreference,
        syncStatus: 'action:replication', serviceReadFallback: 'Exact previously read historical prepare/artifact/source results may fall back to a bounded local cache during service outages; stale results stay labelled.' },
      retrievalHelp: 'Local storage remains active in every mode. Only game notes are sent. replication lists current revision sync receipts across restart; sync(id,expectedRevision) indexes a pre-existing note or reconciles pending/unknown writes without replay. Remote matches must agree with local scope, revision and content hash. This is not a full-history backup: restore/migrate local notebooks for another machine.' };
    if (cfg.mode === 'local') return result;
    if (cfg.mode === 'local-vector') {
      if (args.action !== 'search' || !String(args.query ?? '').trim()) return result;
      const query = cpuMemoryVector(String(args.query));
      const similar = candidates.map(entry => ({ id: idOf(entry), score: cpuMemorySimilarity(query,
        cpuMemoryVector(entry.summary + '\n' + entry.content + '\n' + entry.tags.join(' '))) }))
        .filter(row => row.score > .08).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      signal?.throwIfAborted();
      const ranks = new Map<string, number>();
      [lexical.map(idOf), similar.map(row => row.id)].forEach(list => list.forEach((id, index) =>
        ranks.set(id, (ranks.get(id) ?? 0) + 1 / (61 + index))));
      return { ...this.book.execute(args, ctx, { ranks }), retrieval: { mode: 'local-vector',
        backend: CPU_MEMORY_VECTOR_VERSION, fusion: 'reciprocal-rank', neuralModel: false,
        remoteConsulted: false, candidates: candidates.length, vectorMatches: similar.length } };
    }
    if (result.saved) return { ...result, index: await this.tryIndex(cfg, String(result.scopeKey), this.canonical(result.entry as MemoryCandidate), ctx, signal) };
    if (args.action !== 'search' || !String(args.query ?? '').trim()) return result;
    if (cfg.readPreference === 'local-first' && lexical.length >= Number(args.limit ?? 8) + Number(args.offset ?? 0))
      return { ...result, retrieval: { mode: 'local', requested: cfg.mode, readPreference: cfg.readPreference, remoteConsulted: false, reason: 'Local matches fill the requested page; external retrieval remains available with balanced or remote-first preference.' } };
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
      const weights = cfg.readPreference === 'local-first' ? [3, 1] : cfg.readPreference === 'remote-first' ? [1, 3] : [1, 1];
      [lexical.map(idOf), semantic].forEach((list, index) => list.forEach((id, i) => ranks.set(id, (ranks.get(id) ?? 0) + weights[index] / (60 + i + 1))));
      // Re-read after network wait: revisions/archives may have changed. Never return old remote copies as current notes.
      return { ...this.book.execute(args, ctx, { ranks }), retrieval: { mode: cfg.mode, fusion: 'reciprocal-rank', readPreference: cfg.readPreference, remoteConsulted: true,
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

  private hasPendingPowerCorrection(cfg: GameMemoryConfig, scope: string, ctx: GameMemoryContext): boolean {
    const receipts = new MemoryReplicaLedger(this.directory).entries(memoryTarget(cfg, scope), scope);
    let offset = 0;
    for (;;) {
      const page = this.book.execute({ action: 'search', dimension: '*', includeArchived: true, limit: 20, offset }, ctx);
      for (const entry of page.entries as MemoryCandidate[]) {
        if (entry.revision <= 1) continue;
        const receipt = receipts[entry.id];
        if (!receipt) continue; // Local-only historical notes do not block independent service recall.
        const full = this.canonical(this.book.execute({ action: 'get', id: entry.id }, ctx).entry as MemoryCandidate);
        if (receipt.revision !== entry.revision || receipt.contentHash !== digest(full)
          || receipt.status !== 'stored' || receipt.pendingCorrection || receipt.nativeRevisions !== true) return true;
      }
      if (page.nextOffset === null) return false;
      offset = Number(page.nextOffset);
    }
  }

  private async tryIndex(cfg: GameMemoryConfig, scope: string, e: MemoryCandidate, ctx: GameMemoryContext, signal?: AbortSignal, reconcile = false) {
    try {
      if (cfg.mode !== 'remote') return await this.index(cfg, scope, e, ctx, signal);
      signal?.throwIfAborted();
      validateMemoryTransport(cfg);
      if (!['http', 'mem0-oss', 'mem0-platform', 'bailian', 'powercontext'].includes(cfg.provider)) throw new Error('Unknown memory provider');
      if (cfg.provider === 'powercontext') {
        this.powerScope(cfg);
        const serialized = JSON.stringify({ protocol: 'agent-mc-memory/v1', mc_scope: scope, mc_id: e.id, mc_revision: e.revision, mc_hash: digest(e), entry: e });
        if (Buffer.byteLength(serialized, 'utf8') > 8192) throw new Error('PowerContext memory exceeds 8192 UTF-8 bytes; local note preserved');
      }
      const ledger = new MemoryReplicaLedger(this.directory), target = memoryTarget(cfg, scope), contentHash = digest(e);
      const old = ledger.entries(target, scope)[e.id];
      if (old?.revision === e.revision && old.contentHash === contentHash) {
        const legacyCorrection = cfg.provider === 'powercontext' && e.revision > 1 && !old.nativeRevisions;
        if (old.status === 'stored' && !legacyCorrection) return { ...old, mode: 'remote', replayed: false };
        if (reconcile) {
          if (cfg.provider === 'powercontext' && e.revision > 1) {
            const corrected = await this.index(cfg, scope, e, ctx, signal, old.nativeRevisions ? old.artifacts : undefined);
            if (corrected.status !== 'stored' || !('artifacts' in corrected)) throw new Error('Notebook correction not confirmed');
            ledger.put(target, scope, e.id, { ...old, at: new Date().toISOString(), status: 'stored',
              searchVerified: false, pendingCorrection: false, nativeRevisions: true, artifacts: corrected.artifacts, scopeId: cfg.scopeId });
            return { ...corrected, reconciled: true, replayed: false };
          }
          const matches = await this.remoteSearch(cfg, scope, e.summary, [e], signal);
          signal?.throwIfAborted();
          if (matches.includes(idOf(e))) {
            const receipt: ReplicaReceipt = { ...old, at: new Date().toISOString(), status: 'stored', searchVerified: true };
            ledger.put(target, scope, e.id, receipt);
            return { ...receipt, mode: 'remote', reconciled: true, replayed: false };
          }
        }
        return { ...old, mode: 'remote', replayed: false, automaticRetry: false, needsReconciliation: true,
          guidance: 'No exact remote match confirmed yet. Search absence is not proof the write failed; inspect its remote event or receipt before re-submitting.' };
      }
      const correction = cfg.provider === 'powercontext' && e.revision > 1;
      if (correction) new MemoryKnowledgeCache(this.directory).invalidatePrepared(memoryKnowledgeBinding(cfg, scope), scope);
      const initial: ReplicaReceipt = { revision: e.revision, contentHash, at: new Date().toISOString(), status: 'unverified', searchVerified: false,
        ...(old?.nativeRevisions ? { nativeRevisions: true, artifacts: old.artifacts, scopeId: old.scopeId } : {}),
        ...(correction ? { pendingCorrection: true } : {}) };
      ledger.put(target, scope, e.id, initial); // Persist uncertainty before dispatch; process loss must not invite a duplicate write.
      const indexed = await this.index(cfg, scope, e, ctx, signal, old?.nativeRevisions ? old.artifacts : undefined, !old);
      ledger.put(target, scope, e.id, { ...initial, at: new Date().toISOString(),
        status: indexed.status === 'stored' ? 'stored' : indexed.status === 'pending' ? 'pending' : 'unverified',
        eventId: 'eventId' in indexed ? indexed.eventId : null,
        ...('artifacts' in indexed ? { artifacts: indexed.artifacts, scopeId: indexed.scopeId } : {}),
        ...(cfg.provider === 'powercontext' && indexed.status === 'stored' ? { nativeRevisions: true } : {}),
        ...(correction ? { pendingCorrection: indexed.status !== 'stored' } : {}) });
      return indexed;
    }
    catch (error) { return { status: 'unverified', mode: cfg.mode, reason: String(error), localSaved: true, automaticRetry: false }; }
  }
}
