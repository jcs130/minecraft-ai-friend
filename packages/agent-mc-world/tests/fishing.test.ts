import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOwnedFishing, ownedFishingBobber, lastFishingReel, FISH_LOOT_WAIT_MS } from '../core/fishing.ts';
import { confirmFishingLoot } from '../core/fishing-loot.ts';
import { skillFish } from '../core/skills-gather.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = require('prismarine-registry')('1.20.6');
const ctx = { aborted: () => false } as any;
const clocks: ReturnType<typeof setInterval>[] = [];
afterEach(() => { for (const clock of clocks.splice(0)) clearInterval(clock); vi.useRealTimers(); });

function rig(acknowledgeReel = true) {
  const bag = new Map<string, number>([['fishing_rod', 1]]);
  const client = new EventEmitter();
  let uses = 0, onReel = () => {};
  const bot: any = Object.assign(new EventEmitter(), {
    registry, _client: client, entities: {}, heldItem: { name: 'fishing_rod' },
    entity: { id: 1, position: new Vec3(.5, 64, .5), eyeHeight: 1.62, onGround: true, yaw: 0, pitch: 0 },
    inventory: { items: () => [...bag].filter(([, count]) => count > 0).map(([name, count]) => ({
      name, count, type: registry.itemsByName[name]?.id ?? 0, metadata: 0,
    })) },
    equip: vi.fn(async () => {}), look: vi.fn(async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; }),
    blockAt(p: Vec3) {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      const name = y <= 63 ? (x >= 2 && y >= 62 ? 'water' : 'stone') : 'air';
      return { name, boundingBox: name === 'stone' ? 'block' : 'empty', position: p.floored(),
        getProperties: () => ({ level: 0 }) };
    },
    activateItem() {
      uses++;
      bot.sentPitchAtUse = bot.sentPitch;
      if (uses === 1) spawnHook(10, 1);
      else {
        onReel();
        if (acknowledgeReel) { delete bot.entities[10]; client.emit('entity_destroy', { entityIds: [10] }); }
      }
    },
  });
  function spawnHook(id: number, owner: number, x = 3.5) {
    bot.entities[id] = { id, name: 'fishing_bobber', position: new Vec3(x, 63.8, .5) };
    client.emit('spawn_entity', { entityId: id,
      type: registry.entitiesByName.fishing_bobber.internalId ?? registry.entitiesByName.fishing_bobber.id, objectData: owner });
    bot.emit('entitySpawn', bot.entities[id]);
  }
  function bite(x = 3.5) {
    client.emit('world_particles', { particle: { type: 'fishing' }, amount: 6, x, y: 63.8, z: .5 });
  }
  function drop(id = 20, name: string | null = 'cod') {
    const entity: any = { id, name: 'item', position: new Vec3(3.5, 63.8, .5),
      stack: name ? { name, count: 1 } : null, getDroppedItem() { return this.stack; } };
    bot.entities[id] = entity; bot.emit('entitySpawn', entity); return entity;
  }
  function collect(entity: any, who = bot.entity) {
    bot.emit('playerCollect', who, entity); delete bot.entities[entity.id];
  }
  installOwnedFishing(bot);
  const clock = setInterval(() => { bot.emit('physicsTick'); bot.sentPitch = bot.entity.pitch; }, 50);
  clocks.push(clock);
  return { bot, bag, client, bite, drop, collect, spawnHook, clock, uses: () => uses, onReel: (fn: () => void) => { onReel = fn; } };
}

describe('owned fishing and observable harvest', () => {
  it('ignores other players hooks and particles, and releases connection listeners on end', async () => {
    const r = rig(); const cast = r.bot.fish();
    r.spawnHook(11, 2, 8); r.bite(8);
    expect(ownedFishingBobber(r.bot)?.id).toBe(10); expect(r.uses()).toBe(1);
    r.bite(); await cast; expect(r.uses()).toBe(2);
    r.bot.emit('end');
    for (const event of ['entitySpawn', 'entityUpdate', 'playerCollect', 'end']) expect(r.bot.listenerCount(event)).toBe(0);
    for (const event of ['spawn_entity', 'world_particles', 'entity_destroy']) expect(r.client.listenerCount(event)).toBe(0);
  });

  it('waits for delayed pickup and uses the inventory at reel time, excluding gifts during the cast', async () => {
    vi.useFakeTimers(); const r = rig();
    const task = skillFish(r.bot, { skill: 'fish', at: [3, 63, 0] }, ctx);
    await vi.advanceTimersByTimeAsync(100);
    expect(r.bot.sentPitchAtUse).toBe(r.bot.entity.pitch);
    r.bag.set('cod', 2); // Unrelated items received during a long cast.
    r.onReel(() => { const item = r.drop(); setTimeout(() => { r.collect(item); r.bag.set('cod', 3); }, 2_400); });
    r.bite(); let done = false; void task.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1_500); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await task).toContain('生鳕鱼×1'); expect(await task).not.toContain('生鳕鱼×3');
  });

  it('does not count an unrelated gain before reel as a catch', async () => {
    vi.useFakeTimers(); const r = rig(); const cast = r.bot.fish(); r.bag.set('cod', 1); r.bite(); await cast;
    const checked = expect(confirmFishingLoot(r.bot, ctx)).rejects.toMatchObject({ code: 'fishing-loot-unconfirmed' });
    await vi.advanceTimersByTimeAsync(FISH_LOOT_WAIT_MS); await checked;
  });

  it('does not count another collector even if the player gains the same item independently', async () => {
    vi.useFakeTimers(); const r = rig(); const cast = r.bot.fish();
    r.onReel(() => { const item = r.drop(); r.collect(item, { id: 2 }); r.bag.set('cod', 1); });
    r.bite(); await cast;
    const checked = expect(confirmFishingLoot(r.bot, ctx)).rejects.toMatchObject({ scene: expect.arrayContaining([expect.stringContaining('实体#2拾取')]) });
    await vi.advanceTimersByTimeAsync(FISH_LOOT_WAIT_MS); await checked;
  });

  it('does not associate a pre-existing drop with this reel', async () => {
    vi.useFakeTimers(); const r = rig(); const cast = r.bot.fish(); const existing = r.drop();
    r.onReel(() => { r.collect(existing); r.bag.set('cod', 1); }); r.bite(); await cast;
    expect(lastFishingReel(r.bot)?.drops.size).toBe(0);
    const checked = expect(confirmFishingLoot(r.bot, ctx)).rejects.toMatchObject({ code: 'fishing-loot-unconfirmed' });
    await vi.advanceTimersByTimeAsync(FISH_LOOT_WAIT_MS); await checked;
  });

  it('requires inventory gain to remain stable, even after an observed pickup', async () => {
    vi.useFakeTimers(); const r = rig(); const cast = r.bot.fish();
    r.onReel(() => { const item = r.drop(); r.collect(item); r.bag.set('cod', 1); setTimeout(() => r.bag.delete('cod'), 200); });
    r.bite(); await cast;
    const checked = expect(confirmFishingLoot(r.bot, ctx)).rejects.toMatchObject({ code: 'fishing-loot-unconfirmed' });
    await vi.advanceTimersByTimeAsync(FISH_LOOT_WAIT_MS); await checked;
  });

  it('accepts late item metadata without guessing unknown drops or requiring a fixed 1.5 second delay', async () => {
    vi.useFakeTimers(); const r = rig(); const cast = r.bot.fish();
    r.onReel(() => { const item = r.drop(20, null); setTimeout(() => {
      item.stack = { name: 'salmon', count: 1 }; r.bot.emit('entityUpdate', item); r.collect(item); r.bag.set('salmon', 1);
    }, 2_000); });
    r.bite(); await cast; const task = confirmFishingLoot(r.bot, ctx);
    await vi.advanceTimersByTimeAsync(2_400); expect(await task).toContain('生鲑鱼×1');
  });

  it('reports a stranded drop, hook position and high bank instead of an unknown generic failure', async () => {
    vi.useFakeTimers(); const r = rig(); r.bot.entity.position.y = 69;
    const cast = r.bot.fish(); r.onReel(() => r.drop()); r.bite(); await cast;
    const task = confirmFishingLoot(r.bot, ctx).catch((e: any) => e);
    await vi.advanceTimersByTimeAsync(FISH_LOOT_WAIT_MS); const error = await task;
    expect(error.code).toBe('fishing-loot-unconfirmed');
    expect(error.scene.join('\n')).toContain('本人脚下比收线点高5.2格');
    expect(error.scene.join('\n')).toContain('新掉落物#20'); expect(error.scene.join('\n')).toContain('仍可见');
  });

  it('cancels during loot observation without activating the rod again', async () => {
    vi.useFakeTimers(); const r = rig(); const cast = r.bot.fish(); r.bite(); await cast; let aborted = false;
    const checked = expect(confirmFishingLoot(r.bot, { aborted: () => aborted } as any)).rejects.toThrow();
    aborted = true; await vi.advanceTimersByTimeAsync(100); await checked; expect(r.uses()).toBe(2);
  });

  it('ends an unacknowledged manual reel within a bounded time and never recasts', async () => {
    vi.useFakeTimers(); const r = rig(false);
    const checked = expect(skillFish(r.bot, { skill: 'fish', at: [3, 63, 0] }, ctx)).rejects.toMatchObject({ code: 'fishing-reel-unconfirmed' });
    await vi.advanceTimersByTimeAsync(47_000); await checked;
    expect(r.uses()).toBe(2); expect(ownedFishingBobber(r.bot)).toBeNull();
  });

  it('does not use a different held item when a bite arrives after a hand change', async () => {
    const r = rig(); const checked = expect(r.bot.fish()).rejects.toThrow('hand changed');
    r.bot.heldItem = { name: 'cooked_beef' }; r.bite(); await checked; expect(r.uses()).toBe(1);
  });

  it('does not cast before a rotation tick and leaves no listener behind when physics stops', async () => {
    vi.useFakeTimers(); const r = rig(); clearInterval(r.clock);
    const checked = expect(skillFish(r.bot, { skill: 'fish', at: [3, 63, 0] }, ctx)).rejects.toThrow('尚未抛竿');
    await vi.advanceTimersByTimeAsync(1_100); await checked;
    expect(r.uses()).toBe(0); expect(r.bot.listenerCount('physicsTick')).toBe(0);
  });
});
