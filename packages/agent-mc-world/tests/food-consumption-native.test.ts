import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { afterEach, expect, it, vi } from 'vitest';
import { skillEat, consumeHeldFood, equipNamed } from '../core/skills-craft.ts';
import { installInventoryClickSync } from '../core/inventory-click-sync.ts';
import { installInventoryWindowSyncGuard } from '../core/inventory-window-sync.ts';
import { lastAteOf } from '../core/placed-ledger.ts';
import { stepDecision } from '../core/step-decision.ts';

const require = createRequire(import.meta.url), mf = createRequire(require.resolve('mineflayer'));

/** Pinned inventory/consume plugin with independent server slots and selected hand. */
function foodServer(version = '1.21.1', protectShortcut = true) {
  const registry = require('minecraft-data')(version), Item = mf('prismarine-item')(registry);
  const server = mf('prismarine-windows')(version).createWindow(0, 'minecraft:inventory', 'Inventory');
  const client = Object.assign(new EventEmitter(), { write: (_name: string, _packet: any) => {} });
  const bot = Object.assign(new EventEmitter(), {
    registry, version, _client: client, QUICK_BAR_START: 36,
    entity: { id: 7, yaw: 0, pitch: 0, effects: {} }, game: { gameMode: 'survival' },
    supportFeature: (name: string) => registry.supportFeature(name),
    getEquipmentDestSlot: (name: string) => name === 'hand' ? 36 + bot.quickBarSlot : 45,
  }) as unknown as Bot;
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  mf('mineflayer/lib/plugins/simple_inventory.js')(bot);
  mf('mineflayer/lib/plugins/health.js')(bot, { respawn: false });
  bot.quickBarSlot = 0;
  let stateId = 0, selected = 0, onUse: () => void = () => {};
  const packets: Array<{ name: string; packet: any }> = [];
  const full = () => client.emit('window_items', { windowId: 0, stateId: ++stateId,
    items: server.slots.map((item: unknown) => Item.toNotch(item)), carriedItem: Item.toNotch(server.selectedItem) });
  const seed = (slot: number, name: string, count = 1, custom = false) => {
    const item = new Item(registry.itemsByName[name].id, count);
    if (custom) {
      const name = { type: 'custom_name', data: { type: 'string', value: 'Protected shortcut' } };
      item.components.push(name); item.componentMap.set(name.type, name);
    }
    server.updateSlot(slot, item);
  };
  const health = (food: number) => client.emit('update_health', { health: 10, food, foodSaturation: 0 });
  client.write = (name, packet) => {
    packets.push({ name, packet: structuredClone(packet) });
    if (name === 'held_item_slot') selected = packet.slotId;
    if (name === 'window_click') {
      const protectedMove = protectShortcut && (packet.slot === 36 || packet.mode === 2 && packet.mouseButton === 0);
      if (!protectedMove) server.acceptClick({ ...packet, item: server.slots[packet.slot] });
      setTimeout(full, 50);
    }
    if (name === 'use_item') onUse();
  };
  installInventoryWindowSyncGuard(bot); installInventoryClickSync(bot);
  for (let slot = 9; slot < 45; slot++) seed(slot, 'stone');
  seed(36, 'player_head', 1, true); seed(9, 'cooked_cod', 2); full(); health(2);
  return { bot, client, server, packets, full, seed, health,
    hand: () => server.slots[36 + selected],
    use: (handler: () => void) => { onUse = handler; },
    finish: () => client.emit('entity_status', { entityId: bot.entity.id, entityStatus: 9 }),
    lose: (slot: number, count: number) => {
      const old = server.slots[slot];
      server.updateSlot(slot, old.count > count ? new Item(old.type, old.count - count) : null); full();
    },
  };
}

afterEach(() => vi.useRealTimers());

it.each(['1.21.1', '1.20.6'])('eats stored food after the real %s swap ACK without activating a protected shortcut', async version => {
  vi.useFakeTimers(); const r = foodServer(version);
  r.use(() => {
    expect(r.hand()?.name).toBe('cooked_cod');
    setTimeout(() => { r.lose(37, 1); r.health(7); r.finish(); }, 1_600);
  });
  const result = skillEat(r.bot, 'cooked_cod').then(text => ({ text }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(49);
  expect(r.packets.some(p => p.name === 'use_item')).toBe(false);
  await vi.runAllTimersAsync(); expect(await result).toMatchObject({ text: expect.stringContaining('饥饿 2 → 7') });
  expect(r.server.slots[36]?.name).toBe('player_head');
  expect(r.server.slots[37]?.count).toBe(1);
  expect(r.packets.filter(p => p.name === 'use_item')).toHaveLength(1);
  expect(lastAteOf(r.bot)).not.toBeNull();
});

it('uses the confirmed hand path for named item interaction too', async () => {
  vi.useFakeTimers(); const r = foodServer();
  const result = equipNamed(r.bot, 'cooked_cod').then(text => ({ text }), error => ({ error }));
  await vi.runAllTimersAsync(); expect(await result).toEqual({ text: 'cooked_cod' });
  expect(r.hand()?.name).toBe('cooked_cod');
  expect(r.server.slots[36]?.name).toBe('player_head');
  expect(r.packets.some(p => p.name === 'use_item')).toBe(false);
});

it('does not record eating when a window replaces the inventory and two food items disappear', async () => {
  vi.useFakeTimers(); const r = foodServer('1.21.1', false);
  r.server.updateSlot(9, null);
  r.seed(36, 'cooked_cod', 2); r.full();
  r.use(() => {
    r.lose(36, 2);
    r.client.emit('open_window', { windowId: 1, inventoryType: 5, windowTitle: '{"text":"Container"}' });
    r.finish();
  });
  const result = consumeHeldFood(r.bot, 'cooked_cod');
  const rejected = expect(result).rejects.toMatchObject({ code: 'food-consumption-unconfirmed' });
  await vi.runAllTimersAsync(); await rejected;
  expect(stepDecision('fail', 'food-consumption-unconfirmed')).toMatchObject({ status: 'unknown', retryable: false,
    continue_when: expect.stringContaining('do not replay'), next_safe_read: { tool: 'mc_bag' } });
  expect(lastAteOf(r.bot)).toBeNull();
  expect(r.packets.filter(p => p.name === 'use_item')).toHaveLength(1);
});

it('keeps abnormal multi-item loss out of the meal ledger even without an open window', async () => {
  vi.useFakeTimers(); const r = foodServer('1.21.1', false);
  r.server.updateSlot(9, null);
  r.seed(36, 'cooked_cod', 2); r.full();
  r.use(() => { r.lose(36, 2); r.health(7); r.finish(); });
  const result = consumeHeldFood(r.bot, 'cooked_cod');
  const rejected = expect(result).rejects.toMatchObject({ code: 'food-consumption-unconfirmed', message: expect.stringContaining('2 → 0') });
  await vi.runAllTimersAsync(); await rejected;
  expect(lastAteOf(r.bot)).toBeNull();
});

it('does not equate a held-item change or single lost item with confirmed eating', async () => {
  vi.useFakeTimers(); const r = foodServer('1.21.1', false);
  r.server.updateSlot(9, null);
  r.seed(36, 'cooked_cod', 2); r.full();
  r.use(() => { r.lose(36, 1); }); // Native consume resolves on heldItemChanged, no consume status or nutrition.
  const result = consumeHeldFood(r.bot, 'cooked_cod');
  const rejected = expect(result).rejects.toMatchObject({ code: 'food-consumption-unconfirmed' });
  await vi.runAllTimersAsync(); await rejected;
  expect(lastAteOf(r.bot)).toBeNull();
});

it('accepts a genuine golden apple consumption with unchanged hunger', async () => {
  vi.useFakeTimers(); const r = foodServer('1.21.1', false);
  r.seed(36, 'golden_apple', 2); r.full(); r.health(20);
  r.use(() => { r.lose(36, 1); r.finish(); });
  const result = consumeHeldFood(r.bot, 'golden_apple');
  const success = expect(result).resolves.toContain('饥饿 20 → 20');
  await vi.runAllTimersAsync(); await success;
  expect(lastAteOf(r.bot)).not.toBeNull();
});

it('waits for a delayed nutrition packet after native heldItemChanged resolves early', async () => {
  vi.useFakeTimers(); const r = foodServer('1.21.1', false);
  r.server.updateSlot(9, null); r.seed(36, 'cooked_cod', 2); r.full();
  const listeners = r.client.listenerCount('entity_status');
  r.use(() => { r.lose(36, 1); setTimeout(() => r.health(7), 700); });
  const result = consumeHeldFood(r.bot, 'cooked_cod');
  await vi.advanceTimersByTimeAsync(500); expect(lastAteOf(r.bot)).toBeNull();
  await vi.runAllTimersAsync(); expect(await result).toContain('2 → 7');
  expect(r.client.listenerCount('entity_status')).toBe(listeners);
});

it('does not use food after its task loses control while the hand swap awaits ACK', async () => {
  vi.useFakeTimers(); const r = foodServer(); let active = true;
  const result = skillEat(r.bot, 'cooked_cod', () => { if (!active) throw new Error('Task cancelled'); })
    .then(text => ({ text }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(10); active = false;
  await vi.runAllTimersAsync(); expect(await result).toMatchObject({ error: expect.any(Error) });
  expect(r.packets.some(p => p.name === 'use_item')).toBe(false);
  expect(lastAteOf(r.bot)).toBeNull();
});

it('reports a real milk drink without treating it as a meal', async () => {
  vi.useFakeTimers(); const r = foodServer('1.21.1', false);
  r.seed(36, 'milk_bucket'); r.full();
  r.use(() => { r.seed(36, 'bucket'); r.full(); r.finish(); });
  const result = consumeHeldFood(r.bot, 'milk_bucket');
  await vi.runAllTimersAsync(); expect(await result).toContain('喝了');
  expect(lastAteOf(r.bot)).toBeNull();
});
