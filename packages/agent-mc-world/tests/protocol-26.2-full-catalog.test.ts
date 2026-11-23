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
const catalog = require(join(root, 'tests/fixtures/vanilla-26.2/vanilla-full-catalog.json')) as {
  itemCount: number;
  itemDefaultReportFiles: number;
  itemDefaultComponentOk: number;
  itemDefaultComponentFailed: number;
  itemDefaultComponentAttempt: number;
  itemDefaultComponentReportFallback: number;
  itemDefaultReportFallbackTypes: Record<string, number>;
  itemDefaultComponentOrigins?: Record<string, number>;
  itemDefaultEncoding?: string;
  itemDefaultComponents: Array<{ item: string; name: string; id: number; hex: string; length: number; officialDecodeRemaining: number; origin: string }>;
  recipeOk: number;
  recipeAttempt: number;
  recipeFailed: number;
  recipeDisplayOk: number;
  recipeDisplayFailed: number;
  recipeDisplayTypes: Record<string, number>;
  recipesWithoutDisplay: Array<{ id: string; type: string }>;
  recipeDisplays: Array<{ recipe: string; displayType: string; hex: string; officialDecodeRemaining: number }>;
  soundEventCount: number;
  soundEvents: Array<{ id: number; name: string }>;
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

describe('26.2 official full item-default, recipe-catalog, and sound-id differential', () => {
  it('encodes every official item default component (1537 items) with leftover=0 and official decode remaining 0', () => {
    expect(catalog.itemCount).toBe(1537);
    expect(catalog.itemDefaultReportFiles).toBe(1537);
    expect(catalog.itemDefaultComponentFailed).toBe(0);
    expect(catalog.itemDefaultComponentOk).toBe(catalog.itemDefaultComponentAttempt);
    expect(catalog.itemDefaultComponentOk).toBe(19356);
    expect(catalog.itemDefaultComponentReportFallback).toBe(0);
    expect(catalog.itemDefaultReportFallbackTypes).toEqual({});
    expect(catalog.itemDefaultComponentOrigins).toEqual({ item_prototype: 19356 });
    expect(catalog.itemDefaultEncoding).toMatch(/same instance used to bind/i);
    // Former 44 JSON-reparse rows are now official prototype streamCodec bytes
    // after tag-first synchronized FrozenAccess bind (same RegistryAccess).
    const formerFallback = catalog.itemDefaultComponents.filter((c) =>
      (c.name === 'minecraft:provides_trim_material'
        && ['minecraft:redstone','minecraft:diamond','minecraft:emerald','minecraft:lapis_lazuli','minecraft:quartz','minecraft:amethyst_shard','minecraft:iron_ingot','minecraft:copper_ingot','minecraft:gold_ingot','minecraft:netherite_ingot','minecraft:resin_brick'].includes(c.item))
      || (c.name === 'minecraft:chicken/variant' && ['minecraft:egg','minecraft:blue_egg','minecraft:brown_egg'].includes(c.item))
      || (c.name === 'minecraft:damage_type' && c.item.endsWith('_spear'))
      || (c.name === 'minecraft:jukebox_playable' && c.item.startsWith('minecraft:music_disc_'))
      || (c.name === 'minecraft:instrument' && c.item === 'minecraft:goat_horn'));
    expect(formerFallback).toHaveLength(44);
    expect(formerFallback.every((c) => c.origin === 'item_prototype')).toBe(true);

    const proto = playProto();
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    const leftovers: string[] = [];
    for (const row of catalog.itemDefaultComponents) {
      expect(row.officialDecodeRemaining, `${row.item} ${row.name}`).toBe(0);
      const short = String(row.name).replace(/^minecraft:/, '');
      const typeId = Number(Object.entries(mappings).find(([, n]) => n === short)?.[0]);
      if (!Number.isInteger(typeId)) {
        leftovers.push(`missing-mapping ${row.item} ${row.name}`);
        continue;
      }
      const wrapped = Buffer.concat([varint(typeId), Buffer.from(row.hex, 'hex')]);
      try {
        const decoded = proto.parsePacketBuffer('SlotComponent', wrapped);
        const leftover = wrapped.length - decoded.metadata.size;
        if (leftover !== 0 || decoded.data?.type !== short) {
          leftovers.push(`${row.item} ${row.name} leftover=${leftover} type=${decoded.data?.type}`);
        }
      } catch (e: any) {
        leftovers.push(`${row.item} ${row.name} ${String(e?.message || e).slice(0, 180)}`);
      }
    }
    expect(leftovers, leftovers.slice(0, 8).join('\n')).toEqual([]);
  });

  it('encodes the full official recipe catalog displays leftover=0; special recipes with empty display() are official, not parse failures', () => {
    expect(catalog.recipeOk).toBe(1585);
    expect(catalog.recipeFailed).toBe(0);
    expect(catalog.recipeAttempt).toBe(1585);
    expect(catalog.recipeDisplayFailed).toBe(0);
    expect(catalog.recipeDisplayOk).toBe(1568);
    expect(catalog.recipeDisplayTypes).toEqual({
      ShapedCraftingRecipeDisplay: 734,
      ShapelessCraftingRecipeDisplay: 369,
      StonecutterRecipeDisplay: 319,
      FurnaceRecipeDisplay: 116,
      SmithingRecipeDisplay: 30,
    });
    expect(catalog.recipesWithoutDisplay.length).toBe(24);
    for (const row of catalog.recipesWithoutDisplay) {
      expect(row.type).toBe('minecraft:crafting');
    }

    const proto = playProto();
    const leftovers: string[] = [];
    for (const row of catalog.recipeDisplays) {
      expect(row.officialDecodeRemaining, row.recipe).toBe(0);
      const buf = Buffer.from(row.hex, 'hex');
      try {
        const decoded = proto.parsePacketBuffer('RecipeDisplay', buf);
        const leftover = buf.length - decoded.metadata.size;
        if (leftover !== 0) leftovers.push(`${row.recipe} leftover=${leftover}`);
      } catch (e: any) {
        leftovers.push(`${row.recipe} ${String(e?.message || e).slice(0, 180)}`);
      }
    }
    expect(leftovers, leftovers.slice(0, 8).join('\n')).toEqual([]);
  });

  it('matches the official 1968 sound event ids against the 26.2 sound table; shared holder codec is already proven', () => {
    expect(catalog.soundEventCount).toBe(1968);
    expect(catalog.soundEvents).toHaveLength(1968);
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const nmd: Array<{ id: number; name: string }> = Array.isArray(mcData.sounds)
      ? mcData.sounds
      : Object.values(mcData.sounds || {});
    expect(nmd).toHaveLength(1968);
    const official = new Map(catalog.soundEvents.map((s) => [s.id, s.name.replace(/^minecraft:/, '')]));
    const missing: string[] = [];
    const shifted: string[] = [];
    for (const s of nmd) {
      const name = official.get(s.id);
      if (name == null) missing.push(`id ${s.id} ${s.name}`);
      else if (name !== s.name) shifted.push(`id ${s.id} official=${name} nmd=${s.name}`);
    }
    for (const [id, name] of official) {
      if (!nmd.some((s) => s.id === id)) missing.push(`official-only id ${id} ${name}`);
    }
    expect(missing, missing.slice(0, 8).join('\n')).toEqual([]);
    expect(shifted, shifted.slice(0, 8).join('\n')).toEqual([]);
  });
});
