import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withFactState, type FactState } from '../src/context.ts';
import { AgentJournal } from '../src/client/journal.ts';
import { CurrentFacts } from '../src/client/context.ts';
import { methodHarness } from './method-harness.ts';

describe('producer-owned fact state', () => {
  it('retains new dated evidence and original hashes while comparing unchanged semantic state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-fact-state-'));
    try {
      const journal = new AgentJournal(dir), facts = new CurrentFacts(journal);
      const state = { position: [1, 64, 2], health: 20, inventory: [{ name: 'wheat_seeds', count: 30 }] };
      const read = (sampledAt: string) => facts.replace({ text: '', snapshotTypes: [], parts: [
        withFactState({ key: 'recoveryState', text: JSON.stringify({ sampledAt, ...state }) }, state),
      ] })[0];
      const before = read('2026-10-29T07:01:00Z'), after = read('2026-10-29T07:01:01Z');
      expect(after.stateRevision).toBe(before.stateRevision);
      expect(after.revision).not.toBe(before.revision);
      expect(after.original).not.toBe(before.original);
      expect(after.text).toContain('07:01:01');
      expect(Buffer.from(journal.blob(before.original)!.bytes).toString()).toContain('07:01:00');
      expect(withFactState({ key: 'state', text: 'x' }, { b: 2, a: 1 }).stateRevision)
        .toBe(withFactState({ key: 'state', text: 'x' }, { a: 1, b: 2 }).stateRevision);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(['mana', 'cooldownMs', 'lastCastAt', 'target', 'position', 'inventory', 'health'])
    ('keeps meaningful %s changes, including explicitly supplied timestamps', key => {
      const state = { mana: 12, cooldownMs: 200, lastCastAt: '2026-10-29T07:00Z', target: 'zombie',
        position: [1, 64, 2], inventory: [{ name: 'wheat_seeds', count: 30 }], health: 20 };
      const before = withFactState({ key: 'state', text: 'raw' }, state);
      const after = withFactState({ key: 'state', text: 'raw' }, { ...state, [key]: null });
      expect(after.stateRevision).not.toBe(before.stateRevision);
    });

  it.each([NaN, Infinity, undefined, new Date(), { unsupported: undefined }, [undefined], new Array(2)])
    ('rejects ambiguous non-JSON state %#', value => {
      expect(() => withFactState({ key: 'state', text: 'raw' }, value as FactState)).toThrow(TypeError);
    });

  it('rejects cycles but permits shared acyclic objects', () => {
    const state: Record<string, FactState> = {}; state.self = state;
    expect(() => withFactState({ key: 'state', text: 'raw' }, state)).toThrow(TypeError);
    const child = { x: 1 };
    expect(withFactState({ key: 'state', text: 'raw' }, [child, child]).stateRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

it('core recovery facts declare only sampling time as non-state', () => {
  const r = methodHarness('1.21.1');
  try {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-29T07:00:00Z'));
    Object.assign(r.bot, { deathLifecycle: { episodeId: 'life-1', phase: 'alive' } });
    const read = () => r.world.requestFacts()!.parts!.find(p => p.key === 'recoveryState')!;
    const before = read();
    vi.setSystemTime(new Date('2026-10-29T07:00:02Z'));
    const after = read();
    expect(JSON.parse(after.text).sampledAt).not.toBe(JSON.parse(before.text).sampledAt);
    expect(after.stateRevision).toBe(before.stateRevision);
    r.bot.health = 19;
    expect(read().stateRevision).not.toBe(before.stateRevision);
    r.bot.health = 20; r.bot.entity.position.x += 0.5;
    expect(read().stateRevision).not.toBe(before.stateRevision);
  } finally { vi.useRealTimers(); r.close(); }
});
