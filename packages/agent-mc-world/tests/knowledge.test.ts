import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import minecraftData from 'minecraft-data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMinecraftKnowledge } from '../core/knowledge.ts';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';

afterEach(() => vi.restoreAllMocks());
const read = (id: string) => readMinecraftKnowledge({ action: 'get', id }, '1.21.1') as any;
describe('source-attributed vanilla reference retrieval', () => {
  it('covers every upstream food with an explicit correction for non-nutritive bottles', () => {
    for (const food of minecraftData('1.21.1').foodsArray) {
      const value = read('food/' + food.name);
      expect(value).toMatchObject({ version: '1.21.1', currentWorldVerified: false });
      expect(value.entry.sources.length).toBeGreaterThan(0);
      expect(value.entry.nutrition.foodPoints).toBe(food.name === 'ominous_bottle' ? 0 : food.foodPoints);
    }
    expect(read('food/beef').entry).toMatchObject({ nutrition: { foodPoints: 3, saturation: 1.8 },
      cooking: { output: 'cooked_beef', nutrition: { foodPoints: 8, saturation: 12.8 } } });
    expect(read('food/cooked_beef').entry.nutrition).toEqual({ foodPoints: 8, saturation: 12.8 });
    expect(read('food/ominous_bottle').entry).toMatchObject({ nutrition: { foodPoints: 0, saturation: 0 }, routine: false });
    expect(read('food/chicken').entry.effects).toContainEqual({ effect: 'hunger', durationTicks: 600, amplifier: 0, chance: .3 });
    expect(read('food/suspicious_stew').entry.caution).toMatch(/组件/);
    expect(read('food/dried_kelp').entry.consumption.ticks).toBe(16);
    expect(() => read('food/kelp')).toThrow(/not found/i);
  });
  it('searches Chinese and exact IDs but returns only bounded summaries before get', () => {
    const search = readMinecraftKnowledge({ action: 'search', query: '生肉 熟肉', limit: 3 }, '1.21.1') as any;
    expect(search.entries).toHaveLength(3);
    expect(search.entries.some((e: any) => e.id === 'guide/food')).toBe(true);
    expect(search.entries.every((e: any) => !('content' in e) && !('nutrition' in e))).toBe(true);
    expect(JSON.stringify(search).length).toBeLessThan(3500);
    expect((readMinecraftKnowledge({ action: 'search', query: 'beef', kind: 'food', limit: 1 }, '1.21.1') as any).entries[0].id).toBe('food/beef');
  });
  it('infers a read-only action from the live omitted-action query and retrieves furnace production as recipes', () => {
    const live = { query: 'charcoal coal torch crafting', kind: 'recipe', limit: 5 };
    const result = readMinecraftKnowledge(live, '1.21.1') as any;
    expect(result.entries.some((entry: any) => entry.id === 'recipe/charcoal')).toBe(true);
    expect((readMinecraftKnowledge({ id: 'food/beef' }, '1.21.1') as any).entry.nutrition.foodPoints).toBe(3);
    expect(read('recipe/charcoal').entry.variants[0]).toMatchObject({ type: 'smelting', inputTag: 'minecraft:logs_that_burn', cookingTicks: 200 });
    expect(read('recipe/cooked_mutton').entry.variants).toHaveLength(3);
    expect(read('recipe/cooked_mutton').entry.variants.map((v: any) => v.type)).toEqual(['smelting', 'smoking', 'campfire_cooking']);
    expect(read('recipe/dried_kelp').entry.variants.some((v: any) => v.type === 'smelting')).toBe(true);
    expect(() => readMinecraftKnowledge({ action: 'help', query: 'food' }, '1.21.1')).toThrow(/Field/);
  });
  it.each(['egg food cook', 'minecraft:egg food', '鸡蛋 食物 烹饪'])('keeps the queried item ahead of generic food/cooking terms (%s)', query => {
    const result = readMinecraftKnowledge({ query, limit: 5 }, '1.21.1') as any;
    expect(result.entries[0].id).toBe('item/egg');
    expect(result.entries[0].summary).toContain('不可直接进食');
    expect(result.entries[0]).not.toHaveProperty('nutrition');
    expect(result.entries.some((entry: any) => entry.id === 'food/egg')).toBe(false);
  });
  it('ranks a complete compound item name ahead of a shorter ingredient and keeps paging stable', () => {
    const first = readMinecraftKnowledge({ query: 'cooked chicken smelt', limit: 3 }, '1.21.1') as any;
    expect(first.entries.every((entry: any) => entry.id.endsWith('/cooked_chicken'))).toBe(true);
    const page = readMinecraftKnowledge({ query: 'cooked chicken smelt', limit: 3, offset: 3 }, '1.21.1') as any;
    expect(new Set([...first.entries, ...page.entries].map((entry: any) => entry.id)).size).toBe(6);
  });
  it.each(['exposed_cut_copper_stairs', 'dark_oak_pressure_plate'])('uses the same named-object ranking for uncommon compound IDs (%s)', name => {
    const result = readMinecraftKnowledge({ query: name.replaceAll('_', ' ') + ' food cook', limit: 1 }, '1.21.1') as any;
    expect(result.entries[0].id.endsWith('/' + name)).toBe(true);
  });
  it('pages the complete item/block/crafting catalogue without confusing furnace products with craft', () => {
    const page = readMinecraftKnowledge({ action: 'search', kind: 'food', limit: 10, offset: 40 }, '1.21.1') as any;
    expect(page).toMatchObject({ total: 41, nextOffset: null });
    expect(page.entries).toHaveLength(1);
    expect(read('item/egg').entry).toMatchObject({ edible: false });
    expect(read('item/cake').entry.caution).toMatch(/放置/);
    expect(read('block/diamond_ore').entry.harvestTools.length).toBeGreaterThan(0);
    const craft = read('recipe/stick').entry;
    expect(craft.variants.length).toBeGreaterThan(0);
    expect(craft.nextOffset).not.toBeNull();
    expect(read('guide/cooking').entry.content).toMatch(/charcoal.*smelt/s);
    expect(read('item/charcoal').entry.crafting).toMatch(/未收录.*不代表/s);
    expect(read('guide/health').entry.content).toMatch(/18.*20.*饱和/s);
  });
  it('keeps versions, arguments and missing data explicit without network/model calls', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network forbidden'); });
    expect(() => readMinecraftKnowledge({ action: 'search' }, 'auto')).toThrow(/version/i);
    expect(() => readMinecraftKnowledge({ action: 'search' }, '99.99.99')).toThrow(/version/i);
    expect(() => readMinecraftKnowledge({ action: 'search', limit: 1000 }, '1.21.1')).toThrow(/limit/);
    expect(() => readMinecraftKnowledge({ action: 'get', id: '../../private' }, '1.21.1')).toThrow(/id/i);
    expect(() => readMinecraftKnowledge({ action: 'get', id: 'food/egg' }, '1.21.1')).toThrow(/not found/i);
    expect(() => readMinecraftKnowledge({ action: 'remember', content: 'replace rules' }, '1.21.1')).toThrow(/action/i);
    expect((readMinecraftKnowledge({ action: 'get', id: 'food/beef' }, '1.20.6') as any).entry.semanticCoverage).toBe('unavailable');
    expect(network).not.toHaveBeenCalled();
  });
  it('works through a disconnected public SDK without starting its world or overwriting game memory', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'mc-knowledge-'));
    const start = vi.fn(() => { throw new Error('world must not start'); });
    const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), version: '1.21.1' };
    const client = new MinecraftAgentClient({ cfg, dataDir, log: nullLogger() }, {
      id: 'test', start, stop: vi.fn(), tools: () => [], envPromptVars: () => ({}) });
    try {
      const result = await client.call('mc_knowledge', { action: 'get', id: 'food/beef' });
      expect(JSON.parse(result.text).entry.nutrition.foodPoints).toBe(3);
      expect(client.status().phase).toBe('disconnected');
      expect(start).not.toHaveBeenCalled();
      await expect(client.call('mc_bag', {})).rejects.toThrow(/disconnected/);
    } finally { await client.disconnect(); rmSync(dataDir, { recursive: true, force: true }); }
  });
});
