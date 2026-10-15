import { afterEach, expect, it, vi } from 'vitest';
import { readSkillHelp } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.restoreAllMocks());

it('returns native recipe rejection and exact cooking help without altering queued work', async () => {
  const r = methodHarness();
  try {
    Object.assign(r.bot, { recipesAll: vi.fn(() => []), craft: vi.fn() });
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
    const before = r.exec.status();
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
      queue: 'now', steps: [{ skill: 'craft', item: 'cooked_chicken', count: 1 }],
    }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true, meta: { admission: {
      accepted: false, rule: 'craft.invalid', kind: 'correction',
      recovery: [{ tool: 'mc_help', arguments: { skill: 'smelt' }, text: (readSkillHelp({ skill: 'smelt' }) as { text: string }).text }],
    } } });
    expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    expect((r.bot as any).craft).not.toHaveBeenCalled();
  } finally { r.close(); }
});

it('keeps ordinary admission unchanged and does not attach rejection evidence to accepted work', async () => {
  const r = methodHarness();
  try {
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
      steps: [{ skill: 'goto', at: [8, 64, 0] }], queue: 'append',
    }, { role: 'test', log: r.host.log });
    expect(result).not.toHaveProperty('failed');
    expect(result).not.toHaveProperty('meta.admission');
  } finally { r.close(); }
});
