import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { defaultPolicy, parsePolicy, PolicyBook, POLICY_SCHEMA, renderPolicy, FALLBACK_DEFAULTS } from '../core/policy.ts';

it('exposes independent automatic engagement, retaliation and jump choices without losing existing settings', () => {
  const parsed = parsePolicy({ fight: 'off', retaliate: 'off', jump: 'native' });
  expect(parsed.notes).toEqual([]);
  expect(parsed.patch).toEqual({ fight: 'off', retaliate: 'off', jump: 'native' });
  const state = { ...defaultPolicy(), ...parsed.patch };
  expect(renderPolicy(state, FALLBACK_DEFAULTS)).toContain('受击自动还手关闭');
  expect(renderPolicy(state, FALLBACK_DEFAULTS)).toContain('原生跑酷候选');
  expect(POLICY_SCHEMA).toHaveProperty('properties.jump.enum', ['off', 'gap', 'native']);
  expect(parsePolicy({ jump: 'fly', retaliate: true }).notes).toHaveLength(2);
});

it('persists jump and retaliation across restart while disclosing the existing fight reset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-policy-'));
  try {
    const file = join(dir, 'policy.json'), book = new PolicyBook(file);
    book.set({ jump: 'off', retaliate: 'off', fight: 'off' });
    expect(book.get().fight).toBe('off');
    const restored = new PolicyBook(file);
    expect(restored.get()).toMatchObject({ jump: 'off', retaliate: 'off', fight: 'armed' });
    expect(restored.takeFightRollback()).toBe('off');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
