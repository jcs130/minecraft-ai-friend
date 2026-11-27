import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { precheckStep } from '../core/precheck.ts';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { planTossThrow, skillToss, skillPickup, isRecentDiscard, reacquiredTossNote, protectedTossItem, TOSS_PITCH } from '../core/skills-container.ts';
const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.20.6');
const ctx = { aborted: () => false } as any;
const clocks: ReturnType<typeof setInterval>[] = [];
afterEach(() => { for (const timer of clocks.splice(0)) clearInterval(timer); vi.useRealTimers(); });
function rig(blocked = false, version = '1.20.6') {
  const registry = req('prismarine-registry')(version);
  let count = 32;
  const bot: any = Object.assign(new EventEmitter(), { registry, entities: {},
    entity: { id: 1, position: new Vec3(.5, 64, .5), yaw: 0, pitch: 0, eyeHeight: 1.62 },
    inventory: { items: () => count ? [{ name: 'cobblestone', count, type: registry.itemsByName.cobblestone.id, metadata: 0 }] : [] },
    blockAt: () => ({ name: blocked ? 'stone' : 'air', boundingBox: blocked ? 'block' : 'empty', shapes: blocked ? [[0,0,0,1,1,1]] : [] }),
    look: vi.fn(async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; }),
    lookAt: vi.fn(async () => {}), toss: vi.fn(async (_t, _m, n) => { count -= n; }),
  });
  const clock = setInterval(() => { bot.emit('physicsTick'); bot.sentYaw = bot.entity.yaw; bot.sentPitch = bot.entity.pitch; }, 50);
  clocks.push(clock);
  return { bot, clock, count: (n: number) => { count = n; } };
}
describe('toss receipt and aim', () => {
  it.each(['clear','ledge','fire','busy','cancel'])('owns only its bounded retreat after the drop on %s', async scene => {
    vi.useFakeTimers();
    const { bot } = rig(false, '1.21.11');
    bot.entity.onGround = true;
    bot.controlState = { forward: scene === 'busy', back: false };
    bot.setControlState = vi.fn((key, state) => { bot.controlState[key] = state; });
    const air = {name:'air', boundingBox:'empty', shapes:[]};
    const ground = {name:'stone', boundingBox:'block', shapes:[[0,0,0,1,1,1]]};
    bot.blockAt = (p: Vec3) => {
      if (scene === 'fire' && p.z >= 1 && p.y === 64) return {...air,name:'fire'};
      if (p.y !== 63 || (scene === 'ledge' && p.z >= 1)) return air;
      return ground;
    };
    bot.on('physicsTick', () => { if (bot.controlState.back) bot.entity.position.z += .18; });
    let cancelled = false;
    const result = skillToss(bot,{skill:'toss',item:'cobblestone',count:1},{aborted:()=>cancelled} as any);
    const finished = scene === 'cancel' ? expect(result).rejects.toThrow() :
      expect(result).resolves.toContain(scene === 'clear' ? '实测后退' : '未确认后退');
    await vi.advanceTimersByTimeAsync(150);
    if (scene === 'cancel') cancelled = true;
    await vi.advanceTimersByTimeAsync(4000);
    await finished;
    expect(bot.toss).toHaveBeenCalledTimes(1);
    expect(bot.controlState.back).toBe(false);
    expect(bot.controlState.forward).toBe(scene === 'busy');
    if (scene === 'clear') expect(bot.entity.position.z - .5).toBeGreaterThanOrEqual(2);
    if (['ledge','fire','busy'].includes(scene)) expect(bot.setControlState).not.toHaveBeenCalled();
  });
  it.each([
    { query: 'Worn blade', names: ['Worn blade', 'Spare blade'], suggest: true },
    { query: 'Worn blade', names: ['Worn blade', 'Worn blade'], suggest: false },
    { query: 'Worn blade', names: ['Worn blade', 'Worn blade II'], suggest: false },
    { query: 'Missing blade', names: ['Worn blade', 'Spare blade'], suggest: false },
    { query: 'Worn blade', names: ['Worn blade', 'Spare blade'], pick: 'Spare blade', suggest: false },
  ])('offers a slot read for $query and suggests only an equivalent unique action selector: $names', async row => {
    const { bot } = rig(false, '1.21.1');
    const stock = row.names.map((customName, i) => ({
      name: 'iron_sword', customName, type: bot.registry.itemsByName.iron_sword.id, count: 1, metadata: 0, slot: 9 + i,
    }));
    bot.inventory.items = () => stock;
    bot.tossStack = vi.fn();
    const err = await skillToss(bot, { skill: 'toss', item: row.query, pick: row.pick, count: 1 }, ctx)
      .then(() => { throw Error('expected toss to reject'); }, (error: Error) => error);
    expect(err.message).toContain('mc_bag ' + JSON.stringify({ detail: 'slots', item: row.query }));
    expect(err.message.includes('"pick":')).toBe(row.suggest);
    if (row.suggest) expect(err.message).toContain(JSON.stringify({ item: 'iron_sword', pick: row.query }));
    expect(precheckStep(bot, { skill: 'toss', item: row.query, pick: row.pick, count: 1 }, {} as never))
      .toMatchObject({ text: err.message, rule: 'toss.noStock' });
    expect(bot.look).not.toHaveBeenCalled();
    expect(bot.toss).not.toHaveBeenCalled();
    expect(bot.tossStack).not.toHaveBeenCalled();
  });
  it('recognizes the same 1.21.1 wire item ID during named pickup and does not claim inventory gain', async () => {
    vi.useFakeTimers();
    const { bot } = rig(false, '1.21.1');
    bot.entities[3] = { id: 3, name: 'item', position: new Vec3(.5,64,.5),
      metadata: [{ itemId: bot.registry.itemsByName.cobblestone.id, itemCount: 2 }] };
    const checked = expect(skillPickup(bot, ctx, 'cobblestone')).rejects.toThrow('一样都没进包');
    await vi.advanceTimersByTimeAsync(1000);
    await checked;
  });
  it.each(['1.21.1', '1.20.6'])('uses positive pitch but permits deliberate discard in an enclosed %s scene', async version => {
    vi.useFakeTimers();
    expect(TOSS_PITCH).toBeGreaterThan(0); expect(planTossThrow(rig().bot)?.pitch).toBe(TOSS_PITCH);
    const { bot } = rig(true, version);
    expect(planTossThrow(bot)).toBeNull();
    const result = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 32 }, ctx);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await result).toContain('净少32');
    expect(await result).toContain('当前朝向');
    expect(bot.toss).toHaveBeenCalledOnce();
    expect(bot.look).not.toHaveBeenCalled();
  });
  it('does not report a transient inventory decrease as success', async () => {
    vi.useFakeTimers(); const r = rig();
    const task = skillToss(r.bot, { skill: 'toss', item: 'cobblestone', count: 32 }, ctx);
    const checked = expect(task).rejects.toThrow('没有净减少');
    await vi.advanceTimersByTimeAsync(2000); r.count(32);
    await vi.advanceTimersByTimeAsync(2100); await checked;
    expect(reacquiredTossNote(r.bot, 'cobblestone')).toContain('又回到背包');
    expect(r.bot.listenerCount('playerCollect')).toBe(0);
  });
  it('does not toss toward unknown/occluded players', async () => {
    const { bot } = rig();
    await expect(skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8, target: 'Friend' }, ctx)).rejects.toThrow('看不见');
    expect(bot.toss).not.toHaveBeenCalled();
  });
  it.each(['1.21.1', '1.20.6'])('allows a nearby discard point without claiming an exact landing (%s)', async version => {
    vi.useFakeTimers(); const { bot } = rig(false, version);
    const result = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8, at: [0,64,0] }, ctx);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await result).toContain('净少8');
    expect(await result).toContain('落点未核验');
    expect(bot.toss).toHaveBeenCalledOnce();
  });
  it.each(['1.21.1', '1.20.6'])('uses the best direction even if the %s corridor is shorter than four blocks', async version => {
    vi.useFakeTimers(); const { bot } = rig(false, version);
    bot.blockAt = p => {
      const air = p.y < 66 && p.x >= 0 && p.x < 1 && p.z >= -2 && p.z <= 0;
      return { name: air ? 'air' : 'stone', boundingBox: air ? 'empty' : 'block' };
    };
    const plan = planTossThrow(bot);
    expect(plan?.distance).toBeGreaterThan(0);
    expect(plan!.distance).toBeLessThan(4);
    const result = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8 }, ctx);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await result).toContain('净少8');
    expect(bot.look).toHaveBeenCalledWith(plan!.yaw, plan!.pitch, true);
  });
  it.each(['1.21.1', '1.20.6'])('labels unknown clearance without refusing caller-selected discard (%s)', async version => {
    vi.useFakeTimers(); const { bot } = rig(false, version); bot.blockAt = () => null;
    const result = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8 }, ctx);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await result).toContain('抛物空间未确认');
    expect(await result).toContain('净少8');
    expect(bot.toss).toHaveBeenCalledOnce();
  });
  it('requires a matching recipient pickup event, not just inventory loss', async () => {
    vi.useFakeTimers(); const { bot } = rig();
    bot.entities[2] = { id: 2, username: 'Friend', height: 1.8, position: new Vec3(.5,64,-2.5) };
    const task = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8, target: 'Friend' }, ctx);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await task).toContain('领取未确认'); expect(bot.lookAt).toHaveBeenCalledWith(new Vec3(.5,65.2,-2.5), true);
    expect(bot.listenerCount('entitySpawn')).toBe(0);
  });
  it('rechecks visibility/range after turning, before any non-idempotent throw', async () => {
    const { bot } = rig();
    bot.entities[2] = { id: 2, username: 'Friend', height: 1.8, position: new Vec3(.5,64,-2.5) };
    bot.lookAt = async () => { bot.entities[2].position.z = -20; };
    await expect(skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8, target: 'Friend' }, ctx)).rejects.toThrow('已移动');
    expect(bot.toss).not.toHaveBeenCalled(); expect(bot.listenerCount('playerCollect')).toBe(0);
  });
  it('does not infer exact delivery ownership or quantity from a nearby matching drop', async () => {
    vi.useFakeTimers(); const { bot } = rig();
    const friend = bot.entities[2] = { id: 2, username: 'Friend', height: 1.8, position: new Vec3(.5,64,-2.5) };
    const task = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8, target: 'Friend' }, ctx);
    await vi.advanceTimersByTimeAsync(51);
    const drop = { id: 3, name: 'item', position: new Vec3(.5,65,-.5), getDroppedItem: () => ({ name: 'cobblestone', count: 2 }) };
    bot.emit('entitySpawn', drop); bot.emit('playerCollect', friend, drop);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await task).toContain('本次交付数量未确认');
  });
  it('sends the aimed rotation before the inventory drop, even though forced look already resolved', async () => {
    vi.useFakeTimers(); const { bot } = rig(); let atDrop: number | undefined;
    bot.toss.mockImplementation(async () => { atDrop = bot.sentPitch; });
    const result = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8 }, ctx);
    const checked = expect(result).rejects.toThrow('没扔出去');
    await vi.advanceTimersByTimeAsync(49);
    expect(bot.toss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await checked;
    expect(atDrop).toBe(TOSS_PITCH);
    expect(bot.listenerCount('physicsTick')).toBe(0);
  });
  it('fails closed if physics never sends the aim and releases listeners on cancellation', async () => {
    vi.useFakeTimers(); const r = rig(); clearInterval(r.clock);
    let aborted = false;
    const result = skillToss(r.bot, { skill: 'toss', item: 'cobblestone', count: 8 }, { aborted: () => aborted } as any);
    const checked = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20); aborted = true;
    await vi.advanceTimersByTimeAsync(50); await checked;
    expect(r.bot.toss).not.toHaveBeenCalled(); expect(r.bot.listenerCount('physicsTick')).toBe(0);
    expect(r.bot.listenerCount('entityUpdate')).toBe(0);
  });
  it('remembers late drop metadata across calls without confusing reused entity ids', async () => {
    vi.useFakeTimers(); const { bot } = rig();
    const task = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8 }, ctx);
    await vi.advanceTimersByTimeAsync(51);
    const drop: any = { id: 3, name: 'item', position: new Vec3(.5,65,-.5), getDroppedItem: () => null };
    bot.entities[3] = drop; bot.emit('entitySpawn', drop);
    drop.getDroppedItem = () => ({ name: 'cobblestone', count: 8 }); bot.emit('entityUpdate', drop);
    await vi.advanceTimersByTimeAsync(4000); await task;
    expect(isRecentDiscard(bot, drop)).toBe(true);
    expect(isRecentDiscard(bot, { ...drop })).toBe(false);
    const sweep = skillPickup(bot, ctx); const checked = expect(sweep).rejects.toThrow('附近没有');
    await vi.advanceTimersByTimeAsync(501); await checked;
    await vi.advanceTimersByTimeAsync(120000); expect(isRecentDiscard(bot, drop)).toBe(false);
  });
  it('keeps an explicitly aimed discard out of the generic pickup sweep', async () => {
    vi.useFakeTimers(); const { bot } = rig();
    const task = skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8, at: [4, 64, 0] }, ctx);
    await vi.advanceTimersByTimeAsync(51);
    const drop: any = { id: 3, name: 'item', position: new Vec3(.5,65,-.5), getDroppedItem: () => ({ name: 'cobblestone', count: 8 }) };
    bot.entities[3] = drop; bot.emit('entitySpawn', drop);
    await vi.advanceTimersByTimeAsync(4000); await task;
    expect(isRecentDiscard(bot, drop)).toBe(true);
    const checked = expect(skillPickup(bot, ctx)).rejects.toThrow('附近没有');
    await vi.advanceTimersByTimeAsync(501); await checked;
  });
  it('checks the first fractional metre instead of skipping a nearby wall', () => {
    const { bot } = rig(); bot.entity.position = new Vec3(.05,64,.05);
    const walls = new Set(['0,-1', '-1,0', '-1,-1']);
    bot.blockAt = p => ({ name: walls.has(`${Math.floor(p.x)},${Math.floor(p.z)}`) ? 'stone' : 'air',
      boundingBox: walls.has(`${Math.floor(p.x)},${Math.floor(p.z)}`) ? 'block' : 'empty' });
    const plan = planTossThrow(bot)!;
    expect(plan).not.toBeNull(); expect(Math.sin(plan.yaw)).toBeLessThan(0);
    expect(Math.cos(plan.yaw)).toBeLessThan(0);
  });
  it.each(['cobblestone', 'iron_sword'])('discards the named %s through only its selected slot', async name => {
    vi.useFakeTimers(); const { bot } = rig(false, '1.21.1');
    const keep = { name, customName: 'Retained variant', count: 1, type: bot.registry.itemsByName[name].id, metadata: 0, slot: 9 };
    const discard = { ...keep, customName: 'Discarded variant', slot: 10 };
    let stock = [keep, discard];
    bot.inventory.items = () => stock;
    bot.tossStack = async stack => { stock = stock.filter(candidate => candidate !== stack); };
    expect(protectedTossItem(bot, name, 'Discarded variant', 1)).toBeNull();
    const task = skillToss(bot, { skill: 'toss', item: name, pick: 'Discarded variant', count: 1 }, ctx);
    const checked = expect(task).resolves.toContain('净少1');
    await vi.advanceTimersByTimeAsync(4100);
    await checked;
    expect(stock).toEqual([keep]);
  });
  it('still rejects ambiguous partial variant selection before changing inventory', async () => {
    const { bot } = rig();
    const a = { name: 'cobblestone', customName: 'A', count: 8, type: registry.itemsByName.cobblestone.id, metadata: 0, slot: 9 };
    const b = { ...a, customName: 'B', slot: 10 };
    bot.inventory.items = () => [a, b];bot.tossStack = async () => {};
    await expect(skillToss(bot, { skill: 'toss', item: 'cobblestone', pick: 'A', count: 1 }, ctx)).rejects.toThrow('槽位变体');
    expect(bot.inventory.items()).toEqual([a, b]);
  });
  it('allows partial discard when the caller accepts all same-type stacks, regardless of names', () => {
    const { bot } = rig();
    const a = { name: 'cobblestone', customName: 'A', count: 8, type: registry.itemsByName.cobblestone.id, metadata: 0, slot: 9 };
    bot.inventory.items = () => [a, { ...a, customName: 'B', slot: 10 }];
    expect(protectedTossItem(bot, 'cobblestone', undefined, 1)).toBeNull();
  });
});
