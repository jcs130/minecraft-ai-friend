/** Project only named fields from an already public JSON snapshot, never the live bot. */
export function publicReadProjection(path: unknown): { root: string; fields: string[] } | null {
  if (typeof path !== 'string') return null;
  if (/^entity\.(id|yaw|pitch|onGround|position(?:\.[xyz])?|velocity(?:\.[xyz])?)$/.test(path))
    return { root: 'entity', fields: path.split('.').slice(1) };
  if (/^heldItem\.(name|displayName|type|count|slot|instanceHash)$/.test(path))
    return { root: 'heldItem', fields: path.split('.').slice(1) };
  if (path === 'game.dimension') return { root: 'game', fields: ['dimension'] };
  return null;
}

export function projectPublicRead(value: unknown, fields: string[]): unknown {
  for (const field of fields) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, field)) return null;
    value = (value as Record<string, unknown>)[field];
  }
  return value ?? null;
}
