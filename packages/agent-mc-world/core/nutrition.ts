/** Routine food selection. Explicit player/agent eat requests remain unrestricted. */
import { FOOD_COOKING, FOOD_CAUTIONS, FOOD_EFFECTS, VANILLA_KNOWLEDGE_VERSION, MOJANG_1211_SOURCE,
  type FoodEffect } from './vanilla-food.ts';
export const RISKY_FOODS = new Set([
  'pufferfish', 'spider_eye', 'poisonous_potato', 'rotten_flesh', 'chicken',
  'chorus_fruit', 'suspicious_stew', 'ominous_bottle',
]);

export interface FoodStack { name: string; count: number }
export interface FoodValue { foodPoints?: number; saturation?: number }
/** Vanilla's namespace is optional in Mineflayer registry keys; other namespaces remain distinct. */
export const nativeFoodId = (id: string): string => id.startsWith('minecraft:') ? id.slice(10) : id;
const SPECIAL_FOODS = new Set(['golden_apple', 'enchanted_golden_apple']);

/** A measured need, not a meal command or permission to change the current goal. */
export interface NutritionNeed {
  schema: 'agent-mc-nutrition-need/v1'; id: string; scope: string; generation: string; atMs: number;
  food: number; urgency: 'reserve' | 'low' | 'critical' | 'starving';
  routineUnits: number; riskyUnits: number; specialUnits: number; unclassifiedUnits:number;
  registryReferenceOnly:true;pendingMeal: boolean; goalCompleted: false;
}
export class NutritionNeedObserver {
  private owner = '';
  private announced = new Set<string>();
  private serial = 0;
  private lastFood: number | null = null;
  observe(input: {scope:string;generation:string;atMs:number;food:number|null;synced:boolean;
    stacks:readonly FoodStack[];foods:Record<string,FoodValue|undefined>;knownItems?:Readonly<Record<string,unknown>>;travelling:boolean;pendingMeal:boolean}): NutritionNeed | null {
    const owner=JSON.stringify([input.scope,input.generation]);
    if(owner!==this.owner){this.owner=owner;this.announced.clear();this.lastFood=null;}
    if(!input.synced||input.food===null||!Number.isFinite(input.food)||input.food<0||input.food>20
      ||!Number.isFinite(input.atMs)||!Object.keys(input.foods).length)return null;
    let routineUnits=0,riskyUnits=0,specialUnits=0,unclassifiedUnits=0;
    if(this.lastFood!==null&&this.lastFood<=6&&input.food>6){this.announced.delete('critical');this.announced.delete('starving');}
    this.lastFood=input.food;
    for(const stack of input.stacks){
      if(!Number.isSafeInteger(stack.count)||stack.count<=0)continue;
      if(!((input.foods[stack.name]?.foodPoints??0)>0)){
        if(!Object.hasOwn(input.knownItems??{},stack.name))unclassifiedUnits+=stack.count;
        continue;
      }
      if(RISKY_FOODS.has(stack.name))riskyUnits+=stack.count;
      else if(SPECIAL_FOODS.has(stack.name))specialUnits+=stack.count;
      else routineUnits+=stack.count;
    }
    if(routineUnits>0&&input.food>16){this.announced.clear();return null;}
    // A known pending meal is not a successful recovery; its receipt provides the next evidence.
    if(input.pendingMeal)return null;
    const urgency=input.food===0?'starving':input.food<=6?'critical':routineUnits===0&&input.food<=16?'low'
      :routineUnits===0&&input.travelling?'reserve':null;
    if(!urgency||this.announced.has(urgency))return null;
    this.announced.add(urgency);
    return{schema:'agent-mc-nutrition-need/v1',id:`nutrition:${input.generation}:${++this.serial}`,scope:input.scope,
      generation:input.generation,atMs:input.atMs,food:input.food,urgency,routineUnits,riskyUnits,specialUnits,
      unclassifiedUnits,registryReferenceOnly:true,pendingMeal:false,goalCompleted:false};
  }
}
export function nutritionNeedText(need:NutritionNeed):string {
  return `[补给观察 ${need.id}] 饥饿 ${need.food}/20；按已同步物品和当前注册表识别，随身常规口粮 ${need.routineUnits} 个，`
    +`有风险食物 ${need.riskyUnits} 个，特殊补给 ${need.specialUnits} 个，未分类 ${need.unclassifiedUnits} 个（不代表不可吃）。`
    +'原料和未知物品不算现成口粮；没有自动代选危险或特殊食物。请结合当前任务、食物帮助与现场选择进食或补给。'
    +'原任务仍保留；需要插入短行动时用 afterCheckpoint，不要为了查看状态撤销赶路，也不要把受理当成吃到了。';
}

/** Reference semantics, never a claim about a stack's server-overridden components or current effects. */
export interface FoodRiskReference {
  item: string;
  caution: string;
  effects: FoodEffect[];
  source: { kind: 'vanilla-reference'; version: string; url: string };
  knowledgeId: string;
  serverComponentsVerified: false;
}

export function foodRiskReference(item: string): FoodRiskReference | null {
  if (!RISKY_FOODS.has(item) || !FOOD_CAUTIONS[item]) return null;
  return { item, caution: FOOD_CAUTIONS[item], effects: (FOOD_EFFECTS[item] ?? []).map(effect => ({ ...effect })),
    source: { kind: 'vanilla-reference', version: VANILLA_KNOWLEDGE_VERSION, url: MOJANG_1211_SOURCE },
    knowledgeId: 'food/' + item, serverComponentsVerified: false };
}

/** Counts are from synchronized carried inventory. knownItems is the same versioned registry
 * as foods; absence from foods alone is not evidence that a custom/unknown item is inedible. */
export function renderFoodReserveReadout(
  stacks: readonly FoodStack[],
  foods: Record<string, FoodValue | undefined>,
  synced: boolean,
  nameOf: (name: string) => string = (name) => name,
  knownItems: Readonly<Record<string, unknown>> = {},
): string {
  if (!synced) return '口粮储备：物品栏尚未同步，数量未知。';
  if (Object.keys(foods).length === 0) return '口粮储备：食物注册表尚不可用，未分类。';
  const totals = new Map<string, number>();
  const nonfoods = new Set<string>(), unknown = new Set<string>();
  const carriedCounts = new Map<string, number>();
  for (const stack of stacks) {
    if (!Number.isSafeInteger(stack.count) || stack.count <= 0) continue;
    carriedCounts.set(stack.name, (carriedCounts.get(stack.name) ?? 0) + stack.count);
    if (Object.hasOwn(foods, stack.name) && (foods[stack.name]?.foodPoints ?? 0) > 0) {
      totals.set(stack.name, (totals.get(stack.name) ?? 0) + stack.count);
    } else if (Object.hasOwn(knownItems, stack.name)) nonfoods.add(stack.name);
    else unknown.add(stack.name);
  }
  // Whole native IDs stay usable as query handles. Bound each category independently
  // so neither a full backpack nor long translations hide uncertainty in host previews.
  const examples = (names: Set<string>): string => {
    const selected: string[] = [];
    for (const name of [...names].sort((a, b) => carriedCounts.get(b)! - carriedCounts.get(a)! || a.localeCompare(b))) {
      if (selected.length >= 4 || [...selected, name].join('、').length > 44) break;
      selected.push(name);
    }
    return selected.join('、') + (selected.length < names.size ? `（等${names.size}种）` : '');
  };
  const edibleCount = [...totals].reduce((sum, [name, amount]) => sum + (name === 'ominous_bottle' ? 0 : amount), 0);
  const clarification = `随身可食性（版本注册表）：已识别可直接进食 ${edibleCount} 个`
    + (nonfoods.size ? `；不可直接吃 ${examples(nonfoods)}` : '')
    + (unknown.size ? `；未知 ${examples(unknown)}` : '') + '。';
  const normal: string[] = [], risky: string[] = [], special: string[] = [];
  let points = 0, count = 0;
  for (const [name, amount] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    const food = foods[name]!;
    const value = (n: number | undefined) => n === undefined ? '未知' : String(Number(n.toFixed(2)));
    const cooked = FOOD_COOKING[name];
    const label = `${nameOf(name)}×${amount}` + (name === 'ominous_bottle' ? '（不补饥饿）'
      : `（${value(food.foodPoints)}/${value(food.saturation)}`
        + (name === 'rotten_flesh' ? '；原版饥饿风险80%' : name === 'chicken' ? '；原版饥饿风险30%' : '')
        + (foodRiskReference(name) ? `；1.21.1原版参考：${FOOD_CAUTIONS[name]}` : '')
        + (cooked && foods[cooked] ? `；烹饪成${nameOf(cooked)} ${value(foods[cooked]!.foodPoints)}/${value(foods[cooked]!.saturation)}` : '') + '）');
    if (RISKY_FOODS.has(name)) risky.push(label);
    else if (SPECIAL_FOODS.has(name)) special.push(label);
    else { normal.push(label); count += amount; points += (foods[name]!.foodPoints ?? 0) * amount; }
  }
  return clarification
    + (totals.size === 0 && unknown.size === 0 ? '已同步随身物品没有可直接进食的食物；食物原料不能代替口粮。' : '')
    + `随身口粮储备：常规 ${count} 个（${normal.join('、') || '无'}；基础补饥饿值合计 ${points} 点，不含浪费与后续消耗）。`
    + (risky.length ? `有风险或特殊副作用：${risky.join('、')}。` : '')
    + (special.length ? `特殊食物：${special.join('、')}。` : '')
    + '括号为原版基础饥饿/饱和点，非当前饱和或直接回血；风险参考不证明服务器或物品组件没有覆盖。优先已有安全熟食，危急时可先用安全生食。'
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
  const available = new Set(stacks.filter(stack => stack.count > 0 && foods[stack.name]?.foodPoints).map(stack => stack.name));
  const choices = stacks.filter((stack) => stack.count > 0 && foods[stack.name]?.foodPoints
    && !RISKY_FOODS.has(stack.name)
    && !SPECIAL_FOODS.has(stack.name)
    // Do not waste raw ingredients to save a few overflow points while their cooked food is available.
    && !(FOOD_COOKING[stack.name] && available.has(FOOD_COOKING[stack.name])));
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
