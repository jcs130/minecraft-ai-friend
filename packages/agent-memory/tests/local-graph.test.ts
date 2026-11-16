import { describe, expect, it } from 'vitest';
import { homeSet, preferenceFacts } from '../src/index.ts';
import { clock, memory, OVERWORLD, SCOPE } from './helpers.ts';

describe('LocalTemporalGraph bi-temporal semantics', () => {
  it('a moved home supersedes the old one without deleting it', async () => {
    const c = clock(); const m = memory(c.now); const s = m.scope(SCOPE);
    await s.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 10, y: 64, z: 10 }, world: OVERWORLD, at: '2026-11-01T10:00:00Z' }));
    c.advance(60_000);
    const moved = await s.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 500, y: 70, z: -20 }, world: OVERWORLD, at: '2026-11-05T10:00:00Z' }));
    expect(moved.local.invalidated).toHaveLength(1);
    expect(moved.local.invalidated[0]!.invalidAt).toBe('2026-11-05T10:00:00.000Z');

    const now = (await s.currentFacts({ entity: 'Steve', relation: 'HOME_AT' })).facts;
    expect(now.map(f => f.value)).toEqual(['500,70,-20']);
    const before = (await s.factsAt('2026-11-03T00:00:00Z', { entity: 'Steve', relation: 'HOME_AT' })).facts;
    expect(before.map(f => f.value)).toEqual(['10,64,10']);
    const history = (await s.history({ entity: 'home:base' })).facts;
    expect(history.map(f => [f.value, f.invalidAt])).toEqual([['10,64,10', '2026-11-05T10:00:00.000Z'], ['500,70,-20', null]]);
    expect(history[0]!.supersededBy).toBe(history[1]!.factId);
    await m.close();
  });

  it('knownAt answers what was believed at a past system time', async () => {
    const c = clock('2026-11-16T12:00:00Z'); const m = memory(c.now); const s = m.scope(SCOPE);
    await s.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 1, y: 2, z: 3 }, world: OVERWORLD, at: '2026-11-01T00:00:00Z' }));
    c.advance(3_600_000);
    await s.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 9, y: 9, z: 9 }, world: OVERWORLD, at: '2026-11-02T00:00:00Z' }));
    // Reality time 11-03: home is 9,9,9. But at system time 12:30 (before we learned about the move) we believed 1,2,3.
    expect((await s.factsAt('2026-11-03T00:00:00Z', { relation: 'HOME_AT' })).facts.map(f => f.value)).toEqual(['9,9,9']);
    expect((await s.factsAt('2026-11-03T00:00:00Z', { relation: 'HOME_AT' }, { knownAt: '2026-11-16T12:30:00Z' })).facts.map(f => f.value)).toEqual(['1,2,3']);
    await m.close();
  });

  it('negation and conflicting relations invalidate; repeats only confirm', async () => {
    const m = memory(); const s = m.scope(SCOPE);
    const say = (msg: string, at: string) => s.ingest({ kind: 'chat', occurredAt: at, text: msg, actors: ['Alex'], world: OVERWORLD, data: {},
      importance: 0.5, source: { type: 'synthetic' }, facts: preferenceFacts('Alex', msg, at) });
    await say('我最喜欢钓鱼了', '2026-11-01T00:00:00Z');
    const again = await say('我喜欢钓鱼', '2026-11-02T00:00:00Z');
    expect(again.local.added).toHaveLength(0);
    expect(again.local.confirmed[0]!.episodes).toHaveLength(2);
    const hate = await say('我讨厌钓鱼', '2026-11-03T00:00:00Z');
    expect(hate.local.invalidated.map(f => f.relation)).toEqual(['LIKES']);
    expect((await s.currentFacts({ entity: 'Alex' })).facts.map(f => `${f.relation} ${f.object?.name}`)).toEqual(['DISLIKES 钓鱼']);
    await say('I like diamonds', '2026-11-04T00:00:00Z');
    const neg = await say('I no longer like diamonds', '2026-11-05T00:00:00Z');
    expect(neg.local.added).toHaveLength(0);
    expect(neg.local.invalidated).toHaveLength(1);
    expect((await s.factsAt('2026-11-04T12:00:00Z', { entity: 'diamonds' })).facts).toHaveLength(1);
    expect((await s.currentFacts({ entity: 'diamonds' })).facts).toHaveLength(0);
    await m.close();
  });

  it('out-of-order older facts become historical and do not override newer truth', async () => {
    const m = memory(); const s = m.scope(SCOPE);
    await s.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 9, y: 9, z: 9 }, world: OVERWORLD, at: '2026-11-10T00:00:00Z' }));
    const late = await s.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 1, y: 1, z: 1 }, world: OVERWORLD, at: '2026-11-01T00:00:00Z' }));
    expect(late.local.invalidated).toHaveLength(0);
    expect(late.local.added[0]!.invalidAt).toBe('2026-11-10T00:00:00.000Z');
    expect((await s.currentFacts({ relation: 'HOME_AT' })).facts.map(f => f.value)).toEqual(['9,9,9']);
    expect((await s.factsAt('2026-11-05T00:00:00Z', { relation: 'HOME_AT' })).facts.map(f => f.value)).toEqual(['1,1,1']);
    await m.close();
  });

  it('scopes are isolated and locations are namespaced by world identity', async () => {
    const m = memory(); const a = m.scope(SCOPE); const b = m.scope({ ...SCOPE, agent: 'other' });
    await a.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 1, y: 1, z: 1 }, world: OVERWORLD, at: '2026-11-01T00:00:00Z' }));
    await a.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 5, y: 5, z: 5 }, world: { key: 'minecraft:the_nether' }, at: '2026-11-02T00:00:00Z' }));
    await a.ingest(homeSet({ owner: 'Steve', name: 'base', pos: { x: 7, y: 7, z: 7 }, world: { key: null, connection: 'c1', revision: 2 }, at: '2026-11-03T00:00:00Z' }));
    const facts = (await a.currentFacts({ relation: 'HOME_AT' })).facts.map(f => f.object!.name).sort();
    expect(facts).toEqual(['minecraft:overworld|home:base', 'minecraft:the_nether|home:base', 'unknown-world:c1:2|home:base']);
    expect((await b.currentFacts({})).facts).toHaveLength(0);
    expect(b.recentEpisodes()).toHaveLength(0);
    await m.close();
  });

  it('cold episodes are append-only', async () => {
    const m = memory(); const s = m.scope(SCOPE);
    await s.ingest(homeSet({ owner: 'Steve', name: 'b', pos: { x: 1, y: 1, z: 1 }, world: OVERWORLD, at: '2026-11-01T00:00:00Z' }));
    expect(() => m.db.exec('DELETE FROM episodes')).toThrow(/append-only/);
    expect(() => m.db.exec("UPDATE episodes SET text = 'x'")).toThrow(/append-only/);
    await m.close();
  });
});
