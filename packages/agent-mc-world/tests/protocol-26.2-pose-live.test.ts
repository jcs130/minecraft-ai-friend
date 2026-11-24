import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  installExperimentalMinecraftDataResolution,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';
import '../core/dependency-patches.ts';
import { entitySnapshot } from '../core/entity-snapshot.ts';

const require = createRequire(import.meta.url);
const fixture = require(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/vanilla-26.2/pose-live-facts.json'));

beforeAll(() => installExperimentalMinecraftDataResolution());
afterAll(() => uninstallExperimentalMinecraftDataResolution());

describe('26.2 live vanilla sleep/swim pose → entitySnapshot facts', () => {
  it('records official living-entity pose 2 (sleeping) and 3 (swimming) from 127.0.0.1 vanilla, then maps them through entitySnapshot', () => {
    expect(fixture.source).toMatch(/live vanilla 26\.2 127\.0\.0\.1:25770/);
    expect(fixture.host).toBe('127.0.0.1');
    expect(fixture.port).toBe(25770);
    expect(fixture.errors).toEqual([]);
    expect(fixture.sleeping).toMatchObject({ snapshotPose: 2, raw: 2, name: 'player' });
    expect(fixture.swimming).toMatchObject({ snapshotPose: 3, raw: 3, name: 'player' });
    expect(fixture.sleeping.label).toMatch(/sleep/i);
    expect(fixture.swimming.label).toMatch(/swim/i);

    const registry = require('prismarine-registry')('26.2');
    const keys = registry.entitiesByName.player.metadataKeys as string[];
    const poseIndex = keys.indexOf('pose');
    expect(poseIndex).toBe(fixture.sleeping.index);
    expect(poseIndex).toBe(fixture.swimming.index);

    const pack = (pose: number, id: number) => {
      const metadata: unknown[] = [];
      metadata[poseIndex] = pose;
      const bot = {
        registry,
        game: { dimension: 'overworld' },
        entity: { id, name: 'player', type: 'player', metadata, position: { x: 0, y: 80, z: 0 } },
        entities: { [id]: { id, name: 'player', type: 'player', metadata } },
        players: {},
      };
      return entitySnapshot(bot as any);
    };

    const sleepSnap = pack(fixture.sleeping.raw, fixture.sleeping.id);
    expect(sleepSnap.self?.pose).toBe(2);
    expect(sleepSnap.entities[String(fixture.sleeping.id)]?.pose).toBe(2);

    const swimSnap = pack(fixture.swimming.raw, fixture.swimming.id);
    expect(swimSnap.self?.pose).toBe(3);
    expect(swimSnap.entities[String(fixture.swimming.id)]?.pose).toBe(3);

    // omitted pose is still not invented as standing
    const bare = {
      registry,
      game: { dimension: 'overworld' },
      entity: { id: 1, name: 'player', type: 'player', metadata: [] },
      entities: { 1: { id: 1, name: 'player', type: 'player', metadata: [] } },
      players: {},
    };
    expect(entitySnapshot(bare as any).self?.pose).toBeNull();
  });
});
