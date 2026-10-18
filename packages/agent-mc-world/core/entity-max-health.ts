import type { Bot } from 'mineflayer';

/** Native attributes include server modifiers; a missing maximum stays unknown. */
export function entityMaxHealth(entity: Bot['entity']): number | null {
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const attrs = (entity as unknown as { attributes?: Record<string,
    { value: number; modifiers?: Array<{ amount: number; operation: number }> }> }).attributes;
  const attr = Object.entries(attrs ?? {}).find(([key]) => /(?:^|[.:])max_health$/.test(key))?.[1];
  if (!attr || !finite(attr.value)) return null;
  const mods = attr.modifiers ?? [];
  let value = attr.value + mods.filter(m => m.operation === 0).reduce((n, m) => n + m.amount, 0);
  const base = value;
  value += mods.filter(m => m.operation === 1).reduce((n, m) => n + base * m.amount, 0);
  for (const m of mods) if (m.operation === 2) value *= 1 + m.amount;
  return finite(value) && value > 0 ? value : null;
}
