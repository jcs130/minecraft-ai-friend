/** Translate server biome registry IDs in viewer chunks to 1.20.6 IDs. */
function nearestVanillaBiome(name: string): string {
  const value = name.replace(/^.*:/, '').toLowerCase();
  if (/cherry|sakura/.test(value)) return 'cherry_grove';
  if (/mushroom|fungal/.test(value)) return 'mushroom_fields';
  if (/mangrove|swamp|marsh|bog/.test(value)) return 'swamp';
  if (/badlands|mesa|canyon/.test(value)) return 'badlands';
  if (/snow|frozen|ice|glacier|tundra|alpine/.test(value)) return 'snowy_plains';
  if (/jungle|rainforest|tropical|bamboo/.test(value)) return 'jungle';
  if (/desert|dune/.test(value)) return 'desert';
  if (/savanna|shrub|steppe|prairie|dry_grass/.test(value)) return 'savanna';
  if (/ocean|river|lake|coast/.test(value)) return 'river';
  if (/taiga|spruce|pine/.test(value)) return 'taiga';
  if (/forest|woods|grove/.test(value)) return 'forest';
  if (/nether|crimson|warped|basalt|soul_sand/.test(value)) return 'nether_wastes';
  if (/end|void/.test(value)) return 'the_end';
  return 'plains';
}

export function biomeIdMap(
  server: { biomes?: Record<string, { id?: number; name?: string }>; biomesArray?: Array<{ id: number; name: string }> },
  vanilla: Array<{ id: number; name: string }>,
): Map<number, number> {
  const targetByName = new Map(vanilla.map(biome => [biome.name.replace(/^minecraft:/, ''), biome.id]));
  const fallback = targetByName.get('plains');
  if (fallback === undefined) throw Error('Minecraft 1.20.6 群系列表缺少 plains');
  const result = new Map<number, number>();
  const add = (key: string, biome: { id?: number; name?: string }) => {
    const id = Number.isInteger(biome.id) ? biome.id! : Number(key);
    if (!Number.isInteger(id) || id < 0) return;
    const name = String(biome.name || '').replace(/^minecraft:/, '');
    result.set(id, targetByName.get(name) ?? targetByName.get(nearestVanillaBiome(name)) ?? fallback);
  };
  for (const [key, biome] of Object.entries(server.biomes || {})) add(key, biome);
  for (const biome of server.biomesArray || []) add(String(biome.id), biome);
  return result;
}

export function remapViewerChunkBiomes(serialized: string, ids: Map<number, number>, fallback: number): string {
  if (ids.size === 0 || typeof serialized !== 'string') return serialized;
  try {
    const chunk = JSON.parse(serialized) as { biomes?: Array<string | null> };
    if (!Array.isArray(chunk.biomes)) return serialized;
    let changed = false;
    chunk.biomes = chunk.biomes.map(section => {
      if (typeof section !== 'string') return section;
      const data = JSON.parse(section) as { type?: string; value?: number; palette?: number[] };
      if (data.type === 'single' && Number.isInteger(data.value)) {
        const next = ids.get(data.value!) ?? fallback;
        if (next !== data.value) { data.value = next; changed = true; return JSON.stringify(data); }
      } else if (data.type === 'indirect' && Array.isArray(data.palette)) {
        const palette = data.palette.map(id => ids.get(id) ?? fallback);
        if (palette.some((id, index) => id !== data.palette![index])) {
          data.palette = palette; changed = true; return JSON.stringify(data);
        }
      }
      return section;
    });
    return changed ? JSON.stringify(chunk) : serialized;
  } catch {
    // Preserve the authoritative chunk if a future serializer changes format.
    return serialized;
  }
}
