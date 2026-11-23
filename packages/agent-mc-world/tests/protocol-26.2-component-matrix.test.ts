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
const fixture = join(root, 'tests/fixtures/vanilla-26.2/component-support-matrix.json');

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

beforeAll(() => {
  installExperimentalMinecraftDataResolution();
});

afterAll(() => {
  uninstallExperimentalMinecraftDataResolution();
});

describe('26.2 data_component_type support matrix', () => {
  const matrix = JSON.parse(require('fs').readFileSync(fixture, 'utf8')) as {
    summary: any;
    components: any[];
  };

  it('covers all 111 vanilla component ids with protocol switch schemas and official streamCodec wire proof', () => {
    expect(matrix.summary.dataComponentTypeCount).toBe(111);
    expect(matrix.summary.idMatches).toBe(111);
    expect(matrix.summary.unresolvedSchemaTypes).toBe(0);
    expect(matrix.components).toHaveLength(111);
    expect(matrix.summary.defaultItemReports).toBe(1537);
    expect(matrix.summary.unknownDefaultComponentKeys).toEqual({});
    for (const row of matrix.components) {
      expect(row.idMatch, `${row.id} ${row.vanillaName}`).toBe(true);
      expect(row.switchSchemaPresent).toBe(true);
      expect(row.unresolvedNamedTypes).toEqual([]);
      expect(row.wireIdStatus).toBe('full_compare');
      expect(row.independentWireStatus).toBe('vanilla_streamcodec_verified');
      expect(row.nbtVsNetwork).toMatch(/not the network/i);
    }
    expect(matrix.summary.independentWireVerified).toBe(111);
    expect(matrix.summary.independentWireRepresentative).toBe(0);
    expect(matrix.summary.independentWireUnverified).toBe(0);
    const limits = matrix.summary.independentWireCoverageLimits;
    expect(limits.statement).toMatch(/does not mean every/);
    expect(limits.verifiedScope.length).toBeGreaterThan(0);
    expect(limits.notExhausted).toEqual(expect.arrayContaining([
      expect.stringMatching(/Inline holder/),
      expect.stringMatching(/optional subfields|multi-entry lists/),
    ]));
  });
});

describe('26.2 unknown SlotComponent fails closed', () => {
  function parseWindowItems(bytes: Buffer) {
    const nmp = require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/index.js'));
    const parser = nmp.createDeserializer({
      state: 'play',
      isServer: false,
      version: '26.2',
      noErrorLogging: true,
    });
    return parser.parsePacketBuffer(bytes);
  }

  function windowItems(slots: Buffer[]) {
    return Buffer.concat([
      varint(0x12),
      varint(0),
      varint(1),
      varint(slots.length),
      ...slots,
      varint(0), // carriedItem empty
    ]);
  }

  it('throws and keeps sanitized evidence instead of skipping an unknown type as void and shifting later slots', () => {
    const strict = require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/datatypes/strict-discriminators.js'));
    strict.clearUnknownFieldEvidence();

    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const stone = mcData.itemsByName.stone.id;
    const sword = mcData.itemsByName.iron_sword.id;
    const unknownType = 111; // vanilla 26.2 data_component_type ids are 0-110

    const poisoned = Buffer.concat([
      varint(1),
      varint(stone),
      varint(1),
      varint(0),
      varint(unknownType),
      Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
    ]);
    const empty = varint(0);
    const weapon = Buffer.concat([varint(1), varint(sword), varint(0), varint(0)]);
    const bytes = windowItems(Array.from({ length: 46 }, (_, i) => (i === 9 ? poisoned : i === 36 ? weapon : empty)));

    expect(() => parseWindowItems(bytes)).toThrow(/UNKNOWN_DISCRIMINATED_FIELD|unknown /i);
    const evidence = strict.getUnknownFieldEvidence();
    expect(evidence.length).toBeGreaterThan(0);
    const last = evidence[evidence.length - 1];
    expect(last.remainingBytes).toBeGreaterThan(0);
    expect(JSON.stringify(last)).not.toMatch(/itemCount|iron_sword|nbt/i);
    expect(Object.keys(last).sort()).toEqual(['at', 'discriminator', 'kind', 'remainingBytes'].sort());
  });

  it('still decodes a known void component plus a following slot when the type id is valid', () => {
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    const unbreakable = Number(Object.entries(mappings).find(([, name]) => name === 'unbreakable')![0]);
    const repair = Number(Object.entries(mappings).find(([, name]) => name === 'repair_cost')![0]);
    const sword = mcData.itemsByName.iron_sword.id;
    const stone = mcData.itemsByName.stone.id;
    const item = Buffer.concat([
      varint(1),
      varint(stone),
      varint(2),
      varint(0),
      varint(unbreakable),
      varint(repair),
      varint(4),
    ]);
    const weapon = Buffer.concat([varint(1), varint(sword), varint(0), varint(0)]);
    const empty = varint(0);
    const bytes = windowItems(Array.from({ length: 46 }, (_, i) => (i === 9 ? item : i === 36 ? weapon : empty)));
    const decoded = parseWindowItems(bytes);
    expect(decoded.metadata.size).toBe(bytes.length);
    expect(decoded.data.name).toBe('window_items');
    expect(decoded.data.params.items[9].components).toEqual(
      expect.arrayContaining([
        { type: 'unbreakable', data: undefined },
        { type: 'repair_cost', data: 4 },
      ]),
    );
    expect(decoded.data.params.items[36].itemId).toBe(sword);
  });
});
