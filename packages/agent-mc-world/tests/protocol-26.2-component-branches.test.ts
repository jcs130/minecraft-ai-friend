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
const branches = require(join(root, 'tests/fixtures/vanilla-26.2/component-branch-samples.json'));

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

function parseComponent(hex: string) {
  const nmp = require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/index.js'));
  const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
  const stone = mcData.itemsByName.stone.id;
  const parser = nmp.createDeserializer({ state: 'play', isServer: false, version: '26.2', noErrorLogging: true });
  const payload = Buffer.from(hex, 'hex');
  // window_items with a 1-component patch: added=1, removed=0, component id supplied by caller? 
  // The official samples are raw DataComponentType.streamCodec payloads, not a full ItemStack.
  // Wrap as: item present, count 1, itemId stone, added=1, typeId, payload, removed=0 — but we don't know typeId here.
  return { parser, stone, payload, leftoverOf: (bytes: Buffer) => {
    const decoded = parser.parsePacketBuffer(bytes);
    return { name: decoded.data.name, leftover: bytes.length - decoded.metadata.size, params: decoded.data.params };
  } };
}

function windowItemsFor(typeId: number, payload: Buffer, stone: number) {
  return Buffer.concat([
    varint(0x12), // window_items play id may differ — use the same helper as the streamcodec test
    varint(0),
    varint(1),
    varint(46),
    varint(1), // present
    varint(1), // count
    varint(stone),
    varint(1), // added components
    varint(typeId),
    payload,
    varint(0), // removed
    ...Array.from({ length: 45 }, () => varint(0)),
    varint(0),
  ]);
}

describe('26.2 official streamCodec branch samples (not an exhaustion of all values)', () => {
  it('documents tested inline-holder, list, and optional branches and their limits', () => {
    expect(branches.source).toMatch(/Not a mathematical exhaustion/);
    expect(branches.inlineHolders['minecraft:instrument'].inlineSample.hex.startsWith('00')).toBe(true);
    expect(branches.inlineHolders['minecraft:provides_trim_material'].inlineSample.hex.startsWith('00')).toBe(true);
    expect(branches.inlineHolders['minecraft:jukebox_playable'].inlineSample.hex.startsWith('00')).toBe(true);
    expect(branches.inlineHolders['minecraft:jukebox_playable'].inlineFixedRangeSoundSample.hex.startsWith('00')).toBe(true);
    expect(branches.inlineHolders['minecraft:jukebox_playable'].registryHolderSample.hex.startsWith('00')).toBe(false);
    expect(branches.inlineHolders['minecraft:jukebox_playable'].limits).toMatch(/Holder\.direct inline/);
    expect(branches.lists['minecraft:lore'].map((s: any) => s.length)).toEqual([1, 7, 21]);
    expect(branches.unprovenThisBatch.length).toBeGreaterThan(0);
    expect(branches.unprovenThisBatch.join(' ')).not.toMatch(/jukebox_playable inline Holder\.direct \/ full song object \(curated JSON failed/);
  });

  it('consumes official inline-holder and list branch payloads without leftover bytes', () => {
    const nmp = require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/index.js'));
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    const idByName = new Map(Object.entries(mappings).map(([id, name]) => [name, Number(id)]));
    const stone = mcData.itemsByName.stone.id;
    const parser = nmp.createDeserializer({ state: 'play', isServer: false, version: '26.2', noErrorLogging: true });
    const empty = varint(0);
    const windowItems = (item: Buffer) => Buffer.concat([
      varint(0x12), varint(0), varint(1), varint(46), item,
      ...Array.from({ length: 45 }, () => empty), varint(0),
    ]);
    const typeIdOf = (name: string) => {
      const id = idByName.get(name);
      if (id == null) throw new Error('missing type ' + name);
      return id;
    };

    const cases: Array<{ name: string; hex: string }> = [
      { name: 'instrument', hex: branches.inlineHolders['minecraft:instrument'].inlineSample.hex },
      { name: 'provides_trim_material', hex: branches.inlineHolders['minecraft:provides_trim_material'].inlineSample.hex },
      ...branches.lists['minecraft:lore'].map((s: any, i: number) => ({ name: 'lore', hex: s.hex, label: `lore-${i}` })),
      ...branches.lists['minecraft:enchantments'].filter((s: any) => s.ok).map((s: any) => ({ name: 'enchantments', hex: s.hex })),
      ...branches.lists['minecraft:bundle_contents'].map((s: any) => ({ name: 'bundle_contents', hex: s.hex })),
      ...branches.optionals['minecraft:lodestone_tracker'].filter((s: any) => s.ok).map((s: any) => ({ name: 'lodestone_tracker', hex: s.hex })),
      ...branches.optionals['minecraft:potion_contents'].filter((s: any) => s.ok).map((s: any) => ({ name: 'potion_contents', hex: s.hex })),
    ];

    for (const sample of cases) {
      const typeId = typeIdOf(sample.name);
      const payload = Buffer.from(sample.hex, 'hex');
      const itemBytes = Buffer.concat([varint(1), varint(stone), varint(1), varint(0), varint(typeId), payload]);
      const bytes = windowItems(itemBytes);
      const decoded = parser.parsePacketBuffer(bytes);
      expect(decoded.data.name, sample.name).toBe('window_items');
      expect(bytes.length - decoded.metadata.size, `${sample.name} ${sample.hex}`).toBe(0);
      const slot = decoded.data.params.items[0];
      expect(slot, sample.name).toBeTruthy();
    }
  });
});
