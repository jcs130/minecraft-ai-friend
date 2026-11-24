import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  installExperimentalMinecraftDataResolution,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';
import '../core/dependency-patches.ts';
import { entitySnapshot } from '../core/entity-snapshot.ts';

const require = createRequire(import.meta.url);

beforeAll(() => {
  installExperimentalMinecraftDataResolution();
});
afterAll(() => {
  uninstallExperimentalMinecraftDataResolution();
});

describe('26.2 entity naming/equipment/passenger/pose/effect facts', () => {
  it('maps protocol inputs onto entitySnapshot semantic fields without inventing omitted defaults', () => {
    const registry = require('prismarine-registry')('26.2');
    const keys = registry.entitiesByName.zombie.metadataKeys as string[];
    const poseIndex = keys.indexOf('pose');
    const customIndex = keys.indexOf('custom_name');
    expect(poseIndex).toBeGreaterThanOrEqual(0);
    expect(customIndex).toBeGreaterThanOrEqual(0);

    const metadata: unknown[] = [];
    metadata[customIndex] = { type: 'compound', value: { text: { type: 'string', value: 'probe-zombie' } } };
    metadata[poseIndex] = 2; // vanilla LivingEntity pose SLEEPING

    const chicken = { id: 20, uuid: '11111111-1111-4111-8111-111111111111', name: 'chicken', type: 'animal',
      position: { x: 4.5, y: 81, z: 5.5 }, metadata: [], equipment: [null, null, null, null, null], passengers: [] };
    const zombie = {
      id: 19, uuid: '22222222-2222-4222-8222-222222222222', name: 'zombie', type: 'hostile',
      position: { x: 4.5, y: 80, z: 5.5 }, metadata,
      equipment: [
        { name: 'netherite_sword', count: 1 },
        null,
        { name: 'netherite_boots', count: 1 },
        { name: 'netherite_leggings', count: 1 },
        { name: 'netherite_chestplate', count: 1 },
        { name: 'netherite_helmet', count: 1 },
      ],
      passengers: [chicken],
      vehicle: null,
      effects: { 1: { id: 1, amplifier: 1, duration: 1200 } },
    };
    (chicken as any).vehicle = zombie;

    const speedName = registry.effects?.[1]?.name ?? registry.effectsByName?.speed?.name ?? 'speed';
    const bot = {
      registry,
      game: { dimension: 'overworld' },
      entity: { id: 1, name: 'player', type: 'player', position: { x: 0, y: 80, z: 0 } },
      entities: { 19: zombie, 20: chicken },
      players: {},
    };

    const snap = entitySnapshot(bot as any);
    expect(snap.entities['19']).toMatchObject({
      id: 19, name: 'zombie', customName: 'probe-zombie',
      pose: 2, vehicle: null, passengers: [20],
    });
    expect(snap.entities['19'].equipment).toEqual([
      { slot: 0, name: 'netherite_sword', customName: null, count: 1 },
      null,
      { slot: 2, name: 'netherite_boots', customName: null, count: 1 },
      { slot: 3, name: 'netherite_leggings', customName: null, count: 1 },
      { slot: 4, name: 'netherite_chestplate', customName: null, count: 1 },
      { slot: 5, name: 'netherite_helmet', customName: null, count: 1 },
    ]);
    expect(snap.entities['19'].effects).toEqual([
      expect.objectContaining({ id: 1, amplifier: 1, duration: 1200 }),
    ]);
    if (registry.effects?.[1]?.name) {
      expect(snap.entities['19'].effects[0].name).toBe(registry.effects[1].name);
    } else {
      expect(speedName).toBeTruthy();
    }
    expect(snap.entities['20']).toMatchObject({ id: 20, name: 'chicken', vehicle: 19, passengers: [], pose: null, effects: null });
  });

  it('maps an empty effects object to [] and omitted effects to null', () => {
    const registry = require('prismarine-registry')('26.2');
    const bot = {
      registry, game: { dimension: 'overworld' }, entity: { id: 1, name: 'player', type: 'player' },
      entities: {
        8: { id: 8, name: 'zombie', type: 'hostile', metadata: [], equipment: [], passengers: [], effects: {} },
        9: { id: 9, name: 'zombie', type: 'hostile', metadata: [], equipment: [], passengers: [] },
      },
      players: {},
    };
    const snap = entitySnapshot(bot as any);
    expect(snap.entities['8'].effects).toEqual([]);
    expect(snap.entities['9'].effects).toBeNull();
  });

  it('leaves pose null when the pose metadata key is omitted (default standing is not invented)', () => {
    const registry = require('prismarine-registry')('26.2');
    const bot = {
      registry, game: { dimension: 'overworld' }, entity: { id: 1, name: 'player', type: 'player' },
      entities: { 8: { id: 8, name: 'zombie', type: 'hostile', metadata: [], equipment: [], passengers: [] } },
      players: {},
    };
    expect(entitySnapshot(bot as any).entities['8']).toMatchObject({ pose: null, passengers: [], effects: null });
  });
});
