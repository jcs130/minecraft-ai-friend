import type { Bot } from 'mineflayer';

type Window = NonNullable<Bot['currentWindow']>;
const patched = new WeakSet<Window>();

/** The pinned window predictor omits the protocol's mode-2, button-40 F-key swap. */
export function installInventoryOffhandPrediction(bot: Bot, window: Window): void {
  if (patched.has(window) || window !== bot.inventory || bot.supportFeature?.('stateIdUsed') !== true
    || typeof bot.getEquipmentDestSlot !== 'function') return;
  const offhand = bot.getEquipmentDestSlot('off-hand');
  if (offhand !== 45 || window.slots.length <= offhand) return;
  type Click = { mode: number; slot: number; mouseButton: number };
  const win = window as unknown as {
    selectedItem: Bot['heldItem']; slots: Array<Bot['heldItem']>;
    updateSlot(slot: number, item: Bot['heldItem']): void;
    acceptClick(click: Click, ...rest: unknown[]): unknown;
  };
  const original = win.acceptClick.bind(win);
  win.acceptClick = (click, ...rest) => {
    if (click.mode !== 2 || click.mouseButton !== 40 || !Number.isInteger(click.slot)
      || click.slot < window.inventoryStart || click.slot >= window.inventoryEnd) return original(click, ...rest);
    if (win.selectedItem) return [];
    const source = win.slots[click.slot], previous = win.slots[offhand];
    if (!source && !previous) return [];
    win.updateSlot(click.slot, previous); win.updateSlot(offhand, source);
    return [click.slot, offhand];
  };
  patched.add(window);
}
