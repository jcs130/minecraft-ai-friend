import type { Bot } from 'mineflayer';
import { worldScopedRealm } from './world-scope.ts';

/** Emitted only after the layout was placed and the native result slot stayed empty. */
export class CraftResultSlotTimeout extends Error {}

const recent = new WeakMap<Bot, Map<string, number>>();
const lifetimeMs = 10 * 60_000;

function key(bot: Bot, grid: string[][]): string {
  const width = Math.max(...grid.map(row => row.length));
  const cells = grid.map(row => Array.from({ length: width }, (_, i) => row[i] ?? ''));
  return JSON.stringify([worldScopedRealm('craft', bot), cells]);
}

export function observeCraftGrid(bot: Bot, grid: string[][], result: 'empty' | 'produced'): void {
  const observations = recent.get(bot) ?? new Map<string, number>();
  const id = key(bot, grid);
  observations.delete(id);
  if (result === 'empty') observations.set(id, Date.now());
  if (observations.size > 32) observations.delete(observations.keys().next().value!);
  recent.set(bot, observations);
}

export function recentlyEmptyCraftGrid(bot: Bot, grid: string[][]): boolean {
  const at = recent.get(bot)?.get(key(bot, grid));
  return at !== undefined && Date.now() - at < lifetimeMs;
}
