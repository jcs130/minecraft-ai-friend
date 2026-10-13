/** Keep entity item slots in the packet shape expected by the 1.20.6 renderer. */
export function viewerRenderableMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const normalize = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    const slot = value as Record<string, unknown>;
    if (!('itemCount' in slot)) return value;
    const id = Number.isInteger(slot.itemId) ? slot.itemId
      : Number.isInteger(slot.type) ? slot.type : null;
    if (typeof id === 'number' && id >= 0) return { ...slot, itemId: id };
    if (typeof slot.name === 'string' && /^[a-z0-9_:]+$/.test(slot.name)) return slot;
    return null;
  };
  if (Array.isArray(metadata)) return metadata.map(normalize);
  const source = metadata as Record<string, unknown>;
  return Object.fromEntries(Object.entries(source).map(([key, value]) =>
    [key, /^\d+$/.test(key) ? normalize(value) : value]));
}
