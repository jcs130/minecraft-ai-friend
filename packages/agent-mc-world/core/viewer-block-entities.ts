/** Convert chunk-local Mineflayer block entity keys into world positions for the renderer. */
export function viewerChunkBlockEntities(
  origin: { x: number; z: number }, entities: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entities ?? {})) {
    const parts = key.split(',').map(Number);
    if (parts.length !== 3 || !parts.every(Number.isInteger) ||
        parts[0]! < 0 || parts[0]! > 15 || parts[2]! < 0 || parts[2]! > 15) continue;
    result[`${origin.x + parts[0]!},${parts[1]!},${origin.z + parts[2]!}`] = value;
  }
  return result;
}

export function viewerBlockEntities(chunks: Iterable<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const chunk of chunks) Object.assign(result, chunk);
  return result;
}
