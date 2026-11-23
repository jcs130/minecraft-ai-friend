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

const string16 = (s: string) => Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s, 'utf8')]);

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

function parserTable(mcData: any) {
  const node = mcData.protocol.types.command_node;
  // argument field is command_node_type 2
  const walk = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      for (const x of obj) {
        const f = walk(x);
        if (f) return f;
      }
      return null;
    }
    if (obj.compareTo === 'parser' && obj.fields) return obj;
    for (const v of Object.values(obj)) {
      const f = walk(v);
      if (f) return f;
    }
    return null;
  };
  const sw = walk(node);
  const mapper = (() => {
    const find = (o: any): any => {
      if (o && typeof o === 'object') {
        if (o.mappings && o.mappings['0'] === 'brigadier:bool') return o.mappings;
        if (Array.isArray(o)) {
          for (const x of o) {
            const r = find(x);
            if (r) return r;
          }
        } else {
          for (const v of Object.values(o)) {
            const r = find(v);
            if (r) return r;
          }
        }
      }
      return null;
    };
    return find(node) as Record<string, string>;
  })();
  return { fields: sw.fields as Record<string, unknown>, default: sw.default, mappings: mapper };
}

/** flags: type in low 2 bits, has_command bit2, has_redirect bit3, has_custom_suggestions bit4 */
function argumentNode(parserId: number, properties: Buffer, opts?: { suggestions?: string }) {
  const flags = 2 | (opts?.suggestions ? (1 << 4) : 0);
  const parts = [
    Buffer.from([flags]),
    varint(0), // children
    string16('p'),
    varint(parserId),
    properties,
  ];
  if (opts?.suggestions) parts.push(string16(opts.suggestions));
  return Buffer.concat(parts);
}

function f32(n: number) {
  const b = Buffer.alloc(4);
  b.writeFloatBE(n, 0);
  return b;
}
function f64(n: number) {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n, 0);
  return b;
}
function i32(n: number) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}
function i64(n: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(n, 0);
  return b;
}

describe('26.2 command parsers: finite 51-type table, property branches, unknown reject', () => {
  it('uses the actual 26.2 protocol table of 51 parsers with default None (fail closed)', () => {
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const table = parserTable(mcData);
    const names = Object.values(table.mappings);
    expect(names).toHaveLength(57);
    expect(table.default).toBe(undefined); // compiled as None after strict discriminator, schema default is None
    expect(names[0]).toBe('brigadier:bool');
    expect(names[56]).toBe('minecraft:uuid');
    expect(names).toContain('minecraft:style');
    expect(names).toContain('minecraft:loot_table');
    expect(names).toContain('minecraft:resource_selector');
    expect(names).toContain('minecraft:hex_color');
    expect(names).toContain('minecraft:nbt_tag');
    expect(names).toContain('minecraft:item_slots');
  });

  it('parses a valid executable sample for every parser, including empty/list/boundary property shapes, leftover=0', () => {
    const proto = playProto();
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const table = parserTable(mcData);
    const idByName = new Map(Object.entries(table.mappings).map(([id, name]) => [name, Number(id)]));
    const parseNode = (buf: Buffer, label: string) => {
      const decoded = proto.parsePacketBuffer('command_node', buf);
      const leftover = buf.length - decoded.metadata.size;
      expect(leftover, label).toBe(0);
      return decoded.data;
    };

    const cases: Array<{ name: string; properties: Buffer; expect?: (data: any) => void; label?: string }> = [];

    for (const name of Object.values(table.mappings)) {
      const field = table.fields[name];
      if (field === 'void' || field == null) {
        cases.push({ name, properties: Buffer.alloc(0), label: `${name}:void` });
      }
    }

    const nums: Array<{ name: string; width: 'f32' | 'f64' | 'i32' | 'i64' }> = [
      { name: 'brigadier:float', width: 'f32' },
      { name: 'brigadier:double', width: 'f64' },
      { name: 'brigadier:integer', width: 'i32' },
      { name: 'brigadier:long', width: 'i64' },
    ];
    const encode = (width: 'f32' | 'f64' | 'i32' | 'i64', n: number | bigint) => {
      if (width === 'f32') return f32(Number(n));
      if (width === 'f64') return f64(Number(n));
      if (width === 'i32') return i32(Number(n));
      return i64(typeof n === 'bigint' ? n : BigInt(n));
    };
    for (const { name, width } of nums) {
      cases.push({ name, properties: Buffer.from([0x00]), label: `${name}:no-min-max` });
      cases.push({ name, properties: Buffer.concat([Buffer.from([0x01]), encode(width, 0)]), label: `${name}:min-only-0` });
      cases.push({ name, properties: Buffer.concat([Buffer.from([0x02]), encode(width, width.startsWith('f') ? 1 : 2147483647)]), label: `${name}:max-only` });
      cases.push({
        name,
        properties: Buffer.concat([Buffer.from([0x03]), encode(width, width === 'i64' ? -9223372036854775808n : -1), encode(width, width === 'f32' || width === 'f64' ? 3.5 : 2)]),
        label: `${name}:min-and-max`,
      });
    }

    cases.push({ name: 'brigadier:string', properties: varint(0), label: 'brigadier:string:SINGLE_WORD' });
    cases.push({ name: 'brigadier:string', properties: varint(1), label: 'brigadier:string:QUOTABLE_PHRASE' });
    cases.push({ name: 'brigadier:string', properties: varint(2), label: 'brigadier:string:GREEDY_PHRASE' });

    cases.push({ name: 'minecraft:entity', properties: Buffer.from([0x00]), label: 'minecraft:entity:neither' });
    cases.push({ name: 'minecraft:entity', properties: Buffer.from([0x01]), label: 'minecraft:entity:onlyAllowEntities' });
    cases.push({ name: 'minecraft:entity', properties: Buffer.from([0x02]), label: 'minecraft:entity:onlyAllowPlayers' });
    cases.push({ name: 'minecraft:entity', properties: Buffer.from([0x03]), label: 'minecraft:entity:both-flags' });

    cases.push({ name: 'minecraft:score_holder', properties: Buffer.from([0x00]), label: 'minecraft:score_holder:single' });
    cases.push({ name: 'minecraft:score_holder', properties: Buffer.from([0x01]), label: 'minecraft:score_holder:allowMultiple' });

    cases.push({ name: 'minecraft:time', properties: i32(0), label: 'minecraft:time:min-0' });
    cases.push({ name: 'minecraft:time', properties: i32(-1), label: 'minecraft:time:min--1' });

    for (const name of [
      'minecraft:resource_or_tag',
      'minecraft:resource_or_tag_key',
      'minecraft:resource',
      'minecraft:resource_key',
      'minecraft:resource_selector',
    ]) {
      cases.push({ name, properties: string16(''), label: `${name}:empty-registry` });
      cases.push({ name, properties: string16('minecraft:item'), label: `${name}:item-registry` });
    }

    const covered = new Set(cases.map((c) => c.name));
    expect([...Object.values(table.mappings)].sort()).toEqual([...covered].sort());

    const suggestionsCases = cases.filter((c) => c.name === 'brigadier:bool').map((c) => ({
      ...c,
      label: 'brigadier:bool:with-suggestions',
      suggestions: 'ask_server' as string | undefined,
    }));

    for (const c of [...cases, ...suggestionsCases]) {
      const id = idByName.get(c.name);
      expect(id, c.name).toEqual(expect.any(Number));
      const buf = argumentNode(id!, c.properties, 'suggestions' in c ? { suggestions: (c as any).suggestions } : undefined);
      const data = parseNode(buf, c.label ?? c.name);
      expect(data.flags.command_node_type).toBe(2);
      const parserName = data.parser ?? data.extraNodeData?.parser ?? data.extra?.parser;
      expect(parserName, c.label ?? c.name + ' keys=' + Object.keys(data).join(',')).toBe(c.name);
      if ('suggestions' in c) {
        expect(data.suggestionType ?? data.extraNodeData?.suggestionType ?? data.extra?.suggestionType).toBe('ask_server');
      }
    }
  });

  it('rejects an unknown parser id instead of treating it as void and shifting later fields', () => {
    const proto = playProto();
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    const table = parserTable(mcData);
    const known = Object.keys(table.mappings).map(Number);
    expect(Math.max(...known)).toBe(56);
    const buf = argumentNode(57, Buffer.alloc(0));
    expect(() => proto.parsePacketBuffer('command_node', buf)).toThrow(/UNKNOWN_DISCRIMINATED_FIELD|unknown /i);
    const buf200 = argumentNode(200, Buffer.alloc(0));
    expect(() => proto.parsePacketBuffer('command_node', buf200)).toThrow(/UNKNOWN_DISCRIMINATED_FIELD|unknown /i);
  });

  it('parses a two-node declare_commands packet (root + argument) leftover=0, which is not a substitute for per-parser property coverage', () => {
    const proto = playProto();
    const parser = require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/index.js'))
      .createDeserializer({ state: 'play', isServer: false, version: '26.2', noErrorLogging: true });
    const root = Buffer.concat([Buffer.from([0x00]), varint(1), varint(1)]); // type root, child 1
    const arg = argumentNode(0, Buffer.alloc(0)); // brigadier:bool
    const body = Buffer.concat([varint(2), root, arg, varint(0)]);
    const decoded = proto.parsePacketBuffer('packet_declare_commands', body);
    // packet_* types may or may not include the name wrapper; also try top-level via packet
    const pkt = Buffer.concat([varint(0x10), body]);
    const parsed = parser.parsePacketBuffer(pkt);
    expect(pkt.length - parsed.metadata.size).toBe(0);
    expect(parsed.data.name).toBe('declare_commands');
    expect(parsed.data.params.nodes).toHaveLength(2);
    const n1 = parsed.data.params.nodes[1];
    const parserName = n1.parser ?? n1.extraNodeData?.parser ?? n1.extra?.parser;
    expect(parserName, 'keys=' + Object.keys(n1).join(',')).toBe('brigadier:bool');
  });
});
