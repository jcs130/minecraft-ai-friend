import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CombatTacticBook } from '../core/combat-tactics.ts';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';
import type { CombatResult } from '../core/combat-observation.ts';

const result = (): CombatResult => ({ startedAt: '2026-10-16T00:00:00Z', endedAt: '2026-10-16T00:00:05Z',
  reason: 'death', healthBefore: null, healthAfter: 0, swings: 0, meleeLanded: 0, arrows: 0, rangedLanded: 0, kills: {},
  deathEpisodeId: 'native-death', controlSummary: { schemaVersion: 1, finalMode: 'retreating', enteredDesperate: false, retreat: null } });

it('retains separate receipts and discards malformed optional summaries without invalidating original ledger data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'combat-causal-')), file = join(dir, 'book.json');
  try {
    const book = new CombatTacticBook(file); book.useRealm('realm');
    const timeout = book.record({ ...result(), reason: 'timeout', swings: 20 }, []);
    const lethal = book.record(result(), []);
    expect(timeout.deathEpisodeId).toBeUndefined(); expect(timeout.swings).toBe(20);
    expect(lethal.id).toBe(timeout.id + 1); expect(lethal.swings).toBe(0);
    const before = readFileSync(file, 'utf8');
    for (const invalid of [{ schemaVersion: 2 }, { ...result().controlSummary, retreat: '12345' }, { ...result().controlSummary, extra: 'x'.repeat(2048) },
      { ...result().controlSummary, retreat: { movement: { samples: -1 } } }]) {
      const saved = JSON.parse(before); saved.realms.realm.reports[1].controlSummary = invalid;
      writeFileSync(file, JSON.stringify(saved));
      const reloaded = new CombatTacticBook(file); reloaded.useRealm('realm');
      const row = reloaded.current().reports[1];
      expect(row.controlSummary).toBeUndefined(); expect(row.healthBefore).toBeNull(); expect(row.id).toBe(lethal.id);
      expect(row.deathEpisodeId).toBe('native-death');
      expect(JSON.parse(readFileSync(file, 'utf8')).realms.realm.reports[1].controlSummary).toEqual(invalid);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('emits the existing combat event with the native account scope and saved receipt, retaining failure handling', () => {
  const events: unknown[][] = [], book = new CombatTacticBook(); book.useRealm('realm');
  const world: any = Object.create(TacticalMinecraftWorld.prototype);
  Object.assign(world, { cfg: { auth: 'offline', username: 'configured-name' }, botName: 'agent', realmKey: () => 'realm',
    bridge: { bot: { player: { uuid: 'actual-uuid' }, username: 'player' } },
    tactics: { recordCombat: (r: CombatResult) => book.record(r, []) },
    emit: (...args: unknown[]) => events.push(args), diag: { write() {} } });
  world.extensionCombatReport(result());
  expect(events).toHaveLength(1);
  expect(events[0][0]).toBe('minecraft.combat');
  expect((events[0][3] as any).meta.receipt).toMatchObject({ id: 1, deathEpisodeId: 'native-death', swings: 0,
    scope: { realm: 'realm', account: 'offline:actual-uuid', agent: 'agent' }, controlSummary: result().controlSummary });
  world.tactics.recordCombat = () => { throw Error('disk unavailable'); };
  world.extensionCombatReport(result());
  expect(events[1][0]).toBe('minecraft.event');
  expect(book.current().reports).toHaveLength(1);
});
