import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  experimental26_2VendorRoot,
  installExperimentalMinecraftDataResolution,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dumpPath = join(root, 'tests/fixtures/vanilla-26.2/vanilla-component-streamcodecs.json');
const reportPath = join(root, 'tests/fixtures/vanilla-26.2/vanilla-streamcodec-vs-node.json');

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

function sanitizeError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.replace(/\s+/g, ' ').slice(0, 240);
}

describe('26.2 vanilla StreamCodec bytes vs Node decoder', () => {
  it('consumes official server.jar streamCodec samples without leftover bytes', () => {
    const nmp = require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/index.js'));
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const mappings = mcData.protocol.types.SlotComponentType[1].mappings as Record<string, string>;
    const nameById = new Map(Object.entries(mappings).map(([id, name]) => [Number(id), name]));
    const stone = mcData.itemsByName.stone.id;
    const parser = nmp.createDeserializer({
      state: 'play',
      isServer: false,
      version: '26.2',
      noErrorLogging: true,
    });

    const empty = varint(0);
    const windowItems = (item: Buffer) => Buffer.concat([
      varint(0x12),
      varint(0),
      varint(1),
      varint(46),
      item,
      ...Array.from({ length: 45 }, () => empty),
      varint(0),
    ]);

    const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as {
      source: string;
      typeCount: number;
      types: Array<{
        id: number;
        name: string;
        encoded: boolean;
        samples: Array<{ ok?: boolean; origin?: string; hex?: string; length?: number; label?: string }>;
      }>;
    };

    const types = [];
    for (const type of dump.types) {
      const expectedShort = type.name.replace(/^minecraft:/, '');
      expect(nameById.get(type.id), type.name).toBe(expectedShort);
      const seen = new Set<string>();
      const samples = [];
      for (const sample of type.samples ?? []) {
        if (!sample.ok || typeof sample.hex !== 'string') continue;
        if (seen.has(sample.hex)) continue;
        seen.add(sample.hex);
        const payload = Buffer.from(sample.hex, 'hex');
        const item = Buffer.concat([
          varint(1),
          varint(stone),
          varint(1),
          varint(0),
          varint(type.id),
          payload,
        ]);
        const bytes = windowItems(item);
        try {
          const decoded = parser.parsePacketBuffer(bytes);
          const leftover = bytes.length - decoded.metadata.size;
          const components = decoded.data?.params?.items?.[0]?.components ?? [];
          const first = components[0];
          const ok = leftover === 0
            && decoded.data?.name === 'window_items'
            && first?.type === expectedShort;
          samples.push({
            origin: sample.origin,
            label: sample.label ?? sample.origin,
            length: payload.length,
            ok,
            leftover,
            decodedType: first?.type ?? null,
            error: ok ? undefined : (leftover !== 0 ? `leftover_bytes:${leftover}` : `decoded_type:${first?.type ?? 'none'}`),
          });
        } catch (err) {
          samples.push({
            origin: sample.origin,
            label: sample.label ?? sample.origin,
            length: payload.length,
            ok: false,
            leftover: null,
            decodedType: null,
            error: sanitizeError(err),
          });
        }
      }
      const verified = samples.filter((s) => s.ok).length;
      types.push({
        id: type.id,
        name: type.name,
        vanillaEncodedSamples: samples.length,
        nodeConsumed: verified,
        independentWireStatus: verified > 0 ? 'vanilla_streamcodec_verified' : (type.encoded ? 'vanilla_encoded_node_failed' : 'unverified'),
        samples,
      });
    }

    const verified = types.filter((t) => t.independentWireStatus === 'vanilla_streamcodec_verified');
    const nodeFailed = types.filter((t) => t.independentWireStatus === 'vanilla_encoded_node_failed');
    const unverified = types.filter((t) => t.independentWireStatus === 'unverified');
    const report = {
      source: 'vanilla 26.2 server-26.2.jar DataComponentType.streamCodec bytes decoded by experimental 26.2 Node Slot parser',
      typeCount: types.length,
      vanillaEncodedTypes: dump.types.filter((t) => t.encoded).length,
      nodeVerifiedTypes: verified.length,
      nodeFailedTypes: nodeFailed.map((t) => ({
        id: t.id,
        name: t.name,
        errors: [...new Set(t.samples.filter((s) => !s.ok).map((s) => s.error))],
      })),
      unverifiedTypes: unverified.map((t) => t.name),
      types,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    expect(dump.typeCount).toBe(111);
    expect(types).toHaveLength(111);
    expect(unverified, `vanilla did not encode: ${unverified.map((t) => t.name).join(', ')}`).toHaveLength(0);
    // Keep the exact leftover list visible if the Node decoder cannot consume some official bytes.
    if (nodeFailed.length) {
      throw new Error(
        `Node decoder failed ${nodeFailed.length}/111 official streamCodec types: ${
          nodeFailed.map((t) => `${t.name} (${t.samples.find((s) => !s.ok)?.error})`).join('; ')
        }`,
      );
    }
    expect(verified).toHaveLength(111);
  });
});
