/** Optional, connection-scoped aliases from a verified native view adapter.
 * Keep every protocol ID and original Prismarine Item object unchanged. */
const KEY = Symbol.for('mcviewer.native_item.v1');
export function nativeItemName(item: { name: string; count?: number }): string {
  const tag = (item as unknown as Record<symbol, unknown>)[KEY] as {
    name?: unknown; source?: unknown; count?: unknown; registrySha256?: unknown;
  } | undefined;
  if (tag?.source === 'same_connection_original_before_projection' && tag.count === item.count
    && typeof tag.registrySha256 === 'string' && /^[a-f0-9]{64}$/.test(tag.registrySha256)
    && typeof tag.name === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(tag.name)) return tag.name.replace(/^minecraft:/, '');
  return item.name;
}
