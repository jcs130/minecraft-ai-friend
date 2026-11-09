export const dimensionIds = Object.freeze({ 'minecraft:overworld': 'overworld', 'minecraft:the_nether': 'nether', 'minecraft:the_end': 'end' });
export const worldNames = Object.freeze({ overworld: '主世界', nether: '下界', end: '末地' });
export function positionText(row) { return `X ${Math.floor(row.x)} · Y ${Math.floor(row.y)} · Z ${Math.floor(row.z)}`; }
export function visiblePlayers(state, search = '', now = Date.now()) {
  const observed = Date.parse(state?.observedAt || '');
  if (state?.available !== true || !Number.isFinite(observed) || observed > now + 5000 || now - observed > 20000) return [];
  return (state.players || []).filter(row => dimensionIds[row.dimension] && row.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
export function covered(row, maps) {
  const world = maps?.find(map => map.dimension === row.dimension);
  return !!world && row.x >= world.bounds.minX && row.x <= world.bounds.maxX && row.z >= world.bounds.minZ && row.z <= world.bounds.maxZ;
}
