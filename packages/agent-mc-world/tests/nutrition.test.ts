import minecraftData from 'minecraft-data';
import { describe, expect, it } from 'vitest';
import { chooseRoutineFood, renderFoodReserveReadout } from '../core/nutrition.ts';

const foods = minecraftData('1.21.1').foodsByName;
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
      { name: 'egg', count: 3 }, { name: 'ominous_bottle', count: 1 }], foods, true, n => n);
    expect(text).toContain('常规 3 个');
    expect(text).toContain('合计 14 点');
    expect(text).toContain('3/1.8');
    expect(text).toContain('cooked_beef');
    expect(text).toContain('8/12.8');
    expect(text).not.toContain('egg');
    expect(text).toContain('ominous_bottle');
    expect(text).toContain('不补饥饿');
    expect(renderFoodReserveReadout([{ name: 'beef', count: 2 }], foods, false)).toContain('未知');
  });
  it('puts confirmed absence of edible food before inventory summaries without classifying risky food as absent', () => {
    const none = renderFoodReserveReadout([{ name: 'egg', count: 1 }, { name: 'wheat', count: 2 }], foods, true);
    expect(none.startsWith('已同步随身物品没有可直接进食的食物')).toBe(true);
    expect(none).toContain('食物原料不能代替口粮');
    const risky = renderFoodReserveReadout([{ name: 'chicken', count: 1 }], foods, true);
    expect(risky).not.toContain('没有可直接进食');
    expect(risky).toContain('风险30%');
    expect(renderFoodReserveReadout([{ name: 'egg', count: 1 }], foods, false)).not.toContain('没有可直接进食');
  });
});
