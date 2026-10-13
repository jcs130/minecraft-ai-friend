/** Mineflayer copies an open window's player slots into window 0 when it closes. */
import type { Bot } from 'mineflayer';
import type { MinecraftLog } from './log.ts';
import { inventoryClickState } from './inventory-click-sync.ts';

type Window = NonNullable<Bot['currentWindow']>;
type WindowPacket = { windowId: number; items: unknown[] };
type SlotPacket = { windowId: number; slot: number };

interface WindowSyncState {
  confirmed: boolean;
  observed: WeakMap<Window, Set<number>>;
  pending: Map<number, number>;
}

const syncStates = new WeakMap<Bot, WindowSyncState>();

/** False means the player inventory needs another complete server window read. */
export function inventoryReadConfirmed(bot: Bot): boolean {
  return inventoryClickState(bot).phase === 'ready' && (syncStates.get(bot)?.confirmed ?? true);
}

/**
 * A virtual container may send only its own slots. Its absent player slots must not
 * overwrite the last known player inventory when Mineflayer closes the window.
 */
export function installInventoryWindowSyncGuard(bot: Bot, diag?: MinecraftLog): void {
  if (syncStates.has(bot)) return;
  if (typeof bot.closeWindow !== 'function' || !bot.inventory?.slots) return;
  const state: WindowSyncState = { confirmed: true, observed: new WeakMap(), pending: new Map() };
  syncStates.set(bot, state);

  const observePrefix = (window: Window, length: number): void => {
    const seen = state.observed.get(window) ?? new Set<number>();
    for (let slot = window.inventoryStart; slot < Math.min(length, window.inventoryEnd); slot++) {
      seen.add(slot);
    }
    state.observed.set(window, seen);
    if (seen.size < window.inventoryEnd - window.inventoryStart) state.confirmed = false;
  };

  bot._client.on('window_items', (packet: WindowPacket) => {
    if (packet.windowId === 0) {
      state.confirmed = packet.items.length >= bot.inventory.inventoryEnd;
      return;
    }
    const window = bot.currentWindow;
    if (window?.id === packet.windowId) observePrefix(window, packet.items.length);
    else state.pending.set(packet.windowId, packet.items.length);
  });
  bot._client.on('open_window', (packet: { windowId: number }) => {
    const length = state.pending.get(packet.windowId);
    state.pending.delete(packet.windowId);
    if (length === undefined || bot.currentWindow?.id !== packet.windowId) return;
    observePrefix(bot.currentWindow, length);
  });
  bot._client.on('set_slot', (packet: SlotPacket) => {
    const window = bot.currentWindow;
    if (!window || window.id !== packet.windowId
      || packet.slot < window.inventoryStart || packet.slot >= window.inventoryEnd) return;
    const seen = state.observed.get(window) ?? new Set<number>();
    seen.add(packet.slot);
    state.observed.set(window, seen);
  });

  const closeWindow = bot.closeWindow.bind(bot);
  bot.closeWindow = ((window: Window) => {
    const seen = state.observed.get(window) ?? new Set<number>();
    const total = window.inventoryEnd - window.inventoryStart;
    if (total <= 0) return closeWindow(window);
    const complete = seen.size >= total;
    if (!complete) {
      const offset = window.inventoryStart - bot.inventory.inventoryStart;
      for (let slot = window.inventoryStart; slot < window.inventoryEnd; slot++) {
        if (!seen.has(slot)) window.slots[slot] = bot.inventory.slots[slot - offset];
      }
      diag?.write({ lane: 'inventory', event: 'partial-window-player-slots',
        msg: `窗口 ${window.id} 的玩家槽只收到 ${seen.size}/${total} 格，保留未同步槽位并标记背包待核对`,
        data: { windowId: window.id, observed: seen.size, total }, incident: true });
    }
    closeWindow(window);
    state.confirmed = complete;
  }) as Bot['closeWindow'];
}
