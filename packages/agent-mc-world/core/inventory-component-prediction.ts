import type { Bot } from 'mineflayer';
import { inventoryOrganizationKey, inventoryOrganizationLimit, type OrganizationStack } from './inventory-organization.ts';

type Window = NonNullable<Bot['currentWindow']>;
const patched = new WeakSet<Window>();

/**
 * The pinned prismarine-windows uses legacy Item.equal and constructors for mouse clicks.
 * A server swaps distinct modern variants, while that prediction can merge them or omit
 * components when splitting. Correct this per-window prediction before the existing
 * protocol/ACK barrier; no packets, extra clicks or dependency-file patches are involved.
 */
export function installInventoryComponentPrediction(bot: Bot, window: Window): void {
  if (patched.has(window) || !bot.supportFeature?.('itemsWithComponents')) return;
  type Mutable = OrganizationStack & { slot: number; components?: unknown[]; removedComponents?: unknown[]; componentMap?: Map<string, unknown> };
  const win = window as unknown as { selectedItem: Mutable | null; slots: Array<Mutable | null>;
    craftingResultSlot: number; updateSlot(slot: number, stack: Mutable | null): void;
    acceptClick(click: { mode: number; slot: number; mouseButton: number; item?: Mutable | null }, ...rest: unknown[]): number[] };
  if (typeof win.acceptClick !== 'function' || typeof win.updateSlot !== 'function') return;
  const original = win.acceptClick.bind(win);
  win.acceptClick = (click, ...rest) => {
    const target = win.slots[click.slot], cursor = win.selectedItem;
    if (click.mode !== 0 || click.slot < 0 || click.slot === win.craftingResultSlot) return original(click, ...rest);
    for (const item of [target, cursor]) if (item) {
      const limit = inventoryOrganizationLimit(item);
      if (limit !== undefined) item.stackSize = limit;
    }
    if (target && cursor && target.type === cursor.type && target.metadata === cursor.metadata
      && inventoryOrganizationKey(target) !== inventoryOrganizationKey(cursor)) {
      win.updateSlot(click.slot, cursor); win.selectedItem = target;
      return [click.slot];
    }
    const splitSource = click.mouseButton === 1 ? cursor ?? target : null;
    const components = splitSource ? { components: structuredClone(splitSource.components ?? []),
      removedComponents: structuredClone(splitSource.removedComponents ?? []),
      componentMap: new Map(splitSource.componentMap ?? []), stackSize: splitSource.stackSize } : null;
    const result = original(click, ...rest);
    if (components) {
      if (cursor && !target && win.slots[click.slot]) Object.assign(win.slots[click.slot]!, components);
      if (!cursor && target && win.selectedItem) Object.assign(win.selectedItem, components);
    }
    return result;
  };
  patched.add(window);
}
