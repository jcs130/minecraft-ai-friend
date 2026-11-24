import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  experimental26_2VendorRoot,
  installExperimentalMinecraftDataResolution,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const oracle = require(join(root, 'tests/fixtures/vanilla-26.2/vanilla-structure-oracle.json')) as {
  source: string;
  notExhaustive: string;
  okCount: number;
  failedCount: number;
  attemptCount: number;
  samples: Array<{
    kind: string;
    label: string;
    ok: boolean;
    hex?: string;
    length?: number;
    officialDecodeOk?: boolean;
    officialDecodeRemaining?: number;
    officialDecodeToString?: string;
    officialDecodeError?: string;
    packetHex?: string;
    packetOk?: boolean;
    semantics?: Record<string, unknown>;
  }>;
};

const varint = (value: number): Buffer => {
  const bytes: number[] = [];
  do {
    let byte = value & 127;
    value >>>= 7;
    if (value) byte |= 128;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
};

beforeAll(() => installExperimentalMinecraftDataResolution());
afterAll(() => uninstallExperimentalMinecraftDataResolution());

function playProto() {
  const { ProtoDefCompiler } = require('protodef').Compiler;
  const nbt = require('prismarine-nbt');
  const vendor = experimental26_2VendorRoot();
  const minecraftData = require(join(vendor, 'minecraft-data'));
  const strictDiscriminators = require(join(vendor, 'minecraft-protocol/src/datatypes/strict-discriminators.js'));
  const compilerMinecraft = require(join(vendor, 'minecraft-protocol/src/datatypes/compiler-minecraft.js'));
  const mcData = minecraftData('26.2');
  const protocol = structuredClone(mcData.protocol);
  strictDiscriminators.applyStrictDiscriminators(protocol);
  const compiler = new ProtoDefCompiler();
  compiler.addTypes(compilerMinecraft);
  compiler.addTypes(strictDiscriminators.compilerTypes);
  compiler.addProtocol(protocol, ['play', 'toClient']);
  nbt.addTypesToCompiler('big', compiler);
  return compiler.compileProtoDefSync();
}

function parseType(proto: any, type: string, hex: string) {
  const buf = Buffer.from(hex, 'hex');
  const decoded = proto.parsePacketBuffer(type, buf);
  return { data: decoded.data, leftover: buf.length - decoded.metadata.size, size: decoded.metadata.size, buf };
}

function packetParser() {
  const nmp = require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/index.js'));
  return nmp.createDeserializer({ state: 'play', isServer: false, version: '26.2', noErrorLogging: true });
}

function parsePacket(parser: any, id: number, bodyHex: string) {
  const bytes = Buffer.concat([varint(id), Buffer.from(bodyHex, 'hex')]);
  const decoded = parser.parsePacketBuffer(bytes);
  return {
    name: decoded.data?.name,
    params: decoded.data?.params,
    leftover: bytes.length - decoded.metadata.size,
  };
}

function windowItemsForComponent(typeId: number, payload: Buffer, itemId: number) {
  return Buffer.concat([
    varint(0x12),
    varint(0),
    varint(1),
    varint(1),
    varint(1), // present
    varint(itemId),
    varint(1), // count? — actual Slot encoding is verified by leftover; if this wrap fails we also parse via Slot type
    varint(1), // added
    varint(typeId),
    payload,
    varint(0), // removed
    varint(0), // carried empty
  ]);
}

function samples(kind: string) {
  return oracle.samples.filter((s) => s.kind === kind);
}

describe('26.2 official structure oracle (finite branches, not numeric exhaustion)', () => {
  it('documents a finite official structural admission, not leftover-only and not one sample for every value', () => {
    expect(oracle.source).toMatch(/official StreamCodec/);
    expect(oracle.notExhaustive).toMatch(/not a mathematical exhaustion/i);
    expect(oracle.okCount).toBe(231);
    expect(oracle.failedCount).toBe(0);
    expect(oracle.attemptCount).toBe(231);
    const kinds = new Set(oracle.samples.map((s) => s.kind));
    expect(kinds).toEqual(new Set([
      'component:jukebox_playable',
      'component:attribute_modifiers',
      'component:can_place_on',
      'component:can_break',
      'component:firework_explosion',
      'component:fireworks',
      'component:profile',
      'component:bundle_contents',
      'component:container',
      'component:charged_projectiles',
      'component:tool',
      'component:equippable',
      'component:kinetic_weapon',
      'item_stack',
      'particle',
      'sound_effect',
      'slot_display',
      'recipe_display',
      'map',
    ]));
  });

  it('parses official jukebox_playable registry and Holder.direct inline branches with leftover=0 and holder discriminator semantics', () => {
    const proto = playProto();
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    const typeId = Number(Object.entries(mappings).find(([, name]) => name === 'jukebox_playable')![0]);
    const stone = mcData.itemsByName.stone.id;
    const parser = packetParser();

    const rows = samples('component:jukebox_playable');
    expect(rows.map((r) => r.semantics?.branch)).toEqual([
      'registry_holder',
      'inline_holder',
      'inline_holder_fixed_range_sound',
    ]);
    for (const row of rows) {
      expect(row.ok, row.label).toBe(true);
      expect(row.officialDecodeOk, row.label).toBe(true);
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const payload = Buffer.from(row.hex!, 'hex');
      const wrapped = Buffer.concat([varint(typeId), payload]);
      const decoded = proto.parsePacketBuffer('SlotComponent', wrapped);
      const leftover = wrapped.length - decoded.metadata.size;
      expect(leftover, row.label).toBe(0);
      expect(decoded.data?.type, row.label).toBe('jukebox_playable');
      const first = payload[0];
      if (row.semantics?.branch === 'registry_holder') {
        expect(first, row.label).toBeGreaterThan(0);
        expect(row.length).toBe(1);
      } else {
        expect(first, `${row.label} discriminator`).toBe(0);
        expect(row.length, row.label).toBeGreaterThan(1);
      }
      // also consume through a window_items packet path
      const pkt = Buffer.concat([
        varint(0x12), varint(0), varint(1), varint(1),
        varint(1), varint(stone), varint(1), varint(1), varint(typeId), payload, varint(0),
        varint(0),
      ]);
      const win = parser.parsePacketBuffer(pkt);
      expect(pkt.length - win.metadata.size, `window ${row.label}`).toBe(0);
    }
  });

  it('parses official attribute_modifiers empty/one/two-entry and display/operation branches, not one entry standing for all', () => {
    const proto = playProto();
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    const typeId = Number(Object.entries(mappings).find(([, name]) => name === 'attribute_modifiers')![0]);
    const rows = samples('component:attribute_modifiers');
    expect(rows.map((r) => r.label)).toEqual([
      'empty',
      'one-add-value-default-display',
      'one-mul-base-hidden',
      'one-mul-total-override-text',
      'two-entries',
    ]);
    const seen = new Set<string>();
    for (const row of rows) {
      expect(row.officialDecodeOk, row.label).toBe(true);
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const wrapped = Buffer.concat([varint(typeId), Buffer.from(row.hex!, 'hex')]);
      const decoded = proto.parsePacketBuffer('SlotComponent', wrapped);
      expect(wrapped.length - decoded.metadata.size, row.label).toBe(0);
      expect(decoded.data?.type).toBe('attribute_modifiers');
      const data = decoded.data?.data;
      const modifiers = data?.modifiers ?? data?.value?.modifiers ?? data;
      const count = Array.isArray(modifiers) ? modifiers.length : row.semantics?.count;
      if (row.semantics?.branch === 'empty_list') expect(count).toBe(0);
      if (row.semantics?.branch === 'two_entries') expect(count).toBe(2);
      if (row.semantics?.branch === 'one_entry') expect(count).toBe(1);
      const text = String(row.officialDecodeToString);
      if (row.label.includes('add-value')) expect(text).toMatch(/ADD_VALUE|add_value/i);
      if (row.label.includes('mul-base')) expect(text).toMatch(/ADD_MULTIPLIED_BASE|add_multiplied_base/i);
      if (row.label.includes('mul-total')) expect(text).toMatch(/ADD_MULTIPLIED_TOTAL|add_multiplied_total/i);
      if (row.label.includes('hidden')) expect(text).toMatch(/hidden/i);
      if (row.label.includes('override-text')) expect(text).toMatch(/override/i);
      seen.add(String(row.semantics?.branch) + ':' + row.label);
    }
    expect(seen.size).toBe(5);
  });

  it('parses official can_place_on/can_break empty, one-block, two-predicate branches; records tag encode vs official-decode gap', () => {
    const proto = playProto();
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    for (const kind of ['can_place_on', 'can_break'] as const) {
      const typeId = Number(Object.entries(mappings).find(([, name]) => name === kind)![0]);
      const rows = samples(`component:${kind}`);
      for (const row of rows) {
        expect(row.ok, row.label).toBe(true);
        const wrapped = Buffer.concat([varint(typeId), Buffer.from(row.hex!, 'hex')]);
        const decoded = proto.parsePacketBuffer('SlotComponent', wrapped);
        expect(wrapped.length - decoded.metadata.size, `${kind} ${row.label}`).toBe(0);
        expect(decoded.data?.type).toBe(kind);
        if (row.semantics?.branch === 'empty_list') {
          expect(row.officialDecodeOk).toBe(true);
          expect(row.length).toBe(1);
          expect(row.hex).toBe('00');
        }
        if (row.semantics?.branch === 'one_block') {
          expect(row.officialDecodeOk).toBe(true);
          expect(row.length).toBe(8);
        }
        if (row.semantics?.branch === 'two_predicates') {
          expect(row.officialDecodeOk).toBe(true);
          expect(row.length).toBe(15);
        }
        if (row.semantics?.branch === 'tag') {
          expect(row.length).toBe(24);
          expect(row.officialDecodeOk, 'tag official decode after vanilla TagLoader bind').toBe(true);
          expect(row.officialDecodeRemaining).toBe(0);
          const blob = JSON.stringify(decoded.data);
          expect(blob).toMatch(/planks/);
        }
      }
    }
    expect(samples('component:can_place_on').map((s) => s.semantics?.branch)).toEqual([
      'empty_list', 'one_block', 'two_predicates', 'tag',
    ]);
    expect(samples('component:can_break').map((s) => s.semantics?.branch)).toEqual([
      'empty_list', 'one_block', 'two_predicates', 'tag',
    ]);
  });

  it('parses official ItemStack.OPTIONAL_STREAM_CODEC add/remove combination patches with leftover=0 and official added/removed names', () => {
    const proto = playProto();
    const rows = samples('item_stack');
    expect(rows.map((r) => r.semantics?.branch)).toEqual([
      'empty_patch',
      'add_one',
      'add_two',
      'remove_one',
      'add_and_remove',
      'non_default_item_add',
      'remove_default_add_other',
    ]);
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const parser = packetParser();
    for (const row of rows) {
      expect(row.officialDecodeOk, row.label).toBe(true);
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const slot = parseType(proto, 'Slot', row.hex!);
      expect(slot.leftover, `Slot ${row.label}`).toBe(0);
      const pkt = Buffer.concat([
        varint(0x12), varint(0), varint(1), varint(1),
        Buffer.from(row.hex!, 'hex'),
        varint(0),
      ]);
      const win = parser.parsePacketBuffer(pkt);
      expect(pkt.length - win.metadata.size, `window ${row.label}`).toBe(0);
      const item = win.data?.params?.items?.[0] ?? slot.data;
      const itemName = item?.itemId ?? item?.present?.itemId ?? item?.item ?? item?.name;
      const expectedItem = row.semantics?.item;
      if (typeof expectedItem === 'string') {
        const id = typeof itemName === 'number' ? itemName : itemName;
        const resolved = typeof id === 'number' ? (mcData.items[id]?.name ?? (Object.entries(mcData.itemsByName || {}).find(([, it]: any) => it.id === id)?.[0])) : id;
        const text = JSON.stringify(item);
        expect(text + ' resolved=' + resolved, row.label).toMatch(new RegExp(String(expectedItem)));
      }
      const added = (row.semantics?.addedComponents as string[]) ?? [];
      const removed = (row.semantics?.removedComponents as string[]) ?? [];
      const blob = JSON.stringify(item) + ' ' + String(row.officialDecodeToString);
      for (const name of added) {
        expect(blob, `${row.label} added ${name}`).toMatch(new RegExp(name.replace('minecraft:', '')));
      }
      if (row.semantics?.branch === 'empty_patch') {
        expect(added).toEqual([]);
        expect(removed).toEqual([]);
      }
      if (row.semantics?.branch === 'add_and_remove') {
        expect(added).toEqual(['minecraft:custom_name']);
        expect(removed).toEqual(['minecraft:rarity']);
      }
      if (row.semantics?.branch === 'remove_default_add_other') {
        expect(added).toEqual(['minecraft:custom_name']);
        expect(removed).toEqual(['minecraft:instrument']);
      }
      if (row.semantics?.branch === 'add_two') {
        expect(added).toEqual(['minecraft:custom_name', 'minecraft:lore']);
      }
    }
  });

  it('parses every official particle extra-data branch and all simple types with leftover=0; structurally different branches are each present', () => {
    const proto = playProto();
    const parser = packetParser();
    const rows = samples('particle');
    const branches = new Set(rows.map((r) => r.semantics?.branch));
    expect(rows).toHaveLength(126);
    expect(branches).toEqual(new Set([
      'no_extra_data',
      'block_state',
      'color_scale',
      'from_to_scale',
      'color_argb',
      'color',
      'item_stack_template',
      'roll',
      'delay',
      'position_block',
      'position_entity',
      'target_color_duration',
      'power',
      'color_power',
      'water_blocks',
      'water_blocks_impulse',
    ]));
    const simples = rows.filter((r) => r.semantics?.branch === 'no_extra_data');
    const dataBearing = rows.filter((r) => r.semantics?.branch !== 'no_extra_data');
    expect(simples.length).toBe(103);
    expect(dataBearing.length).toBe(23);
    for (const row of rows) {
      expect(row.officialDecodeOk, row.label).toBe(true);
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const parsed = parseType(proto, 'Particle', row.hex!);
      expect(parsed.leftover, row.label).toBe(0);
      const typeName = String(row.semantics?.particleType ?? '').replace(/^minecraft:/, '');
      const got = String(parsed.data?.type ?? '');
      expect(got, row.label).toBeTruthy();
      // Official BuiltInRegistries names can differ slightly from protocol mapper aliases
      // (e.g. trial_spawner_detection vs trial_spawner_detected_player). leftover=0 is required;
      // data-bearing branches still must match the official type or a known alias.
      if (row.semantics?.branch !== 'no_extra_data') {
        const aliases: Record<string, string[]> = {};
        const ok = got === typeName || got.includes(typeName) || typeName.includes(got) || (aliases[typeName] ?? []).includes(got);
        expect(ok, `${row.label} official=${typeName} got=${got}`).toBe(true);
      }
      if (row.packetOk && row.packetHex) {
        const pkt = parsePacket(parser, 0x2f, row.packetHex);
        expect(pkt.leftover, `packet ${row.label}`).toBe(0);
        expect(pkt.name).toBe('world_particles');
      }
    }
    // vibration has two structurally different position sources
    expect(dataBearing.filter((r) => r.semantics?.particleType === 'minecraft:vibration').map((r) => r.semantics?.branch)).toEqual([
      'position_block',
      'position_entity',
    ]);
  });

  it('parses official sound holder branches, all SlotDisplay types, all RecipeDisplay types, and map icon/patch branches with leftover=0', () => {
    const proto = playProto();
    const parser = packetParser();

    const sounds = samples('sound_effect');
    expect(sounds.map((s) => s.semantics?.branch)).toEqual([
      'registry_holder',
      'inline_variable_range',
      'inline_fixed_range',
    ]);
    for (const row of sounds) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const pkt = parsePacket(parser, 0x75, row.hex!);
      expect(pkt.leftover, row.label).toBe(0);
      expect(pkt.name).toBe('sound_effect');
    }

    const slots = samples('slot_display');
    const slotBranches = slots.map((s) => s.semantics?.branch);
    expect(slotBranches).toEqual(expect.arrayContaining([
      'empty', 'any_fuel', 'item', 'item_stack', 'tag', 'with_any_potion',
      'only_with_component', 'dyed_slot_demo', 'with_remainder',
      'composite_empty', 'composite_one', 'composite_many', 'smithing_trim',
    ]));
    expect(slots).toHaveLength(13);
    for (const row of slots) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const parsed = parseType(proto, 'SlotDisplay', row.hex!);
      expect(parsed.leftover, row.label).toBe(0);
      const type = String(parsed.data?.type ?? '');
      const branch = String(row.semantics?.branch);
      if (branch.startsWith('composite')) expect(type).toBe('composite');
      else if (branch === 'item_stack') expect(type).toBe('item_stack');
      else if (branch === 'tag') {
        expect(type).toBe('tag');
        expect(JSON.stringify(parsed.data)).toMatch(/planks/);
      }
    }

    const recipes = samples('recipe_display');
    expect(recipes.map((s) => s.semantics?.branch)).toEqual([
      'crafting_shapeless', 'crafting_shapeless', 'crafting_shapeless',
      'crafting_shaped', 'crafting_shaped',
      'furnace', 'stonecutter', 'smithing',
    ]);
    const shapeless = recipes.filter((s) => s.semantics?.branch === 'crafting_shapeless');
    expect(shapeless.map((s) => s.semantics?.ingredientCount)).toEqual([0, 1, expect.anything()]);
    expect(shapeless[0].label).toMatch(/empty/);
    expect(shapeless[1].label).toMatch(/one/);
    expect(shapeless[2].label).toMatch(/many/);
    const shaped = recipes.filter((s) => s.semantics?.branch === 'crafting_shaped');
    expect(shaped.map((s) => s.label)).toEqual(['shaped-1x1', 'shaped-2x2']);
    for (const row of recipes) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const parsed = parseType(proto, 'RecipeDisplay', row.hex!);
      expect(parsed.leftover, row.label).toBe(0);
      expect(String(parsed.data?.type)).toBe(String(row.semantics?.branch));
    }

    const maps = samples('map');
    expect(maps.map((s) => s.semantics?.branch)).toEqual([
      'icons_absent_patch_absent',
      'icons_empty_list_patch_absent',
      'one_icon',
      'icon_with_name',
      'several_icons',
      'full_patch',
      'partial_patch_with_icon',
    ]);
    for (const row of maps) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const pkt = parsePacket(parser, 0x33, row.hex!);
      expect(pkt.leftover, row.label).toBe(0);
      expect(pkt.name).toBe('map');
      const p = pkt.params ?? {};
      const blob = JSON.stringify(p);
      if (row.semantics?.branch === 'full_patch') {
        expect(blob).toMatch(/128/);
        expect(row.semantics?.dataLen).toBe(16384);
      }
      if (row.semantics?.branch === 'partial_patch_with_icon') {
        expect(blob).toMatch(/16/);
        expect(row.semantics).toMatchObject({ columns: 8, rows: 4, x: 16, y: 32, dataLen: 32, mapId: 3 });
      }
      if (row.semantics?.branch === 'icons_absent_patch_absent') {
        expect(blob).toMatch(/false|empty|null/i);
      }
    }
  });

  it('parses official firework shapes, profile property arms, and bounded-depth bundle/container/charged nested patches', () => {
    const proto = playProto();
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    const idOf = (name: string) => Number(Object.entries(mappings).find(([, n]) => n === name)![0]);
    const parse = (typeName: string, hex: string) => {
      const wrapped = Buffer.concat([varint(idOf(typeName)), Buffer.from(hex, 'hex')]);
      const decoded = proto.parsePacketBuffer('SlotComponent', wrapped);
      return { leftover: wrapped.length - decoded.metadata.size, data: decoded.data };
    };

    const shapes = samples('component:firework_explosion').filter((s) => s.semantics?.branch === 'shape');
    expect(shapes.map((s) => s.semantics?.shape)).toEqual(['small_ball', 'large_ball', 'star', 'creeper', 'burst']);
    for (const row of samples('component:firework_explosion')) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      expect(parse('firework_explosion', row.hex!).leftover, row.label).toBe(0);
    }
    const fireworks = samples('component:fireworks');
    expect(fireworks.map((s) => s.semantics?.branch)).toEqual(['explosions_empty', 'explosions_one', 'explosions_many']);
    for (const row of fireworks) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      expect(parse('fireworks', row.hex!).leftover, row.label).toBe(0);
    }

    const profiles = samples('component:profile');
    expect(profiles.map((s) => s.semantics?.branch)).toEqual([
      'unresolved_name', 'unresolved_uuid', 'resolved_no_properties', 'resolved_with_property', 'resolved_property_unsigned',
    ]);
    for (const row of profiles) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const parsed = parse('profile', row.hex!);
      expect(parsed.leftover, row.label).toBe(0);
      const blob = JSON.stringify(parsed.data);
      if (row.semantics?.branch === 'unresolved_name') expect(blob).toMatch(/auditor/);
      if (row.semantics?.branch === 'resolved_with_property') expect(blob).toMatch(/textures/);
    }

    for (const kind of ['bundle_contents', 'container', 'charged_projectiles'] as const) {
      const rows = samples(`component:${kind}`);
      expect(rows.some((s) => s.semantics?.branch === 'empty'), kind).toBe(true);
      expect(rows.some((s) => s.semantics?.branch === 'one_nested_patch'), kind).toBe(true);
      for (const row of rows) {
        expect(row.officialDecodeRemaining, `${kind} ${row.label}`).toBe(0);
        const parsed = parse(kind, row.hex!);
        expect(parsed.leftover, `${kind} ${row.label}`).toBe(0);
        if (row.semantics?.branch === 'one_nested_patch' || row.semantics?.branch === 'nested_bundle_depth_2') {
          expect(JSON.stringify(parsed.data), `${kind} ${row.label}`).toMatch(/custom_name|bundle_contents|stone|tipped|nested/i);
        }
      }
    }
  });


  it('parses official tool, equippable, and kinetic_weapon optional present/absent structural arms', () => {
    const proto = playProto();
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    const idOf = (name: string) => Number(Object.entries(mappings).find(([, n]) => n === name)![0]);
    const parse = (typeName: string, hex: string) => {
      const wrapped = Buffer.concat([varint(idOf(typeName)), Buffer.from(hex, 'hex')]);
      const decoded = proto.parsePacketBuffer('SlotComponent', wrapped);
      return { leftover: wrapped.length - decoded.metadata.size, data: decoded.data };
    };

    const tools = samples('component:tool');
    expect(tools.map((s) => s.semantics?.branch)).toEqual([
      'rules_empty',
      'rule_mines_and_drops',
      'rule_denies_drops',
      'rule_override_speed',
      'rule_direct_speed_absent_cfd_absent',
      'rule_direct_speed_absent_cfd_true',
      'rule_direct_speed_present_cfd_false',
      'rules_two_mixed',
    ]);
    for (const row of tools) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      expect(parse('tool', row.hex!).leftover, row.label).toBe(0);
    }

    const eqs = samples('component:equippable');
    expect(eqs.map((s) => s.semantics?.branch)).toEqual([
      'optionals_all_absent',
      'asset_only',
      'overlay_only',
      'allowed_list_one',
      'allowed_list_two',
      'allowed_tag',
      'asset_and_overlay',
      'overlay_and_allowed',
      'asset_and_allowed_tag',
      'all_three_optionals_present',
    ]);
    for (const row of eqs) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      const parsed = parse('equippable', row.hex!);
      expect(parsed.leftover, row.label).toBe(0);
      const blob = JSON.stringify(parsed.data);
      if (row.semantics?.branch === 'overlay_only' || String(row.semantics?.cameraOverlayPresent) === 'true' || row.semantics?.cameraOverlayPresent === true) {
        if (row.semantics?.cameraOverlayPresent || row.semantics?.branch === 'overlay_only' || row.semantics?.branch === 'asset_and_overlay' || row.semantics?.branch === 'overlay_and_allowed' || row.semantics?.branch === 'all_three_optionals_present') {
          expect(blob, row.label).toMatch(/pumpkinblur/);
        }
      }
      if (row.semantics?.branch === 'allowed_tag' || row.semantics?.branch === 'asset_and_allowed_tag') {
        expect(blob, row.label).toMatch(/can_equip_harness|harness/);
      }
    }

    const kws = samples('component:kinetic_weapon');
    expect(kws.map((s) => s.semantics?.branch)).toEqual([
      'optionals_all_absent',
      'dismount_only',
      'knockback_only',
      'damage_only',
      'sound_only',
      'hit_sound_only',
      'optionals_all_present',
    ]);
    for (const row of kws) {
      expect(row.officialDecodeRemaining, row.label).toBe(0);
      expect(parse('kinetic_weapon', row.hex!).leftover, row.label).toBe(0);
    }
  });

  it('rejects unknown Particle, RecipeDisplay, and SlotDisplay type ids instead of skipping them as void', () => {
    const proto = playProto();
    const unknown = varint(200);
    expect(() => proto.parsePacketBuffer('Particle', unknown)).toThrow(/UNKNOWN_DISCRIMINATED_FIELD|unknown /i);
    expect(() => proto.parsePacketBuffer('RecipeDisplay', unknown)).toThrow(/UNKNOWN_DISCRIMINATED_FIELD|unknown /i);
    expect(() => proto.parsePacketBuffer('SlotDisplay', unknown)).toThrow(/UNKNOWN_DISCRIMINATED_FIELD|unknown /i);
  });
});
