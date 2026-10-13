import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { planTossThrow, skillToss, TOSS_PITCH } from '../core/skills-container.ts';
const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.20.6');
const ctx = { aborted: () => false } as any;
afterEach(() => vi.useRealTimers());
function rig(blocked = false) {
  let count = 32;
  const bot: any = Object.assign(new EventEmitter(), { registry, entities: {},
    entity: { id: 1, position: new Vec3(.5, 64, .5), yaw: 0, pitch: 0, eyeHeight: 1.62 },
    inventory: { items: () => count ? [{ name: 'cobblestone', count, type: registry.itemsByName.cobblestone.id, metadata: 0 }] : [] },
    blockAt: () => ({ name: blocked ? 'stone' : 'air', boundingBox: blocked ? 'block' : 'empty', shapes: blocked ? [[0,0,0,1,1,1]] : [] }),
    look: vi.fn(async () => {}), lookAt: vi.fn(async () => {}), toss: vi.fn(async (_t, _m, n) => { count -= n; }),
  });
  return { bot, count: (n: number) => { count = n; } };
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
    await vi.advanceTimersByTimeAsync(2001); await checked;
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
    await vi.advanceTimersByTimeAsync(4001);
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
    await vi.advanceTimersByTimeAsync(1);
    const drop = { id: 3, name: 'item', position: new Vec3(.5,65,-.5), getDroppedItem: () => ({ name: 'cobblestone', count: 2 }) };
    bot.emit('entitySpawn', drop); bot.emit('playerCollect', friend, drop);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await task).toContain('本次交付数量未确认');
  });
});
