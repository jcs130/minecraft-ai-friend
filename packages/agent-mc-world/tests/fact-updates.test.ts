import { describe, it, expect } from 'vitest';
import { FactUpdateStream, applyFactUpdate, FACT_UPDATE_GUIDANCE, type FactUpdateState } from '../src/client/fact-updates.ts';

describe('append-only game facts', () => {
  it('preserves complete state across movement, inventory changes, explicit unknowns and removals', () => {
    const stream = new FactUpdateStream(), first = { run: 'a', dimension: 'overworld', at: 'one', health: 20, food: 0,
      inventory: [{ item: 'bread', count: 2 }], hazards: ['zombie'], ready: false, block: { type: 'chest', known: true } };
    const baseline = stream.preview(first); expect(baseline.kind).toBe('snapshot'); stream.commit(baseline);
    let state = applyFactUpdate(null, baseline);
    const next = { run: 'a', dimension: 'overworld', at: 'two', health: null, food: 0, inventory: [], ready: false, position: [1, 2, 3] };
    const patch = stream.preview(next); expect(patch.kind).toBe('patch');
    expect(patch.values).toEqual({ health: null, inventory: [], position: [1, 2, 3] });
    expect(patch.removed).toEqual(['block', 'hazards']);
    stream.commit(patch); state = applyFactUpdate(state, patch);
    const { at, ...expected } = next; expect(state.values).toEqual(expected); expect(state.observedAt).toBe(at);
    expect(state.values.food).toBe(0); expect(state.values.ready).toBe(false);
    expect(first.health).toBe(20); expect(first.inventory).toHaveLength(1);
  });
  it('preview/abandoned prompt assembly cannot advance the baseline; serialization order is stable', () => {
    const stream = new FactUpdateStream();
    const first = stream.preview({ at: 'one', b: { y: 2, x: 1 }, a: 0 });
    const again = stream.preview({ a: 0, b: { x: 1, y: 2 }, at: 'one' });
    expect(again).toEqual(first); expect(again.kind).toBe('snapshot'); stream.commit(first);
    const abandoned = stream.preview({ a: 5, b: { x: 1, y: 2 } });
    const admitted = stream.preview({ a: 6, b: { x: 1, y: 2 } });
    expect(admitted.baseRevision).toBe(first.revision); expect(abandoned.baseRevision).toBe(first.revision);
    stream.commit(admitted); expect(stream.preview({ a: 6, b: { x: 1, y: 2 }, at: 'three' }).values).toEqual({});
    expect(stream.preview({ a: 6, b: { x: 1, y: 2 }, at: 'three' }).observedAt).toBe('three');
  });
  it('reconnect, history compaction, run and dimension changes establish fresh baselines', () => {
    const stream = new FactUpdateStream();
    stream.commit(stream.preview({ run: 'one', dimension: 'overworld', health: 3 }));
    for (const value of [{ run: 'two', dimension: 'overworld', health: 3 }, { run: 'two', dimension: 'nether', health: 3 }]) {
      const update = stream.preview(value); expect(update.kind).toBe('snapshot'); stream.commit(update);
    }
    stream.reset(); expect(stream.preview({ run: 'two', dimension: 'nether', health: 3 }).kind).toBe('snapshot');
  });
  it('periodically rebases without rewriting or dropping the event stream', () => {
    const stream = new FactUpdateStream({ snapshotEvery: 3 }); const kinds: string[] = [];
    for (let health = 20; health > 13; health--) { const frame = stream.preview({ health }); kinds.push(frame.kind); stream.commit(frame); }
    expect(kinds).toEqual(['snapshot', 'patch', 'patch', 'snapshot', 'patch', 'patch', 'snapshot']);
  });
  it('rejects missing, corrupted or reordered baselines and preserves prototype-like JSON keys', () => {
    const stream = new FactUpdateStream(); const first = stream.preview(JSON.parse('{"health":20,"__proto__":{"safe":true}}'));
    const state = applyFactUpdate(null, first); stream.commit(first);
    expect(Object.hasOwn(state.values, '__proto__')).toBe(true); expect(({} as any).safe).toBeUndefined();
    const patch = stream.preview({ health: 19 }); expect(() => applyFactUpdate(null, patch)).toThrow(/baseline/);
    expect(() => applyFactUpdate(state, { ...patch, values: { health: 1 } })).toThrow(/revision/);
    stream.commit(patch); const later = stream.preview({ health: 18 });
    expect(() => applyFactUpdate(state, later)).toThrow(/baseline/);
    expect(() => stream.preview({ health: NaN })).toThrow(/finite JSON/);
    expect(() => stream.preview({ health: undefined })).toThrow(/finite JSON/);
  });
  it('reconstructs a long independent simulation exactly while transferring less unchanged data', () => {
    const stream = new FactUpdateStream(); let state: FactUpdateState | null = null, fullBytes = 0, updateBytes = 0;
    for (let tick = 0; tick < 200; tick++) {
      const facts = { run: 'same', at: String(tick), position: [tick, 64, tick % 3], health: tick % 19 ? 20 : null,
        inventory: Array.from({ length: 36 }, (_, n) => ({ item: 'fixture-item-' + n, count: n === 0 ? tick % 64 : 32 })),
        serverCapabilities: { description: 'stable reference, not an instruction '.repeat(200), available: true } };
      const frame = stream.preview(facts); state = applyFactUpdate(state, frame); stream.commit(frame);
      const { at, ...expected } = facts; expect(state.values).toEqual(expected); expect(state.observedAt).toBe(at);
      fullBytes += Buffer.byteLength(JSON.stringify(facts)); updateBytes += Buffer.byteLength(JSON.stringify(frame));
    }
    expect(updateBytes).toBeLessThan(fullBytes * 0.35);
    expect(FACT_UPDATE_GUIDANCE).toContain('untrusted');
  });
});
