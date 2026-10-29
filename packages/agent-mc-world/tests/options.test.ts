import { describe, expect, it } from 'vitest';
import { minecraftOptionsFromSnapshot, extendMinecraftOptions, readMinecraftOptions, renderMinecraftOptionIndex } from '../core/options.ts';
import { readSkillHelp } from '../core/skills.ts';
import type { WorldSnapshot } from '../core/terrain.ts';
import type { MinecraftOption } from '../src/contracts/options.ts';

const state = { freeSlots: 4, task: null, travelling: false, restriction: null };
function snapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return { realTime: '2026-10-18T03:00:00+08:00', invSynced: true, inventory: [], equipment: [],
    entities: [], food: 12, inWater: false, oxygen: 20, ...overrides } as WorldSnapshot;
}
const foods = { bread: { foodPoints: 5 }, rotten_flesh: { foodPoints: 4 } };
const server = (id: string, intents: MinecraftOption['intents']): MinecraftOption => ({ id, intents,
  title: id, purpose: '固定配方 bread×4；当前资格未核验', support: 'unknown',
  evidence: ['历史说明'], checks: ['当前魔力和冷却未知'], read: [],
  source: { kind: 'server-observation', reference: 'test', observedAt: '2026-10-17T00:00:00Z' } });

describe('outcome-oriented capability discovery', () => {
  it('reports carried weapon gaps and focused storage, memory and recipe paths without declaring remote stock empty', () => {
    const s=minecraftOptionsFromSnapshot(snapshot({inventory:[{name:'bow',count:3},{name:'iron_ingot',count:4},{name:'stick',count:4}]}),foods,state);
    expect(s.context).toMatchObject({meleeEquipment:[],arrows:0});
    const read=JSON.stringify(readMinecraftOptions(s,{intent:'equipment'}));
    expect(read).toContain('未见'); expect(read).toContain('mc_bag');expect(read).toContain('mc_memory');
    expect(read).toContain('当前版本配方');expect(read).toContain('内容未知');
    expect(renderMinecraftOptionIndex(s)).toContain('武器与装备→');
    const armed=minecraftOptionsFromSnapshot(snapshot({inventory:[{name:'iron_sword',count:1}]}),foods,state);
    expect(renderMinecraftOptionIndex(armed)).not.toContain('武器与装备→');
    expect(minecraftOptionsFromSnapshot(snapshot({invSynced:false}),foods,state).context.meleeEquipment).toBeNull();
  });
  it('keeps unsynchronized stock and unclassified custom food unknown instead of declaring supplies absent', () => {
    const unready = minecraftOptionsFromSnapshot(snapshot({ invSynced: false }), foods, state);
    expect(unready.context.carriedFood).toBeNull();
    expect(unready.context.carriedBoats).toBeNull();
    expect(unready.context.freeSlots).toBeNull();
    const noRegistry = minecraftOptionsFromSnapshot(snapshot(), {}, state);
    expect(noRegistry.context.carriedFood).toBeNull();
    expect(noRegistry.options.find(o => o.id === 'core.carried-food')?.evidence.join('')).toContain('可食性未知');
    expect(readMinecraftOptions(null, {})).toMatchObject({ status: 'unverified', options: [] });
  });

  it('distinguishes hunger from portable supplies, preserves existing work and counts offhand stock', () => {
    const s = minecraftOptionsFromSnapshot(snapshot({ food: 20, inventory: [{ name: 'rotten_flesh', count: 9 }],
      equipment: [{ slot: 'offhand', name: 'bread', count: 2 } as WorldSnapshot['equipment'][number]] }), foods,
      { ...state, task: '沿道路到河岸', travelling: true });
    expect(s.context.carriedFood).toBe(2);
    const index = renderMinecraftOptionIndex(s);
    expect(index).not.toContain('补给与随身口粮→');
    expect(index).toContain('赶路与交通→core.boat');
    const result = readMinecraftOptions(s, { intent: 'food' }) as { options: MinecraftOption[] };
    expect(result.options.find(o => o.id === 'core.carried-food')?.evidence.join('')).toContain('bread×2');
    expect(result.options.some(o => o.id === 'core.food-production')).toBe(true);
    expect(s.context.bodyTask).toBe('沿道路到河岸');
  });

  it('surfaces actual boat stock and visible vehicles without inventing a horse driving implementation', () => {
    const s = minecraftOptionsFromSnapshot(snapshot({ inventory: [{ name: 'oak_boat', count: 1 }], inWater: true, oxygen: 11,
      entities: [{ name: 'horse', visible: true, distance: 3 }, { name: 'boat', visible: false, distance: 2 }] as WorldSnapshot['entities'] }), foods, state);
    expect(s.context.carriedBoats).toBe(1);
    const boats = s.options.find(o => o.id === 'core.boat')!;
    expect(boats.evidence.join('')).toContain('horse 3格');
    expect(boats.evidence.join('')).not.toContain('boat 2格');
    expect(s.options.find(o => o.id === 'core.horse-travel')?.support).toBe('unsupported');
    expect(renderMinecraftOptionIndex(s)).toContain('水路与潜水');
    expect(s.options.find(o => o.id === 'core.swim')?.checks.join('')).toContain('不因碰水自动选上浮');
  });

  it('keeps a food option visible after a long unrelated catalogue and never lets a pack replace core support facts', () => {
    const s = minecraftOptionsFromSnapshot(snapshot(), foods, { ...state, travelling: true, freeSlots: 0 });
    const extras = [...Array.from({ length: 20 }, (_, i) => server(`server.scan${i}`, ['explore'])), server('server.give', ['food', 'inventory']),
      { ...server('core.horse-travel', ['travel']), support: 'supported' as const }];
    const merged = extendMinecraftOptions(s, extras);
    expect(merged.options.find(o => o.id === 'core.horse-travel')?.support).toBe('unsupported');
    expect(merged.options.filter(o => o.id === 'server.give')).toHaveLength(1);
    const index = renderMinecraftOptionIndex(merged);
    expect(index).toContain('server.give');
    expect(index).toContain('bread×4');
    expect(index.length).toBeLessThanOrEqual(1400);
    expect(JSON.stringify(readMinecraftOptions(merged, { intent: 'food' }))).toContain('当前魔力和冷却未知');
  });

  it('points to real registered action help, returns only the requested family and rejects malformed intents', () => {
    const s = minecraftOptionsFromSnapshot(snapshot(), foods, state);
    for (const o of s.options) for (const entry of o.read) if (entry.tool === 'mc_help') expect(readSkillHelp(entry.args)).not.toHaveProperty('error');
    const result = readMinecraftOptions(s, { intent: 'water' }) as { options: MinecraftOption[] };
    expect(result.options.every(o => o.intents.includes('water'))).toBe(true);
    expect(result.options.some(o => o.id === 'core.horse-travel')).toBe(false);
    expect(() => readMinecraftOptions(s, { intent: 'cast' })).toThrow('intent=');
    expect(() => readMinecraftOptions(s, { intent: 'food', execute: true })).toThrow();
  });
});
