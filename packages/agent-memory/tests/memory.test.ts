import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentMemory, fromEvent, homeSet } from '../src/index.ts';
import { OVERWORLD, SCOPE } from './helpers.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'agent-memory-')); dirs.push(d); return d; };

function fakeSidecar(behaviour: { fail?: boolean } = {}) {
  const calls: Array<{ path: string; body: any }> = [];
  const fetcher = (async (url: URL | string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname; const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    if (behaviour.fail) return new Response('boom', { status: 503 });
    if (path === '/health') return Response.json({ ok: true, driver: 'fake', llm: 'fake', embedder: 'hash' });
    const edge = { uuid: 'g1', name: 'LIKES', fact: 'Steve likes redstone', group_id: body.group_id,
      source: { uuid: 's', name: 'Steve', labels: ['Entity', 'Player'] }, target: { uuid: 't', name: 'redstone', labels: ['Entity'] },
      valid_at: '2026-11-01T00:00:00Z', invalid_at: null, created_at: '2026-11-16T00:00:00Z', expired_at: null, episodes: ['e'] };
    if (path === '/episodes') return Response.json({ edges: [edge], invalidated: [] });
    if (path === '/search') return Response.json({ facts: [edge] });
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe('AgentMemory', () => {
  it('persists across restarts and de-duplicates replayed host events', async () => {
    const dir = tmp();
    const ev = { type: 'minecraft.enter', ts: '2026-11-16T12:00:00Z', text: 'Steve joined', meta: { uname: 'Steve' }, cursor: 42 };
    let m = new AgentMemory({ dataDir: dir });
    const first = await m.scope(SCOPE).ingest(fromEvent(ev, { self: 'Komi', world: OVERWORLD })!);
    const replay = await m.scope(SCOPE).ingest(fromEvent(ev, { self: 'Komi', world: OVERWORLD })!);
    expect(replay.duplicate).toBe(true);
    expect(replay.episode.id).toBe(first.episode.id);
    await m.close();
    m = new AgentMemory({ dataDir: dir });
    const s = m.scope(SCOPE);
    expect(s.episodeCount()).toBe(1);
    expect((await s.currentFacts({ entity: 'Player:Steve' })).facts[0]).toMatchObject({ relation: 'IS_ONLINE', value: true });
    await m.close();
  });

  it('hybrid mode ingests into Graphiti asynchronously and merges reads', async () => {
    const side = fakeSidecar();
    const m = new AgentMemory({ dataDir: ':memory:', backend: 'hybrid', graphiti: { url: 'http://127.0.0.1:8765', fetch: side.fetcher } });
    const s = m.scope(SCOPE);
    const r = await s.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 1, y: 2, z: 3 }, world: OVERWORLD, at: '2026-11-01T00:00:00Z' }));
    expect(r.queuedForGraphiti).toBe(true);
    await m.flush();
    expect(m.stats.graphitiOk).toBe(1);
    const sent = side.calls.find(c => c.path === '/episodes')!.body;
    expect(sent.group_id).toBe(s.key);
    expect(sent.episode.reference_time).toBe('2026-11-01T00:00:00.000Z');
    expect(sent.hints[0]).toContain('HOME_AT');
    const facts = (await s.currentFacts({ entity: 'Steve' })).facts;
    expect(facts.map(f => f.backend).sort()).toEqual(['graphiti', 'local']);
    expect((await m.health()).map(h => h.ok)).toEqual([true, true]);
    await m.close();
  });

  it('sidecar failure degrades to local and never loses the cold episode', async () => {
    const warnings: string[] = [];
    const m = new AgentMemory({ dataDir: ':memory:', backend: 'hybrid', onWarning: w => warnings.push(w),
      graphiti: { url: 'http://127.0.0.1:8765', fetch: fakeSidecar({ fail: true }).fetcher } });
    const s = m.scope(SCOPE);
    await s.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 1, y: 2, z: 3 }, world: OVERWORLD, at: '2026-11-01T00:00:00Z' }));
    await m.flush();
    expect(m.stats.graphitiFailed).toBe(1);
    expect(warnings[0]).toMatch(/graphiti ingest failed/);
    const res = await s.currentFacts({ entity: 'Steve' });
    expect(res.facts).toHaveLength(1);
    expect(res.degraded).toMatch(/graphiti unavailable/);
    expect(s.episodeCount()).toBe(1);
    expect((await m.health())[1]!.ok).toBe(false);
    await m.close();
  });

  it('bounded sidecar queue drops lowest-importance work first', async () => {
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const fetcher = (async () => { await gate; return Response.json({ edges: [], invalidated: [] }); }) as unknown as typeof fetch;
    const m = new AgentMemory({ dataDir: ':memory:', backend: 'hybrid', maxPending: 2, graphiti: { url: 'http://127.0.0.1:1', fetch: fetcher } });
    const s = m.scope(SCOPE);
    const ep = (i: number, importance: number) => ({ kind: 'note' as const, occurredAt: `2026-11-0${i}T00:00:00Z`, text: `n${i}`, actors: [],
      world: null, data: {}, importance, source: { type: 'synthetic' }, facts: [] });
    await s.ingest(ep(1, 0.5)); // taken by worker immediately
    await s.ingest(ep(2, 0.1)); await s.ingest(ep(3, 0.9));
    const dropped = await s.ingest(ep(4, 0.05));
    expect(dropped.queuedForGraphiti).toBe(false);
    await s.ingest(ep(5, 0.8)); // evicts n2 (0.1)
    expect(m.stats.graphitiDropped).toBe(2);
    expect(s.episodeCount()).toBe(5);
    release(); await m.close();
  });

  it('retains exact failed deliveries across a local-only restart; recovery is bounded and scoped', async () => {
    const dir = tmp(), down = fakeSidecar({ fail: true }), up = fakeSidecar();
    const other = { ...SCOPE, agent: 'another' };
    const event = (n: number) => fromEvent({ type: 'minecraft.enter', ts: '2026-11-16T12:00:00Z',
      cursor: n, text: 'Guest joined', meta: { uname: 'Guest' } }, { self: 'Komi', world: OVERWORLD })!;
    let m = new AgentMemory({ dataDir: dir, backend: 'hybrid', graphiti: { url: 'http://localhost', fetch: down.fetcher } });
    const first = await m.scope(SCOPE).ingest(event(40));
    await m.scope(other).ingest(event(41));
    await m.close();
    const firstBody = down.calls[0]!.body;
    m = new AgentMemory({ dataDir: dir });
    expect(m.scope(SCOPE).episode(first.episode.id)?.text).toBe(first.episode.text);
    expect(m.scope(other).episode(first.episode.id)).toBeNull();
    await m.scope(SCOPE).ingest(event(42)); // explicitly local: this must not be sent on restoration
    await m.close();
    m = new AgentMemory({ dataDir: dir, backend: 'hybrid', graphiti: { url: 'http://localhost', fetch: up.fetcher } });
    expect((await m.scope(SCOPE).ingest(event(40))).duplicate).toBe(true);
    expect(up.calls).toHaveLength(0);
    expect(m.scope(SCOPE).retryPendingGraphiti(1)).toEqual({ queued: 1, outstanding: 1 });
    expect(m.scope(SCOPE).retryPendingGraphiti(1).queued).toBe(0);
    await m.flush();
    expect(up.calls.map(c => c.body)).toEqual([firstBody]);
    expect(m.scope(SCOPE).retryPendingGraphiti()).toEqual({ queued: 0, outstanding: 0 });
    expect(m.scope(other).retryPendingGraphiti(1).queued).toBe(1);
    await m.close();
    expect(up.calls[1]!.body.group_id).not.toBe(firstBody.group_id);
  });

  it('allows replay after a local write fails without leaving a partial cold record', async () => {
    const m = new AgentMemory({ dataDir: ':memory:' }), s = m.scope(SCOPE);
    const draft = fromEvent({ type: 'minecraft.enter', ts: '2026-11-16T12:00:00Z', cursor: 9,
      text: 'Guest joined', meta: { uname: 'Guest' } }, { self: 'Komi', world: OVERWORLD })!;
    m.db.exec("CREATE TRIGGER simulate_storage_failure BEFORE INSERT ON facts BEGIN SELECT RAISE(ABORT,'write failed'); END");
    await expect(s.ingest(draft)).rejects.toThrow('write failed');
    expect(s.episodeCount()).toBe(0);
    m.db.exec('DROP TRIGGER simulate_storage_failure');
    expect((await s.ingest(draft)).duplicate).toBe(false);
    expect((await s.currentFacts()).facts).toHaveLength(1);
    await m.close();
  });

  it('keeps a valid local answer when a graph response carries a different partition', async () => {
    const m = new AgentMemory({ dataDir: ':memory:', backend: 'hybrid', maxPending: 0, graphiti: {
      url: 'http://localhost', fetch: async () => Response.json({ facts: [{ group_id: 'other' }] }),
    } });
    const s = m.scope(SCOPE);
    await s.ingest(homeSet({ owner: 'Guest', name: 'home', pos: { x: 5, y: 66, z: 5 }, world: OVERWORLD, at: '2026-11-16T12:00:00Z' }));
    expect((await s.currentFacts()).facts.map(f => f.scopeKey)).toEqual([s.key]);
    expect(s.retryPendingGraphiti(1)).toEqual({ queued: 0, outstanding: 1 });
    await m.close();
  });
});
