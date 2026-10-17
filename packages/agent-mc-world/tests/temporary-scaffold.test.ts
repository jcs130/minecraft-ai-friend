import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { Aborted, type SkillContext } from '../core/skill-context.ts';
import { installMineflayerFixes } from '../core/mineflayer-fixes.ts';
import { protectionCheck } from '../core/protection-port.ts';
import { armTemporaryScaffoldPlacement, beginTemporaryScaffold, closeTemporaryScaffold, prepareTemporaryScaffoldPlacement,
  recordTemporaryScaffold, reclaimTemporaryScaffold, reclaimPendingTemporaryScaffold,
  pendingTemporaryScaffolds, promoteTemporaryScaffold, scaffoldCleanupCheckpoint } from '../core/temporary-scaffold.ts';
import { Executor, type TaskReport } from '../core/executor.ts';
import { skillBuild } from '../core/skills-build.ts';
import { parseSteps } from '../core/skills.ts';
function makeExecutorOn(bot: Bot) {
  const reports: TaskReport[] = []; let id = 0;
  const exec = new Executor({ getBot: () => bot, report: r => reports.push(r),
    nextId: () => ++id, log: { info() {}, warn() {}, debug() {}, error() {} } as never });
  return { exec, reports };
}
async function waitUntil(condition: () => boolean) {
  for (let n=0; n<300 && !condition(); n++) await vi.advanceTimersByTimeAsync(10);
  if (!condition()) throw new Error('executor did not finish');
}

const require = createRequire(import.meta.url);
const dependency = createRequire(require.resolve('mineflayer'));
const registry = require('minecraft-data')('1.20.6') as Bot['registry'];
const Blocks = dependency('prismarine-block')('1.20.6') as typeof Block;

function rig() {
  const events = new EventEmitter();
  const cells = new Map<string, Block>();
  const unloaded = new Set<string>();
  const dug: string[] = [];
  const stock: Array<{ name: string; count: number; type: number }> = [];
  let aborted = false;
  let reachable = true;
  let collect = true;
  let visible = true;
  const reports: unknown[] = [];
  const make = (name: string, p: Vec3, properties: Record<string, unknown> = {}): Block => {
    const definition = registry.blocksByName[name];
    // The first state of a waterloggable block is often submerged; ordinary
    // fixture blocks should use dry vanilla states unless the scenario says otherwise.
    const wanted = { ...(definition.states?.some((state) => state.name === 'waterlogged')
      ? { waterlogged: false } : {}), ...properties };
    let b = Blocks.fromStateId(definition.minStateId, 0);
    if (Object.keys(wanted).length) {
      for (let stateId = definition.minStateId; stateId <= definition.maxStateId; stateId++) {
        const candidate = Blocks.fromStateId(stateId, 0);
        if (Object.entries(wanted).every(([key, value]) => candidate.getProperties()[key] === value)) {
          b = candidate; break;
        }
      }
      expect(b.getProperties()).toMatchObject(wanted);
    }
    b.position = p;
    return b;
  };
  const bot = Object.assign(events, {
    registry, game: { dimension: 'overworld' },
    entity: { position: new Vec3(0.5, 64, 0.5), width: 0.6, eyeHeight: 1.62, onGround: true, effects: {} },
    entities: {} as Record<string, unknown>, heldItem: null,
    inventory: { items: () => stock, slots: [] },
    blockAt: (p: Vec3) => unloaded.has(p.toString()) ? null : cells.get(p.toString()) ?? make('air', p),
    canDigBlock: () => reachable, digTime: () => 50,
    canSeeBlock: () => visible, world: { raycast: () => null },
    unequip: async () => undefined, lookAt: async () => undefined,
    dig: async (block: Block) => {
      dug.push(block.position.toString());
      const air = make('air', block.position);
      cells.set(block.position.toString(), air);
      events.emit('blockUpdate', block, air);
      if (collect) stock.push({ name: block.name, count: 1, type: registry.itemsByName[block.name].id });
    },
  }) as unknown as Bot;
  const ctx = { aborted: () => aborted, diag: { write: (report: unknown) => { reports.push(report); } } } as unknown as SkillContext;
  const at = (x = 2, y = 64, z = 0) => new Vec3(x, y, z);
  const seed = (name: string, p = at(), properties: Record<string, unknown> = {}) => {
    const block = make(name, p, properties); cells.set(p.toString(), block); return block;
  };
  const place = (p = at(), previous = 'air') => {
    const before = make(previous, p);
    const proof = prepareTemporaryScaffoldPlacement(bot, before);
    armTemporaryScaffoldPlacement(bot, p);
    const after = seed('oak_planks', p);
    recordTemporaryScaffold(bot, proof, after);
    return after;
  };
  return { bot, ctx, events, dug, reports, stock, at, place, seed,
    abort: () => { aborted = true; }, unreachable: () => { reachable = false; },
    noPickup: () => { collect = false; }, unload: (p: Vec3) => unloaded.add(p.toString()) };
}

describe('temporary path support provenance and bounded cleanup', () => {
  it.each([true, false])('diagnoses an unconfirmed dig without querying a successful dig (confirmed=%s)', async confirmed => {
    vi.useFakeTimers();
    try {
      const r = rig(); const queries: unknown[] = [];
      Object.assign(r.bot, {
        _client: Object.assign(new EventEmitter(), { write: () => undefined }),
        _updateBlockState: () => undefined,
        dig: async (block: Block) => {
          if (confirmed) r.events.emit('blockUpdate', block, r.seed('air', block.position));
        },
        cortiProtectionPreflight: () => false,
        cortiBreakVerdict: () => 'unknown',
        cortiProtectCheck: protectionCheck({ verdict: () => null,
          check: async (action, dimension, cell) => {
            queries.push({ action, dimension, cell });
            return { action, dimension, ...cell, status: 'deny', reason: 'server denied' };
          } }, () => 'overworld', () => false),
      });
      installMineflayerFixes(r.bot, { error() {}, info() {}, warn() {}, debug() {} } as never);
      const dig = r.bot.dig(r.seed('stone'));
      const checked = confirmed ? expect(dig).resolves.toBeUndefined()
        : expect(dig).rejects.toThrow('失败后保护查询 deny');
      await vi.runAllTimersAsync(); await checked;
      expect(queries).toHaveLength(confirmed ? 0 : 1);
      expect(r.bot.blockAt(r.at())?.name).toBe(confirmed ? 'air' : 'stone');
    } finally { vi.useRealTimers(); }
  });
  it.each([true, false])('queries protection only after an unconfirmed placement (confirmed=%s)', async confirmed => {
    vi.useFakeTimers();
    try {
      const r = rig(); const queries: unknown[] = [];
      Object.assign(r.bot, {
        _client: Object.assign(new EventEmitter(), { write: () => undefined }),
        craft: async () => undefined, placeBlock: async () => undefined,
        _genericPlace: async () => { if (confirmed) r.seed('oak_planks'); },
        pathfinder: { isBuilding: () => false, setGoal: () => undefined },
        cortiProtectCheck: protectionCheck({ verdict: () => null,
          check: async (action, dimension, cell) => {
            queries.push({ action, dimension, cell });
            return { action, dimension, ...cell, status: 'deny', reason: 'server denied' };
          } }, () => 'overworld', () => false),
      });
      installMineflayerFixes(r.bot, { error() {}, info() {}, warn() {}, debug() {} } as never);
      const placement = r.bot.placeBlock(r.seed('stone', r.at(2, 63)), new Vec3(0, 1, 0));
      const checked = confirmed ? expect(placement).resolves.toBeUndefined()
        : expect(placement).rejects.toThrow('放置未确认后的保护查询 deny');
      await vi.runAllTimersAsync(); await checked;
      expect(queries).toHaveLength(confirmed ? 0 : 1);
      if (!confirmed) expect(queries[0]).toMatchObject({ action: 'place', cell: { x: 2, y: 64, z: 0 } });
    } finally { vi.useRealTimers(); }
  });
  it('places explicitly temporary work through native confirmation, preserves it for use, then reclaims only that work', async () => {
    vi.useFakeTimers();
    try {
      const r=rig(); r.seed('stone', r.at(2,63)); r.seed('oak_planks',r.at(3));
      const item={name:'oak_planks',count:3,type:registry.itemsByName.oak_planks.id}; r.stock.push(item);
      Object.assign(r.bot.entity,{height:1.8,yaw:0,pitch:0});
      Object.assign(r.bot,{heldItem:item,_client:Object.assign(new EventEmitter(),{write(){}}),
        craft:async()=>{},placeBlock:async()=>{},setControlState(){},clearControlStates(){},
        pathfinder:{isBuilding:()=>false,setGoal(){}},
        _genericPlace:async (reference:Block,face:Vec3)=>{
          const pos=reference.position.plus(face), before=r.bot.blockAt(pos);
          const after=r.seed('oak_planks',pos); item.count--; r.events.emit('blockUpdate',before,after);
        }});
      installMineflayerFixes(r.bot,{info(){},warn(){},error(){},debug(){}} as never);
      const call={skill:'build' as const,material:'oak_planks',anchors:[[2,64,0],[3,64,0]] as [number,number,number][],temporary:true};
      const result=skillBuild(r.bot,call,r.ctx); await vi.runAllTimersAsync();
      expect(await result).toContain('临时支撑');
      expect(pendingTemporaryScaffolds(r.bot)).toHaveLength(1);
      expect(scaffoldCleanupCheckpoint([call,{skill:'chat',text:'支架搭好了'}],0)).toBe(false);
      expect(r.bot.blockAt(r.at())?.name).toBe('oak_planks');
      const cleanup=reclaimPendingTemporaryScaffold(r.bot,r.ctx); await vi.runAllTimersAsync();
      expect(await cleanup).toContain('拆除 1 块');
      expect(r.bot.blockAt(r.at())?.name).toBe('air');
      expect(r.bot.blockAt(r.at(3))?.name).toBe('oak_planks');
    } finally {vi.useRealTimers();}
  });

  it('promotes already-matching permanent work, while a preview keeps cleanup authority unchanged', async () => {
    const r=rig(); r.place();
    const call={skill:'build' as const,material:'oak_planks',anchors:[[2,64,0]] as [number,number,number][]};
    await skillBuild(r.bot,{...call,dryRun:true},r.ctx);
    expect(pendingTemporaryScaffolds(r.bot)).toHaveLength(1);
    await skillBuild(r.bot,call,r.ctx);
    expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
    expect(r.dug).toEqual([]);
  });

  it('rejects ambiguous temporary flags and does not allow an entire blueprint to become cleanup work', () => {
    expect(parseSteps([{skill:'build',material:'dirt',anchors:[[1,64,0]],temporary:'true'}])).toHaveProperty('error');
    expect(parseSteps([{skill:'build',blueprint:'home',temporary:true}])).toHaveProperty('error');
  });
  it('cleans only current-scope air-to-support placements and reports observed inventory', async () => {
    const r = rig();
    r.place(r.at(4));
    const scope = beginTemporaryScaffold(r.bot);
    r.place();
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([r.at().toString()]);
    expect(text).toContain('拆除 1 块');
    expect(text).toContain('×1');
    expect(text).toContain('未单独确认掉落来源');
    expect(r.bot.blockAt(r.at(4))!.name).toBe('oak_planks');
    expect(await reclaimTemporaryScaffold(r.bot, r.ctx, scope)).toBe('');
  });

  it.each(['oak_planks', 'grass_block', 'water'])('does not acquire provenance when the destination was %s', async (name) => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place(r.at(), name);
    expect(await reclaimTemporaryScaffold(r.bot, r.ctx, scope)).toBe('');
    expect(r.dug).toEqual([]);
  });

  it('does not acquire provenance for an unreadable destination or a different confirmed cell', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot);
    expect(prepareTemporaryScaffoldPlacement(r.bot, null)).toBeNull();
    const proof = prepareTemporaryScaffoldPlacement(r.bot, r.seed('air', r.at()));
    armTemporaryScaffoldPlacement(r.bot, r.at());
    recordTemporaryScaffold(r.bot, proof, r.seed('oak_planks', r.at(3)));
    expect(await reclaimTemporaryScaffold(r.bot, r.ctx, scope)).toBe('');
    expect(r.dug).toEqual([]);
  });

  it('does not infer ownership from the older coarse placed ledger', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot);
    r.seed('oak_planks');
    (r.bot as unknown as { placedLedger: unknown[] }).placedLedger = [{ name: 'oak_planks', x: 2, y: 64, z: 0 }];
    expect(await reclaimTemporaryScaffold(r.bot, r.ctx, scope)).toBe('');
    expect(r.dug).toEqual([]);
  });

  it.each([true, false])('only the confirmed path placement hook records provenance (path building = %s)', async (building) => {
    const r = rig();
    const client = Object.assign(new EventEmitter(), { write: () => undefined });
    Object.assign(r.bot, { _client: client, craft: async () => undefined, placeBlock: async () => undefined,
      _genericPlace: async () => { r.seed('oak_planks'); },
      pathfinder: { isBuilding: () => building, setGoal: () => undefined },
    });
    const log = { error: () => undefined, info: () => undefined, warn: () => undefined, debug: () => undefined };
    installMineflayerFixes(r.bot, log as never);
    const scope = beginTemporaryScaffold(r.bot);
    await r.bot.placeBlock(r.seed('stone', r.at(2, 63)), new Vec3(0, 1, 0));
    expect(scope.records).toHaveLength(building ? 1 : 0);
    closeTemporaryScaffold(scope);
  });

  it('invalidates a replaced block even when the same material returns later', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); const placed = r.place();
    const air = r.seed('air'); r.events.emit('blockUpdate', placed, air);
    const restored = r.seed('oak_planks'); r.events.emit('blockUpdate', air, restored);
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('方块在放置后发生变化');
  });

  it('invalidates unloaded chunks including negative block coordinates', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place(r.at(-2));
    r.events.emit('chunkColumnUnload', new Vec3(-16, 0, 0));
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('区块已卸载');
  });

  it.each(['respawn', 'spawn', 'end'])('invalidates provenance after %s', async (event) => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place(); r.events.emit(event, 'done');
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('保留 1 块');
  });

  it('refuses cross-dimension cleanup before respawn delivery', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place();
    r.bot.game.dimension = 'the_nether';
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('维度或连接已变化');
  });

  it('does not dismantle its own footing or a nearby player footing', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot);
    r.place(r.at(0, 63)); r.place(r.at(2, 63));
    r.bot.entities.player = { type: 'player', position: new Vec3(2.5, 64, 0.5), width: 0.6 } as never;
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('保留 2 块');
  });

  it('does not remove a support below a solid block or a task-intended placement', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place(); r.seed('stone', r.at(2, 65));
    r.place(r.at(3)); r.ctx.intended = new Set(['3,64,0']);
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('上方仍有承重方块'); expect(text).toContain('有意保留');
  });

  it('does not dismantle a support hidden behind a wall even when the distance permits digging', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place();
    r.bot.canSeeBlock = () => false;
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('看不见');
  });

  it('rechecks identity after an awaited tool change', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); const placed = r.place();
    r.bot.heldItem = { name: 'diamond_pickaxe', type: registry.itemsByName.diamond_pickaxe.id } as never;
    r.bot.unequip = async () => { r.events.emit('blockUpdate', placed, r.seed('stone')); };
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('方块在放置后发生变化');
  });

  it('honors the current server protection verdict before dismantling', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place();
    (r.bot as unknown as { cortiBreakVerdict: () => string }).cortiBreakVerdict = () => 'unknown';
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([]); expect(text).toContain('破坏权限尚未');
  });

  it('removes a reachable unoccupied column from the top and never follows an unreachable support', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place(); r.place(r.at(2, 65));
    await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toEqual([r.at(2, 65).toString(), r.at().toString()]);
    const next = beginTemporaryScaffold(r.bot); r.place(); r.unreachable();
    const text = await reclaimTemporaryScaffold(r.bot, r.ctx, next);
    expect(r.dug).toHaveLength(2); expect(text).toContain('够不到');
  });

  it('waits at most the pickup budget and reports a removal without claiming the drop entered inventory', async () => {
    vi.useFakeTimers();
    try {
      const r = rig(); r.noPickup(); const scope = beginTemporaryScaffold(r.bot); r.place();
      const pending = reclaimTemporaryScaffold(r.bot, r.ctx, scope);
      await vi.runAllTimersAsync();
      const text = await pending;
      expect(r.dug).toHaveLength(1); expect(text).toContain('×0');
      expect(text).toContain('掉落入包尚未全部确认'); expect(text).toContain('(2,64,0)');
    } finally { vi.useRealTimers(); }
  });

  it('aborted scopes perform no cleanup and closing prevents later placements from entering the scope', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place(); r.abort();
    await expect(reclaimTemporaryScaffold(r.bot, r.ctx, scope)).rejects.toBeInstanceOf(Aborted);
    expect(r.dug).toEqual([]); closeTemporaryScaffold(scope);
    r.place(r.at(3)); expect(scope.records).toHaveLength(1);
  });
});

describe('strict deferred temporary supports', () => {
  it('captures a new confirmed path support without a collection scope, without importing a coarse ledger', async () => {
    const r = rig(); r.place();
    r.seed('oak_planks', r.at(7));
    (r.bot as unknown as { placedLedger: unknown[] }).placedLedger = [{ name: 'oak_planks', x: 7, y: 64, z: 0 }];
    expect(pendingTemporaryScaffolds(r.bot)).toMatchObject([{ x: 2, y: 64, z: 0, name: 'oak_planks' }]);
    const text = await reclaimPendingTemporaryScaffold(r.bot, r.ctx);
    expect(r.dug).toEqual([r.at().toString()]);
    expect(text).toContain('拆除 1 块');
    expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
    expect(r.bot.blockAt(r.at(7))!.name).toBe('oak_planks');
  });

  it('keeps a footing after its scope closes and reclaims it after the bot safely leaves', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place(r.at(0, 63));
    expect(await reclaimTemporaryScaffold(r.bot, r.ctx, scope)).toContain('仍在实体脚下');
    expect(scope.finished).toBe(true);
    expect(pendingTemporaryScaffolds(r.bot)).toHaveLength(1);
    r.bot.entity.position = new Vec3(3.5, 64, .5);
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('拆除 1 块');
    expect(r.dug).toEqual([r.at(0, 63).toString()]);
  });

  it('retains an unreachable support for a later nearby pass, without pathfinding', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place(); r.unreachable();
    await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    r.bot.canDigBlock = () => true;
    const goto = vi.fn(); Object.assign(r.bot, { pathfinder: { goto } });
    await reclaimPendingTemporaryScaffold(r.bot, r.ctx);
    expect(r.dug).toHaveLength(1); expect(goto).not.toHaveBeenCalled();
  });

  it.each(['block', 'unload', 'spawn', 'end'])('keeps invalidation working after scope closure (%s)', async (event) => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); const placed = r.place();
    closeTemporaryScaffold(scope);
    if (event === 'block') r.events.emit('blockUpdate', placed, r.seed('air'));
    else if (event === 'unload') r.events.emit('chunkColumnUnload', new Vec3(0, 0, 0));
    else r.events.emit(event);
    if (event === 'block') r.seed('oak_planks');
    await reclaimPendingTemporaryScaffold(r.bot, r.ctx);
    expect(r.dug).toEqual([]);
    expect(pendingTemporaryScaffolds(r.bot)[0].invalid).not.toBeNull();
  });

  it('explicit promotion removes cleanup authority across later unrelated tasks', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place();
    expect(promoteTemporaryScaffold(r.bot, [r.at()])).toBe(1);
    expect(promoteTemporaryScaffold(r.bot, [r.at(7)])).toBe(0);
    expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
    expect(await reclaimTemporaryScaffold(r.bot, r.ctx, scope)).toContain('明确保留');
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toBe('');
    expect(r.dug).toEqual([]);
  });

  it('task intended cells are permanently promoted rather than becoming removable in the next task', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); r.place();
    r.ctx.intended = new Set(['2,64,0']);
    expect(await reclaimTemporaryScaffold(r.bot, r.ctx, scope)).toContain('任务有意保留');
    r.ctx.intended.clear();
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toBe('');
    expect(r.dug).toEqual([]);
  });

  it('deduplicates two confirmations of the same new support', async () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot);
    const proof = prepareTemporaryScaffoldPlacement(r.bot, r.seed('air'));
    armTemporaryScaffoldPlacement(r.bot, r.at());
    const placed = r.seed('oak_planks');
    recordTemporaryScaffold(r.bot, proof, placed); recordTemporaryScaffold(r.bot, proof, placed);
    expect(scope.records).toHaveLength(1); expect(pendingTemporaryScaffolds(r.bot)).toHaveLength(1);
    await reclaimTemporaryScaffold(r.bot, r.ctx, scope);
    expect(r.dug).toHaveLength(1);
  });

  it('does not classify a ladder, torch, or liquid as disposable support', () => {
    for (const name of ['ladder', 'torch', 'water']) {
      const r = rig(); const proof = prepareTemporaryScaffoldPlacement(r.bot, r.seed('air'));
      armTemporaryScaffoldPlacement(r.bot, r.at());
      recordTemporaryScaffold(r.bot, proof, r.seed(name));
      expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
    }
  });

  it('bounds a pass and leaves the remaining strict proof available for the next pass', async () => {
    const r = rig(); for (let i = 0; i < 17; i++) r.place(r.at(i + 2));
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('清理预算已到');
    expect(r.dug).toHaveLength(16); expect(pendingTemporaryScaffolds(r.bot)).toHaveLength(1);
    await reclaimPendingTemporaryScaffold(r.bot, r.ctx);
    expect(r.dug).toHaveLength(17); expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
  });

  it('reports a retained footing once, audits unchanged passes, and reports cleanup after the obstacle leaves', async () => {
    const r = rig(); r.place(r.at(0, 63));
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('仍在实体脚下');
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toBe('');
    expect(r.reports).toHaveLength(2);
    expect(r.dug).toEqual([]);
    r.bot.entity.position = new Vec3(3.5, 64, .5);
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('拆除 1 块');
    expect(r.dug).toHaveLength(1); expect(r.reports).toHaveLength(3);
  });

  it('reports new placement proof but suppresses an unchanged obligation after unrelated inventory changes', async () => {
    const r = rig(); const p = r.at(0, 63); const placed = r.place(p);
    const first = await reclaimPendingTemporaryScaffold(r.bot, r.ctx);
    expect(first).toContain('仍在实体脚下');
    const air = r.seed('air', p); r.events.emit('blockUpdate', placed, air);
    r.place(p);
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('仍在实体脚下');
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toBe('');
    r.stock.push({ name: 'bread', count: 1, type: registry.itemsByName.bread.id });
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toBe('');
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toBe('');
    expect(r.dug).toEqual([]); expect(r.reports).toHaveLength(5);
  });
});

describe('deferred cleanup through the executor', () => {
  it.each(['look', 'walkOnly'] as const)('preserves the %s contract with an old reachable temporary support', async (action) => {
    vi.useFakeTimers();
    try {
      const r = rig();
      r.place();
      Object.assign(r.bot.entity, { height: 1.62, yaw: 0, pitch: 0 });
      Object.assign(r.bot, {
        health: 20, food: 20, players: {},
        waitForTicks: async () => undefined,
        clearControlStates: () => undefined, setControlState: () => undefined,
        pathfinder: { stop: () => undefined, setGoal: () => undefined,
          movements: { canDig: true, scafoldingBlocks: [] },
          goto: async (goal: { x?: number; y?: number; z?: number }) => {
            const p = r.bot.entity.position;
            r.bot.entity.position = new Vec3(goal.x ?? p.x, goal.y ?? p.y, goal.z ?? p.z);
          } },
        lookAt: async (point: Vec3) => {
          const delta = point.minus(r.bot.entity.position.offset(0, 1.62, 0));
          r.bot.entity.yaw = Math.atan2(-delta.x, -delta.z);
          r.bot.entity.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
        },
      });
      const nativeDig = r.bot.dig.bind(r.bot);
      r.bot.dig = async (block: Block) => {
        await r.bot.lookAt(block.position.offset(.5, .5, .5), true);
        await nativeDig(block);
      };
      const { exec, reports } = makeExecutorOn(r.bot);
      const before = r.bot.entity.position.clone();
      exec.submit([action === 'look' ? { skill: 'look', at: [0, 68, -5] }
        : { skill: 'goto', at: [1, 64, 0], exact: true, walkOnly: true }]);
      await waitUntil(() => reports.length === 1);
      expect(reports[0].kind).toBe('done');
      expect(r.dug).toEqual([]);
      expect(r.bot.blockAt(r.at())!.name).toBe('oak_planks');
      expect(pendingTemporaryScaffolds(r.bot)).toHaveLength(1);
      if (action === 'look') {
        expect(r.bot.entity.position).toEqual(before);
        expect(r.bot.entity.yaw).toBeCloseTo(0);
        expect(r.bot.entity.pitch).toBeGreaterThan(0);
      }
      Object.assign(r.bot, { chat: () => undefined });
      exec.submit([{ skill: 'goto', at: [4, 64, 0], exact: true }, { skill: 'chat', text: '到达后收尾' }]);
      await waitUntil(() => reports.length === 2);
      expect(reports[1].kind).toBe('done');
      expect(r.dug).toEqual([r.at().toString()]);
      expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

describe('temporary support attachment and last-moment safety', () => {
  it.each([
    [1, 0, 0, 'water'], [-1, 0, 0, 'lava'], [0, 1, 0, 'water'],
    [0, -1, 0, 'water'], [0, 0, 1, 'water'], [0, 0, -1, 'lava'],
  ] as const)('does not release adjacent fluid at %s,%s,%s', async (dx, dy, dz, name) => {
    const r = rig(); r.place(); r.seed(name, r.at().offset(dx, dy, dz));
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('相邻仍有液体');
    expect(r.dug).toEqual([]);
  });

  it('retains a support when any neighbouring cell is unreadable', async () => {
    const r = rig(); r.place(); r.unload(r.at().offset(1, 0, 0));
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('相邻方块未加载');
    expect(r.dug).toEqual([]);
  });

  it('does not release water contained in a neighbouring waterlogged block', async () => {
    const r = rig(); r.place();
    r.seed('oak_stairs', r.at().offset(1, 0, 0), { waterlogged: true });
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('相邻仍有液体');
    expect(r.dug).toEqual([]);
  });

  it.each(['ladder', 'wall_torch', 'oak_wall_sign'])('retains %s attached to the side', async (name) => {
    const r = rig(); r.place(); r.seed(name, r.at().offset(0, 0, -1), { facing: 'north' });
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('侧面仍有');
    expect(r.dug).toEqual([]);
  });

  it('does not mistake a ladder attached to a different support for an attachment to this block', async () => {
    const r = rig(); r.place(); r.seed('ladder', r.at().offset(0, 0, -1), { facing: 'south' });
    await reclaimPendingTemporaryScaffold(r.bot, r.ctx);
    expect(r.dug).toHaveLength(1);
  });

  it('retains floor decorations and hanging lanterns that depend on the support', async () => {
    const top = rig(); top.place(); top.seed('torch', top.at().offset(0, 1, 0));
    expect(await reclaimPendingTemporaryScaffold(top.bot, top.ctx)).toContain('依附物');
    expect(top.dug).toEqual([]);
    const bottom = rig(); bottom.place(); bottom.seed('lantern', bottom.at().offset(0, -1, 0), { hanging: true });
    expect(await reclaimPendingTemporaryScaffold(bottom.bot, bottom.ctx)).toContain('悬挂依附');
    expect(bottom.dug).toEqual([]);
  });

  it('retains nearby item frames instead of dropping a displayed player item', async () => {
    const r = rig(); r.place();
    r.bot.entities.frame = { type: 'other', name: 'item_frame', position: new Vec3(3, 64.5, .5), width: .75, height: .75 } as never;
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('物品展示框');
    expect(r.dug).toEqual([]);
  });

  it.each(['lever', 'oak_button'])('retains %s attached to the underside', async (name) => {
    const r = rig(); r.place(); r.seed(name, r.at().offset(0, -1, 0), { face: 'ceiling' });
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('下方仍有悬挂依附');
    expect(r.dug).toEqual([]);
  });

  it.each(['replacement', 'player', 'attachment', 'liquid'])('revalidates after asynchronous server protection preflight (%s)', async (change) => {
    const r = rig(); r.place();
    Object.assign(r.bot, { _client: Object.assign(new EventEmitter(), { write: () => {} }),
      craft: async () => {}, placeBlock: async () => {}, _updateBlockState: () => {},
      cortiProtectCheck: async () => {
        await Promise.resolve();
        if (change === 'replacement') {
          const before = r.bot.blockAt(r.at()); const after = r.seed('stone'); r.events.emit('blockUpdate', before, after);
        } else if (change === 'player') {
          r.bot.entities.player = { type: 'player', position: new Vec3(2.5, 65, .5), width: .6 } as never;
        } else if (change === 'attachment') r.seed('ladder', r.at().offset(0, 0, -1), { facing: 'north' });
        else r.seed('water', r.at().offset(1, 0, 0));
        return { status: 'allow_likely', reason: 'test' };
      },
    });
    const log = { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} };
    installMineflayerFixes(r.bot, log as never);
    expect(await reclaimPendingTemporaryScaffold(r.bot, r.ctx)).toContain('再次核验未通过');
    expect(r.dug).toEqual([]);
  });
});

describe('temporary placement proof before-send boundary', () => {
  it('requires explicit arming rather than treating a changed cell as proof of ownership', () => {
    const r = rig(); const proof = prepareTemporaryScaffoldPlacement(r.bot, r.seed('air'));
    recordTemporaryScaffold(r.bot, proof, r.seed('oak_planks'));
    expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
  });

  it.each(['replacement', 'unload', 'spawn'])('rejects a prepared proof after %s before the send boundary', (change) => {
    const r = rig(); const before = r.seed('air');
    const proof = prepareTemporaryScaffoldPlacement(r.bot, before);
    if (change === 'replacement') {
      const occupied = r.seed('oak_planks'); r.events.emit('blockUpdate', before, occupied);
      const air = r.seed('air'); r.events.emit('blockUpdate', occupied, air);
    } else if (change === 'unload') r.events.emit('chunkColumnUnload', new Vec3(0, 0, 0));
    else r.events.emit('spawn');
    expect(armTemporaryScaffoldPlacement(r.bot, r.at())).toBe(0);
    recordTemporaryScaffold(r.bot, proof, r.seed('oak_planks'));
    expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
  });

  it('rechecks the air state at arming even when no blockUpdate was delivered', () => {
    const r = rig(); const proof = prepareTemporaryScaffoldPlacement(r.bot, r.seed('air'));
    r.seed('oak_planks');
    expect(armTemporaryScaffoldPlacement(r.bot, r.at())).toBe(0);
    recordTemporaryScaffold(r.bot, proof, r.bot.blockAt(r.at())!);
    expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
  });

  it('rejects an observed occupied-to-air update even if the cell ends with its original air state', () => {
    const r = rig(); const before = r.seed('air');
    const proof = prepareTemporaryScaffoldPlacement(r.bot, before);
    const occupied = r.seed('oak_planks'); const air = r.seed('air');
    r.events.emit('blockUpdate', occupied, air);
    expect(armTemporaryScaffoldPlacement(r.bot, r.at())).toBe(0);
    recordTemporaryScaffold(r.bot, proof, r.seed('oak_planks'));
    expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
  });

  it('arms all overlapping same-cell proofs and accepts its own first confirmed update only once', () => {
    const r = rig(); const scope = beginTemporaryScaffold(r.bot); const before = r.seed('air');
    const outer = prepareTemporaryScaffoldPlacement(r.bot, before);
    const inner = prepareTemporaryScaffoldPlacement(r.bot, before);
    expect(armTemporaryScaffoldPlacement(r.bot, r.at(), 'oak_planks')).toBe(2);
    const placed = r.seed('oak_planks'); r.events.emit('blockUpdate', before, placed);
    recordTemporaryScaffold(r.bot, inner, placed); recordTemporaryScaffold(r.bot, outer, placed);
    expect(scope.records).toHaveLength(1); expect(pendingTemporaryScaffolds(r.bot)).toHaveLength(1);
  });

  it('rejects a same-material replacement after the first send update but before record', () => {
    const r = rig(); const before = r.seed('air');
    const proof = prepareTemporaryScaffoldPlacement(r.bot, before);
    armTemporaryScaffoldPlacement(r.bot, r.at(), 'oak_planks');
    const placed = r.seed('oak_planks'); r.events.emit('blockUpdate', before, placed);
    const air = r.seed('air'); r.events.emit('blockUpdate', placed, air);
    const replacement = r.seed('oak_planks'); r.events.emit('blockUpdate', air, replacement);
    recordTemporaryScaffold(r.bot, proof, replacement);
    expect(pendingTemporaryScaffolds(r.bot)).toEqual([]);
  });

  it.each(['none', 'protect', 'look', 'unload'])('uses the real native placement send boundary (%s)', async (change) => {
    const r = rig(); let sends = 0; let looks = 0;
    const client = Object.assign(new EventEmitter(), { write: (name: string) => {
      if (name !== 'block_place') return;
      sends++;
      const before = r.bot.blockAt(r.at()); const after = r.seed('oak_planks');
      r.events.emit('blockUpdate', before, after);
    } });
    const occupy = () => {
      const before = r.bot.blockAt(r.at()); const after = r.seed('oak_planks');
      r.events.emit('blockUpdate', before, after);
    };
    Object.assign(r.bot, { _client: client,
      heldItem: { name: 'oak_planks', count: 4, type: registry.itemsByName.oak_planks.id },
      craft: async () => {}, placeBlock: async () => {}, _updateBlockState: () => {},
      supportFeature: (name: string) => name === 'blockPlaceHasInsideBlock', swingArm: () => {},
      lookAt: async () => { looks++; await Promise.resolve(); if (change === 'look') occupy(); },
      cortiProtectCheck: async () => {
        await Promise.resolve();
        if (change === 'protect') occupy();
        else if (change === 'unload') r.events.emit('chunkColumnUnload', new Vec3(0, 0, 0));
        return { status: 'allow_likely', reason: 'test' };
      },
      pathfinder: { isBuilding: () => true, setGoal: () => {} },
    });
    // Keep Mineflayer's actual lookAt → swingArm → block_place implementation.
    require('mineflayer/lib/plugins/generic_place.js')(r.bot);
    const log = { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} };
    installMineflayerFixes(r.bot, log as never);
    const scope = beginTemporaryScaffold(r.bot);
    await r.bot.placeBlock(r.seed('stone', r.at(2, 63)), new Vec3(0, 1, 0));
    expect(sends).toBe(1); expect(looks).toBe(1);
    expect(scope.records).toHaveLength(change === 'none' ? 1 : 0);
    expect(pendingTemporaryScaffolds(r.bot)).toHaveLength(change === 'none' ? 1 : 0);
  });
});
