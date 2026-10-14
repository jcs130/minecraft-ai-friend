import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BreakPermissions, BREAK_ACL_CHANNEL, NEUTRAL_BREAK_ACL_CHANNEL } from '../core/break-permissions.ts';
import { readRealmMarker } from '../core/server.ts';

it('preserves both server ACL wire names without accepting arbitrary channels', () => {
  const bytes = Buffer.from(JSON.stringify({ v: 1, complete: true, dimension: 'overworld', chunkX: 0, chunkZ: 0,
    revision: 1, denyCells: [[0, 64, 0]], denyBoxes: [] }));
  for (const channel of [BREAK_ACL_CHANNEL, NEUTRAL_BREAK_ACL_CHANNEL]) {
    const acl = new BreakPermissions(null, 'fixture');
    expect(acl.applyPacket('unknown:break_acl', bytes, 1)).toBe(false);
    expect(acl.applyPacket(channel, bytes, 1)).toBe('changed');
    expect(acl.verdict('overworld', 0, 64, 0, 1, 2)).toBe('protected');
    expect(acl.verdict('overworld', 16, 64, 0, 1, 2)).toBe('unknown');
  }
});

it('reuses the independent world marker while keeping legacy markers readable and unchanged', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mc-realm-compat-'));
  try {
    const marker = JSON.stringify({ uuid: 'preserved-world-id', levelName: 'world', createdAt: '2026-01-01T00:00:00Z' });
    const legacy = join(directory, 'cortico-realm.json'), neutral = join(directory, 'agent-mc-realm.json');
    writeFileSync(legacy, marker);
    expect(readRealmMarker(directory)?.uuid).toBe('preserved-world-id');
    rmSync(legacy); writeFileSync(neutral, marker);
    expect(readRealmMarker(directory)?.uuid).toBe('preserved-world-id');
    expect(readFileSync(neutral, 'utf8')).toBe(marker);
  } finally { rmSync(directory, { force: true, recursive: true }); }
});
