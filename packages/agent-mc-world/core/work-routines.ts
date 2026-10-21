/** Reviewed player-work recipes, separate from an agent's editable/learned method library. */
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { METHOD_LIMITS, type MethodRequest } from './method-runner.ts';
import { MOVEMENT_ROUTINES } from './movement-routines.ts';

export const WORK_ROUTINE_VERSION = 1;
export const WORK_ROUTINE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { op: { type: 'string', enum: ['list', 'read', 'run'] }, id: { type: 'string' } }, required: ['op'],
};
const cellSchema = { type: 'array', items: { type: 'integer', minimum: -30_000_000, maximum: 30_000_000 },
  minItems: 3, maxItems: 3 };
const shared = { dimension: { type: 'string', minLength: 1, maxLength: 96, pattern: '^[a-z0-9_:./-]+$' },
  minHealth: { type: 'number', minimum: 0, maximum: 1000, description: 'Stop below this observed health; default 6.' } };
const cropSchema = { type: 'object', additionalProperties: false, properties: { ...shared,
  crop: { type: 'string', enum: ['wheat', 'carrots', 'potatoes', 'beetroots'] },
  cells: { type: 'array', items: cellSchema, minItems: 1, maxItems: 8, uniqueItems: true } },
  required: ['dimension', 'crop', 'cells'] };
const logSchema = { type: 'object', additionalProperties: false, properties: { ...shared,
  block: { type: 'string', enum: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'] },
  cells: { type: 'array', items: cellSchema, minItems: 1, maxItems: 8, uniqueItems: true },
  tool: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-z0-9_:.-]+$' } },
  required: ['dimension', 'block', 'cells'] };
const storageSchema = { type: 'object', additionalProperties: false, properties: { ...shared, chest: cellSchema,
  items: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false,
    properties: { item: { type: 'string', pattern: '^[a-z0-9_]+$', maxLength: 80 },
      count: { type: 'integer', minimum: 0, maximum: 64 } }, required: ['item', 'count'] } } },
  required: ['dimension', 'chest', 'items'] };

const COMMON = String.raw`
let state = await mc.state();
const initial = state;
const dim = value => String(value).replace(/^minecraft:/, '');
const counts = s => {
  if (!s || !s.snapshot || s.snapshot.invSynced !== true || !Array.isArray(s.snapshot.inventory)) return null;
  const result = Object.create(null);
  for (const item of s.snapshot.inventory || []) result[item.name] = (result[item.name] || 0) + item.count;
  return result;
};
const before = counts(initial);
const records = [];
const unsafe = () => {
  if (!state || !state.snapshot) return 'observation_unavailable';
  if (state.connectionGeneration !== initial.connectionGeneration) return 'connection_changed';
  if (dim(state.snapshot.dimension) !== dim(params.dimension)) return 'dimension_mismatch';
  if (state.snapshot.invSynced !== true || !Array.isArray(state.snapshot.inventory)) return 'inventory_unavailable';
  if (state.snapshot.cursorItem) return 'cursor_not_empty';
  if (state.bodyRestriction) return 'body_restricted';
  if (state.combatActive) return 'combat_active';
  if (!Number.isFinite(state.snapshot.health)) return 'health_unknown';
  if (state.snapshot.health <= 0) return 'dead';
  if (state.snapshot.health < (params.minHealth === undefined ? 6 : params.minHealth)) return 'low_health';
  return null;
};
const finish = (reason, remaining) => {
  const after = counts(state);
  const delta = before && after ? Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(id => (after[id] || 0) !== (before[id] || 0)).map(id => [id, (after[id] || 0) - (before[id] || 0)])) : null;
  const changed = records.some(r => r.outcome === 'ok' || r.changed === true);
  return { schema: 'agent-mc.work/v1', routine: ROUTINE_ID, version: 1,
    outcome: reason ? (changed ? 'partial' : 'blocked') : (changed ? 'completed' : 'noop'),
    goalCompleted: !reason, reason: reason || null, remaining, records, inventoryDelta: delta,
    startedAt: initial.sampledAt, sampledAt: state && state.sampledAt,
    connectionGeneration: initial.connectionGeneration, dimension: params.dimension,
    position: state && state.snapshot && state.snapshot.position };
};
`;

function harvestSource(farm: boolean): string {
  return `const ROUTINE_ID = '${farm ? 'farm_harvest' : 'gather_logs'}';\n` + COMMON + String.raw`
const wanted = params.crop || params.block;
const farm = ROUTINE_ID === 'farm_harvest';
const maxAge = {wheat:7,carrots:7,potatoes:7,beetroots:3};
const ageOf = block => {
  const raw = block.getProperties().age;
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+$/.test(raw))) return NaN;
  const age = Number(raw);
  return Number.isInteger(age) && age >= 0 && age <= maxAge[wanted] ? age : NaN;
};
for (let i = 0; i < params.cells.length; i++) {
  let reason = unsafe();
  if (reason) return finish(reason, params.cells.slice(i));
  const at = params.cells[i];
  const cell = new Vec3(...at);
  const block = await bot.blockAt(cell);
  if (!block) return finish('target_unobserved', params.cells.slice(i));
  if (block.name !== wanted) return finish('target_changed', params.cells.slice(i));
  if (farm) {
    const age = ageOf(block);
    if (!Number.isFinite(age)) return finish('age_unknown', params.cells.slice(i));
    if (age < maxAge[wanted]) { records.push({at, outcome:'noop', reason:'not_mature', age}); continue; }
  }
  const group = await mc.do([{skill:'harvest',block:wanted,at,
    ...(farm ? {replant:true} : {expect:{block:'air',at}}),...(params.tool ? {tool:params.tool} : {})}]);
  state = group.state;
  reason = unsafe();
  if (reason) {
    records.push({at,outcome:'unknown',taskId:group.taskId,receipt:group.receipt});
    return finish(reason, params.cells.slice(i));
  }
  const afterBlock = await bot.blockAt(cell);
  // Removing a lower log can put its now-empty cell behind the upper log. Keep current sight
  // unknown; the explicit executor postcondition still records the known action result.
  const confirmedRemoval = !farm && group.done && group.steps && group.steps[0] && group.steps[0].outcome === 'ok'
    && (!afterBlock || afterBlock.name === 'air');
  const verified = farm ? afterBlock && afterBlock.name === wanted && ageOf(afterBlock) === 0
    : confirmedRemoval && (!afterBlock || afterBlock.name === 'air');
  records.push({at,taskId:group.taskId,outcome:group.done && verified ? 'ok' : 'blocked',
    changed: !!confirmedRemoval || (!!afterBlock && (afterBlock.name !== wanted || (farm && ageOf(afterBlock) === 0))),
    block:afterBlock ? {name:afterBlock.name,properties:afterBlock.getProperties()} : null,
    ...(confirmedRemoval ? {verification:{source:'executor_postcondition',at,block:'air',sampledAt:state.sampledAt}} : {}),
    receipt:String(group.receipt || '').slice(0,600)});
  if (!group.done || !verified) return finish(!group.done ? 'operation_blocked' : 'postcondition_unconfirmed', params.cells.slice(i));
}
return finish(null, []);
`;
}

function storageSource(deposit: boolean): string {
  return `const ROUTINE_ID = '${deposit ? 'deposit_surplus' : 'restock'}';\n` + COMMON + String.raw`
const deposit = ROUTINE_ID === 'deposit_surplus';
for (let i = 0; i < params.items.length; i++) {
  const reason = unsafe();
  if (reason) return finish(reason, params.items.slice(i));
  const request = params.items[i];
  if (!await bot.read('registry.itemsByName.' + request.item)) return finish('unknown_item_id', params.items.slice(i));
  const current = (counts(state) || {})[request.item] || 0;
  const amount = deposit ? Math.max(0, current - request.count) : Math.max(0, request.count - current);
  if (amount === 0) { records.push({item:request.item,outcome:'noop',count:current}); continue; }
  if (deposit) {
    const items = await bot.inventory.items();
    if (items.some(item => item.name === request.item && (item.customName || (item.enchants || []).length || item.durabilityUsed > 0))) {
      return finish('component_selection_required', params.items.slice(i));
    }
  }
  const group = await mc.do([{skill:deposit?'stow':'take',item:request.item,count:Math.min(64,amount),at:params.chest}]);
  state = group.state;
  const stop = unsafe();
  const after = counts(state);
  const value = after ? (after[request.item] || 0) : null;
  const met = value !== null && (deposit ? value <= request.count : value >= request.count);
  records.push({item:request.item,at:params.chest,taskId:group.taskId,before:current,after:value,
    outcome:group.done && met && !stop?'ok':'blocked',changed:value !== null && value !== current,
    receipt:String(group.receipt || '').slice(0,600)});
  if (stop || !group.done || !met) return finish(stop || (!group.done?'operation_blocked':'quantity_unconfirmed'), params.items.slice(i));
}
return finish(null, []);
`;
}

interface WorkRoutine {
  id: string; title: string; description: string; conditions: string[];
  parameters: Record<string, unknown>; code: string;
}
const ROUTINES: WorkRoutine[] = [
  { id: 'farm_harvest', title: '收割补种',
    description: '逐格检查指定田地，只收成熟作物并补种；返回方块状态、库存净变化和未完成坐标。',
    conditions: ['原版四种耕地作物；at/cells 指植株格，不是土格', '预留种子；只用已存在的步行通路',
      '未成熟保留；未知、目标变化、缺料、保护、战斗或失败时停止，不自行重试'], parameters: cropSchema, code: harvestSource(true) },
  { id: 'gather_logs', title: '定点采木',
    description: '只采指定自然原木格，不扩展到附近建筑或整片树林；报告实际入包结果。',
    conditions: ['调用者须确认是可采自然林木；未登记建筑的原木不能仅凭材质自动辨认',
      '只用已有步行通路，够不到的树冠停止；不自动挖路、搭高或补树', '每次最多8格，未加载或不可见不作为可采事实'],
    parameters: logSchema, code: harvestSource(false) },
  { id: 'deposit_surplus', title: '余料入仓',
    description: '将明确点名物资超过 count（随身保留量）的部分存到指定箱子；不自动清空整个背包。',
    conditions: ['count 是保留数量，不是本次移动数量；每项最多移动64个，多余仍需核验',
      '仅按精确物品名计数；命名、附魔或有耐久损耗的同名物品要求带 pick 的 stow；其他组件原样保留，不把传输标记当专属装备', '箱满、库存未同步或数量未达标返回部分完成，不丢物也不反复开箱'],
    parameters: storageSchema, code: storageSource(true) },
  { id: 'restock', title: '按需补给',
    description: '从指定箱子补足明确点名物资，使随身数量达到 count；已有足量时不取。',
    conditions: ['count 是目标随身总量，不是追加数量；每项0–64，最多8种',
      '缺货、背包满或数量未达标即返回；不会自动换箱或重复取物', '模组物品须有正确的原生物品身份，不能把投影 paper 当原生物品名'],
    parameters: storageSchema, code: storageSource(false) },
  ...MOVEMENT_ROUTINES,
];

const ajv = new Ajv({ allErrors: true, strict: true });
const validators = new Map(ROUTINES.map(routine => [routine.id, ajv.compile(routine.parameters)]));

export function listWorkRoutines() {
  return ROUTINES.map(({ id, title, description }) => ({ id, title, description, version: WORK_ROUTINE_VERSION }));
}

export function readWorkRoutine(id: unknown) {
  const routine = ROUTINES.find(value => value.id === id);
  if (!routine) throw new Error(`未知工作脚本 ${String(id)}；用 routine:{op:"list"} 查看`);
  return { ...structuredClone(routine), version: WORK_ROUTINE_VERSION,
    sourceHash: createHash('sha256').update(routine.code).digest('hex'), limits: METHOD_LIMITS,
    control: 'existing-body-queue', automaticallyReplayed: false, supportedTransport: 'mineflayer' };
}

export function prepareWorkRoutine(id: unknown, params: unknown): MethodRequest {
  const routine = readWorkRoutine(id);
  const validate = validators.get(routine.id)!;
  if (!validate(params)) throw new Error(`工作脚本 ${routine.id} 参数无效：${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  const input = params as { items?: Array<{ item: string }> };
  if (input.items && new Set(input.items.map(item => item.item)).size !== input.items.length) {
    throw new Error('items 不可重复列出同一物品名');
  }
  return { name: `work:${routine.id}`, code: routine.code, params: structuredClone(params) as Record<string, unknown>,
    durationMs: METHOD_LIMITS.maxDurationMs, routine: { id: routine.id, version: WORK_ROUTINE_VERSION } };
}
