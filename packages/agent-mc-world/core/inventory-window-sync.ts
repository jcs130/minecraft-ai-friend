/** Keep inventory reads tied to server slots, across all native container close paths. */
import type { Bot } from 'mineflayer';
import type { MinecraftLog } from './log.ts';
import { inventoryClickState } from './inventory-click-sync.ts';

type Window = NonNullable<Bot['currentWindow']>;
interface WindowSyncState {
  confirmed: boolean;
  observed: WeakMap<Window, Set<number>>;
}
const syncStates = new WeakMap<Bot, WindowSyncState>();

export interface InventoryReadState {
  phase: 'ready' | 'initial' | 'partial' | 'pending' | 'quarantined';
  reason?: string;
}

export function inventoryReadState(bot: Bot, initialReceived = true): InventoryReadState {
  const click = inventoryClickState(bot);
  if (click.phase !== 'ready') return { phase: click.phase, reason: click.reason };
  if (syncStates.get(bot)?.confirmed === false) return { phase: 'partial' };
  return { phase: initialReceived ? 'ready' : 'initial' };
}

/** False means a complete server read or the pending click's outcome is still required. */
export function inventoryReadConfirmed(bot: Bot): boolean {
  return inventoryReadState(bot).phase === 'ready';
}

export function narrateInventorySync(state?: InventoryReadState): string {
  switch (state?.phase) {
    case 'pending': return '上一笔背包操作正在等待服务器确认槽位和光标，请稍后查询，不要重复存取或合成。';
    case 'quarantined': return `上一笔背包操作结果未知，已暂停后续物品操作。${state.reason ? `原因：${state.reason}。` : ''}等待新的完整槽位和光标数据后重新查询；持续未恢复可重新连接，不要重放上一笔操作。此等待只限制物品操作，仍可只读观察、交流或在安全条件下无需用物品的行走。`;
    case 'partial': return '容器的玩家槽位数据尚不完整，已保留上次读数但暂不作为当前清单。请关闭后重新打开容器查询；仍未恢复可重新连接，不要重复存取。';
    default: return '尚未收到首次完整背包数据，请稍后查询；持续未恢复可重新连接。';
  }
}

/**
 * A virtual container may initially send only its own slots. Track actual slot
 * coverage per Window instance, never by a reusable numeric ID. Full snapshots
 * and the last missing set_slot both restore reads; local predictions do not.
 */
export function installInventoryWindowSyncGuard(bot: Bot, diag?: MinecraftLog): void {
  if (syncStates.has(bot) || typeof bot.closeWindow !== 'function' || !bot.inventory?.slots) return;
  const state: WindowSyncState = { confirmed: true, observed: new WeakMap() };
  syncStates.set(bot, state);
  const seenFor = (window: Window): Set<number> => {
    let seen = state.observed.get(window);
    if (!seen) { seen = new Set(); state.observed.set(window, seen); }
    return seen;
  };
  const complete = (window: Window): boolean =>
    seenFor(window).size >= window.inventoryEnd - window.inventoryStart;
  // updateSlot changes item.slot. Keep the two windows' Item instances separate.
  const copyItem = (item: Window['selectedItem']): Window['selectedItem'] =>
    item ? Object.assign(Object.create(Object.getPrototypeOf(item)), item) : null;
  // prismarine-windows accepts null for an empty slot (its declaration omits it).
  const updateSlot = (window: Window, slot: number, item: Window['selectedItem']): void =>
    (window as unknown as { updateSlot(slot: number, item: Window['selectedItem']): void }).updateSlot(slot, item);
  const copyObserved = (window: Window, onlySlot?: number): void => {
    const offset = window.inventoryStart - bot.inventory.inventoryStart;
    for (const slot of seenFor(window)) {
      if (onlySlot === undefined || onlySlot === slot) updateSlot(bot.inventory, slot - offset, copyItem(window.slots[slot]));
    }
  };
  const preserveMissing = (window: Window): void => {
    const seen = seenFor(window), offset = window.inventoryStart - bot.inventory.inventoryStart;
    for (let slot = window.inventoryStart; slot < window.inventoryEnd; slot++) {
      if (!seen.has(slot)) window.slots[slot] = copyItem(bot.inventory.slots[slot - offset]);
    }
    state.confirmed = complete(window);
    if (!state.confirmed) diag?.write({ lane: 'inventory', event: 'partial-window-player-slots',
      msg: `窗口 ${window.id} 的玩家槽只收到 ${seen.size}/${window.inventoryEnd - window.inventoryStart} 格，保留未同步槽位并等待完整读数`,
      data: { windowId: window.id, observed: seen.size, total: window.inventoryEnd - window.inventoryStart }, incident: true });
  };
  const client = bot._client as unknown as {
    emit(name: string, ...args: any[]): boolean;
    write(name: string, packet: { windowId?: number }): void;
  };
  const emit = client.emit.bind(client);
  client.emit = (name, ...args): boolean => {
    const packet = args[0];
    const window = bot.currentWindow;
    if (name === 'open_window' || name === 'open_horse_window') state.confirmed = false;
    if (name === 'window_items' && packet.windowId !== 0 && packet.windowId !== window?.id) {
      // Native Mineflayer otherwise caches a closed window's late packet and
      // reuses it as the initial contents when that numeric ID is opened again.
      return true;
    }
    if (name === 'window_items') {
      if (packet.windowId === 0) state.confirmed = packet.items.length >= bot.inventory.slots.length;
      else if (window) {
        const seen = seenFor(window);
        for (let slot = window.inventoryStart; slot < Math.min(packet.items.length, window.inventoryEnd); slot++) seen.add(slot);
        state.confirmed = complete(window);
      }
    } else if (name === 'set_slot' && window && window.id === packet.windowId
      && packet.slot >= window.inventoryStart && packet.slot < window.inventoryEnd) {
      seenFor(window).add(packet.slot);
      state.confirmed = complete(window);
    } else if ((name === 'close_window' || name === 'login') && window) {
      // A server-driven close bypasses bot.closeWindow and native copyInventory.
      copyObserved(window);
      state.confirmed = complete(window);
    }
    const result = emit(name, ...args);
    if (name === 'window_items' && packet.windowId === 0 && state.confirmed && bot.currentWindow === window && window) {
      // A newer complete player snapshot must not be overwritten by an older
      // container copy when the container subsequently closes.
      const offset = window.inventoryStart - bot.inventory.inventoryStart;
      for (let slot = window.inventoryStart; slot < window.inventoryEnd; slot++) {
        updateSlot(window, slot, copyItem(bot.inventory.slots[slot - offset]));
        seenFor(window).add(slot);
      }
    } else if ((name === 'window_items' || name === 'set_slot') && window
      && packet.windowId === window.id && bot.currentWindow === window) copyObserved(window, name === 'set_slot' ? packet.slot : undefined);
    return result;
  };
  // windowOpen fires inside native window_items handling, before emit returns.
  // Coverage is already recorded above, so synchronous readers/closers are safe.
  bot.prependListener('windowOpen', copyObserved);
  const write = client.write.bind(client);
  client.write = (name, packet): void => {
    // Also covers window.close(), whose native closure bypasses bot.closeWindow.
    const window = bot.currentWindow;
    if (name === 'close_window' && window && window.id === packet.windowId) preserveMissing(window);
    write(name, packet);
  };
}
