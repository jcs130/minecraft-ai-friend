import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { BowController, selectRangedWeapon } from '../core/ranged.ts';

const itemIds = { bow: 1, crossbow: 2, trident: 3, arrow: 4 };
const arrowEntityId = 100;
const tridentEntityId = 101;
const bodyEntityId = 9;

function item(name: keyof typeof itemIds, slot: number) {
  return { name, slot, count: 1, type: itemIds[name],
    componentMap: new Map<string, { data: unknown }>() };
}

function load(weapon: ReturnType<typeof item>, itemId = itemIds.arrow) {
  return { ...weapon, componentMap: new Map(weapon.componentMap).set(
    'charged_projectiles', { data: { projectiles: [{ itemId, itemCount: 1 }] } },
  ) };
}

function enchant(weapon: ReturnType<typeof item>, id: string, level = 1) {
  weapon.componentMap.set('enchantments', { data: { enchantments: [{ id, level }] } });
  return weapon;
}

function fixture(weapons: ReturnType<typeof item>[], withAmmo = false) {
  const target = { id: 7, uuid: 'hostile', position: new Vec3(12, 64, 0) };
  const slots: Array<ReturnType<typeof item> | null> = Array(46).fill(null);
  for (const stack of weapons) slots[stack.slot] = stack;
  if (withAmmo) slots[11] = item('arrow', 11);
  const wire = new EventEmitter();
  const body = {
    _client: wire,
    supportFeature: (feature: string) => feature === 'itemsWithComponents',
    registry: {
      items: { [itemIds.arrow]: { name: 'arrow' } },
      entitiesByName: { arrow: { id: arrowEntityId }, trident: { id: tridentEntityId } },
    },
    entity: { id: bodyEntityId, position: new Vec3(0, 64, 0), eyeHeight: 1.62, onGround: true },
    inventory: { items: () => slots.filter(Boolean), hotbarStart: 36, slots },
    heldItem: slots[36], quickBarSlot: 0, usingHeldItem: false,
    equip: vi.fn(async (stack: ReturnType<typeof item>) => { body.heldItem = stack; }),
    lookAt: vi.fn(async (_point: Vec3) => {}),
    activateItem: vi.fn(() => { body.usingHeldItem = true; }),
    deactivateItem: vi.fn(() => { body.usingHeldItem = false; }),
    setQuickBarSlot: vi.fn((slot: number) => { body.quickBarSlot = slot; body.heldItem = slots[36 + slot]; }),
  };
  const bot = body as unknown as Bot;
  let visible = true;
  let ownsBody = true;
  const controller = new BowController({ getBot: () => bot, resolveTarget: () => target,
    hasLos: () => visible, leaseValid: () => ownsBody });
  const observeLaunch = (type: number, objectData = bodyEntityId) =>
    wire.emit('spawn_entity', { entityId: 42, type, objectData });
  const replaceHeld = (stack: ReturnType<typeof item>) => { body.heldItem = slots[stack.slot] = stack; };
  return { body, bot, controller, target, observeLaunch, replaceHeld,
    occlude: () => { visible = false; }, loseLease: () => { ownsBody = false; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('native ranged weapons', () => {
  it('selects effective weapons from observed ammo, range and enchantments', () => {
    const trident = enchant(item('trident', 38), 'loyalty');
    const f = fixture([item('bow', 36), item('crossbow', 37), trident], true);
    expect(selectRangedWeapon(f.bot, undefined, 10)?.kind).toBe('trident');
    expect(selectRangedWeapon(f.bot, undefined, 16)?.kind).toBe('bow');
    expect(selectRangedWeapon(f.bot, undefined, 25)?.kind).toBe('crossbow');
    expect(selectRangedWeapon(f.bot, 'minecraft:bow', 25)?.kind).toBe('bow');
    expect(selectRangedWeapon(f.bot, 'crossbow')?.chargeMs).toBe(1300);
    enchant(f.body.inventory.slots[37]!, 'quick_charge', 3);
    expect(selectRangedWeapon(f.bot, 'crossbow')?.chargeMs).toBe(550);
    expect(selectRangedWeapon(fixture([item('trident', 36)]).bot)).toBeNull();
    expect(selectRangedWeapon(fixture([item('trident', 36)]).bot, 'trident')?.kind).toBe('trident');
    expect(selectRangedWeapon(fixture([enchant(item('trident', 36), 'riptide')]).bot, 'trident')).toBeNull();
    const worn = item('trident', 36);
    worn.componentMap.set('damage', { data: 249 });
    expect(selectRangedWeapon(fixture([worn]).bot, 'trident')).toBeNull();
    expect(selectRangedWeapon(fixture([load(item('crossbow', 36), 99)]).bot, 'crossbow')).toBeNull();
  });

  it('fires a loaded crossbow without reserve arrows and ignores another shooter', async () => {
    const f = fixture([load(item('crossbow', 36))]);
    f.body.activateItem.mockImplementation(() => {
      f.body.usingHeldItem = true;
      f.observeLaunch(arrowEntityId, 900);
      setTimeout(() => f.observeLaunch(arrowEntityId), 50);
    });
    const result = f.controller.shoot(f.target);
    await vi.advanceTimersByTimeAsync(20);
    expect(f.controller.active).toBe(true);
    await vi.advanceTimersByTimeAsync(80);
    expect(await result).toMatchObject({ kind: 'released', weapon: 'crossbow' });
    expect(f.body.activateItem).toHaveBeenCalledTimes(1);
    expect(f.body.deactivateItem).not.toHaveBeenCalled();
    expect(f.body.usingHeldItem).toBe(false);
    expect(f.body._client.listenerCount('spawn_entity')).toBe(0);
  });

  it.each(['loaded', 'no_update', 'occluded', 'lost_lease'] as const)(
    'only sends the second activation after acknowledged loading and revalidation (%s)', async outcome => {
      const crossbow = item('crossbow', 36);
      const f = fixture([crossbow], true);
      f.body.deactivateItem.mockImplementation(() => {
        f.body.usingHeldItem = false;
        if (outcome !== 'no_update') setTimeout(() => {
          if (outcome === 'occluded') f.occlude();
          if (outcome === 'lost_lease') f.loseLease();
          f.replaceHeld(load(crossbow));
        }, 120);
      });
      f.body.activateItem.mockImplementation(() => {
        f.body.usingHeldItem = true;
        if (f.body.activateItem.mock.calls.length === 2) f.observeLaunch(arrowEntityId);
      });
      const result = f.controller.shoot(f.target, 'combat', 'crossbow');
      await vi.advanceTimersByTimeAsync(1350);
      expect(f.body.activateItem).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1100);
      const expected = {
        loaded: { kind: 'released', weapon: 'crossbow' },
        no_update: { kind: 'blocked', cause: 'charge_unconfirmed' },
        occluded: { kind: 'blocked', reason: 'no_los' },
        lost_lease: { kind: 'blocked', cause: 'lease' },
      };
      expect(await result).toMatchObject(expected[outcome]);
      expect(f.body.deactivateItem).toHaveBeenCalledTimes(1);
      expect(f.body.activateItem).toHaveBeenCalledTimes(outcome === 'loaded' ? 2 : 1);
    },
  );

  it('only records a released trident after a self-owned trident spawn', async () => {
    const f = fixture([enchant(item('trident', 36), 'loyalty')]);
    f.body.deactivateItem.mockImplementation(() => {
      f.body.usingHeldItem = false;
      f.observeLaunch(arrowEntityId);
      f.observeLaunch(tridentEntityId, 1000);
      setTimeout(() => f.observeLaunch(tridentEntityId), 150);
    });
    const result = f.controller.shoot(f.target);
    await vi.advanceTimersByTimeAsync(599);
    expect(f.body.deactivateItem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(await result).toMatchObject({ kind: 'released', weapon: 'trident' });
    expect(f.controller.noteHit(f.target.id)).toBeNull();
    expect(f.controller.noteHit(f.target.id, Date.now(), 41)).toBeNull();
    expect(f.controller.noteHit(f.target.id, Date.now(), 42)).toMatchObject({ kind: 'hit', weapon: 'trident' });
  });

  it('keeps a request with no native projectile acknowledgement out of hits', async () => {
    const f = fixture([enchant(item('trident', 36), 'loyalty')]);
    const result = f.controller.shoot(f.target);
    await vi.advanceTimersByTimeAsync(1700);
    expect(await result).toMatchObject({ kind: 'blocked', cause: 'launch_unconfirmed' });
    expect(f.controller.noteHit(f.target.id)).toBeNull();
    expect(f.body._client.listenerCount('spawn_entity')).toBe(0);
  });

  it('switches slots to cancel an already drawn trident without a release packet', async () => {
    const f = fixture([enchant(item('trident', 36), 'loyalty')]);
    const result = f.controller.shoot(f.target);
    await vi.advanceTimersByTimeAsync(575);
    f.controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ kind: 'blocked', cause: 'abort' });
    expect(f.body.setQuickBarSlot).toHaveBeenCalledTimes(1);
    expect(f.body.deactivateItem).not.toHaveBeenCalled();
    expect(f.body.usingHeldItem).toBe(false);
  });
});
