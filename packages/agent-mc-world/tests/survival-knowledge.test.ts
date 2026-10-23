import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMinecraftKnowledge } from '../core/knowledge.ts';
import { GameMemoryBook } from '../core/game-memory.ts';
import { MinecraftWorld } from '../core/world.ts';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { MinecraftClientWorld } from '../src/client/world.ts';
import { createMinecraftMcpServer } from '../src/mcp/server.ts';

const topics = [
  ['bed', '睡觉', 'wool'], ['night_shelter', '庇护', 'dawn'],
  ['equipment', '防具', 'armor'], ['base', '营地', 'home'],
  ['storage', '收纳', 'stow'], ['farming', '补种', 'renewable'],
] as const;
const read = (name: string, version = '1.21.1') => readMinecraftKnowledge({ id: `guide/${name}` }, version) as any;
afterEach(() => vi.restoreAllMocks());

describe('optional survival references', () => {
  it.each(topics)('retrieves %s with bilingual summary discovery and its own pinned provenance', (name, zh, en) => {
    const result = read(name);
    expect(result).toMatchObject({ version: '1.21.1', retrieval: 'local-reference', currentWorldVerified: false });
    expect(result.entry).toMatchObject({ id: `guide/${name}`, kind: 'guide' });
    expect(Buffer.byteLength(result.entry.content)).toBeLessThanOrEqual(3500);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(10000);
    expect(result.entry.sources.every((s: any) => s.version === '1.21.1' && s.evidence)).toBe(true);
    expect(result.entry.sources.some((s: any) => s.url.startsWith('https://www.minecraft.net/'))).toBe(true);
    expect(result.entry.sources).toContainEqual(expect.objectContaining({
      sha1: '30c73b1c5da787909b2f73340419fdf13b9def88',
      url: 'https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar',
    }));
    for (const query of [zh, en]) {
      const page = readMinecraftKnowledge({ query, kind: 'guide', limit: 1 }, '1.21.1') as any;
      expect(page.entries[0].id).toBe(`guide/${name}`);
      expect(page.entries[0]).not.toHaveProperty('content');
      expect(page.entries[0]).not.toHaveProperty('sources');
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(2000);
    }
  });
  it('preserves all food guides, unique IDs, source-specific evidence and bounded paging', () => {
    const page = readMinecraftKnowledge({ kind: 'guide', limit: 10 }, '1.21.1') as any;
    expect(page.total).toBe(9);
    expect(page.nextOffset).toBeNull();
    expect(new Set(page.entries.map((e: any) => e.id)).size).toBe(9);
    expect(page.entries.map((e: any) => e.id)).toEqual(expect.arrayContaining(['guide/food', 'guide/health', 'guide/cooking']));
    expect(page.entries.every((e: any) => !('content' in e))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(6500);
    expect(read('bed').entry.sources.some((s: any) => s.evidence.includes('dimension_type'))).toBe(true);
    expect(read('farming').entry.sources.some((s: any) => s.evidence.includes('FarmBlock.isNearWater'))).toBe(true);
    // Returned references cannot mutate a later read of the immutable catalogue.
    const bed = read('bed'); bed.entry.sources[0].url = 'changed'; bed.entry.content = 'changed';
    expect(read('bed').entry.sources[0].url).not.toBe('changed');
    expect(read('bed').entry.content).not.toBe('changed');
  });
  it('keeps survival semantics out of legacy, unknown and approximate versions', () => {
    const page = readMinecraftKnowledge({ kind: 'guide', limit: 10 }, '1.20.6') as any;
    expect(page.entries).toEqual([]);
    for (const [name] of topics) expect(() => read(name, '1.20.6')).toThrow(/not found/i);
    for (const version of ['auto', '', '1.21', '99.99.99']) {
      expect(() => read('bed', version)).toThrow(/version|not found/i);
    }
  });
  it('uses the actual connected body version rather than the configured default', async () => {
    const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), version: '1.21.1' };
    const world = new MinecraftWorld({ cfg });
    const handler = world.tools().find(t => t.name === 'mc_knowledge')!.handler;
    const context = { role: 'test', log: nullLogger(), callId: 'knowledge-version-test' };
    for (const version of ['1.20.6', 'auto']) {
      (world as any).bridge = { bot: { version } };
      expect(await handler({ id: 'guide/bed' }, context)).toMatchObject({ failed: true });
    }
    (world as any).bridge = { bot: { version: '1.21.1' } };
    for (const [name] of topics) {
      const outcome = await handler({ id: `guide/${name}` }, context) as { meta: any };
      expect(outcome.meta.knowledge.entry.id).toBe(`guide/${name}`);
      expect(outcome.meta.knowledge.version).toBe('1.21.1');
    }
  });
  it.each(['mc', 'mymc'] as const)('exposes all six cards through offline public SDK and MCP discovery (%s)', async prefix => {
    const directory = mkdtempSync(join(tmpdir(), 'mc-survival-knowledge-'));
    const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), version: '1.21.1' };
    const world = new MinecraftClientWorld({ cfg, dataDir: directory });
    const start = vi.spyOn(world, 'start').mockImplementation(async () => { throw new Error('body must not start'); });
    // A custom namespace is adapter-owned; use the actual generic tool declarations under that binding.
    const tools = world.tools.bind(world);
    vi.spyOn(world, 'tools').mockImplementation(() => tools().map(t => ({ ...t, name: t.name.replace(/^mc_/, prefix + '_') })));
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network/model forbidden'); });
    const notebook = vi.spyOn(GameMemoryBook.prototype, 'execute').mockImplementation(() => { throw new Error('memory forbidden'); });
    const runtime = new MinecraftAgentClient({ cfg, dataDir: directory, log: nullLogger() }, world,
      { profile: 'survival-offline', toolPrefix: prefix });
    const tool = `${prefix}_knowledge`;
    const memory = join(directory, 'minecraft-memory'); mkdirSync(memory);
    const sentinel = join(memory, 'sentinel'); writeFileSync(sentinel, 'historical memory remains separate');
    const server = createMinecraftMcpServer(runtime, 'test');
    const client = new Client({ name: 'survival-reference-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a); await client.connect(b);
      const discovery = (await client.listTools()).tools.find(t => t.name === tool)!;
      expect(discovery.annotations?.readOnlyHint).toBe(true);
      expect(discovery.description).toMatch(/bed\/sleep.*night shelter.*equipment.*base.*storage.*farming/);
      const help = JSON.parse((await runtime.call(tool, {})).text);
      expect(help.examples.map((e: any) => e.id)).toEqual(expect.arrayContaining(topics.map(([name]) => `guide/${name}`)));
      for (const [name, zh, en] of topics) {
        const sdk = JSON.parse((await runtime.call(tool, { id: `guide/${name}` })).text);
        const response = await client.callTool({ name: tool, arguments: { id: `guide/${name}` } });
        expect(response.isError).not.toBe(true);
        const mcp = JSON.parse((response.content as Array<{ text: string }>)[0].text);
        expect(mcp).toEqual(sdk);
        for (const query of [zh, en]) {
          const found = await client.callTool({ name: tool, arguments: { query, kind: 'guide', limit: 1 } });
          expect(JSON.parse((found.content as Array<{ text: string }>)[0].text).entries[0].id).toBe(`guide/${name}`);
        }
      }
      expect(runtime.status().phase).toBe('disconnected');
      expect(start).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
      expect(notebook).not.toHaveBeenCalled();
      expect(readFileSync(sentinel, 'utf8')).toBe('historical memory remains separate');
      expect(readdirSync(memory)).toEqual(['sentinel']);
      expect(existsSync(join(directory, 'methods'))).toBe(false);
      await expect(runtime.call(`${prefix}_bag`, {})).rejects.toThrow(/disconnected/);
    } finally {
      await client.close(); await server.close(); await runtime.disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
