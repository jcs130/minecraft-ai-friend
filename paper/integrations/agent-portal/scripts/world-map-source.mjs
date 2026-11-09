import { createHash } from 'node:crypto';
export const playerSelector = '@a[gamemode=!spectator,nbt=!{active_effects:[{id:"minecraft:invisibility"}]}]';
export const readCommands = Object.freeze(Object.fromEntries(['Pos', 'Dimension', 'Rotation'].map(field => [field,
  `minecraft:execute as ${playerSelector} run minecraft:data get entity @s ${field}`])));
const namePattern = '(\\.?[A-Za-z0-9_]{1,16})';
const numberPattern = '(-?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?)[df]?';
const prefix = '^' + namePattern + ' has the following entity data: ';
const position = new RegExp(prefix + '\\[' + [numberPattern, numberPattern, numberPattern].join(',\\s*') + '\\]$');
const rotation = new RegExp(prefix + '\\[' + [numberPattern, numberPattern].join(',\\s*') + '\\]$');
const dimension = new RegExp(prefix + '"(minecraft:(?:overworld|the_nether|the_end))"$');
const excluded = /^(?:goddess|live|ag_photolens|cortieye|corticam)$/i;
export function parseMapObservation(results, usercache, { excludeNames = [] } = {}) {
  const all = {};
  for (const [field, pattern] of [['Pos', position], ['Dimension', dimension], ['Rotation', rotation]]) {
    if (typeof results[field] !== 'string') throw Error('MAP_READ_UNAVAILABLE');
    const rows = new Map();
    for (const line of results[field].trim().split(/\r?\n/).filter(Boolean)) {
      if (/^No (?:entity|entities) (?:was |were )?found/.test(line)) continue;
      const match = pattern.exec(line);
      if (!match || rows.has(match[1])) throw Error('MAP_READ_UNRECOGNIZED_' + field);
      rows.set(match[1], match.slice(2));
    }
    all[field] = rows;
  }
  const cache = new Map(usercache.map(row => [row.name?.toLowerCase(), row.uuid]));
  const blocked = new Set(excludeNames.map(name => name.toLowerCase()));
  const players = [];
  for (const [name, pos] of all.Pos) {
    // A player joining/leaving or switching world during the short sample is
    // omitted. Never fill gaps from the previous observation or another body.
    if (!all.Dimension.has(name) || !all.Rotation.has(name) || excluded.test(name) || blocked.has(name.toLowerCase())) continue;
    const uuid = cache.get(name.toLowerCase());
    if (!/^[a-f0-9-]{36}$/i.test(uuid || '')) continue;
    const [x, y, z] = pos.map(Number), [yaw, pitch] = all.Rotation.get(name).map(Number);
    if (![x, y, z, yaw, pitch].every(Number.isFinite)) throw Error('MAP_READ_NONFINITE');
    players.push({ name, uuid, x, y, z, yaw, pitch, dimension: all.Dimension.get(name)[0] });
  }
  return players;
}
export function fileDigest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
