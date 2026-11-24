/**
 * Runtime dynamic registries from configuration-phase `registry_data`.
 * Entry order is the network id. Tables are replaced per packet and cleared
 * on `start_configuration` so a later session cannot keep a previous server's
 * mapping (including Purpur inserting `paper:raw` into chat_type). Names are
 * taken from the packet; no static Paper offset is applied.
 */
import type { EventEmitter } from 'node:events';

export const RUNTIME_REGISTRY_IDS = [
  'minecraft:chat_type',
  'minecraft:dimension_type',
  'minecraft:worldgen/biome',
  'minecraft:damage_type',
  'minecraft:enchantment',
  'minecraft:instrument',
] as const;

export type RuntimeRegistryId = (typeof RUNTIME_REGISTRY_IDS)[number] | string;

export interface RuntimeRegistryTables {
  /** Full resource names in network-id order, including both vanilla and server-inserted keys. */
  readonly tables: Readonly<Record<string, readonly string[]>>;
}

export interface RuntimeRegistryBot {
  _client: EventEmitter;
  registry?: any;
  supportFeature?: (name: any) => unknown;
}

interface RegistryDataPacket {
  id?: string;
  codec?: { id?: string; entries?: Array<{ key?: string }> };
  entries?: Array<{ key?: string }>;
}

const state = new WeakMap<RuntimeRegistryBot, Map<string, string[]>>();

function tablesOf(bot: RuntimeRegistryBot): Map<string, string[]> {
  let tables = state.get(bot);
  if (!tables) {
    tables = new Map();
    state.set(bot, tables);
  }
  return tables;
}

function shortName(resource: string): string {
  return resource.replace(/^minecraft:/, '');
}

function packetRegistryId(packet: RegistryDataPacket): string | null {
  const id = packet.id ?? packet.codec?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function packetEntries(packet: RegistryDataPacket): string[] | null {
  const entries = packet.entries ?? packet.codec?.entries;
  if (!Array.isArray(entries)) return null;
  return entries.map((entry) => {
    const key = entry?.key;
    return typeof key === 'string' ? key : '';
  });
}

function applyToPrismarine(bot: RuntimeRegistryBot, registryId: string, names: readonly string[]): void {
  const registry = bot.registry;
  if (!registry) return;
  if (registryId === 'minecraft:chat_type') {
    const byId = registry.chatFormattingById ?? (registry.chatFormattingById = {});
    const byName = registry.chatFormattingByName ?? (registry.chatFormattingByName = {});
    for (const key of Object.keys(byId)) delete byId[Number(key) as unknown as number];
    for (const key of Object.keys(byId)) delete byId[key as unknown as number];
    for (const key of Object.keys(byName)) delete byName[key];
    const incremented = registry.supportFeature?.('incrementedChatType') === true
      || bot.supportFeature?.('incrementedChatType') === true;
    names.forEach((resource, id) => {
      const packetId = incremented ? id + 1 : id;
      const current = byId[packetId] as { id?: number; name?: string; formatString?: string; parameters?: string[] } | undefined;
      const entry = {
        id,
        name: resource,
        formatString: current?.formatString ?? '%s',
        parameters: current?.parameters ?? ['content'],
      };
      byId[packetId] = { ...current, ...entry, id, name: resource };
      byName[resource] = byId[packetId];
      byName[shortName(resource)] = byId[packetId];
    });
    return;
  }
  if (registryId === 'minecraft:enchantment') {
    const byId: Record<number, { id: number; name: string; resource: string }> = [];
    const byName: Record<string, { id: number; name: string; resource: string }> = {};
    names.forEach((resource, id) => {
      const entry = { id, name: shortName(resource), resource };
      byId[id] = entry;
      byName[entry.name] = entry;
      byName[resource] = entry;
    });
    registry.enchantments = byId;
    registry.enchantmentsByName = byName;
    registry.enchantmentsArray = names.map((_, id) => byId[id]);
    return;
  }
  if (registryId === 'minecraft:instrument') {
    const byId: Record<number, { id: number; name: string; resource: string }> = [];
    const byName: Record<string, { id: number; name: string; resource: string }> = {};
    names.forEach((resource, id) => {
      const entry = { id, name: shortName(resource), resource };
      byId[id] = entry;
      byName[entry.name] = entry;
      byName[resource] = entry;
    });
    registry.instruments = byId;
    registry.instrumentsByName = byName;
    registry.instrumentsArray = names.map((_, id) => byId[id]);
  }
}


function emptyIndexedTable(table: unknown): void {
  if (!table || typeof table !== 'object') return;
  if (Array.isArray(table)) {
    table.length = 0;
    return;
  }
  for (const key of Object.keys(table)) delete (table as Record<string, unknown>)[key];
}

function clearPrismarineDynamic(bot: RuntimeRegistryBot): void {
  const registry = bot.registry;
  if (!registry) return;
  if (registry.chatFormattingById) {
    for (const key of Object.keys(registry.chatFormattingById)) {
      delete registry.chatFormattingById[key as unknown as number];
    }
  }
  if (registry.chatFormattingByName) {
    for (const key of Object.keys(registry.chatFormattingByName)) delete registry.chatFormattingByName[key];
  }
  if (registry.dimensionsById) {
    for (const key of Object.keys(registry.dimensionsById)) delete registry.dimensionsById[key as unknown as number];
  }
  if (registry.dimensionsByName) {
    for (const key of Object.keys(registry.dimensionsByName)) delete registry.dimensionsByName[key];
  }
  if (Array.isArray(registry.dimensionsArray)) registry.dimensionsArray.length = 0;
  // prismarine-registry's static biomes table is an id-keyed object, not a dense array.
  // biomeAt reads registry.biomes[id]; length=0 would leave object entries in place.
  emptyIndexedTable(registry.biomes);
  emptyIndexedTable(registry.biomesByName);
  emptyIndexedTable(registry.biomesArray);
  // Fail closed until the next enchantment registry_data; do not keep static ids across configuration.
  if (registry.enchantments && tablesOf(bot).has('minecraft:enchantment')) {
    registry.enchantments = [];
    registry.enchantmentsByName = {};
    registry.enchantmentsArray = [];
  }
  if (registry.instruments && tablesOf(bot).has('minecraft:instrument')) {
    registry.instruments = [];
    registry.instrumentsByName = {};
    registry.instrumentsArray = [];
  }
}

function ingest(bot: RuntimeRegistryBot, packet: RegistryDataPacket): void {
  const id = packetRegistryId(packet);
  const entries = packetEntries(packet);
  if (!id || !entries) return;
  tablesOf(bot).set(id, entries);
  applyToPrismarine(bot, id, entries);
}

export function installRuntimeRegistry(bot: RuntimeRegistryBot): () => void {
  const client = bot._client;
  const registry = bot.registry as { loadDimensionCodec?: (codec: RegistryDataPacket) => void } | undefined;
  const originalLoad = registry?.loadDimensionCodec?.bind(registry);
  if (registry && originalLoad) {
    registry.loadDimensionCodec = (codec: RegistryDataPacket) => {
      originalLoad(codec);
      ingest(bot, codec);
    };
  }
  const onRegistryData = (packet: RegistryDataPacket) => {
    // Mineflayer's loadDimensionCodec rebuilds chatFormatting* and would drop
    // undecorated types such as paper:raw if we applied first. Ingest after
    // the other listeners on this packet have finished.
    queueMicrotask(() => ingest(bot, packet));
  };
  const onStartConfiguration = () => {
    clearPrismarineDynamic(bot);
    tablesOf(bot).clear();
  };
  const dispose = () => {
    if (registry && originalLoad && registry.loadDimensionCodec !== originalLoad) {
      registry.loadDimensionCodec = originalLoad;
    }
    client.removeListener('registry_data', onRegistryData);
    client.removeListener('start_configuration', onStartConfiguration);
    client.removeListener('end', dispose);
    state.delete(bot);
  };
  client.on('registry_data', onRegistryData);
  client.on('start_configuration', onStartConfiguration);
  client.once('end', dispose);
  return dispose;
}

export function runtimeRegistryName(bot: RuntimeRegistryBot, registryId: RuntimeRegistryId, id: number): string | null {
  if (!Number.isSafeInteger(id) || id < 0) return null;
  const names = tablesOf(bot).get(registryId);
  if (!names || id >= names.length) return null;
  return names[id] ?? null;
}

export function runtimeRegistryShortName(bot: RuntimeRegistryBot, registryId: RuntimeRegistryId, id: number): string | null {
  const name = runtimeRegistryName(bot, registryId, id);
  return name === null ? null : shortName(name);
}

export function runtimeRegistryId(bot: RuntimeRegistryBot, registryId: RuntimeRegistryId, name: string): number | null {
  const names = tablesOf(bot).get(registryId);
  if (!names) return null;
  const full = name.includes(':') ? name : `minecraft:${name}`;
  const index = names.indexOf(full);
  if (index >= 0) return index;
  const short = names.findIndex((entry) => shortName(entry) === shortName(name));
  return short >= 0 ? short : null;
}

export function runtimeRegistryEntries(bot: RuntimeRegistryBot, registryId: RuntimeRegistryId): readonly string[] {
  return tablesOf(bot).get(registryId) ?? [];
}

/** Semantic export: current dynamic tables as resource names in network-id order. */
export function runtimeRegistryFacts(bot: RuntimeRegistryBot): RuntimeRegistryTables {
  const tables: Record<string, readonly string[]> = {};
  for (const [id, names] of tablesOf(bot)) tables[id] = [...names];
  return { tables };
}

/**
 * Chat packet type ids are 0-based on 26.2 (`incrementedChatType` is false) and
 * 1-based on some 1.21 revisions. The adjustment comes from the live feature
 * flag, never from a hardcoded Paper offset.
 */
export function runtimeChatTypeName(bot: RuntimeRegistryBot, packetTypeId: number): string | null {
  if (!Number.isSafeInteger(packetTypeId) || packetTypeId < 0) return null;
  const incremented = bot.registry?.supportFeature?.('incrementedChatType') === true
    || bot.supportFeature?.('incrementedChatType') === true;
  const tableId = incremented ? packetTypeId - 1 : packetTypeId;
  return runtimeRegistryName(bot, 'minecraft:chat_type', tableId);
}
