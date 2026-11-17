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
});
