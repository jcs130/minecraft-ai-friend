export const dimensionIds = Object.freeze({ 'minecraft:overworld': 'overworld', 'minecraft:the_nether': 'nether', 'minecraft:the_end': 'end', 'minecraft:aincrad': 'aincrad' });
export const worldNames = Object.freeze({ overworld: '主世界', nether: '下界', end: '末地', aincrad: '艾恩葛朗特' });
export function positionText(row) { return `X ${Math.floor(row.x)} · Y ${Math.floor(row.y)} · Z ${Math.floor(row.z)}`; }
export function visiblePlayers(state, search = '', now = Date.now()) {
  const observed = Date.parse(state?.observedAt || '');
  if (state?.available !== true || !Number.isFinite(observed) || observed > now + 5000 || now - observed > 20000) return [];
  return [...(state.players || []),...(state.npcs || [])].filter(row => dimensionIds[row.dimension] && row.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
export function covered(row, maps) {
  const world = maps?.find(map => map.dimension === row.dimension);
  return !!world && row.x >= world.bounds.minX && row.x <= world.bounds.maxX && row.z >= world.bounds.minZ && row.z <= world.bounds.maxZ;
}

export const addressKinds = Object.freeze({
  home: '住宅', building: '建筑', room: '房间', garden: '花圃', market: '集市',
  fishing: '钓点', 'dungeon-room': '地下城房间', landmark: '地标'
});

export function directoryIndex(directory) {
  const index = rows => new Map(rows.map(row => [row.id, row]));
  return { districts: index(directory.districts), streets: index(directory.streets), places: index(directory.places) };
}

export function placeStreetId(place, index) {
  return place.streetId ?? index.places.get(place.parentId)?.streetId;
}

export function placeAddress(place, index) {
  const street = index.streets.get(placeStreetId(place, index));
  return [index.districts.get(place.districtId)?.name, street?.name, place.number].filter(Boolean).join(' · ');
}

export function matchingPlaces(directory, { districtId = '', streetId = '', search = '' } = {}, index = directoryIndex(directory)) {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return directory.places.filter(place => {
    if ((districtId && place.districtId !== districtId) || (streetId && placeStreetId(place, index) !== streetId)) return false;
    if (!terms.length) return true;
    const words = [
      place.id, place.name, addressKinds[place.kind], placeAddress(place, index), index.places.get(place.parentId)?.name,
      ...(place.residents || []).flatMap(row => [row.name, row.profession]), ...(place.activities || [])
    ].join(' ').toLowerCase();
    return terms.every(term => words.includes(term));
  });
}
