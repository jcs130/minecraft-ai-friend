import minecraftData from 'minecraft-data';
import { describe, expect, it } from 'vitest';
import { chooseRoutineFood, renderFoodReserveReadout } from '../core/nutrition.ts';

const foods = minecraftData('1.21.1').foodsByName;
const items = minecraftData('1.21.1').itemsByName;
describe('Java 1.21.1 routine food', () => {
  it.each([['beef', 'cooked_beef'], ['porkchop', 'cooked_porkchop'], ['mutton', 'cooked_mutton'],
    ['rabbit', 'cooked_rabbit'], ['cod', 'cooked_cod'], ['salmon', 'cooked_salmon'], ['chicken', 'cooked_chicken']])(
    'keeps %s for cooking when its cooked counterpart %s is already carried', (raw, cooked) => {
      expect(chooseRoutineFood(16, [{ name: raw, count: 5 }, { name: cooked, count: 1 }], foods)).toBe(cooked);
    });
  it('keeps available safe raw meat usable without a furnace or cooked food', () => {
    expect(chooseRoutineFood(16, [{ name: 'beef', count: 1 }], foods)).toBe('beef');
    expect(chooseRoutineFood(6, [{ name: 'mutton', count: 1 }], foods)).toBe('mutton');
  });
  it('never spends a non-nutritive ominous bottle or a poison/teleport item for routine hunger', () => {
    for (const name of ['ominous_bottle', 'pufferfish', 'spider_eye', 'poisonous_potato', 'chorus_fruit', 'suspicious_stew']) {
      expect(chooseRoutineFood(2, [{ name, count: 1 }], foods)).toBeNull();
    }
  });
  it('preserves the existing bounded rotten-flesh/raw-chicken emergency fallback', () => {
    expect(chooseRoutineFood(12, [{ name: 'rotten_flesh', count: 1 }], foods)).toBeNull();
    expect(chooseRoutineFood(6, [{ name: 'rotten_flesh', count: 1 }], foods)).toBe('rotten_flesh');
    expect(chooseRoutineFood(6, [{ name: 'chicken', count: 1 }, { name: 'bread', count: 1 }], foods)).toBe('bread');
  });
  it('shows real carried nutrition and cooking gains without counting eggs or bottle nutrition', () => {
    const text = renderFoodReserveReadout([{ name: 'beef', count: 2 }, { name: 'cooked_beef', count: 1 },
      { name: 'egg', count: 3 }, { name: 'ominous_bottle', count: 1 }], foods, true, n => n, items);
    expect(text).toContain('常规 3 个');
    expect(text).toContain('合计 14 点');
    expect(text).toContain('3/1.8');
    expect(text).toContain('cooked_beef');
    expect(text).toContain('8/12.8');
    expect(text).toContain('不可直接吃 egg');
    expect(text).not.toContain('egg×');
    expect(text).toContain('ominous_bottle');
    expect(text).toContain('不补饥饿');
    expect(renderFoodReserveReadout([{ name: 'beef', count: 2 }], foods, false)).toContain('未知');
  });
  it('puts confirmed absence of edible food before inventory summaries without classifying risky food as absent', () => {
    const none = renderFoodReserveReadout([{ name: 'egg', count: 1 }, { name: 'wheat', count: 2 }], foods, true, n => n, items);
    expect(none.slice(0, 160)).toContain('已同步随身物品没有可直接进食的食物');
    expect(none).toContain('食物原料不能代替口粮');
    const risky = renderFoodReserveReadout([{ name: 'chicken', count: 1 }], foods, true);
    expect(risky).not.toContain('没有可直接进食');
    expect(risky).toContain('风险30%');
    expect(renderFoodReserveReadout([{ name: 'egg', count: 1 }], foods, false)).not.toContain('没有可直接进食');
  });
  it('preserves factual egg/sugar negatives and unknown custom food in short host previews', () => {
    const text = renderFoodReserveReadout([{ name: 'egg', count: 2 }, { name: 'sugar', count: 1 },
      { name: 'custom:egg_food', count: 1 }], foods, true, () => '可食用熟鸡蛋', items);
    for (const limit of [160, 240]) {
      const preview = text.slice(0, limit);
      expect(preview).toContain('不可直接吃 egg、sugar');
      expect(preview).toContain('未知 custom:egg_food');
      expect(preview).toContain('已识别可直接进食 0 个');
    }
    expect(text).not.toContain('没有可直接进食的食物');
  });
  it('classifies every versioned nonfood rather than a named ingredient allowlist', () => {
    for (const name of Object.keys(items).filter(name => !foods[name])) {
      const text = renderFoodReserveReadout([{ name, count: 1 }], foods, true, n => n, items);
      expect(text.slice(0, 160), name).toContain(`不可直接吃 ${name}`);
      expect(text.slice(0, 160), name).not.toContain('未知');
    }
  });
  it('keeps quantity-representative negatives visible in the observed mixed backpack', () => {
    const stacks = [['stick', 22], ['sugar', 8], ['egg', 8], ['feather', 7], ['oak_planks', 4], ['oak_log', 4],
      ['chest', 3], ['sugar_cane', 2], ['birch_sapling', 1], ['dirt', 1], ['birch_planks', 1]]
      .map(([name, count]) => ({ name: String(name), count: Number(count) }));
    const preview = renderFoodReserveReadout(stacks, foods, true, () => 'translated label', items).slice(0, 160);
    expect(preview).toContain('不可直接吃 stick、egg、sugar、feather');
    expect(preview).toContain('等11种');
    expect(preview).toContain('已识别可直接进食 0 个');
    expect(preview).not.toContain('birch_sapling');
  });
  it('keeps edible, risky and special counts and unknown truth independent of negative examples', () => {
    const text = renderFoodReserveReadout([{ name: 'bread', count: 2 }, { name: 'chicken', count: 1 },
      { name: 'golden_apple', count: 1 }, { name: 'iron_pickaxe', count: 1 },
      { name: 'mod:bread', count: 1 }], foods, true, n => n, items);
    expect(text.slice(0, 160)).toContain('已识别可直接进食 4 个');
    expect(text.slice(0, 160)).toContain('不可直接吃 iron_pickaxe');
    expect(text.slice(0, 160)).toContain('未知 mod:bread');
    expect(text).toContain('常规 2 个');
    expect(text).toContain('风险30%');
    expect(text).toContain('特殊食物');
  });
  it('bounds clarification examples and does not classify unsynced or unregistered inventory', () => {
    const stacks = Object.keys(items).map(name => ({ name, count: 1 }));
    const text = renderFoodReserveReadout(stacks, foods, true, n => n, items);
    expect(text.indexOf('。') + 1).toBeLessThanOrEqual(160);
    expect(text.slice(0, 160)).toMatch(/等\d+种/);
    const crowded = renderFoodReserveReadout([...stacks,
      ...Array.from({ length: 99 }, (_, i) => ({ name: `custom:unrecognized_${i}`, count: 1 }))], foods, true, n => n, items);
    expect(crowded.indexOf('。') + 1).toBeLessThanOrEqual(160);
    expect(crowded.slice(0, 160)).toContain('未知 custom:unrecognized_0');
    expect(crowded.slice(0, 160)).toContain('等99种');
    expect(renderFoodReserveReadout([{ name: 'egg', count: 1 }], foods, false, n => n, items))
      .toBe('口粮储备：物品栏尚未同步，数量未知。');
    expect(renderFoodReserveReadout([{ name: 'egg', count: 1 }], foods, true))
      .toContain('未知 egg');
    expect(renderFoodReserveReadout([{ name: 'egg', count: 0 }, { name: 'sugar', count: NaN }], foods, true, n => n, items))
      .not.toContain('不可直接吃');
  });
});
