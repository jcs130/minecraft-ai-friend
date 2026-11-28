import { afterEach, expect, it, vi } from 'vitest';
import { readSkillHelp } from '../core/skills.ts';
import type { Bot } from 'mineflayer';
import { observeCraftGrid, recentlyEmptyCraftGrid } from '../core/craft-grid-observation.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.restoreAllMocks());
it('returns correlated no-effect admission and ends only this decision turn, preserving the task terminal', async () => {
  const r = methodHarness();
  try {
    vi.spyOn(r.exec, 'submit').mockImplementation((_steps, _mode, _wrote, onDecision) => {
      onDecision?.(false, undefined, false, { kind:'repeat', rule:'task.no-observed-effect', review: {
        protocol:'agent-mc-no-effect-plan-review/v1',planHash:'a'.repeat(64),completedNoopTasks:2,
        firstTaskId:41,latestTaskId:42,observedAt:Date.now(),observation:'unchanged',goalVerified:false,
      } });
      return 'Prior task completed with noop; identical selection was not dispatched';
    });
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({steps:[{skill:'pickup',item:'phantom_membrane'}]}, {role:'test',log:r.host.log});
    expect(result).toMatchObject({failed:true,endsTurn:true,data:{status:'blocked',goal_completed:false,
      next_safe_read:{tool:'mc_queue',arguments:{taskId:42,detail:true}}},meta:{admission:{kind:'repeat',rule:'task.no-observed-effect',review:{latestTaskId:42}}}});
    expect(result).not.toHaveProperty('execution');
  } finally { r.close(); }
});

it('rejects invalid coordinates before replacing, navigating or dispatching any earlier step', async () => {
  const r = methodHarness();
  try {
    r.exec.submitDetailed([{ skill: 'goto', at: [8, 64, 0] }], 'append');
    const before = r.exec.status(), submit = vi.spyOn(r.exec, 'submit');
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({ queue: 'replace', steps: [
      { skill: 'goto', at: [10, 64, 10] },
      { skill: 'observe', mode: 'voxels', bounds: [-8, -6, -8, -9, 3, 4], needs: [1] },
    ] }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true, meta: { admission: {
      accepted: false, dispatched: false, kind: 'correction', rule: 'arguments.steps',
    } } });
    expect(result).not.toHaveProperty('execution');
    expect((result as { text: string }).text).toContain('bounds');
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

it('refuses a known ingredient shortage before sacrificing a stack and returns the recipe read', async () => {
  const r = methodHarness();
  try {
    const items = r.bot.registry.itemsByName;
    const inventory = [['iron_ingot', 16], ['stick', 1], ['rotten_flesh', 10]] as const;
    Object.assign(r.bot.inventory, {items: () => inventory.map(([name, count]) => ({name, count, type:items[name].id}))});
    Object.assign(r.bot, { recipesAll: () => [{result:{count:1},delta:[
      {id:items.stick.id,count:-2}, {id:items.iron_ingot.id,count:-3}]}], toss:vi.fn(), craft:vi.fn() });
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({steps:[
      {skill:'toss',item:'rotten_flesh',count:10}, {skill:'craft',item:'iron_pickaxe',count:1},
      {skill:'equip',item:'iron_pickaxe'},
    ]}, {role:'test',log:r.host.log});
    expect(result).toMatchObject({failed:true,data:{completed:0,next_safe_read:{
      tool:'mc_knowledge',arguments:{kind:'recipe',query:'iron_pickaxe'}}},
      meta:{admission:{accepted:false,recovery:[{tool:'mc_help',arguments:{skill:'craft'}}]}}});
    expect(result.text).toContain('木棍×1');
    expect(result.text).toContain('丢弃未执行');
    expect((r.bot as any).toss).not.toHaveBeenCalled();
    expect(r.exec.status().waiting).toHaveLength(0);
  } finally { r.close(); }
});

it('recognizes a recently empty native output across different discard prefixes while allowing standalone or changed trials', async () => {
  const r = methodHarness(), bot = r.bot as unknown as Bot;
  const grid = [['oak_sapling'], ['oak_sapling']];
  try {
    Object.assign(r.bot.inventory,{items:() => [{name:'oak_sapling',count:4,type:r.bot.registry.itemsByName.oak_sapling.id}]});
    observeCraftGrid(bot, grid, 'empty');
    for (const item of ['string','spider_eye']) {
      const result = r.exec.submitDetailed([{skill:'toss',item,count:1},{skill:'craft',grid,count:1}],'append');
      expect(result.accepted).toBe(false);
      expect(result.receipt).toContain('产出槽没有返回物品');
    }
    expect(recentlyEmptyCraftGrid(bot,[['oak_sapling','oak_sapling']])).toBe(false);
    expect(recentlyEmptyCraftGrid({...r.bot} as unknown as Bot,grid)).toBe(false);
    expect(r.exec.submitDetailed([{skill:'craft',grid,count:1}],'append').accepted).toBe(true);
    observeCraftGrid(bot,grid,'produced');
    expect(recentlyEmptyCraftGrid(bot,grid)).toBe(false);
  } finally { r.close(); }
});

it('checks stock again when previously queued work releases the body', async () => {
  const r = methodHarness();
  try {
    const id = r.bot.registry.itemsByName.stick.id, toss = vi.fn();
    Object.assign(r.bot,{recipesAll:() => [{result:{count:1},delta:[{id,count:-2}]}],toss});
    Object.assign(r.bot.inventory,{items:() => [{type:id,name:'stick',count:1}]});
    const report = vi.spyOn(r.world as any,'onTaskReport');
    const first = r.exec.submitDetailed([{skill:'wait',ticks:3}],'append');
    const queued = r.exec.submitDetailed([{skill:'toss',item:'dirt',count:1},{skill:'craft',item:'iron_pickaxe',count:1}],'append');
    expect(first.accepted && queued.accepted).toBe(true);
    await vi.waitFor(() => expect(report.mock.calls.some(([outcome]) =>
      outcome.kind === 'blocked' && outcome.text.includes('开工前受阻') && outcome.text.includes('木棍×1'))).toBe(true));
    expect(toss).not.toHaveBeenCalled();
  } finally { r.close(); }
});
