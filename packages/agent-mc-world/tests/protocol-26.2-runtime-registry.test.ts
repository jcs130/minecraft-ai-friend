import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  experimental26_2VendorRoot,
  installExperimentalMinecraftDataResolution,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';
import {
  installRuntimeRegistry,
  runtimeChatTypeName,
  runtimeRegistryEntries,
  runtimeRegistryFacts,
  runtimeRegistryId,
  runtimeRegistryName,
  runtimeRegistryShortName,
  type RuntimeRegistryBot,
} from '../core/runtime-registry.ts';
import { readEnchants, readInstrument } from '../core/item-facts.ts';
import { biomeAt } from '../core/terrain.ts';
import { biomeIdMap } from '../core/viewer-biome.ts';
import { trackDamageSources, takeSelfDamage } from '../core/damage-source.ts';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vanillaPath = join(root, 'tests/fixtures/vanilla-26.2/vanilla-live-registry_data.json');
const purpurPath = join(root, 'tests/fixtures/vanilla-26.2/purpur-chain-registry_data.json');

type RegistryFile = Record<string, { size: number; keys: string[] }>;

const vanilla = JSON.parse(readFileSync(vanillaPath, 'utf8')) as RegistryFile;
const purpur = JSON.parse(readFileSync(purpurPath, 'utf8')) as RegistryFile;

const TRACKED = [
  'minecraft:chat_type',
  'minecraft:dimension_type',
  'minecraft:worldgen/biome',
  'minecraft:damage_type',
  'minecraft:enchantment',
  'minecraft:instrument',
] as const;

beforeAll(() => {
  installExperimentalMinecraftDataResolution();
});

afterAll(() => {
  uninstallExperimentalMinecraftDataResolution();
});

const rigs: Array<() => void> = [];
afterEach(() => { for (const dispose of rigs.splice(0)) dispose(); });

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function rig() {
  const prismarine = require('prismarine-registry')('26.2');
  const bot: RuntimeRegistryBot & { entity?: { id: number }; entities: Record<number, { name: string }> } = {
    _client: new EventEmitter(),
    registry: prismarine,
    supportFeature: (name: string) => prismarine.supportFeature(name),
    entity: { id: 1 },
    entities: {},
  };
  const dispose = installRuntimeRegistry(bot);
  rigs.push(dispose);
  const feed = async (tables: RegistryFile) => {
    for (const id of TRACKED) {
      bot._client.emit('registry_data', { id, entries: tables[id].keys.map((key) => ({ key })) });
    }
    await flush();
  };
  return { bot, feed, client: bot._client, registry: prismarine };
}

describe('26.2 core runtime registry consumption', () => {
  it('keeps incrementedChatType off so 26.2 chat packet ids stay 0-based', () => {
    const { registry } = rig();
    expect(registry.supportFeature('incrementedChatType')).toBe(false);
    expect(registry.supportFeature('segmentedRegistryCodecData')).toBe(true);
  });

  it('maps vanilla and Purpur chat ids from the live tables without a hardcoded paper offset', async () => {
    const { bot, feed, client } = rig();
    await feed(vanilla);
    expect(runtimeRegistryEntries(bot, 'minecraft:chat_type')).toEqual(vanilla['minecraft:chat_type'].keys);
    expect(runtimeRegistryName(bot, 'minecraft:chat_type', 4)).toBe('minecraft:say_command');
    expect(runtimeChatTypeName(bot, 4)).toBe('minecraft:say_command');
    expect(runtimeRegistryId(bot, 'minecraft:chat_type', 'say_command')).toBe(4);

    client.emit('start_configuration');
    expect(runtimeRegistryName(bot, 'minecraft:chat_type', 4)).toBeNull();
    expect(runtimeRegistryFacts(bot).tables).toEqual({});

    await feed(purpur);
    expect(runtimeRegistryName(bot, 'minecraft:chat_type', 4)).toBe('paper:raw');
    expect(runtimeChatTypeName(bot, 4)).toBe('paper:raw');
    expect(runtimeRegistryName(bot, 'minecraft:chat_type', 5)).toBe('minecraft:say_command');
    expect(runtimeRegistryId(bot, 'minecraft:chat_type', 'minecraft:say_command')).toBe(5);
    expect(runtimeRegistryId(bot, 'minecraft:chat_type', 'paper:raw')).toBe(4);
    // Same numeric id, different names after a real table replacement — not a static offset.
    expect(purpur['minecraft:chat_type'].keys[4]).toBe('paper:raw');
    expect(vanilla['minecraft:chat_type'].keys[4]).toBe('minecraft:say_command');

    client.emit('start_configuration');
    await feed(vanilla);
    expect(runtimeRegistryName(bot, 'minecraft:chat_type', 4)).toBe('minecraft:say_command');
    expect(runtimeRegistryName(bot, 'minecraft:chat_type', 5)).toBe('minecraft:team_msg_command_incoming');
    expect(runtimeRegistryEntries(bot, 'minecraft:chat_type')).not.toContain('paper:raw');
  });

  it('replaces dimension, damage, enchantment, instrument and biome tables from each packet', async () => {
    const { bot, feed } = rig();
    await feed(vanilla);
    for (const id of TRACKED) {
      expect(runtimeRegistryEntries(bot, id), id).toEqual(vanilla[id].keys);
      expect(vanilla[id].keys).toHaveLength(vanilla[id].size);
    }
    expect(runtimeRegistryName(bot, 'minecraft:dimension_type', 0)).toBe('minecraft:overworld');
    expect(runtimeRegistryName(bot, 'minecraft:instrument', 4)).toBe('minecraft:ponder_goat_horn');
    expect(runtimeRegistryId(bot, 'minecraft:enchantment', 'sharpness')).toBe(
      vanilla['minecraft:enchantment'].keys.indexOf('minecraft:sharpness'),
    );
    expect(runtimeRegistryName(bot, 'minecraft:damage_type', 37)).toBe('minecraft:spear');
    expect(runtimeRegistryEntries(bot, 'minecraft:worldgen/biome')).toHaveLength(66);
  });

  it('exports semantic facts and feeds damage plus enchantment lookups after a configuration swap', async () => {
    const { bot, feed, client, registry } = rig();
    trackDamageSources(bot as never);
    await feed(vanilla);
    const sharpness = vanilla['minecraft:enchantment'].keys.indexOf('minecraft:sharpness');
    expect(readEnchants({
      name: 'diamond_sword',
      componentMap: new Map([['enchantments', { type: 'enchantments', data: { enchantments: [{ id: sharpness, level: 5 }] } }]]),
    }, registry)).toEqual([{ name: 'sharpness', level: 5 }]);

    bot.entity = { id: 1 };
    bot.entities = {};
    client.emit('damage_event', { entityId: 1, sourceTypeId: 37, sourceCauseId: 0, sourceDirectId: 0 });
    expect(takeSelfDamage(bot as never)).toEqual([expect.objectContaining({ type: 'spear' })]);

    const facts = runtimeRegistryFacts(bot);
    expect(facts.tables['minecraft:chat_type'][4]).toBe('minecraft:say_command');
    expect(facts.tables['minecraft:instrument'][4]).toBe('minecraft:ponder_goat_horn');

    client.emit('start_configuration');
    expect(readEnchants({
      name: 'diamond_sword',
      componentMap: new Map([['enchantments', { type: 'enchantments', data: { enchantments: [{ id: sharpness, level: 5 }] } }]]),
    }, registry)).toEqual([]);
    client.emit('damage_event', { entityId: 1, sourceTypeId: 37, sourceCauseId: 0, sourceDirectId: 0 });
    expect(takeSelfDamage(bot as never)).toEqual([expect.objectContaining({ type: null })]);

    await feed(purpur);
    expect(runtimeRegistryFacts(bot).tables['minecraft:chat_type'][4]).toBe('paper:raw');
    expect(readEnchants({
      name: 'diamond_sword',
      componentMap: new Map([['enchantments', { type: 'enchantments', data: { enchantments: [{ id: sharpness, level: 5 }] } }]]),
    }, registry)).toEqual([{ name: 'sharpness', level: 5 }]);
    client.emit('damage_event', { entityId: 1, sourceTypeId: 37, sourceCauseId: 0, sourceDirectId: 0 });
    expect(takeSelfDamage(bot as never)).toEqual([expect.objectContaining({ type: 'spear' })]);
  });

  it('keeps paper:raw in the live chat table even if prismarine skips undecorated types', async () => {
    const { bot, client, registry } = rig();
    const nbt = require('prismarine-nbt');
    const decorated = vanilla['minecraft:chat_type'].keys.map((key) => ({
      key,
      value: key === 'minecraft:chat'
        ? nbt.comp({ chat: nbt.comp({ translation_key: nbt.string('chat.type.text'), parameters: nbt.list(nbt.string(['sender', 'content'])) }) })
        : nbt.comp({}),
    }));
    const purpurEntries = [
      ...decorated.slice(0, 4),
      { key: 'paper:raw', value: nbt.comp({}) },
      ...decorated.slice(4),
    ];
    registry.loadDimensionCodec({ id: 'minecraft:chat_type', entries: purpurEntries });
    await flush();
    expect(runtimeRegistryName(bot, 'minecraft:chat_type', 4)).toBe('paper:raw');
    expect((registry.chatFormattingById as Record<number, { name: string }>)[4]?.name).toBe('paper:raw');
    expect((registry.chatFormattingById as Record<number, { name: string }>)[5]?.name).toBe('minecraft:say_command');
    client.emit('start_configuration');
    expect(runtimeRegistryName(bot, 'minecraft:chat_type', 4)).toBeNull();
    expect(registry.chatFormattingById[4]).toBeUndefined();
  });
  it('records the 2026-11-23 live Velocity A/B and menu evidence without treating it as an exhaustive branch claim', () => {
    const evidence = require('./fixtures/vanilla-26.2/windows-and-registry-live-evidence.json');
    expect(evidence.vanilla.chatTypeId4).toBe('minecraft:say_command');
    expect(evidence.purpurViaVelocity.limboChatTypeId4).toBe('minecraft:say_command');
    expect(evidence.purpurViaVelocity.afterTransfer.chatTypeId4).toBe('paper:raw');
    expect(evidence.purpurViaVelocity.afterTransfer.chatTypeId5).toBe('minecraft:say_command');
    expect(evidence.purpurViaVelocity.afterTransfer.start_configuration).toBe(1);
    expect(evidence.purpurViaVelocity.vanillaBlockBoundary).toMatch(/no vanilla 26.2 block/);
    expect(evidence.vanilla.generic_9x6).toMatchObject({ inventoryType: 5, slotCount: 90, inventoryStart: 54 });
    expect(evidence.vanilla.lectern).toMatchObject({ inventoryType: 17, slotCount: 1 });
    expect(evidence.vanilla.merchant).toMatchObject({ inventoryType: 19, slotCount: 39, inventoryStart: 3 });
    expect(evidence.purpurViaVelocity.menus.generic_9x1).toMatchObject({ inventoryType: 0, slotCount: 45, inventoryStart: 9 });
    expect(evidence.purpurViaVelocity.menus.generic_9x5).toMatchObject({ inventoryType: 4, slotCount: 81, inventoryStart: 45 });
  });

  it('core consumers follow live chat/damage/enchantment/instrument tables and fail closed after start_configuration', async () => {
    const { bot, client, registry, feed } = rig();
    await feed(vanilla);
    expect(runtimeChatTypeName(bot, 4)).toBe('minecraft:say_command');
    expect((registry.chatFormattingById as Record<number, { name: string }>)[4]?.name).toBe('minecraft:say_command');
    expect(runtimeRegistryName(bot, 'minecraft:damage_type', 37)).toBe('minecraft:spear');
    expect(runtimeRegistryShortName(bot, 'minecraft:instrument', 4)).toBe('ponder_goat_horn');
    expect((registry as any).instruments?.[4]?.name).toBe('ponder_goat_horn');
    expect(readInstrument({
      name: 'goat_horn',
      componentMap: new Map([['instrument', { type: 'instrument', data: { id: 4 } }]]),
    }, registry)).toBe('ponder_goat_horn');
    const sharpness = runtimeRegistryId(bot, 'minecraft:enchantment', 'minecraft:sharpness');
    expect(readEnchants({
      name: 'diamond_sword',
      componentMap: new Map([['enchantments', { type: 'enchantments', data: { enchantments: [{ id: sharpness, level: 5 }] } }]]),
    }, registry)).toEqual([{ name: 'sharpness', level: 5 }]);
    expect(runtimeRegistryName(bot, 'minecraft:dimension_type', 0)).toMatch(/overworld|the_nether|the_end/);
    expect(runtimeRegistryEntries(bot, 'minecraft:worldgen/biome').length).toBeGreaterThan(0);

    client.emit('start_configuration');
    expect(runtimeChatTypeName(bot, 4)).toBeNull();
    expect(runtimeRegistryName(bot, 'minecraft:damage_type', 37)).toBeNull();
    expect(runtimeRegistryName(bot, 'minecraft:instrument', 4)).toBeNull();
    expect((registry as any).instruments?.[4]).toBeUndefined();
    expect(readInstrument({
      name: 'goat_horn',
      componentMap: new Map([['instrument', { type: 'instrument', data: { id: 4 } }]]),
    }, registry)).toBeNull();
    const biomeBot = { registry, blockAt: () => ({ biome: { id: 0 } }) };
    expect(biomeAt(biomeBot, { x: 0, y: 64, z: 0 })).toBe('unknown');
    expect(biomeIdMap(registry, [{ id: 0, name: 'plains' }, { id: 1, name: 'forest' }]).size).toBe(0);
    expect(readEnchants({
      name: 'diamond_sword',
      componentMap: new Map([['enchantments', { type: 'enchantments', data: { enchantments: [{ id: sharpness, level: 5 }] } }]]),
    }, registry)).toEqual([]);
    expect(registry.chatFormattingById[4]).toBeUndefined();

    await feed(purpur);
    expect(runtimeChatTypeName(bot, 4)).toBe('paper:raw');
    expect((registry.chatFormattingById as Record<number, { name: string }>)[4]?.name).toBe('paper:raw');
    expect(runtimeChatTypeName(bot, 5)).toBe('minecraft:say_command');
    expect(runtimeRegistryName(bot, 'minecraft:damage_type', 37)).toBe('minecraft:spear');
    expect(readEnchants({
      name: 'diamond_sword',
      componentMap: new Map([['enchantments', { type: 'enchantments', data: { enchantments: [{ id: sharpness, level: 5 }] } }]]),
    }, registry)).toEqual([{ name: 'sharpness', level: 5 }]);
  });
});
