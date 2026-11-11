import { expect, it } from 'vitest';
import type { Bot } from 'mineflayer';
import { edibleInBag, notFoodText } from '../core/precheck.ts';

function inventory(names: Array<[string, number]>, off?: [string, number]): Bot {
  return {
    registry: { itemsByName: { cooked_beef: {}, golden_apple: {}, wheat: {} },
      foodsByName: { cooked_beef: {}, golden_apple: {} } },
    inventory: { items: () => names.map(([name, count]) => ({ name, count })),
      slots: { 45: off ? { name: off[0], count: off[1] } : null } },
  } as unknown as Bot;
}

it('returns executable food IDs alongside the localized labels used in observations', () => {
  const bot = inventory([['cooked_beef', 19], ['golden_apple', 20]], ['cooked_beef', 2]);
  expect(edibleInBag(bot)).toContain('牛排(cooked_beef)×19');
  expect(edibleInBag(bot)).toContain('副手能吃的有:牛排(cooked_beef)×2');
  const receipt = notFoodText(bot, '牛排');
  expect(receipt).not.toContain('没有 牛排 这样的物品');
  expect(receipt).toContain('完整物品 ID');
  expect(receipt).toContain('cooked_beef');
});

it('does not infer food or substitute similar ingredients from localized text', () => {
  const bot = inventory([['wheat', 4], ['cooked_beef', 0]]);
  expect(edibleInBag(bot)).toBeNull();
  expect(notFoodText(bot, '牛排')).toContain('没有 牛排 这样的物品');
  expect(notFoodText(bot, 'wheat')).toContain('不是可进食物品');
  expect(notFoodText(bot, 'wheat')).not.toContain('wheat_seeds');
});
