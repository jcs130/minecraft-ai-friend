import { describe, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { precheckSteps, renderPrecheckNotes, type PrecheckDeps } from '../core/precheck.ts';
import type { SkillCall } from '../core/skills.ts';

const deps: PrecheckDeps = { resolve: () => null, cellsOf: () => null, blockAt: () => null };
function rig(names: string[], held: string | null = names[0] ?? null) {
  const items = names.map((name, i) => ({ name, type: i + 1, count: name === 'arrow' ? 37 : 1 }));
  const bot = { inventory: { items: () => items, slots: [] },
    heldItem: items.find(i => i.name === held) ?? null,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { 2: { id: 2, name: 'zombie', position: new Vec3(1, 64, 0) } },
    equip: vi.fn(), attack: vi.fn(), activateItem: vi.fn() };
  return bot;
}

describe('explicit melee admission exposes current equipment', () => {
  it('reports bow-only melee without rejecting or changing the chosen action', () => {
    const bot = rig(['bow', 'arrow', 'shield']);
    const steps: SkillCall[] = [{ skill: 'equip', item: 'bow' }, { skill: 'attack', target: 'zombie', mode: 'melee' }];
    const original = structuredClone(steps);
    const notes = precheckSteps(bot as never, steps, deps);
    expect(notes).toContainEqual({ index: 1, note: expect.objectContaining({ level: 'soft', rule: 'attack.meleeLoadout' }) });
    const receipt = renderPrecheckNotes(notes)!;
    expect(receipt).toContain('主手为 bow');
    expect(receipt).toContain('不会射箭');
    expect(receipt).toContain('和普通箭');
    expect(steps).toEqual(original);
    expect(bot.equip).not.toHaveBeenCalled();
    expect(bot.attack).not.toHaveBeenCalled();
    expect(bot.activateItem).not.toHaveBeenCalled();
  });
  it('keeps deliberate unarmed combat a soft fact, including missing arrows', () => {
    for (const names of [[], ['bow']]) {
      const notes = precheckSteps(rig(names) as never, [{ skill: 'attack', target: 'zombie', mode: 'melee' }], deps);
      expect(notes[0]?.note).toMatchObject({ level: 'soft', rule: 'attack.meleeLoadout' });
      expect(notes[0]?.note.text).not.toContain('和普通箭');
    }
  });
  it('does not warn when the executor can select a melee weapon, or override auto', () => {
    expect(precheckSteps(rig(['bow', 'arrow', 'iron_sword']) as never,
      [{ skill: 'attack', target: 'zombie', mode: 'melee' }], deps)).toEqual([]);
    expect(precheckSteps(rig(['bow', 'arrow']) as never,
      [{ skill: 'attack', target: 'zombie', mode: 'auto' }], deps)).toEqual([]);
  });
  it('does not hide the missing target fact', () => {
    const bot = rig(['bow', 'arrow']); bot.entities = {} as typeof bot.entities;
    expect(precheckSteps(bot as never, [{ skill: 'attack', target: 'zombie', mode: 'melee' }], deps)[0]?.note.rule).toBe('attack.noTarget');
  });
  it('reports unusable auto equipment without rejecting a batch that may acquire a weapon first', () => {
    const bot = rig(['bow', 'bread'], 'bread');
    const steps: SkillCall[] = [{ skill: 'attack', target: 'zombie' }];
    expect(precheckSteps(bot as never, steps, deps)[0]?.note).toMatchObject({ level: 'soft', rule: 'attack.autoLoadout' });
    expect(renderPrecheckNotes(precheckSteps(bot as never, steps, deps))).toContain('不会降级为空手');
    expect(steps).toEqual([{ skill: 'attack', target: 'zombie' }]);
  });
});
