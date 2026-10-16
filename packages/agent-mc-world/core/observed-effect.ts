import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { EffectSample, ObservedEffect } from '../src/contracts/observed-effect.ts';
import { inventoryReadConfirmed } from './inventory-window-sync.ts';

/** Observation failures must never change an action's outcome or invent zero values. */
export function sampleEffect(bot: Bot, cell: [number, number, number] | null): EffectSample {
  const sample: EffectSample = { at: new Date().toISOString(), target: null, inventory: null, position: null };
  try {
    const p = bot.entity?.position;
    if (p && [p.x, p.y, p.z].every(Number.isFinite)) sample.position = [p.x, p.y, p.z];
    if (cell) {
      const block = bot.blockAt(new Vec3(...cell));
      if (block && Number.isSafeInteger(block.stateId)) sample.target = { name: block.name, stateId: block.stateId };
    }
  } catch { /* Unloaded cells remain unknown. */ }
  try {
    if (inventoryReadConfirmed(bot)) {
      const stacks = bot.inventory.items();
      if (stacks.length <= 128 && stacks.every(s => typeof s.name === 'string' && Number.isSafeInteger(s.count) && s.count >= 0)) {
        sample.inventory = {};
        for (const s of stacks) sample.inventory[s.name] = (sample.inventory[s.name] ?? 0) + s.count;
      }
    }
  } catch { /* Inventory synchronization/read failure is unknown. */ }
  try {
    if (bot.currentWindow === null) sample.window = null;
    else if (bot.currentWindow && Number.isSafeInteger(bot.currentWindow.id))
      sample.window = { id: bot.currentWindow.id, type: String(bot.currentWindow.type) };
  } catch { /* Missing window read remains unknown. */ }
  return sample;
}
const equalMap = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => (a[k] ?? 0) === (b[k] ?? 0));
export function observedEffect(skill: string, dimension: string, cell: [number, number, number] | null,
  before: EffectSample, after: EffectSample): ObservedEffect {
  const changed = {
    target: cell && before.target && after.target ? before.target.stateId !== after.target.stateId || before.target.name !== after.target.name : null,
    inventory: before.inventory && after.inventory ? !equalMap(before.inventory, after.inventory) : null,
    position: before.position && after.position ? Math.hypot(...before.position.map((n, i) => n - after.position![i])) > .05 : null,
    window: before.window === undefined || after.window === undefined ? null : JSON.stringify(before.window) !== JSON.stringify(after.window),
  };
  const values = [changed.inventory, changed.position, changed.window, ...(cell ? [changed.target] : [])];
  return { schema: 'agent-mc-observed-effect/v1', skill, dimension, at: cell, before, after, changed,
    status: values.includes(true) ? 'changed' : values.includes(null) ? 'unknown' : 'unchanged',
    coverage: 'client-visible-only', goalVerified: false };
}
