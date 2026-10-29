import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GameMemoryBook, type GameMemoryContext } from '../core/game-memory.ts';
import { GameMemoryService, type GameMemoryConfig } from '../core/game-memory-service.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const ctx: GameMemoryContext = { scope: { realm: 'fixture', account: 'offline:alice', agent: 'alice' }, dimension: 'overworld' };
const note = { action: 'remember', kind: 'method', summary: 'Breathing pocket', content: 'Verified only for a short dive, task 5.', source: { kind: 'hypothesis', reference: 'task:5' } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const id = (result: Record<string, unknown>) => (result.entry as { id: string }).id;
function setup(respond: (url: URL, body: Record<string, any>, init: RequestInit) => Response | Promise<Response>) {
  const directory = mkdtempSync(join(tmpdir(), 'mc-retrieval-')); dirs.push(directory);
  const book = new GameMemoryBook(directory);
  const request = vi.fn<typeof fetch>(async (url, init) => respond(new URL(String(url)), JSON.parse(String(init?.body)), init!));
  return { book, request, service: new GameMemoryService(book, directory, request) };
}
const vectorConfig: Partial<GameMemoryConfig> = { mode: 'vector', endpoint: 'http://fixture.invalid/v1/embeddings', model: 'test' };

it.each(['stored', 'pending'])('does not repeat a remote %s write when the same note is remembered again', async status => {
  const { service, request } = setup(() => json({ status: status === 'pending' ? 'PENDING' : status, event_id: 'existing-event' }));
  const config = { mode: 'remote' as const, provider: 'http' as const, endpoint: 'https://fixture.invalid' };
  const first = await service.execute(note, ctx, config);
  const retry = await service.execute(note, ctx, config);
  expect(retry).toMatchObject({ saved: true, deduplicated: true, written: false, entry: { id: id(first) }, index: { status } });
  expect(request).toHaveBeenCalledTimes(1);
});

it('works without any model or network and only sends explicitly indexed game notes', async () => {
  const { service, request } = setup(() => { throw new Error('Network must remain unused'); });
  const saved = await service.execute(note, ctx);
  expect(await service.execute({ action: 'search', query: 'pocket' }, ctx)).toMatchObject({ total: 1 });
  expect(await service.execute({ action: 'sync', id: id(saved), expectedRevision: 1 }, ctx)).toMatchObject({ index: { status: 'local-only' } });
  expect(request).not.toHaveBeenCalled();
});

it('retrieves a semantic match without keyword overlap, isolates changed models and reports missing indexes', async () => {
  const { service, request } = setup((url, body) => {
    expect(url.pathname).toBe('/v1/embeddings');
    expect(body.encoding_format).toBe('float');
    return json({ data: [{ index: 0, embedding: body.input.includes('lava') ? [0, 1] : [1, 0] }] });
  });
  const saved = await service.execute(note, ctx, vectorConfig);
  await service.execute({ ...note, summary: 'lava', content: 'Retreat from heat' }, ctx, vectorConfig);
  const search = await service.execute({ action: 'search', query: '水下氧气' }, ctx, vectorConfig);
  expect(search).toMatchObject({ total: 1, entries: [{ id: id(saved) }], retrieval: { indexed: 2, incompleteIndex: false } });
  expect(JSON.stringify(search)).not.toContain('Verified only');
  expect(await service.execute({ action: 'search', query: '水下氧气' }, ctx, { ...vectorConfig, model: 'new-model' }))
    .toMatchObject({ total: 0, retrieval: { indexed: 0, incompleteIndex: true } });
  expect(request).toHaveBeenCalledTimes(4); // writes index once each; searches embed only their queries.
  await service.execute({ action: 'sync', id: id(saved), expectedRevision: 1 }, ctx, { ...vectorConfig, model: 'new-model' });
  expect(await service.execute({ action: 'search', query: '水下氧气' }, ctx, { ...vectorConfig, model: 'new-model' }))
    .toMatchObject({ total: 1, retrieval: { indexed: 1, incompleteIndex: true } });
});

it('persists local writes on external failure and degrades search without exposing service errors or keys', async () => {
  vi.stubEnv('MC_MEMORY_TEST_KEY', 'private-test-key');
  const { service, request } = setup((_url, _body, init) => {
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer private-test-key');
    return json({ error: 'private-test-key + private-service-detail' }, 503);
  });
  const config = { ...vectorConfig, apiKeyEnv: 'MC_MEMORY_TEST_KEY' };
  const saved = await service.execute(note, ctx, config);
  expect(saved).toMatchObject({ saved: true, index: { status: 'unverified', localSaved: true, automaticRetry: false } });
  const search = await service.execute({ action: 'search', query: 'pocket' }, ctx, config);
  expect(search).toMatchObject({ total: 1, retrieval: { mode: 'local', degraded: true } });
  expect(JSON.stringify([saved, search])).not.toMatch(/private-test-key|private-service-detail/);
  expect(request).toHaveBeenCalledTimes(2);
});

it.each(['http', 'mem0-oss', 'mem0-platform', 'bailian', 'powercontext'] as const)(
  'uses the documented %s wire format and rejects foreign, stale or changed notes', async provider => {
    vi.stubEnv('MC_MEMORY_TEST_KEY', 'test-key');
    let captured: Record<string, any>;
    const { service } = setup((url, body, init) => {
      const auth = init.headers as Record<string, string>;
      expect(provider === 'mem0-oss' ? auth['X-API-Key'] : auth.Authorization)
        .toBe(provider === 'mem0-oss' ? 'test-key' : provider === 'mem0-platform' ? 'Token test-key' : 'Bearer test-key');
      if (!url.pathname.includes('search')) {
        captured = body;
        if (provider === 'http') { expect(url.pathname).toBe('/upsert'); return json({ status: 'stored' }); }
        if (provider === 'bailian') { expect(url.pathname).toBe('/add'); expect(body.project_id).toBe('game'); return json({ memory_nodes: [{ event: 'ADD' }] }); }
        if (provider === 'powercontext') {
          expect(url.pathname).toBe('/v1/memory/remember');
          expect(body.scope_id).toBe('operator-selected-game-scope');
          expect(body.expected_revision).toBeUndefined();
          return json({ changed: true, records: [{ text: body.text, artifact: { family: 'atomic-memory', artifact_id: 'actual-id', revision: 1 } }] });
        }
        expect(url.pathname).toBe(provider === 'mem0-oss' ? '/memories' : '/v3/memories/add/');
        expect(body.infer).toBe(false);
        return json({ results: [{ id: 'remote-id' }] });
      }
      let meta: Record<string, any>;
      if (provider === 'powercontext') {
        expect(url.pathname).toBe('/v1/atomic-memory/search');
        expect(body).toMatchObject({ scope_id: 'operator-selected-game-scope', kind: captured.kind, mode: 'text' });
        const stored = JSON.parse(captured.text);
        const memory = { artifact: { family: 'atomic-memory', artifact_id: 'fixture', revision: 1 }, kind: captured.kind, state: 'active', text: captured.text };
        return json({ hits: [{ memory }, { memory: { ...memory, text: JSON.stringify({ ...stored, mc_scope: 'foreign' }) } },
          { memory: { ...memory, state: 'retired' } }, { memory: { ...memory, text: 'unrelated private context' } }] });
      }
      if (provider === 'bailian') {
        expect(url.pathname).toBe('/memory_nodes/search'); expect(body.messages[0].content).toBe('oxygen'); meta = captured.meta_data;
      } else {
        expect(url.pathname).toBe(provider === 'mem0-platform' ? '/v3/memories/search/' : '/search');
        meta = captured.metadata;
        if (provider !== 'http') expect(body.filters).toEqual({ user_id: meta.mc_scope });
        else expect(body.namespace).toBe(meta.mc_scope);
      }
      const field = provider === 'bailian' ? 'meta_data' : 'metadata';
      return json({ [provider === 'bailian' ? 'memory_nodes' : 'results']: [
        { [field]: { ...meta, mc_scope: 'foreign' } }, { [field]: { ...meta, mc_revision: 0 } },
        { [field]: { ...meta, mc_hash: 'modified' } }, { [field]: meta }, { [field]: meta },
      ] });
    });
    const cfg: Partial<GameMemoryConfig> = { mode: 'remote', provider, endpoint: 'https://fixture.invalid',
      apiKeyEnv: 'MC_MEMORY_TEST_KEY', projectId: 'game', scopeId: 'operator-selected-game-scope' };
    const saved = await service.execute(note, ctx, cfg);
    expect(saved).toMatchObject({ index: { status: 'stored', searchVerified: false } });
    expect(await service.execute({ action: 'search', query: 'oxygen' }, ctx, cfg))
      .toMatchObject({ total: 1, entries: [{ id: id(saved), currentWorldVerified: false }], retrieval: { acceptedRemoteMatches: 1 } });
  },
);

it('does not replay pending remote writes and requires explicit current revision for sync', async () => {
  const { service, request } = setup(() => json({ status: 'PENDING', event_id: 'event-123' }));
  const cfg: Partial<GameMemoryConfig> = { mode: 'remote', provider: 'mem0-platform', endpoint: 'https://fixture.invalid' };
  const saved = await service.execute(note, ctx, cfg);
  expect(saved).toMatchObject({ saved: true, index: { status: 'pending', eventId: 'event-123', searchVerified: false } });
  await expect(service.execute({ action: 'sync', id: id(saved), expectedRevision: 2 }, ctx, cfg)).rejects.toThrow('Revision conflict');
  expect(request).toHaveBeenCalledTimes(1);
});

it('rechecks local revisions after remote latency instead of resurrecting archived data', async () => {
  let savedId = '', metadata: unknown;
  const { book, service } = setup((_url, body) => {
    if (body.entry) { metadata = body.metadata; return json({ status: 'stored' }); }
    book.execute({ action: 'archive', id: savedId, expectedRevision: 1 }, ctx);
    return json({ results: [{ metadata }] });
  });
  const cfg: Partial<GameMemoryConfig> = { mode: 'remote', provider: 'http', endpoint: 'https://fixture.invalid' };
  savedId = id(await service.execute(note, ctx, cfg));
  expect(await service.execute({ action: 'search', query: 'pocket' }, ctx, cfg)).toMatchObject({ total: 0 });
});

it('bounds network waits, rejects redirects/oversized replies, and respects caller cancellation', async () => {
  const { service, request } = setup((_url, _body, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new Error('secret error text')), { once: true });
  }));
  await service.execute(note, ctx);
  const cfg = { ...vectorConfig, timeoutMs: 100 };
  expect(await service.execute({ action: 'search', query: 'pocket' }, ctx, cfg)).toMatchObject({ total: 1, retrieval: { degraded: true } });
  const abort = new AbortController();
  const pending = service.execute({ action: 'search', query: 'pocket' }, ctx, cfg, abort.signal); abort.abort();
  await expect(pending).rejects.toThrow('cancelled');
  const count = request.mock.calls.length;
  expect(await service.execute({ action: 'search', query: 'pocket' }, ctx, { ...cfg, endpoint: 'https://user:secret@fixture.invalid' }))
    .toMatchObject({ total: 1, retrieval: { degraded: true } });
  expect(request).toHaveBeenCalledTimes(count);
  const huge = setup(() => json({ data: 'x'.repeat(1024 * 1024) })).service;
  const written = await huge.execute(note, ctx, vectorConfig);
  expect(written).toMatchObject({ saved: true, index: { status: 'unverified' } });
});

it('requires an explicit PowerContext scope, preserves over-size notes locally and sends no administrative requests', async () => {
  const { service, request } = setup(() => { throw new Error('No request expected'); });
  const cfg: Partial<GameMemoryConfig> = { mode: 'remote', provider: 'powercontext', endpoint: 'https://fixture.invalid' };
  expect(await service.execute(note, ctx, cfg)).toMatchObject({ saved: true, index: { status: 'unverified' } });
  expect(await service.execute({ ...note, content: '中'.repeat(5000) }, ctx, { ...cfg, scopeId: 'existing' }))
    .toMatchObject({ saved: true, index: { status: 'unverified' } });
  expect(request).not.toHaveBeenCalled();
});

it('does not claim an explicit PowerContext memory was stored when the acknowledgement has no exact ArtifactRef', async () => {
  const { service } = setup((_url, body) => json({ changed: true, records: [{ text: body.text }] }));
  expect(await service.execute(note, ctx, { mode: 'remote', provider: 'powercontext', endpoint: 'https://fixture.invalid', scopeId: 'existing' }))
    .toMatchObject({ saved: true, index: { status: 'unverified', artifacts: [] } });
});
