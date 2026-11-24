import { itemHeadProfile } from './viewer-item-profile.mjs';
/** Display text carried by an individual item, separate from its registry ID. */
export function itemCustomName(item: {
  name?: string;
  customName?: unknown;
  componentMap?: Map<string, { data?: unknown }>;
  components?: Array<{ type?: string; data?: unknown }>;
  nbt?: unknown;
}): string | null {
  const nbt = item.nbt as { value?: { display?: { value?: { Name?: { value?: unknown } } } } } | undefined;
  for (const value of [item.customName, componentData(item, 'custom_name'), componentData(item, 'item_name'),
    nbt?.value?.display?.value?.Name?.value]) {
    const text = chatText(unwrapNbt(value))?.replace(/§[0-9a-fk-orx]/gi, '').trim();
    if (text) return text.slice(0, 80);
  }
  return null;
}

type ComponentItem = {
  componentMap?: Map<string, { data?: unknown }>;
  components?: Array<{ type?: string; data?: unknown }>;
};

function componentData(item: ComponentItem, type: string): unknown {
  return item.componentMap?.get(type)?.data
    ?? item.componentMap?.get(`minecraft:${type}`)?.data
    ?? item.components?.find((entry) => entry.type === type || entry.type === `minecraft:${type}`)?.data;
}

function unwrapNbt(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 16) return value;
  const tag = value as { type?: unknown; value?: unknown };
  if (tag.type === 'compound' && tag.value && typeof tag.value === 'object') {
    return Object.fromEntries(Object.entries(tag.value).map(([key, entry]) => [key, unwrapNbt(entry, depth + 1)]));
  }
  if (tag.type === 'list' && tag.value && typeof tag.value === 'object') {
    const list = tag.value as { type?: unknown; value?: unknown };
    return Array.isArray(list.value) ? list.value.slice(0, 64)
      .map((entry) => unwrapNbt({ type: list.type, value: entry }, depth + 1)) : [];
  }
  if (typeof tag.type === 'string' && 'value' in tag) return unwrapNbt(tag.value, depth + 1);
  return value;
}

function chatText(value: unknown, depth = 0): string | null {
  if (depth > 16) return null;
  if (typeof value === 'string') {
    if (value.length > 4096) return null;
    try { return chatText(JSON.parse(value), depth + 1) ?? value; } catch { return value.trim() || null; }
  }
  if (Array.isArray(value)) {
    const text = value.map((part) => chatText(part, depth + 1)).filter((part): part is string => Boolean(part)).join('');
    return text || null;
  }
  if (value && typeof value === 'object') {
    const part = value as { text?: unknown; extra?: unknown };
    const text = `${typeof part.text === 'string' ? part.text : ''}${chatText(part.extra, depth + 1) ?? ''}`.trim();
    return text || null;
  }
  return null;
}

export function itemProfileSkinHash(item: ComponentItem & { name?: string; nbt?: unknown }): string | null {
  const components = item.components ?? (item.componentMap ? [...item.componentMap].map(([type, value]) => ({ type, data: value.data })) : undefined);
  return itemHeadProfile({ ...item, components })?.hash ?? null;
}

/** Lore lines from 26.1 component or legacy NBT, with formatting stripped. */
export function itemLoreText(item: {
  lore?: unknown;
  componentMap?: Map<string, { data?: unknown }>;
  components?: Array<{ type?: string; data?: unknown }>;
  nbt?: unknown;
}): string[] {
  const nbt = item.nbt as { value?: { display?: { value?: { Lore?: { value?: { value?: unknown } } } } } } | undefined;
  const raw = item.lore ?? componentData(item, 'lore') ?? nbt?.value?.display?.value?.Lore?.value?.value;
  const lines = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { value?: unknown }).value)
    ? (raw as { value: unknown[] }).value : [];
  const out: string[] = [];
  for (const line of lines.slice(0, 32)) {
    const textLine = chatText(unwrapNbt(line))?.replace(/§[0-9a-fk-orx]/gi, '').trim();
    if (textLine) out.push(textLine.slice(0, 160));
  }
  return out;
}

const DISPLAY_COMPONENT_TYPES = new Set(['custom_name', 'item_name', 'lore', 'minecraft:custom_name', 'minecraft:item_name', 'minecraft:lore']);

/** Component type names present on a stack, including unknown namespaces. Display text stays in name/lore. */
export function itemComponentTypes(item: ComponentItem, limit = 64): string[] {
  const types: string[] = [];
  const seen = new Set<string>();
  const add = (type: unknown) => {
    if (typeof type !== 'string' || !type || seen.has(type) || types.length >= limit) return;
    seen.add(type);
    types.push(type.slice(0, 160));
  };
  if (item.componentMap) for (const key of item.componentMap.keys()) add(key);
  if (item.components) for (const entry of item.components) add(entry.type);
  return types;
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 120);
  if (Array.isArray(value)) return value.slice(0, 16).map((entry) => boundedValue(entry, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 16)) out[key.slice(0, 64)] = boundedValue(entry, depth + 1);
    return out;
  }
  return null;
}

/** Official custom_model_data payload when present; never invents a default. */
export function itemCustomModelData(item: ComponentItem): unknown | null {
  const data = componentData(item, 'custom_model_data');
  return data == null ? null : boundedValue(unwrapNbt(data));
}

/** Keys only. Values may be large or private; presence is evidence, not a game rule. */
export function itemCustomDataKeys(item: ComponentItem, limit = 32): string[] {
  const data = unwrapNbt(componentData(item, 'custom_data'));
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return Object.keys(data).slice(0, limit).map((key) => key.slice(0, 80));
  }
  return data == null ? [] : ['_present'];
}

export type ItemComponentEvidence = {
  customName: string | null;
  lore: string[];
  componentTypes: string[];
  extraComponentTypes: string[];
  customModelData: unknown | null;
  customDataKeys: string[];
};

export function itemComponentEvidence(item: Parameters<typeof itemCustomName>[0] & ComponentItem, loreLines = 32): ItemComponentEvidence {
  const componentTypes = itemComponentTypes(item);
  return {
    customName: itemCustomName(item),
    lore: itemLoreText(item).slice(0, loreLines),
    componentTypes,
    extraComponentTypes: componentTypes.filter((type) => !DISPLAY_COMPONENT_TYPES.has(type)),
    customModelData: itemCustomModelData(item),
    customDataKeys: itemCustomDataKeys(item),
  };
}

/** Optional slot fields so vanilla-only stacks stay compact. */
export function itemEvidenceFields(item: Parameters<typeof itemCustomName>[0] & ComponentItem, loreLines = 32) {
  const ev = itemComponentEvidence(item, loreLines);
  return {
    ...(ev.extraComponentTypes.length ? { componentTypes: ev.extraComponentTypes } : {}),
    ...(ev.customModelData != null ? { customModelData: ev.customModelData } : {}),
    ...(ev.customDataKeys.length ? { customDataKeys: ev.customDataKeys } : {}),
  };
}
