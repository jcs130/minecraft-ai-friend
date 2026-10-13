/** Data sent to the read-only Minecraft picture for open menus and server skills. */

import { itemCustomName, itemProfileSkinHash } from './item-display.ts';
import { readDamage, readDurability, readEnchants } from './item-facts.ts';
import { minecraftTextComponent } from './text-component.ts';

export interface ViewerItem {
  name: string;
  type: number;
  itemId: number;
  displayName: string;
  count: number;
  metadata: number;
  customName?: string;
  headTextureHash?: string;
  visualDataUnavailable?: boolean;
  enchanted?: boolean;
  durability?: { left: number; max: number };
  components?: unknown;
  nbt?: unknown;
}

type WindowLike = {
  id: number;
  type: string;
  title: unknown;
  slots: unknown[];
  inventoryStart: number;
  hotbarStart: number;
};

export type ViewerTradeOffer = {
  input: ViewerItem;
  secondInput: ViewerItem | null;
  output: ViewerItem;
  uses: number;
  maxUses: number;
  disabled: boolean;
  realPrice: number | null;
  xp: number | null;
};

export type ViewerTrades = {
  windowId: number;
  offers: ViewerTradeOffer[];
  level: number | null;
  experience: number | null;
  regularVillager: boolean;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const bounded = (value: unknown, min: number, max: number): number | null =>
  finite(value) && value >= min && value <= max ? value : null;

type ItemBudget = { nodes: number; chars: number; truncated: boolean };
function viewerItemData(value: unknown, depth: number, budget: ItemBudget): unknown {
  if (--budget.nodes < 0) { budget.truncated = true; return undefined; }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const text = value.slice(0, Math.max(0, Math.min(16384, budget.chars)));
    budget.chars -= text.length;
    if (text.length !== value.length) budget.truncated = true;
    return text;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (depth >= 14) { budget.truncated = true; return undefined; }
  if (Array.isArray(value)) {
    if (value.length > 64) budget.truncated = true;
    return value.slice(0, 64).map((part) => viewerItemData(part, depth + 1, budget) ?? null);
  }
  const result: Record<string, unknown> = {};
  if (Object.keys(value).length > 64) budget.truncated = true;
  for (const [key, part] of Object.entries(value).slice(0, 64)) {
    const safe = viewerItemData(part, depth + 1, budget);
    if (safe !== undefined) result[key.slice(0, 128)] = safe;
  }
  return result;
}

export function viewerItem(value: unknown): ViewerItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== 'string' || !finite(item.type)) return null;
  const customName = itemCustomName(item);
  const headTextureHash = item.name.replace(/^minecraft:/, '') === 'player_head' ? itemProfileSkinHash(item) : null;
  const componentMap = item.componentMap instanceof Map ? item.componentMap as Map<string, { data?: unknown }> : null;
  const enchantComponent = (componentMap?.get('enchantments')?.data ??
    (Array.isArray(item.components) ? (item.components as Array<{ type?: string; data?: unknown }>)
      .find(component => component.type === 'enchantments')?.data : undefined)) as { enchantments?: unknown } | undefined;
  const enchanted = (Array.isArray(enchantComponent?.enchantments) && enchantComponent.enchantments.length > 0) ||
    readEnchants(item as unknown as Parameters<typeof readEnchants>[0]).length > 0;
  const vanillaDurability = readDurability(item as unknown as Parameters<typeof readDurability>[0]);
  const customMax = componentMap?.get('max_damage')?.data;
  const max = finite(customMax) && customMax > 0 && customMax <= 1_000_000
    ? customMax : vanillaDurability?.max;
  const damage = readDamage(item as unknown as Parameters<typeof readDamage>[0]) ?? 0;
  const durability = max && !componentMap?.has('unbreakable')
    ? { left: Math.max(0, max - damage), max } : null;
  const budget = { nodes: 1024, chars: 32768, truncated: false };
  const components = item.components ?? (componentMap ? [...componentMap].map(([type, entry]) => ({ type, data: entry.data })) : null);
  const visual = { ...(components ? { components: viewerItemData(components, 0, budget) } : {}),
    ...(item.nbt ? { nbt: viewerItemData(item.nbt, 0, budget) } : {}) };
  return {
    name: item.name.slice(0, 96), type: item.type, itemId: item.type,
    displayName: customName ?? (typeof item.displayName === 'string' ? item.displayName.slice(0, 80) : item.name.slice(0, 80)),
    count: bounded(item.count, 1, 127) ?? 1,
    metadata: bounded(item.metadata, 0, 65535) ?? 0,
    ...(customName ? { customName } : {}),
    ...(headTextureHash ? { headTextureHash } : {}),
    ...(enchanted ? { enchanted: true } : {}),
    ...(durability ? { durability } : {}),
    ...visual,
    ...(budget.truncated ? { visualDataUnavailable: true } : {}),
  };
}

/** The 1.20.6 trade list is sent separately from the merchant's slot contents. */
export function viewerTradeList(packet: unknown,
  decodeItem: (item: unknown) => ViewerItem | null): ViewerTrades | null {
  if (!packet || typeof packet !== 'object') return null;
  const source = packet as Record<string, unknown>;
  if (!Number.isInteger(source.windowId) || !Array.isArray(source.trades)) return null;
  const offers: ViewerTradeOffer[] = [];
  for (const entry of source.trades.slice(0, 128)) {
    if (!entry || typeof entry !== 'object') continue;
    const trade = entry as Record<string, unknown>;
    const input = decodeItem(trade.inputItem1);
    const output = decodeItem(trade.outputItem);
    if (!input || !output) continue;
    const secondInput = decodeItem(trade.inputItem2);
    const uses = bounded(trade.nbTradeUses, 0, 65_535) ?? 0;
    const maxUses = bounded(trade.maximumNbTradeUses, 0, 65_535) ?? 0;
    const demand = finite(trade.demand) ? trade.demand : 0;
    const multiplier = finite(trade.priceMultiplier) ? trade.priceMultiplier : 0;
    const special = finite(trade.specialPrice) ? trade.specialPrice : 0;
    const calculatedPrice = Math.max(1, Math.min(64,
      input.count + special + Math.max(0, Math.floor(input.count * demand * multiplier))));
    const compact = (item: ViewerItem): ViewerItem => {
      const display = { ...item };
      delete display.components;
      delete display.nbt;
      return display;
    };
    offers.push({
      input: compact(input), secondInput: secondInput ? compact(secondInput) : null,
      output: compact(output), uses, maxUses,
      disabled: trade.tradeDisabled === true || (maxUses > 0 && uses >= maxUses),
      realPrice: bounded(trade.realPrice, 1, 64) ?? calculatedPrice,
      xp: bounded(trade.xp, 0, 9_999),
    });
  }
  return {
    windowId: source.windowId as number,
    offers,
    level: bounded(source.villagerLevel, 0, 5),
    experience: bounded(source.experience, 0, 1_000_000),
    regularVillager: source.isRegularVillager === true,
  };
}

export function windowSnapshot(window: WindowLike | null | undefined,
  properties: ReadonlyMap<number, number> = new Map(),
  serializeItem: (item: unknown) => object | null = viewerItem,
  trades: ViewerTrades | null = null) {
  if (!window) return null;
  const type = String(window.type || 'minecraft:generic_9x3').slice(0, 80);
  const inventoryStart = Math.max(0, Math.min(90, Number(window.inventoryStart) || 0));
  const hotbarStart = Math.max(inventoryStart, Math.min(90, Number(window.hotbarStart) || 0));
  const furnace = /(?:^|:)(?:furnace|blast_furnace|smoker)$/.test(type);
  const currentBurn = properties.get(0);
  const totalBurn = properties.get(1);
  const currentCook = properties.get(2);
  const totalCook = properties.get(3);
  const ratio = (current: number | undefined, total: number | undefined) =>
    finite(current) && finite(total) && total > 0 ? Math.max(0, Math.min(1, current / total)) : null;
  return {
    id: window.id,
    type,
    title: minecraftTextComponent(window.title).slice(0, 100) || type.replace(/^minecraft:/, '').replaceAll('_', ' '),
    slots: window.slots.slice(0, 90).map(serializeItem),
    inventoryStart,
    hotbarStart,
    containerCount: inventoryStart,
    furnace: furnace ? { burn: ratio(currentBurn, totalBurn), cook: ratio(currentCook, totalCook) } : null,
    properties: Object.fromEntries([...properties].filter(([key, value]) =>
      Number.isInteger(key) && key >= 0 && key < 16 && finite(value))),
    trades: /(?:^|:)(?:merchant|villager)$/.test(type) && trades?.windowId === window.id ? trades : null,
  };
}

export interface ViewerSkills {
  schemaVersion: 1;
  mana: { current: number; max: number } | null;
  skills: Array<{ id: string; name: string; level: number; xp: number | null; requiredXp: number | null }>;
  abilities: Array<{ id: string; name: string; level: number | null; cooldownMs: number | null;
    cooldownRemainingMs?: number | null; manaCost?: number | null; icon?: string }>;
  source?: 'plugin' | 'chat';
  observedAt?: number;
}

export function viewerBossBars(value: unknown): Array<{ title: string; progress: number; color: string }> {
  if (!Array.isArray(value)) return [];
  const colors = new Set(['pink', 'blue', 'red', 'green', 'yellow', 'purple', 'white']);
  return value.slice(0, 8).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const bar = entry as { title?: unknown; health?: unknown; color?: unknown };
    const title = minecraftTextComponent(bar.title).slice(0, 100);
    if (!title) return [];
    const health = finite(bar.health) ? Math.max(0, Math.min(1, bar.health)) : 0;
    const color = typeof bar.color === 'string' && colors.has(bar.color) ? bar.color : 'purple';
    return [{ title, progress: health, color }];
  });
}

/** Player metadata's player_absorption field is the actual remaining gold hearts. */
export function viewerPlayerAbsorption(metadata: unknown, metadataKeys?: string[]): number {
  if (!metadata || typeof metadata !== 'object') return 0;
  const index = metadataKeys?.indexOf('player_absorption') ?? 15;
  const value = (metadata as Record<number, unknown>)[index >= 0 ? index : 15];
  return finite(value) ? Math.max(0, Math.min(80, value)) : 0;
}
