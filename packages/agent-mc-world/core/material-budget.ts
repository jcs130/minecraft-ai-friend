import type { Bot } from 'mineflayer';
import { inventoryReadState } from './inventory-window-sync.ts';

export interface MaterialRequirement {
  item: string;
  required: number;
  keep?: number;
}

/** One decision's assumptions, not reservations against the body or other jobs. */
export function materialBalance(held: number | null, required: number, keep = 0) {
  if (held === null) return { held, required, keep, spendable: null, missing: null };
  const spendable = Math.max(0, held - keep);
  return { held, required, keep, spendable, missing: Math.max(0, required - spendable) };
}

function quantity(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

export function readMaterialBudget(bot: Bot | undefined, invSynced: boolean, input: unknown) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('requirements 需提供至少一种物品，以及该任务所需的总件数 required。');
  const seen = new Set<string>();
  const needs: MaterialRequirement[] = input.map(row => {
    if (!row || typeof row.item !== 'string' || !quantity(row.required) ||
        (row.keep !== undefined && !quantity(row.keep))) throw new Error('requirements 使用物品注册 ID，required、可选 keep 均为非负整数。');
    const item = row.item.trim().replace(/^minecraft:/, '');
    if (!item || seen.has(item)) throw new Error('每种物品请只提交一条汇总需求，填写已确认的物品注册 ID。');
    seen.add(item);
    return { item, required: row.required, keep: row.keep ?? 0 };
  });
  const phase = bot ? inventoryReadState(bot, invSynced).phase : 'disconnected';
  const window = bot?.currentWindow ?? bot?.inventory;
  // prismarine-windows exposes only player main slots and hotbar through items(),
  // including when the active window is a container with a different slot offset.
  const items = phase === 'ready' && typeof window?.items === 'function' ? window.items() : null;
  const rows = needs.map(({ item, required, keep }) => {
    const known = bot && Object.hasOwn(bot.registry.itemsByName, item);
    const status = !items ? 'unobserved' : !known ? 'unknown-item' : 'observed';
    const held = status === 'observed' && items
      ? items.reduce((n, stack) => n + (stack.name === item ? stack.count : 0), 0) : null;
    return { item, status, ...materialBalance(held, required, keep) };
  });
  return { protocol: 'agent-mc/material-budget/v1', scope: 'player-main-and-hotbar-by-material',
    inventoryPhase: phase, reservationsSource: 'caller', rows };
}
