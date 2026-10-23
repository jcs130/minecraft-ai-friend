/** A bounded overhead sample of blocks already loaded by the bot. */

const RADIUS = 12;
const MAX_Y_ABOVE = 9;
const MAX_Y_BELOW = 18;

type Column = { minY?: number; worldHeight?: number;
  getBlockStateId(position: { x: number; y: number; z: number }): number };
type MapSource = {
  entity: { position: { x: number; y: number; z: number } };
  game: { dimension?: string };
  world: { getColumn(x: number, z: number): Column | null | undefined };
  registry: { blocksByStateId?: Record<number, { name?: string }> };
};

export function terrainKind(name: string): string {
  if (!name || name === 'air' || name.endsWith('_air')) return ' ';
  if (name.includes('water') || name === 'bubble_column') return 'W';
  if (name.includes('lava')) return 'L';
  if (name.includes('leaves') || name.includes('vine')) return 'F';
  if (name.includes('log') || name.includes('stem') || name.includes('wood')) return 'T';
  if (name.includes('grass') || name.includes('moss') || name.includes('azalea')) return 'G';
  if (name.includes('path') || name.includes('farmland')) return 'P';
  if (name.includes('sand') || name.includes('terracotta')) return 'S';
  if (name.includes('snow') || name.includes('ice')) return 'N';
  if (name.includes('flower') || name.includes('crop') || name.includes('wheat')) return 'C';
  if (name.includes('stone') || name.includes('ore') || name.includes('tuff')) return 'R';
  if (name.includes('dirt') || name.includes('mud') || name.includes('clay')) return 'B';
  if (name.includes('planks') || name.includes('brick') || name.includes('cobble') || name.includes('glass')) return 'H';
  return 'X';
}

export function minimapSnapshot(source: MapSource) {
  const position = source.entity.position;
  const centerX = Math.floor(position.x);
  const centerZ = Math.floor(position.z);
  const playerY = Math.floor(position.y);
  const blocks = source.registry.blocksByStateId ?? {};
  const columns = new Map<string, Column | null>();
  const cells: string[] = [];
  for (let dz = -RADIUS; dz <= RADIUS; dz++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const worldX = centerX + dx;
      const worldZ = centerZ + dz;
      const chunkX = Math.floor(worldX / 16);
      const chunkZ = Math.floor(worldZ / 16);
      const key = `${chunkX},${chunkZ}`;
      if (!columns.has(key)) columns.set(key, source.world.getColumn(chunkX, chunkZ) ?? null);
      const column = columns.get(key);
      if (!column) { cells.push('?'); continue; }
      const localX = worldX - chunkX * 16;
      const localZ = worldZ - chunkZ * 16;
      const top = Math.min(playerY + MAX_Y_ABOVE, (column.minY ?? -64) + (column.worldHeight ?? 384) - 1);
      const bottom = Math.max(playerY - MAX_Y_BELOW, column.minY ?? -64);
      let kind = ' ';
      for (let y = top; y >= bottom; y--) {
        const stateId = column.getBlockStateId({ x: localX, y, z: localZ });
        const name = blocks[stateId]?.name ?? '';
        kind = terrainKind(name);
        if (kind !== ' ') break;
      }
      cells.push(kind);
    }
  }
  return { centerX, centerZ, radius: RADIUS, sampleY: playerY,
    dimension: String(source.game.dimension || 'minecraft:overworld'), cells: cells.join('') };
}
