import type { Anchor } from './geometry.ts';
/** Portable inventory organization planning. No Bot, model, click or storage policy is implicit. */
export interface OrganizationStack {
  type: number;
  name: string;
  count: number;
  metadata?: number | null;
  stackSize?: number;
  nbt?: unknown;
  components?: readonly unknown[];
  removedComponents?: readonly unknown[];
  componentMap?: ReadonlyMap<string, unknown>;
}

export interface InventoryDisposition {
  item: string;
  keep: number;
  action: 'stow' | 'toss';
  pick?: string;
}

export interface InventoryOrganization {
  target?: 'inventory' | 'open';
  includeHotbar?: boolean;
  sort?: boolean;
  dryRun?: boolean;
  rules?: InventoryDisposition[];
  at?: Anchor;
  into?: 'open';
}

export interface OrganizationMove {
  kind: 'merge' | 'swap';
  from: number;
  to: number;
  /** Exact source/target state expected at this operation, including counts. */
  source: string;
  destination: string;
}

export interface InventoryShortcutExchange { slot: number; shortcut: number; button: number }

/** Pure proposal inside a caller-supplied allowed range. No permission, snapshot
 * freshness or completion is implied; the executor must revalidate every click. */
export function planInventoryShortcutExchange(slots: readonly (OrganizationStack | null | undefined)[],
  move: OrganizationMove, start: number, end: number, hotbarStart: number): InventoryShortcutExchange[] | null {
  if (move.kind !== 'swap' || ![start, end, hotbarStart, move.from, move.to].every(Number.isSafeInteger)
    || start < 0 || start >= end || end > slots.length || hotbarStart < 0 || hotbarStart + 9 > slots.length
    || move.from < start || move.from >= end || move.to < start || move.to >= end || move.from === move.to) return null;
  const shortcuts = Array.from({ length: 9 }, (_, i) => hotbarStart + i).filter(slot => slot >= start && slot < end);
  if (!shortcuts.length) return null;
  const scratch = shortcuts.find(slot => !!slots[slot]) ?? shortcuts[0];
  const pairs = shortcuts.includes(move.from) ? [[move.to, move.from]] : shortcuts.includes(move.to) ? [[move.from, move.to]]
    : [[move.from, scratch], [move.to, scratch], [move.from, scratch]];
  return pairs.map(([slot, shortcut]) => ({ slot, shortcut, button: shortcut - hotbarStart }));
}

function stable(value: unknown): unknown {
  if (typeof value === 'bigint') return { bigint: value.toString() };
  if (value instanceof Map) return [...value].sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([key, child]) => [key, stable(child)]);
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

/** Count and slot are excluded; legacy NBT and modern component patches both identify a stack. */
export function inventoryOrganizationKey(stack: OrganizationStack): string {
  const components = (stack.components ?? []).map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(stable([stack.type, stack.name, stack.metadata ?? 0, stack.nbt ?? null,
    components, [...(stack.removedComponents ?? [])].sort(), stack.componentMap ? stable(stack.componentMap) : null]));
}

export function organizationSlotState(stack: OrganizationStack | null | undefined): string {
  return stack ? `${inventoryOrganizationKey(stack)}:${stack.count}` : 'empty';
}

/** Modern max_stack_size overrides the registry base (including custom one-per-slot items). */
export function inventoryOrganizationLimit(stack: OrganizationStack): number | undefined {
  const patch = stack.components?.find(value => value && typeof value === 'object'
    && 'type' in value && /^(?:minecraft:)?max_stack_size$/.test(String(value.type)));
  const data = patch && typeof patch === 'object' && 'data' in patch ? patch.data : undefined;
  if (patch) return typeof data === 'number' && Number.isInteger(data) && data > 0 ? data : undefined;
  return Number.isInteger(stack.stackSize) && stack.stackSize! > 0 ? stack.stackSize : undefined;
}

/** Exact multiset used to check conservation, including a carried cursor when provided. */
export function inventoryOrganizationTotals(slots: readonly (OrganizationStack | null | undefined)[]): string {
  const totals = new Map<string, number>();
  for (const stack of slots) if (stack) {
    const key = inventoryOrganizationKey(stack);
    totals.set(key, (totals.get(key) ?? 0) + stack.count);
  }
  return JSON.stringify([...totals].sort(([a], [b]) => a.localeCompare(b)));
}

export interface InventoryOrganizationPlan {
  range: { start: number; end: number };
  beforeFree: number;
  expectedFree: number;
  merges: number;
  swaps: number;
  moves: OrganizationMove[];
}

/** Stack limits are supplied by the current client/registry; missing limits never imply 64. */
export function planInventoryOrganization(slots: readonly (OrganizationStack | null | undefined)[],
  start: number, end: number, sort = true): InventoryOrganizationPlan {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > slots.length)
    throw new Error('Invalid inventory organization slot range');
  const copy = slots.map(stack => stack ? { ...stack, componentMap: stack.componentMap } : null);
  const free = () => copy.slice(start, end).filter(x => !x).length;
  const beforeFree = free(), moves: OrganizationMove[] = [];
  const move = (kind: OrganizationMove['kind'], from: number, to: number) => moves.push({ kind, from, to,
    source: organizationSlotState(copy[from]), destination: organizationSlotState(copy[to]) });
  for (let to = start; to < end; to++) {
    const dest = copy[to];
    if (!dest) continue;
    const max = inventoryOrganizationLimit(dest);
    if (!Number.isInteger(max) || max! <= 1 || dest.count >= max!) continue;
    for (let from = to + 1; from < end && dest.count < max!; from++) {
      const source = copy[from];
      if (!source || inventoryOrganizationKey(source) !== inventoryOrganizationKey(dest)) continue;
      move('merge', from, to);
      const n = Math.min(source.count, max! - dest.count);
      dest.count += n; source.count -= n;
      if (source.count === 0) copy[from] = null;
    }
  }
  if (sort) {
    const key = (stack: OrganizationStack) => `${stack.name}\0${inventoryOrganizationKey(stack)}`;
    for (let to = start; to < end; to++) {
      let from = to;
      for (let candidate = to + 1; candidate < end; candidate++) {
        const x = copy[candidate], y = copy[from];
        if (x && (!y || key(x) < key(y))) from = candidate;
      }
      if (from !== to) {
        move('swap', from, to);
        [copy[from], copy[to]] = [copy[to], copy[from]];
      }
    }
  }
  return { range: { start, end }, beforeFree, expectedFree: free(),
    merges: moves.filter(x => x.kind === 'merge').length,
    swaps: moves.filter(x => x.kind === 'swap').length, moves };
}
