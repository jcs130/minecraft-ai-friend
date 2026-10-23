import { afterEach, expect, it, vi } from 'vitest';
import { readSkillHelp } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.restoreAllMocks());

it('rejects invalid offset bounds before replacing, navigating or dispatching any earlier step', async () => {
  const r = methodHarness();
  try {
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
    const before = r.exec.status(), submit = vi.spyOn(r.exec, 'submit');
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ queue: 'replace', steps: [
      { skill: 'goto', at: [10, 64, 10] },
      { skill: 'observe', mode: 'voxels', bounds: [-17, -6, -8, 4, 3, 4], needs: [1] },
    ] }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true, meta: { admission: {
      accepted: false, dispatched: false, kind: 'correction', rule: 'arguments.steps',
    } } });
    expect(result).not.toHaveProperty('execution');
    expect((result as { text: string }).text).toContain('16');
    expect(submit).not.toHaveBeenCalled();
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    expect(r.exec.status().waiting.map(t => t.id)).toEqual(before.waiting.map(t => t.id));
  } finally { r.close(); }
});

it('returns machine admission correction for invalid queue selection before any executor call', async () => {
  const r = methodHarness();
  try {
    const submit = vi.spyOn(r.exec, 'submit');
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
      queue: 'invented', steps: [{ skill: 'goto', at: [10, 64, 10] }],
    }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true, meta: { admission: { accepted: false,
      dispatched: false, kind: 'correction', rule: 'arguments.queue' } } });
    expect(submit).not.toHaveBeenCalled();
  } finally { r.close(); }
});

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

it.each([
  { steps: [{ skill: 'toss', item: 'dirt', count: 18 }, { skill: 'toss', item: 'wheat_seeds', count: 7 }] },
  { steps: [{ skill: 'toss', item: 'dirt', count: 18 }, { skill: 'pickup', item: 'iron_pickaxe' }] },
])('admits caller-selected discards without requiring a storage trip', async ({ steps }) => {
  const r = methodHarness();
  try {
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ steps }, { role: 'test', log: r.host.log });
    expect(result).not.toHaveProperty('failed');
    expect(result).not.toHaveProperty('meta.admission');
    expect(result).toHaveProperty('execution');
  } finally { r.close(); }
});
