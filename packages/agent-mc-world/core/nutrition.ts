/** Routine food selection. Explicit player/agent eat requests remain unrestricted. */
export const RISKY_FOODS = new Set([
  'pufferfish', 'spider_eye', 'poisonous_potato', 'rotten_flesh', 'chicken',
  'chorus_fruit', 'suspicious_stew',
]);

export interface FoodStack { name: string; count: number }
export interface FoodValue { foodPoints?: number; saturation?: number }
const SPECIAL_FOODS = new Set(['golden_apple', 'enchanted_golden_apple']);

/** Counts are from the synchronized carried inventory; hunger and stored food are separate facts. */
export function renderFoodReserveReadout(
  stacks: readonly FoodStack[],
  foods: Record<string, FoodValue | undefined>,
  synced: boolean,
  nameOf: (name: string) => string = (name) => name,
): string {
  if (!synced) return '口粮储备：物品栏尚未同步，数量未知。';
  if (Object.keys(foods).length === 0) return '口粮储备：食物注册表尚不可用，未分类。';
  const totals = new Map<string, number>();
  for (const stack of stacks) {
    if (Number.isSafeInteger(stack.count) && stack.count > 0 && (foods[stack.name]?.foodPoints ?? 0) > 0) {
      totals.set(stack.name, (totals.get(stack.name) ?? 0) + stack.count);
    }
  }
  const normal: string[] = [], risky: string[] = [], special: string[] = [];
  let points = 0, count = 0;
  for (const [name, amount] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    const label = `${nameOf(name)}×${amount}`;
    if (RISKY_FOODS.has(name)) risky.push(label);
    else if (SPECIAL_FOODS.has(name)) special.push(label);
    else { normal.push(label); count += amount; points += (foods[name]!.foodPoints ?? 0) * amount; }
  }
  return `随身口粮储备：常规 ${count} 个（${normal.join('、') || '无'}；基础补饥饿值合计 ${points} 点，不含浪费与后续消耗）。`
    + (risky.length ? `有风险或特殊副作用：${risky.join('、')}。` : '')
    + (special.length ? `特殊食物：${special.join('、')}。` : '')
    + '仅计已同步的随身物品，未计仓库或食物原料；当前不饿不表示已有储备。';
}

/** Keep hunger above the natural regeneration threshold without spending combat supplies. */
export function chooseRoutineFood(
  hunger: number,
  stacks: readonly FoodStack[],
  foods: Record<string, FoodValue | undefined>,
): string | null {
  if (!Number.isFinite(hunger) || hunger > 16 || hunger < 0) return null;
  const missing = 20 - hunger;
  const choices = stacks.filter((stack) => stack.count > 0 && foods[stack.name]?.foodPoints
    && !RISKY_FOODS.has(stack.name)
    && !SPECIAL_FOODS.has(stack.name));
  choices.sort((a, b) => {
    const value = (stack: FoodStack): number => {
      const info = foods[stack.name]!;
      const points = info.foodPoints ?? 0;
      return Math.min(points, missing) + Math.min(info.saturation ?? 0, missing * 1.2) * 0.25
        - Math.max(0, points - missing) * 1.5;
    };
    return value(b) - value(a) || a.name.localeCompare(b.name);
  });
  if (choices.length > 0) return choices[0].name;
  // Starving with no safe food: rotten flesh/raw chicken can keep the bot moving.
  // The ordinary eat receipt reports any resulting status effect for later learning.
  if (hunger <= 6) {
    const emergency = stacks.find((stack) => stack.count > 0
      && (stack.name === 'rotten_flesh' || stack.name === 'chicken'));
    if (emergency) return emergency.name;
  }
  return null;
}
