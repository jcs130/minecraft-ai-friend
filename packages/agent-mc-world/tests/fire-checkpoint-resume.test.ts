import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Reflexes } from '../core/executor.ts';
import { goalOwnerOf } from '../core/travel.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.useRealTimers());

it.each([false, true])('wakes a checkpoint meal after burning recovery (external hold: %s)', async externalHold => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T07:11:00Z'));
  const h = methodHarness('1.21.1');
  const bot = h.bot as unknown as Bot;
  const water = new Vec3(4, 64, 0);
  const bread = { name: 'bread', count: 2, type: h.bot.registry.itemsByName.bread.id, slot: 36 };
  const metadata = [1];
  const consume = vi.fn(async () => { bread.count--; h.bot.food += 5; });
  Object.assign(h.bot, { isAlive: true, physicsEnabled: false, food: 5,
    findBlocks: () => [water], lookAt: vi.fn(async () => {}), consume,
    equip: vi.fn(async () => { h.bot.heldItem = bread as never; }) });
  Object.assign(h.bot.entity, { metadata });
  h.bot.inventory.items = () => bread.count ? [bread] : [];
  h.set(0, 64, 0, 'lava');
  h.set(water.x, water.y, water.z, 'water');
  const reflex = new Reflexes({
    getBot: () => bot, report: () => {}, log: h.host.log,
    preempt: why => h.exec.preempt(why), pauseEnvironment: why => h.exec.pauseForEnvironment(why),
    resumeEnvironment: token => h.exec.resumeAfterEnvironment(token),
    onBurningRecovered: body => h.exec.wakeCheckpointQueue(body),
    stopFallTask: why => h.exec.stopCurrent(why), resumeAfterFall: token => h.exec.resumeQueue(token),
    fightBack: () => false, fleeHealth: () => 6, reactCooldownSec: () => 10,
    antiDrown: () => false, antiLava: () => true,
  });
  reflex.start();
  try {
    await vi.advanceTimersByTimeAsync(400);
    expect(h.exec.status().hold).toBeTruthy();
    h.bot.entity.position = new Vec3(2.5, 64, 0.5);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(h.exec.status().hold).toBeFalsy();
    expect(goalOwnerOf(bot)).toMatchObject({ kind: 'escape', intent: '着火找水' });

    const receipt = h.exec.submitDetailed([{ skill: 'eat', item: 'bread' }], 'afterCheckpoint');
    expect(receipt.accepted).toBe(true);
    const taskId = h.exec.status().waiting[0]?.id;
    expect(taskId).toBeDefined();
    expect(h.exec.status().running).toBeNull();
    const hold = externalHold ? h.exec.pauseForExternal('separate body lease') : undefined;

    metadata[0] = 0;
    await vi.advanceTimersByTimeAsync(200);
    expect(goalOwnerOf(bot)).toBeNull();
    if (hold) {
      expect(h.exec.status().hold).toBe('separate body lease');
      expect(h.exec.status().waiting[0]?.id).toBe(taskId);
      expect(h.exec.status().running).toBeNull();
      expect(consume).not.toHaveBeenCalled();
      h.exec.resumeAfterExternal(hold);
    }
    expect(h.exec.status().running?.id).toBe(taskId);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(h.bot.food).toBe(10);
    expect(h.exec.status().waiting).toHaveLength(0);
  } finally {
    reflex.stop();
    h.close();
  }
});

it('waits for a later overlapping bucket cleanup before waking the same body', async () => {
  vi.useFakeTimers();
  const h = methodHarness('1.21.1');
  const bot = h.bot as unknown as Bot;
  const woke = vi.fn();
  const reflex = new Reflexes({
    getBot: () => bot, report: () => {}, log: h.host.log, preempt: () => {},
    pauseEnvironment: () => null, resumeEnvironment: () => ({ released: false, note: null }),
    onBurningRecovered: woke, stopFallTask: () => null, resumeAfterFall: () => false,
    fightBack: () => false, fleeHealth: () => 6, reactCooldownSec: () => 10,
    antiDrown: () => false, antiLava: () => true,
  });
  const internals = reflex as unknown as {
    endBurning(body: Bot, state: { pour: 'poured'; water: Vec3 }): void;
    scoopBack(body: Bot, water: Vec3): Promise<void>;
  };
  let first!: () => void, second!: () => void;
  vi.spyOn(internals, 'scoopBack')
    .mockImplementationOnce(() => new Promise<void>(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { second = resolve; }));
  reflex.start();
  try {
    internals.endBurning(bot, { pour: 'poured', water: new Vec3(1, 64, 0) });
    internals.endBurning(bot, { pour: 'poured', water: new Vec3(2, 64, 0) });
    first();
    await vi.advanceTimersByTimeAsync(0);
    expect(woke).not.toHaveBeenCalled();
    second();
    await vi.advanceTimersByTimeAsync(0);
    expect(woke).toHaveBeenCalledTimes(1);
    expect(woke).toHaveBeenCalledWith(bot);
  } finally {
    reflex.stop();
    h.close();
  }
});
