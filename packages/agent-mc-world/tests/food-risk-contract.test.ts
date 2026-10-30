import { describe, expect, it } from 'vitest';
import minecraftData from 'minecraft-data';
import { foodRiskReference, chooseRoutineFood } from '../core/nutrition.ts';
import { precheckStep, type PrecheckDeps } from '../core/precheck.ts';
import { familiarStepAction } from '../src/client/familiar-action.ts';
import { methodHarness } from './method-harness.ts';

describe('food risk reaches explicit action and current decision contracts', () => {
  const registry = minecraftData('1.21.1');
  const deps = { learned: { list: [] }, blueprints: { list: [] } } as unknown as PrecheckDeps;
  const bot = (items: string[]) => ({ registry, food: 15, inventory: { items: () => items.map(name => ({ name, count: 1 })), slots: [] } }) as never;

  it('warns about the observed poison meal even when there is no safe alternative, without changing the requested action', () => {
    const call = { skill: 'eat' as const, item: 'pufferfish' };
    const note = precheckStep(bot(['pufferfish', 'rotten_flesh', 'spider_eye']), call, deps);
    expect(note).toMatchObject({ level: 'soft', rule: 'eat.risky' });
    expect(note?.text).toContain('中毒 II 60 秒');
    expect(note?.text).toContain('饥饿 III 15 秒');
    expect(note?.text).toContain('反胃 I 15 秒');
    expect(note?.text).toContain('未见常规安全替代');
    expect(note?.text).toContain('服务器/物品组件可能覆盖');
    expect(call).toEqual({ skill: 'eat', item: 'pufferfish' });
  });
  it('offers an actually carried safe alternative and keeps safe raw fish usable', () => {
    expect(precheckStep(bot(['pufferfish', 'cod']), { skill: 'eat', item: 'pufferfish' }, deps))
      .toMatchObject({ level: 'soft', rule: 'eat.riskyWithSafe', text: expect.stringContaining('生鳕鱼') });
    expect(precheckStep(bot(['cod']), { skill: 'eat', item: 'cod' }, deps)).toBeNull();
    expect(chooseRoutineFood(15, [{ name: 'pufferfish', count: 1 }, { name: 'cod', count: 1 }], registry.foodsByName)).toBe('cod');
  });
  it('keeps risk reference distinct from current server effects and unknown custom items', () => {
    const risk = foodRiskReference('pufferfish')!;
    expect(risk).toMatchObject({ source: { kind: 'vanilla-reference', version: '1.21.1' },
      serverComponentsVerified: false, knowledgeId: 'food/pufferfish',
      effects: expect.arrayContaining([{ effect: 'poison', amplifier: 1, durationTicks: 1200, chance: 1 }]) });
    risk.effects[0].durationTicks = 0;
    expect(foodRiskReference('pufferfish')?.effects[0].durationTicks).toBe(1200);
    expect(foodRiskReference('custom:pufferfish')).toBeNull();
    expect(foodRiskReference('cod')).toBeNull();
  });
  it.each(['pufferfish', 'suspicious_stew', 'ominous_bottle'])('does not fast-track risky %s as a familiar safe meal', item => {
    expect(familiarStepAction({ steps: [{ skill: 'eat', item }] })).toBeNull();
  });
  it('makes specific risk visible in live SDK facts, backpack reads and low-health recovery facts', () => {
    const r = methodHarness('1.21.1');
    try {
      Object.assign((r.world as any).bridge, { connected: true, invSynced: true });
      r.bot.food = 15;
      Object.assign(r.bot.inventory, { items: () => [{ name: 'pufferfish', count: 1 }, { name: 'spider_eye', count: 1 }] });
      const fact = r.world.requestFacts()!.parts!.find(part => part.key === 'foodReserve')!.text;
      expect(fact).toContain('中毒 II 60 秒'); expect(fact).toContain('常规 0 个');
      expect((r.world as any).bagReadout().text).toContain('中毒 II 60 秒');
      expect((r.world as any).bagReadout('pufferfish').text).toContain('中毒 II 60 秒');
      expect((r.world as any).recoveryFoodFact(r.bot)).toContain('中毒 II 60 秒');
      Object.assign((r.world as any).bridge, { invSynced: false });
      expect((r.world as any).recoveryFoodFact(r.bot)).not.toContain('河豚');
    } finally { r.close(); }
  });
});
