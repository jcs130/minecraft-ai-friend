import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { planTossThrow, skillToss, skillPickup, isRecentDiscard, reacquiredTossNote, protectedTossItem, TOSS_PITCH } from '../core/skills-container.ts';
const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.20.6');
const ctx = { aborted: () => false } as any;
const clocks: ReturnType<typeof setInterval>[] = [];
afterEach(() => { for (const timer of clocks.splice(0)) clearInterval(timer); vi.useRealTimers(); });
function rig(blocked = false) {
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
  it('uses positive Mineflayer pitch and refuses a measured enclosed scene without dropping', async () => {
    expect(TOSS_PITCH).toBeGreaterThan(0); expect(planTossThrow(rig().bot)?.pitch).toBe(TOSS_PITCH);
    const { bot } = rig(true);
    await expect(skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 32 }, ctx)).rejects.toThrow('尚未抛出');
    expect(bot.toss).not.toHaveBeenCalled();
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
  it('does not toss toward unknown/occluded players or its own feet', async () => {
    const { bot } = rig();
    await expect(skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8, target: 'Friend' }, ctx)).rejects.toThrow('看不见');
    await expect(skillToss(bot, { skill: 'toss', item: 'cobblestone', count: 8, at: [0,64,0] }, ctx)).rejects.toThrow('不足2格');
    expect(bot.toss).not.toHaveBeenCalled();
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
  it('allows a caller to discard a named full stack through its selected slot', async () => {
    vi.useFakeTimers(); const { bot } = rig();
    const keep = { name: 'cobblestone', customName: 'Retained variant', count: 1, type: registry.itemsByName.cobblestone.id, metadata: 0, slot: 9 };
    const discard = { ...keep, customName: 'Discarded variant', slot: 10 };
    let stock = [keep, discard];
    bot.inventory.items = () => stock;
    bot.tossStack = async stack => { stock = stock.filter(candidate => candidate !== stack); };
    expect(protectedTossItem(bot, 'cobblestone', 'Discarded variant', 1)).toBeNull();
    const task = skillToss(bot, { skill: 'toss', item: 'cobblestone', pick: 'Discarded variant', count: 1 }, ctx);
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
