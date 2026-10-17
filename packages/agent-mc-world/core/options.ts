import type { ToolDef } from './support/host-contract.ts';
import type { WorldSnapshot } from './terrain.ts';
import { RISKY_FOODS, type FoodValue } from './nutrition.ts';
import { MINECRAFT_OPTION_INTENTS, type MinecraftOption, type MinecraftOptionIntent,
  type MinecraftOptionsSnapshot } from '../src/contracts/options.ts';

export const OPTIONS_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'mc_options', tags: ['read'],
  description: 'Discover a bounded shortlist by intended outcome: food, travel, water, inventory, explore or method. '
    + 'Empty arguments show an index and current clues. Returns purposes, observed evidence, missing prerequisites and focused read-tool arguments. '
    + 'Includes explicitly installed server observations where available. No model, scan, body task, cast or automatic choice; discovery does not certify readiness or success.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    intent: { type: 'string', enum: ['index', ...MINECRAFT_OPTION_INTENTS] },
  } },
};
const guide = (args: Record<string, unknown>) => ({ tool: 'mc_help', args });
const method = (query: string) => ({ tool: 'mc_script', args: { library: { op: 'list', query, limit: 4 } } });
const source = { kind: 'core' as const, reference: 'agent-mc-world:action-registry/knowledge/method-library' };
const title: Record<MinecraftOptionIntent, string> = {
  food: '补给与随身口粮', travel: '赶路与交通', water: '水路与潜水', inventory: '背包与取舍',
  explore: '现场线索与交互', method: '已保存方法与经验',
};
const boatItem = (id: string) => /(?:^|_)(?:boat|chest_boat|raft|chest_raft)$/.test(id);

/** Uses the same cheap snapshot and versioned food registry as current facts. Never reads blocks or files. */
export function minecraftOptionsFromSnapshot(snapshot: WorldSnapshot, foods: Record<string, FoodValue | undefined>,
  state: { freeSlots: number | null; task: string | null; travelling: boolean; restriction: string | null }): MinecraftOptionsSnapshot {
  const inventory = snapshot.invSynced ? [...snapshot.inventory,
    ...snapshot.equipment.filter(s => s.slot === 'offhand' && s.count !== undefined)
      .map(s => ({ name: s.name, count: s.count! }))] : null;
  const edible = inventory && Object.keys(foods).length ? inventory.filter(s => !RISKY_FOODS.has(s.name)
    && (foods[s.name]?.foodPoints ?? 0) > 0) : null;
  const foodNames = edible?.slice(0, 4).map(s => `${s.name}×${s.count}`).join('、');
  const boats = inventory?.filter(s => boatItem(s.name)) ?? null;
  const vehicles = snapshot.entities.filter(e => e.visible && /boat|raft|horse|donkey|mule|pig$|strider/.test(e.name))
    .slice(0, 4).map(e => `${e.name} ${e.distance}格`);
  const context = { sampledAt: snapshot.realTime, backend: 'mineflayer' as const, food: snapshot.food,
    oxygen: snapshot.inWater ? snapshot.oxygen : null, inWater: snapshot.inWater,
    carriedFood: edible?.reduce((n, s) => n + s.count, 0) ?? null,
    carriedBoats: boats?.reduce((n, s) => n + s.count, 0) ?? null,
    freeSlots: snapshot.invSynced ? state.freeSlots : null, travelling: state.travelling,
    bodyTask: state.task, bodyRestriction: state.restriction };
  const options: MinecraftOption[] = [
    { id: 'core.carried-food', intents: ['food'], title: '吃已有食物', purpose: '恢复当前饥饿；随身储备和当前饱食分开判断。',
      support: 'supported', evidence: [edible ? `已同步随身常规食物 ${context.carriedFood} 个${foodNames ? `：${foodNames}` : ''}` : '随身食物未同步或未分类；自定义物品可食性未知'],
      checks: ['核对饥饿、食物效果及当前身体任务；未知可食性先读物品说明'],
      read: [guide({ skill: 'eat' }), { tool: 'mc_bag', args: {} }], source },
    { id: 'core.food-production', intents: ['food'], title: '制作、烹饪或取得口粮',
      purpose: '取得能随身携带的食物，比较已见来源、实际配方、成本和副作用。', support: 'supported',
      evidence: [`随身常规食物 ${context.carriedFood ?? '未知'}；未搜索仓库或推断周围食物不存在`],
      checks: ['当前食谱、原料、工作台/炉子、燃料与空位；补给够用后继续原目标'],
      read: [{ tool: 'mc_knowledge', args: { query: 'cooking', limit: 3 } }, guide({ skills: ['craft', 'smelt', 'take'] }), method('food')], source },
    { id: 'core.walk-route', intents: ['travel'], title: '步行、现有道路或绕行', purpose: '沿已测通路分段到达，比较距离、危险和挖放成本。',
      support: 'supported', evidence: [state.task ? `当前身体任务：${state.task.slice(0, 140)}` : '当前无身体任务'],
      checks: ['实际通路和落脚点；有效任务继续，不因查看候选重复接管'], read: [guide({ skill: 'goto' })], source },
    { id: 'core.boat', intents: ['water', 'travel'], title: '乘已有船或造船', purpose: '较长河流、湖面和沿岸交通；短涉水也可走桥或绕陆。',
      support: 'supported', evidence: [`随身船 ${context.carriedBoats ?? '未知'}`, `当前可见载具：${vehicles.join('、') || '本次近处列表未报告；非全域搜索'}`],
      checks: ['先确认已有船；没有再读当前船配方、材料及工作台', '核对放船水面、通航净空和上岸点；放船、上船、航行、上岸分别验收'],
      read: [guide({ skills: ['craft', 'use', 'ride'] }), { tool: 'mc_knowledge', args: { kind: 'recipe', query: 'boat', limit: 3 } }, method('boat')], source },
    { id: 'core.horse-travel', intents: ['travel'], title: '骑马赶路（驾驶尚不支持）', purpose: '区分观察、上马/驯服与实际驾驶能力。',
      support: 'unsupported', evidence: ['当前 ride 实现可上马和下马；不支持马/驴/骡驾驶'],
      checks: ['不能把坐上去当成能骑行；驯服、鞍、归属和可通行路线还需现场核验'], read: [guide({ skill: 'ride' })], source },
    { id: 'core.swim', intents: ['water'], title: '游泳或有意潜水', purpose: '按实际氧气、生命和回程预算选择短步游动、下潜或换气。',
      support: 'supported', evidence: [`头部浸水=${snapshot.inWater}；水下氧气=${context.oxygen ?? '不适用'}`],
      checks: ['水流、净空、呼吸点、当前控制权及实测回程时间；不因碰水自动选上浮'],
      read: [guide({ skills: ['control', 'surface'] }), { tool: 'mc_script', args: { api: 'diving' } }, method('diving')], source },
    { id: 'core.inventory', intents: ['inventory'], title: '使用、整理、转存或丢弃', purpose: '按物品实际用途和补给需求取舍，核对净空位变化。',
      support: 'supported', evidence: [`随身空位=${context.freeSlots ?? '未知'}；这不是远处箱子或扩展背包容量`],
      checks: ['保留当前目标需要的物品；自定义物品先读说明；抛出后可能自动捡回'],
      read: [{ tool: 'mc_bag', args: {} }, guide({ skills: ['take', 'stow', 'toss'] })], source },
    { id: 'core.explore', intents: ['explore'], title: '读现场线索再选择交互', purpose: '查看牌文、容器、实体或局部几何，沿新证据推进探索。',
      support: 'supported', evidence: ['本索引没有额外扫描；没报告的地点与文字保持未知'],
      checks: ['文字保留外部来源；看、开编辑器和真正读到文字不同；操作拒绝不等于路线封死'],
      read: [guide({ skills: ['observe', 'look', 'use'] })], source },
    { id: 'core.methods', intents: [...MINECRAFT_OPTION_INTENTS], title: '检索已有方法和反例', purpose: '按当前困难查少量方法/经验，再选择匹配版本；必要时编写并验证修订。',
      support: 'supported', evidence: ['尚未为此次选择检索方法库；本索引不把维护者资料当作学会'],
      checks: ['适用条件、父版本、实际终态和世界净变化；语法校验或保存不是效果证明'],
      read: [{ tool: 'mc_script', args: { api: 'methods' } }, method(''), { tool: 'mc_memory', args: { action: 'experience', operation: 'help' } }], source },
  ];
  return { schema: 'minecraft-options/v1', context, options };
}

export function extendMinecraftOptions(snapshot: MinecraftOptionsSnapshot, extra: readonly MinecraftOption[]): MinecraftOptionsSnapshot {
  // An optional pack can append evidence, never replace a generic implementation contract.
  const ids = new Set(snapshot.options.map(o => o.id));
  const additions: MinecraftOption[] = [];
  // Reserve space per intent: a large combat/exploration catalogue must not hide all food options.
  for (const intent of MINECRAFT_OPTION_INTENTS) {
    for (const option of extra.filter(o => o.intents.includes(intent)).slice(0, 4)) {
      if (!ids.has(option.id)) { ids.add(option.id); additions.push(option); }
    }
  }
  return { ...snapshot, options: [...snapshot.options, ...additions] };
}
export function relevantMinecraftOptionIntents(s: MinecraftOptionsSnapshot): MinecraftOptionIntent[] {
  const c = s.context, intents: MinecraftOptionIntent[] = [];
  if ((c.food !== null && c.food < 18) || c.carriedFood === 0) intents.push('food');
  if (c.inWater === true) intents.push('water');
  if (c.travelling) intents.push('travel');
  if (c.freeSlots === 0) intents.push('inventory');
  return intents;
}
export function renderMinecraftOptionIndex(s: MinecraftOptionsSnapshot): string {
  const intents = relevantMinecraftOptionIntents(s);
  const lead = '[可选办法索引] mc_options {intent:food|travel|water|inventory|explore|method} 按意图读用途、前提与工具入口；不是强制流程，不执行动作。';
  const selected = intents.flatMap(intent => s.options.filter(o => o.intents.includes(intent) && o.id !== 'core.methods')
    .slice(0, 6).map(o => `${title[intent]}→${o.id} ${o.title}：${o.purpose.slice(0, 105)}`));
  // Prefer an explicit server effect over generic second-line preparation details when space is tight.
  const ordered = [...selected.filter(line => line.includes('→server.')), ...selected.filter(line => !line.includes('→server.'))];
  let text = lead;
  const end = '\n候选存在≠现在可执行；先核对条件，再用正常工具行动并验收。';
  for (const line of [...new Set(ordered)]) if (text.length + line.length + 1 + end.length <= 1400) text += '\n' + line;
  return text + end;
}
export function readMinecraftOptions(s: MinecraftOptionsSnapshot | null | undefined, args: Record<string, unknown>): unknown {
  const intent = args.intent ?? 'index';
  if (Object.keys(args).some(k => k !== 'intent') || (intent !== 'index' && !MINECRAFT_OPTION_INTENTS.includes(intent as MinecraftOptionIntent)))
    throw new Error('intent=index|food|travel|water|inventory|explore|method');
  const warning = 'Discovery only. Evidence is scoped to this sample; all action prerequisites, permissions, ownership and terminal effects require validation. Unknown is not ready. No body task or model was started.';
  if (!s) return { schema: 'minecraft-options/v1', status: 'unverified', warning,
    index: MINECRAFT_OPTION_INTENTS.map(id => ({ intent: id, title: title[id] })), options: [] };
  if (intent === 'index') return { schema: s.schema, context: s.context, warning,
    index: MINECRAFT_OPTION_INTENTS.map(id => ({ intent: id, title: title[id] })), currentClues: renderMinecraftOptionIndex(s) };
  return { schema: s.schema, context: s.context, intent, warning,
    options: s.options.filter(o => o.intents.includes(intent as MinecraftOptionIntent)).slice(0, 10),
    omitted: Math.max(0, s.options.filter(o => o.intents.includes(intent as MinecraftOptionIntent)).length - 10) };
}
