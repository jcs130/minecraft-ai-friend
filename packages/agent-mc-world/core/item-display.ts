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
