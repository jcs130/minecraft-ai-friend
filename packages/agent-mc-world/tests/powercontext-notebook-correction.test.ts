import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GameMemoryBook, type GameMemoryContext } from '../core/game-memory.ts';
import { GameMemoryService, GAME_MEMORY_DEFAULTS } from '../core/game-memory-service.ts';
import { MemoryKnowledgeCache, memoryKnowledgeBinding } from '../core/game-memory-redundancy.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const ctx: GameMemoryContext = { scope: { realm: 'fixture', account: 'offline:a', agent: 'a' }, dimension: 'overworld' };
const cfg = { ...GAME_MEMORY_DEFAULTS, mode: 'remote' as const, provider: 'powercontext' as const,
  endpoint: 'https://fixture.invalid', scopeId: 'owned-game-scope', learningEnabled: true };
const note = { action: 'remember', kind: 'lesson', summary: 'One failed spell',
  content: 'A failed sample does not establish permanent inability.', source: { kind: 'agent_note', reference: 'run:1' } };
const json = (body: unknown, status = 200, etag?: string) => new Response(JSON.stringify(body), {
  status, ...(etag ? { headers: { ETag: etag } } : {}),
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-power-correction-')); dirs.push(dir);
  const heads = new Map<string, any>(), history: any[] = [], calls: any[] = [];
  const mode = { listingIncomplete: false, listingConflict: false, putLost: false, createLost: false, forgetLost: false, conflict: false, offline: false };
  const request = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url)), method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: u.pathname, method, body, headers: init?.headers });
    if (mode.offline) throw Error('fixture offline');
    if (u.pathname === '/v1/context/prepare') return json({ schema: 'powercontext.prepared-context.v1', status: 'empty', content: null, content_bytes: 0 });
    if (u.pathname === '/v1/memory/remember') {
      const id = 'note-' + (heads.size + 1), artifact = { family: 'atomic-memory', artifact_id: id, revision: 1 };
      heads.set(id, { scope_id: cfg.scopeId, ...artifact, content: { kind: body.kind, text: body.text }, state: 'active', state_version: 0 });
      return json({ records: [{ text: body.text, artifact }] });
    }
    if (u.pathname === `/v1/scopes/${cfg.scopeId}/artifacts`) {
      const id = 'note-' + (heads.size + 1), artifact = { family: 'atomic-memory', artifact_id: id, revision: 1 };
      const head = { scope_id: cfg.scopeId, ...artifact, content: body.content, state: 'active', state_version: 0 };
      heads.set(id, head);
      if (mode.createLost) { mode.createLost = false; throw Error('initial creation response lost'); }
      return json(head, 201, '"revision:1"');
    }
    if (u.pathname === '/v1/atomic-memory/list') return json({
      items: [...heads.values()].filter(h => body.states.includes(h.state)).map(h => ({
        artifact: { family: h.family, artifact_id: h.artifact_id, revision: h.revision }, kind: h.content.kind,
        text: mode.listingConflict ? h.content.text.replace('One failed spell', 'Changed outside notebook') : h.content.text,
        state: h.state, state_version: h.state_version,
      })), next_cursor: mode.listingIncomplete ? 'repeating-page' : null,
    });
    if (u.pathname === '/v1/atomic-memory/lifecycle') {
      const h = heads.get(body.target.artifact.artifact_id);
      if (h.state_version !== body.target.state_version || h.revision !== body.target.artifact.revision) return json({}, 409);
      h.state = 'forgotten'; h.state_version++;
      if (mode.forgetLost) { mode.forgetLost = false; throw Error('lifecycle response lost'); }
      return json({ changed: true, records: [{ artifact: body.target.artifact, kind: h.content.kind,
        text: h.content.text, state: 'forgotten', state_version: h.state_version }] });
    }
    const id = u.pathname.split('/')[6], h = heads.get(id);
    if (!h) return json({}, 404);
    if (u.pathname.endsWith('/state')) return json({ artifact: { family: h.family, artifact_id: id, revision: h.revision }, state: h.state, state_version: h.state_version });
    const head = () => ({ scope_id: h.scope_id, family: h.family, artifact_id: id, revision: h.revision,
      content: mode.listingConflict ? { ...h.content, text: h.content.text.replace('One failed spell', 'Changed outside notebook') } : h.content });
    if (method === 'GET') return json(head(), 200, `"revision:${h.revision}"`);
    if (method === 'PUT') {
      if (mode.conflict || (init!.headers as Record<string, string>)['If-Match'] !== `"revision:${h.revision}"`) return json({}, 412);
      history.push(structuredClone(h)); h.revision++; h.content = body.content;
      if (mode.putLost) { mode.putLost = false; throw Error('reply lost after update'); }
      return json(head(), 200, `"revision:${h.revision}"`);
    }
    throw Error('Unexpected request ' + u.pathname);
  });
  const book = new GameMemoryBook(dir), service = new GameMemoryService(book, dir, request);
  return { dir, heads, history, calls, mode, request, book, service,
    reopen: () => new GameMemoryService(new GameMemoryBook(dir), dir, request) };
}
async function remember(s: ReturnType<typeof setup>) {
  const first = await s.service.execute(note, ctx, cfg);
  return (first.entry as any).id as string;
}
function legacyReceipt(s: ReturnType<typeof setup>) {
  const file = join(s.dir, 'replicas', readdirSync(join(s.dir, 'replicas'))[0]);
  const ledger = JSON.parse(readFileSync(file, 'utf8'));
  for (const entry of Object.values(ledger.entries) as any[]) delete entry.nativeRevisions;
  writeFileSync(file, JSON.stringify(ledger));
}
const revision = (id: string, expectedRevision = 1) => ({ ...note, action: 'revise', id, expectedRevision,
  summary: 'Failure retained; capability must be rechecked', content: 'Old attempt remains history. Fresh capability is available; causality was not established.' });

it('corrects the exact remote head, keeps immutable old content, and never appends an active obsolete sibling', async () => {
  const s = setup(), id = await remember(s);
  const fixed = await s.service.execute(revision(id), ctx, cfg);
  expect(fixed).toMatchObject({ saved: true, entry: { revision: 2 }, index: { status: 'stored', artifacts: [{ artifact_id: 'note-1', revision: 2 }] } });
  expect(s.heads.size).toBe(1);
  expect(JSON.parse(s.heads.get('note-1').content.text).entry.summary).toBe('Failure retained; capability must be rechecked');
  expect(JSON.parse(s.history[0].content.text).entry.summary).toBe('One failed spell');
  expect((await s.service.execute({ action: 'get', id, revision: 1 }, ctx)).entry).toMatchObject({ summary: 'One failed spell' });
  expect(s.calls.filter(x => x.path === '/v1/memory/remember')).toHaveLength(1);
  expect(s.calls.filter(x => x.path === '/v1/atomic-memory/list')).toHaveLength(0);
});

it('does not change a remote record whose content has diverged from local evidence', async () => {
  const s = setup(), id = await remember(s); s.mode.listingConflict = true;
  expect(await s.service.execute(revision(id), ctx, cfg)).toMatchObject({ saved: true, index: { status: 'unverified', automaticRetry: false } });
  expect(s.calls.some(x => x.method === 'PUT')).toBe(false);
  expect(s.heads.size).toBe(1);
});

it('rejects head races using If-Match rather than overwriting an external change', async () => {
  const s = setup(), id = await remember(s); s.mode.conflict = true;
  const fixed = await s.service.execute(revision(id), ctx, cfg);
  expect(fixed).toMatchObject({ saved: true, index: { status: 'unverified', reason: expect.stringContaining('412') } });
  expect(s.heads.get('note-1').revision).toBe(1);
  expect(s.calls.filter(x => x.method === 'PUT')).toHaveLength(1);
});

it('reconciles a lost correction response across restart without a second PUT or remember', async () => {
  const s = setup(), id = await remember(s); s.mode.putLost = true;
  expect(await s.service.execute(revision(id), ctx, cfg)).toMatchObject({ index: { status: 'unverified' } });
  expect(await s.reopen().execute({ action: 'sync', id, expectedRevision: 2 }, ctx, cfg))
    .toMatchObject({ index: { status: 'stored', reconciled: true, replayed: false } });
  expect(s.calls.filter(x => x.method === 'PUT')).toHaveLength(1);
  expect(s.calls.filter(x => x.path === '/v1/memory/remember')).toHaveLength(1);
});

it('finishes a bounded complete listing before any correction and rejects repeated cursors', async () => {
  const s = setup(), id = await remember(s); legacyReceipt(s); s.mode.listingIncomplete = true;
  expect(await s.service.execute(revision(id), ctx, cfg)).toMatchObject({ index: { status: 'unverified' } });
  expect(s.calls.some(x => x.method === 'PUT')).toBe(false);
});

it('reconciles a lost forgetting response without restoring or forgetting the artifact again', async () => {
  const s = setup(), id = await remember(s); s.mode.forgetLost = true;
  expect(await s.service.execute({ action: 'archive', id, expectedRevision: 1 }, ctx, cfg))
    .toMatchObject({ index: { status: 'unverified' } });
  expect(await s.reopen().execute({ action: 'sync', id, expectedRevision: 2 }, ctx, cfg))
    .toMatchObject({ index: { status: 'stored', forgotten: true, reconciled: true } });
  expect(s.heads.get('note-1').state).toBe('forgotten');
  expect(s.calls.filter(x => x.path === '/v1/atomic-memory/lifecycle')).toHaveLength(1);
  expect(s.calls.filter(x => x.method === 'PUT')).toHaveLength(1);
});

it('keeps one corrected active legacy head, forgets obsolete copies without rewriting them, and preserves unrelated memories', async () => {
  const s = setup(), id = await remember(s); legacyReceipt(s);
  const original = structuredClone(s.heads.get('note-1'));
  s.heads.set('old-sibling', { ...structuredClone(original), artifact_id: 'old-sibling' });
  s.heads.set('foreign', { ...structuredClone(original), artifact_id: 'foreign', content: {
    ...original.content, text: original.content.text.replace(id, '00000000-0000-0000-0000-000000000000') } });
  expect(await s.service.execute(revision(id), ctx, cfg)).toMatchObject({ index: { status: 'stored', artifacts: [
    { artifact_id: 'note-1', revision: 2 },
  ], forgottenCopies: [{ artifact_id: 'old-sibling', revision: 1 }] } });
  expect(s.heads.get('old-sibling')).toMatchObject({ revision: 1, state: 'forgotten', content: original.content });
  expect(s.heads.get('foreign').revision).toBe(1);
  expect(s.calls.filter(x => x.path === '/v1/memory/remember')).toHaveLength(1);
});

it('upgrades a legacy same-revision stored receipt only after exact native reconciliation', async () => {
  const s = setup(), id = await remember(s);
  await s.service.execute(revision(id), ctx, cfg); legacyReceipt(s);
  s.heads.set('obsolete', { ...structuredClone(s.history[0]), artifact_id: 'obsolete' });
  expect(await s.reopen().execute({ action: 'sync', id, expectedRevision: 2 }, ctx, cfg))
    .toMatchObject({ index: { status: 'stored', reconciled: true } });
  const rows = await s.reopen().execute({ action: 'replication' }, ctx, cfg);
  expect((rows.entries as any[])[0].receipt).toMatchObject({ nativeRevisions: true, pendingCorrection: false, searchVerified: false });
  expect(JSON.parse(s.heads.get('obsolete').content.text).mc_revision).toBe(1);
  expect(s.heads.get('obsolete').state).toBe('forgotten');
});

it('retires an archived notebook replica from active remote recall while preserving all local revisions', async () => {
  const s = setup(), id = await remember(s);
  expect(await s.service.execute({ action: 'archive', id, expectedRevision: 1 }, ctx, cfg))
    .toMatchObject({ index: { status: 'stored', forgotten: true } });
  expect(s.heads.get('note-1').state).toBe('forgotten');
  expect((await s.service.execute({ action: 'get', id, revision: 1 }, ctx)).entry).toMatchObject({ archived: false });
});

it('invalidates derived cache on correction and blocks remote prepare until the corrected replica is confirmed', async () => {
  const s = setup(), id = await remember(s);
  const scope = String(s.book.execute({ action: 'search' }, ctx).scopeKey);
  const cache = new MemoryKnowledgeCache(s.dir), binding = memoryKnowledgeBinding(cfg, scope), input = { query: 'spell', max_bytes: 4000 };
  cache.put(binding, scope, 'prepare', input, { content: 'Obsolete interpretation' });
  s.mode.offline = true;
  expect(await s.service.execute(revision(id), ctx, cfg)).toMatchObject({ index: { status: 'unverified' } });
  expect(cache.get(binding, scope, 'prepare', input)).toBeNull();
  await expect(s.reopen().execute({ action: 'service', operation: 'prepare', input }, ctx, cfg)).rejects.toThrow('local notebook correction');
  expect(await s.service.execute({ action: 'search', query: 'capability', preference: 'local-first' }, ctx, { ...cfg, mode: 'local' }))
    .toMatchObject({ entries: [{ revision: 2 }] });
});

it('creates a first native replica for a previously local-only revised note and then keeps its Artifact identity', async () => {
  const s = setup(), local = await s.service.execute(note, ctx), id = (local.entry as any).id;
  await s.service.execute(revision(id), ctx);
  const synced = await s.service.execute({ action: 'sync', id, expectedRevision: 2 }, ctx, cfg);
  expect(synced).toMatchObject({ index: { status: 'stored', artifacts: [{ artifact_id: 'note-1', revision: 1 }] } });
  expect(JSON.parse(s.heads.get('note-1').content.text).mc_revision).toBe(2);
  expect(await s.service.execute(revision(id, 2), ctx, cfg)).toMatchObject({ index: { status: 'stored', artifacts: [{ artifact_id: 'note-1', revision: 2 }] } });
  expect(s.calls.filter(x => x.path === '/v1/memory/remember')).toHaveLength(0);
  expect(s.calls.filter(x => x.path.endsWith('/artifacts') && x.method === 'POST')).toHaveLength(1);
});

it('never blindly repeats initial creation after its response is lost', async () => {
  const s = setup(), local = await s.service.execute(note, ctx), id = (local.entry as any).id;
  await s.service.execute(revision(id), ctx);s.mode.createLost = true;
  expect(await s.service.execute({ action: 'sync', id, expectedRevision: 2 }, ctx, cfg)).toMatchObject({ index: { status: 'unverified' } });
  expect(await s.reopen().execute({ action: 'sync', id, expectedRevision: 2 }, ctx, cfg)).toMatchObject({ index: { status: 'stored', reconciled: true } });
  expect(s.calls.filter(x => x.path.endsWith('/artifacts') && x.method === 'POST')).toHaveLength(1);
});

it('does not turn merged legacy input into a fresh active identity', async () => {
  const s = setup(), id = await remember(s);legacyReceipt(s);s.heads.get('note-1').state = 'merged';
  expect(await s.service.execute(revision(id), ctx, cfg)).toMatchObject({ index: { status: 'unverified', reason: expect.stringContaining('merged or retired') } });
  expect(s.calls.some(x => x.method === 'PUT'||x.path.endsWith('/artifacts'))).toBe(false);
});

it('does not block independent prepared context for local-only revision history', async () => {
  const s = setup(), local = await s.service.execute(note, ctx), id = (local.entry as any).id;
  await s.service.execute(revision(id), ctx);
  expect(await s.service.execute({ action: 'service', operation: 'prepare', input: { query: 'spell', max_bytes: 4000 } }, ctx, cfg))
    .toMatchObject({ result: { status: 'empty' } });
});

it('bounds the whole correction rather than giving each sequential read a fresh timeout', async () => {
  const s = setup(), id = await remember(s);
  const slow = new GameMemoryService(s.book, s.dir, async (url, init) => {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer);reject(new DOMException('fixture cancelled', 'AbortError')); };
      const timer = setTimeout(() => { init?.signal?.removeEventListener('abort', abort);resolve(); }, 70);
      if(init?.signal?.aborted)abort();else init?.signal?.addEventListener('abort', abort, {once:true});
    });
    return s.request(url, init);
  });
  expect(await slow.execute(revision(id), ctx, { ...cfg, timeoutMs: 100 })).toMatchObject({ index: { status: 'unverified' } });
  expect(s.calls.some(x => x.method === 'PUT')).toBe(false);
});
