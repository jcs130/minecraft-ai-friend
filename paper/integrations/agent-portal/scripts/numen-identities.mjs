import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nbt from 'prismarine-nbt';
import { UUID, RESERVED } from '../src/game-data.mjs';

const nameOK = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(value) && !RESERVED.has(value.toLowerCase()) && !/eye$/i.test(value);
export function uuidFromIntArray(value) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(n => !Number.isInteger(n) || n < -2147483648 || n > 2147483647)) return null;
  const hex = value.map(n => (n >>> 0).toString(16).padStart(8, '0')).join('');
  return /^0+$/.test(hex) ? null : `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function registryIdentities(data) {
  const entries = data?.data?.companions;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length > 256) return [];
  return Object.entries(entries).filter(([uuid, row]) => UUID.test(uuid) && nameOK(row?.name) && !row.removedFor && UUID.test(row?.owner || '') && uuid.toLowerCase() !== row.owner.toLowerCase()).map(([uuid, row]) => ({ playerUuid: uuid.toLowerCase(), name: row.name, ownerPlayerUuid: row.owner.toLowerCase(), source: 'Numen.CompanionRegistry' }));
}
const intTag = /\[I; (-?\d+), (-?\d+), (-?\d+), (-?\d+)\]/g;
export function intArrayTags(reply) { return [...String(reply).matchAll(intTag)].map(match => uuidFromIntArray(match.slice(1).map(Number))).filter(Boolean); }

// Native creation is observed from the server's own registry AND online body
// NBT. Public/display names and chat messages never establish a relationship.
// These are fixed read-only console queries; no remote command is forwarded.
export async function readNumenIdentities(settings, commandOverride) {
  if (!path.isAbsolute(settings.serverDir || '')) throw Error('NUMEN_SERVER_DIRECTORY_INVALID');
  const records = new Map();
  try {
    const file = path.join(settings.serverDir, 'world', 'data', 'numen_companions.dat');
    if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw Error('NUMEN_REGISTRY_TOO_LARGE');
    const parsed = await nbt.parse(await fs.readFile(file));
    for (const row of registryIdentities(nbt.simplify(parsed.parsed))) records.set(row.playerUuid, row);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (settings.live !== false) {
    if (!commandOverride && !path.isAbsolute(settings.rconClientModule || '')) throw Error('NUMEN_RCON_MODULE_INVALID');
    const command = commandOverride || (await import(pathToFileURL(settings.rconClientModule).href)).command;
    const rosterReply = await command('minecraft:list uuids', 3000), roster = new Map();
    for (const match of rosterReply.matchAll(/(?:^|[:,]\s*)([A-Za-z0-9_]{1,16}) \(([0-9a-f-]{36})\)/gi)) if (UUID.test(match[2])) roster.set(match[2].toLowerCase(), match[1]);
    const bodyReply = await command('minecraft:execute as @a if data entity @s NumenOwner run minecraft:data get entity @s UUID', 3000);
    for (const uuid of [...new Set(intArrayTags(bodyReply))].slice(0, 64)) {
      const name = roster.get(uuid); if (!nameOK(name)) continue;
      const owners = intArrayTags(await command('minecraft:data get entity ' + name + ' NumenOwner', 3000));
      if (owners.length !== 1 || owners[0] === uuid) continue;
      records.set(uuid, { playerUuid: uuid, name, ownerPlayerUuid: owners[0], source: 'Numen.live-owner-tag' });
    }
  }
  return { schemaVersion: 1, observedAt: Date.now(), companions: [...records.values()].slice(0, 256) };
}
