import { describe, expect, it } from 'vitest';
import { protectionCheck, type BlockProtectionPort, type ProtectReply, type ProtectStatus } from '../core/protection-port.ts';
import { breakPermissionNote } from '../core/travel.ts';
import type { Bot } from 'mineflayer';

describe('permission diagnosis policy', () => {
  it('permits an ordinary attempt with missing ACL coverage while retaining known denial', () => {
    let verdict: 'protected' | 'unknown' = 'unknown';
    const bot = { cortiProtectionPreflight: () => false, cortiBreakVerdict: () => verdict } as unknown as Bot;
    const block = { name: 'stone', position: { x: 1, y: 64, z: 2 } } as NonNullable<ReturnType<Bot['blockAt']>>;
    expect(breakPermissionNote(bot, block)).toBeNull();
    verdict = 'protected';
    expect(breakPermissionNote(bot, block)).toContain('受保护');
  });
  it('does not query normal actions, diagnoses the failed cell once and honors its cached denial', async () => {
    const queries: unknown[] = [];
    let cached: ProtectStatus | null = null;
    const port: BlockProtectionPort = {
      verdict: () => cached,
      check: async (action, dimension, cell, fresh) => {
        if (cached !== 'deny') queries.push({ action, dimension, cell, fresh });
        cached = 'deny';
        return { action, dimension, ...cell, status: cached, reason: 'server denied' } as ProtectReply;
      },
    };
    let dim = 'overworld'; let proactive = false;
    const check = protectionCheck(port, () => dim, () => proactive);
    const cell = { x: 1, y: 64, z: 2 };
    expect(await check('break', cell)).toBeNull();
    expect(await check('place', cell)).toBeNull();
    expect(queries).toEqual([]);
    expect(await check('break', cell, 'after_failure')).toMatchObject({ status: 'deny' });
    expect(await check('break', cell)).toMatchObject({ status: 'deny' });
    expect(queries).toHaveLength(1);
    cached = 'unknown';
    expect(await check('break', cell)).toBeNull();
    proactive = true; dim = 'the_nether'; cached = null;
    await check('place', cell);
    expect(queries.at(-1)).toMatchObject({ action: 'place', dimension: 'the_nether', fresh: true });
  });
});
