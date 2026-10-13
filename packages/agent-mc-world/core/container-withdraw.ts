import type { Bot } from 'mineflayer';
import { isDeepStrictEqual } from 'node:util';
import { checkAbort, type SkillContext } from './skill-context.ts';

type Container = Awaited<ReturnType<Bot['openContainer']>>;
type Stack = NonNullable<Bot['heldItem']>;

function stackIdentity(item: Stack): unknown {
  const components = item as Stack & { components?: unknown[]; removedComponents?: unknown[] };
  return [item.type, item.metadata, item.nbt ?? null,
    components.components ?? [], components.removedComponents ?? []];
}

/** Mineflayer withdraw rejects every full inventory, including stacks with merge capacity. */
export async function withdrawStack(
  bot: Bot, window: Container, item: Stack, count: number, ctx: SkillContext,
): Promise<void> {
  if (bot.inventory.emptySlotCount?.() !== 0) {
    await window.withdraw(item.type, item.metadata ?? null, count);
    return;
  }
  const identity = stackIdentity(item);
  const compatible: Array<{ slot: number; capacity: number }> = [];
  for (let slot = window.inventoryStart; slot < window.inventoryEnd; slot++) {
    const target = window.slots[slot];
    if (target === null) compatible.push({ slot, capacity: item.stackSize });
    else if (target.count < target.stackSize && isDeepStrictEqual(stackIdentity(target), identity)) {
      compatible.push({ slot, capacity: target.stackSize - target.count });
    }
  }
  if (compatible.reduce((sum, target) => sum + target.capacity, 0) < count) {
    throw new Error('Unable to withdraw, Bot inventory is full. No compatible stack capacity.');
  }
  let remaining = count;
  for (const destination of compatible) {
    checkAbort(ctx);
    const amount = Math.min(remaining, destination.capacity);
    await bot.transfer({ window, itemType: item.type, metadata: item.metadata, count: amount,
      sourceStart: item.slot, sourceEnd: item.slot + 1,
      destStart: destination.slot, destEnd: destination.slot + 1 });
    remaining -= amount;
    if (remaining === 0) return;
  }
}
