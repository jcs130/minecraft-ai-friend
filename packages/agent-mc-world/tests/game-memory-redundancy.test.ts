import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GameMemoryBook, type GameMemoryContext } from '../core/game-memory.ts';
import { GAME_MEMORY_DEFAULTS, GameMemoryService, type GameMemoryConfig } from '../core/game-memory-service.ts';
import { KNOWLEDGE_CACHE_MAX_AGE_MS, MemoryKnowledgeCache } from '../core/game-memory-redundancy.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const ctx: GameMemoryContext = { scope: { realm: 'fixture', account: 'offline:a', agent: 'a' }, dimension: null };
const note = { action: 'remember', kind: 'lesson', summary: 'Local route', content: 'Actual short route, not a proof of general reachability.', source: { kind: 'agent_note', speaker: 'fixture' } };
const cfg: Partial<GameMemoryConfig> = { mode: 'remote', provider: 'http', endpoint: 'https://fixture.invalid' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
function setup(handler: (url: URL, body: any) => Response | Promise<Response>) {
  const dir = mkdtempSync(join(tmpdir(), 'mc-memory-dual-')); dirs.push(dir);
  const request = vi.fn<typeof fetch>(async (url, init) => handler(new URL(String(url)), init?.body ? JSON.parse(String(init.body)) : {}));
  const reopen = () => new GameMemoryService(new GameMemoryBook(dir), dir, request);
  return { dir, request, reopen, service: reopen() };
}

it('keeps both copies, lets the Agent choose each search emphasis, and falls back to local on outage', async () => {
  const remote: any[] = []; let offline = false;
  const { service, request } = setup((url, body) => {
    if (offline) throw new Error('fixture offline');
    if (url.pathname === '/upsert') { remote.push(body); return json({ status: 'stored' }); }
    return json({ results: [{ metadata: remote[1].metadata }] });
  });
  const local = await service.execute(note, ctx, cfg);
  const distant = await service.execute({ ...note, summary: 'Ocean air pocket', content: 'Needs air check' }, ctx, cfg);
  const queries = () => request.mock.calls.filter(([url]) => String(url).endsWith('/search')).length;
  expect(await service.execute({ action: 'search', query: 'route', limit: 1, preference: 'local-first' }, ctx, cfg))
    .toMatchObject({ entries: [{ id: (local.entry as any).id }], retrieval: { remoteConsulted: false } });
  expect(queries()).toBe(0);
  expect(await service.execute({ action: 'search', query: 'route', limit: 1, preference: 'remote-first' }, ctx, cfg))
    .toMatchObject({ entries: [{ id: (distant.entry as any).id }], retrieval: { readPreference: 'remote-first', remoteConsulted: true } });
  expect(await service.execute({ action: 'search', query: 'route' }, ctx, cfg)).toMatchObject({ total: 2, retrieval: { readPreference: 'balanced' } });
  offline = true;
  expect(await service.execute({ action: 'search', query: 'route', preference: 'remote-first' }, ctx, cfg))
    .toMatchObject({ entries: [{ id: (local.entry as any).id }], retrieval: { mode: 'local', degraded: true } });
  expect(await service.execute({ action: 'get', id: (distant.entry as any).id }, ctx)).toMatchObject({ entry: { content: 'Needs air check' } });
});

it('persists lost-response uncertainty across restart, reconciles an exact replica, and never blindly repeats the write', async () => {
  let stored: any, visible = false;
  const { service, reopen, request } = setup((url, body) => {
    if (url.pathname === '/upsert') { stored = body; throw new Error('response lost after storing'); }
    return json({ results: visible ? [{ metadata: stored.metadata }] : [] });
  });
  const saved = await service.execute(note, ctx, cfg), id = (saved.entry as any).id;
  expect(saved).toMatchObject({ saved: true, index: { status: 'unverified', localSaved: true } });
  expect(await reopen().execute({ action: 'replication' }, ctx, cfg)).toMatchObject({ entries: [{ id, state: 'unverified', currentRevisionConfirmed: false }] });
  expect(await reopen().execute({ action: 'sync', id, expectedRevision: 1 }, ctx, cfg)).toMatchObject({ index: { replayed: false, needsReconciliation: true } });
  visible = true;
  expect(await reopen().execute({ action: 'sync', id, expectedRevision: 1 }, ctx, cfg)).toMatchObject({ index: { status: 'stored', reconciled: true, searchVerified: true, replayed: false } });
  expect(await reopen().execute({ action: 'sync', id, expectedRevision: 1 }, ctx, cfg)).toMatchObject({ index: { status: 'stored', replayed: false } });
  expect(request.mock.calls.filter(([url]) => String(url).endsWith('/upsert'))).toHaveLength(1);
  expect(await reopen().execute({ action: 'replication' }, ctx, { ...cfg, endpoint: 'https://different.invalid' }))
    .toMatchObject({ entries: [{ id, state: 'not-recorded', currentRevisionConfirmed: false }] });
});

it('does not confuse preflight rejection with unknown dispatch, and syncs after credentials are supplied', async () => {
  const { service, request } = setup(() => json({ status: 'stored' }));
  const config = { ...cfg, apiKeyEnv: 'MISSING_FIXTURE_MEMORY_KEY' };
  const saved = await service.execute(note, ctx, config), id = (saved.entry as any).id;
  expect(request).not.toHaveBeenCalled();
  expect(await service.execute({ action: 'replication' }, ctx, config)).toMatchObject({ entries: [{ state: 'not-recorded' }] });
  vi.stubEnv('MISSING_FIXTURE_MEMORY_KEY', 'fixture');
  expect(await service.execute({ action: 'sync', id, expectedRevision: 1 }, ctx, config)).toMatchObject({ index: { status: 'stored' } });
  expect(request).toHaveBeenCalledTimes(1);
});

it('retains the exact PowerContext artifact receipt across restart without submitting the note again', async () => {
  const artifact = { family: 'atomic-memory', artifact_id: 'remote-note', revision: 4 };
  const { service, reopen, request } = setup((_url, body) => json({ records: [{ text: body.text, artifact }] }));
  const config: Partial<GameMemoryConfig> = { ...cfg, provider: 'powercontext', scopeId: 'game-only' };
  const saved = await service.execute(note, ctx, config), id = (saved.entry as any).id;
  expect(await reopen().execute({ action: 'sync', id, expectedRevision: 1 }, ctx, config))
    .toMatchObject({ index: { status: 'stored', replayed: false, artifacts: [artifact], scopeId: 'game-only' } });
  expect(request).toHaveBeenCalledTimes(1);
});

it('preserves the newest revision receipt when an older dispatch finishes later and tracks archival separately', async () => {
  let finish!: (r: Response) => void, started!: () => void;
  const ready = new Promise<void>(r => { started = r; });
  const { dir, service, reopen } = setup((_url, body) => {
    if (body.entry.revision === 1) return new Promise<Response>(r => { finish = r; started(); });
    return json({ status: 'stored' });
  });
  const pending = service.execute(note, ctx, cfg); await ready;
  const book = new GameMemoryBook(dir), first = (book.execute({ action: 'search' }, ctx).entries as any[])[0];
  await reopen().execute({ ...note, action: 'revise', id: first.id, expectedRevision: 1, content: 'Corrected method' }, ctx, cfg);
  finish(json({ status: 'PENDING' })); await pending;
  expect(await service.execute({ action: 'replication' }, ctx, cfg)).toMatchObject({ entries: [{ revision: 2, state: 'stored', receipt: { revision: 2 } }] });
  await service.execute({ action: 'archive', id: first.id, expectedRevision: 2 }, ctx, cfg);
  expect(await service.execute({ action: 'replication' }, ctx, cfg)).toMatchObject({ entries: [{ revision: 3, archived: true, state: 'stored' }] });
  expect(await service.execute({ action: 'search', query: 'route', preference: 'local-first' }, ctx)).toMatchObject({ total: 0 });
});

it('retains validated cloud experience locally across restart, but never caches approval/capability or different queries', async () => {
  let mode = 200;
  const { service, reopen } = setup((url, body) => {
    if (mode !== 200) return json({}, mode);
    expect(url.pathname).toBe('/learning/prepare');
    const content = 'Historical lesson, verify geometry before reuse.';
    return json({ protocol: 'agent-mc-learning/v1', namespace: body.namespace, result: {
      schema: 'agent-mc-prepared-context/v1', status: 'ready', content, content_bytes: Buffer.byteLength(content) } });
  });
  const config = { ...cfg, learningEnabled: true }, args = { action: 'service', operation: 'prepare', input: { query: 'geometry' } };
  expect(await service.execute(args, ctx, config)).toMatchObject({ status: 'confirmed', localCache: { status: 'stored' } });
  mode = 503;
  expect(await reopen().execute(args, ctx, config)).toMatchObject({ status: 'cached', degraded: true, currentWorldVerified: false,
    localCache: { status: 'fallback', currentServiceStateVerified: false }, result: { content: 'Historical lesson, verify geometry before reuse.', injected: false } });
  await expect(reopen().execute({ ...args, input: { query: 'different' } }, ctx, config)).rejects.toThrow('503');
  await expect(reopen().execute({ action: 'service', operation: 'capabilities' }, ctx, config)).rejects.toThrow('503');
  await expect(reopen().execute(args, { ...ctx, scope: { ...ctx.scope, agent: 'other' } }, config)).rejects.toThrow('503');
  mode = 403;
  await expect(reopen().execute(args, ctx, config)).rejects.toThrow('403');
  mode = 503;
  await expect(reopen().execute(args, ctx, config)).rejects.toThrow('503'); // A known denial invalidates the earlier fallback, including after restart.
  mode = 404;
  await expect(reopen().execute(args, ctx, config)).rejects.toThrow('404');
});

it('expires cloud backups, detects corruption, and never stores state or mutating receipts in the knowledge cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-cache-')); dirs.push(dir);
  let now = Date.parse('2026-10-14T09:00:00Z');
  const cache = new MemoryKnowledgeCache(dir, () => now), binding = 'a'.repeat(64), scope = 'b'.repeat(64);
  cache.put(binding, scope, 'prepare', { query: 'q' }, { content: 'historical' });
  expect(cache.get(binding, scope, 'prepare', { query: 'q' })).toMatchObject({ ageMs: 0, result: { content: 'historical' } });
  now += KNOWLEDGE_CACHE_MAX_AGE_MS + 1;
  expect(cache.get(binding, scope, 'prepare', { query: 'q' })).toBeNull();
  cache.put(binding, scope, 'prepare', { query: 'q' }, { content: 'new historical' });
  const path = join(dir, 'knowledge-cache', readdirSync(join(dir, 'knowledge-cache'))[0]);
  const content = JSON.parse(readFileSync(path, 'utf8'));
  Object.values(content.entries).forEach((entry: any) => { entry.result.content = 'corrupted'; });
  writeFileSync(path, JSON.stringify(content));
  expect(cache.get(binding, scope, 'prepare', { query: 'q' })).toBeNull();
  cache.put(binding, scope, 'dream', {}, { status: 'succeeded' });
  expect(cache.get(binding, scope, 'dream', {})).toBeNull();
  expect(GAME_MEMORY_DEFAULTS.readPreference).toBe('balanced');
});
