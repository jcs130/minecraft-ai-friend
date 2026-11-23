import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  experimental26_2VendorRoot,
  installExperimentalMinecraftDataResolution,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';
import '../core/dependency-patches.ts';
import { entitySnapshot } from '../core/entity-snapshot.ts';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'tests/fixtures/vanilla-26.2/entity-effect-wire.json');

beforeAll(() => installExperimentalMinecraftDataResolution());
afterAll(() => uninstallExperimentalMinecraftDataResolution());

describe('26.2 entity_effect wire and core facts', () => {
  const evidence = require(fixture) as {
    vanillaBroadcast: Record<string, string>;
    samples: Array<{ label: string; packet: string; hex: string; decoded: any }>;
  };

  it('records vanilla broadcast limits: observers do not get UpdateMobEffect for other entities', () => {
    expect(evidence.vanillaBroadcast.otherEntityObservers).toMatch(/passengers/);
    expect(evidence.vanillaBroadcast.observerVisible).toMatch(/DATA_EFFECT_PARTICLES/);
    expect(evidence.vanillaBroadcast.passenger).toMatch(/mounts/);
  });

  it('parses official vanilla UpdateMobEffect bytes with leftover=0 and official ids', () => {
    const nmp = require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/index.js'));
    const parser = nmp.createDeserializer({ state: 'play', isServer: false, version: '26.2', noErrorLogging: true });
    for (const sample of evidence.samples) {
      const parsed = parser.parsePacketBuffer(Buffer.from(sample.hex, 'hex'));
      expect(parsed.data.name, sample.label).toBe('entity_effect');
      expect(parsed.metadata.size, sample.label).toBe(Buffer.from(sample.hex, 'hex').length);
      const params = parsed.data.params;
      expect(params).toMatchObject({
        entityId: sample.decoded.entityId,
        effectId: sample.decoded.effectId,
        amplifier: sample.decoded.amplifier,
        duration: sample.decoded.duration,
        flags: sample.decoded.flags,
      });
      expect(Buffer.from(sample.hex, 'hex').length - parsed.metadata.size, sample.label).toBe(0);
    }
  });

  it('maps packet-attested effects onto entitySnapshot and leaves observer-only particles out of effects[]', () => {
    const registry = require('prismarine-registry')('26.2');
    const keys = registry.entitiesByName.zombie.metadataKeys as string[];
    const particleIndex = keys.indexOf('effect_particles');
    expect(particleIndex).toBeGreaterThanOrEqual(0);
    const metadata: unknown[] = [];
    metadata[particleIndex] = [{ type: 'entity_effect', data: -13374465 }];
    const observer = {
      id: 1536, name: 'zombie', type: 'hostile', metadata, equipment: [], passengers: [], effects: {},
    };
    const passengerView = {
      ...observer,
      effects: { 0: { id: 0, amplifier: 1, duration: 587 }, 4: { id: 4, amplifier: 0, duration: 600 } },
    };
    const bot = {
      registry, game: { dimension: 'overworld' },
      entity: { id: 1, name: 'player', type: 'player' },
      entities: { 1536: observer },
      players: {},
    };
    const observed = entitySnapshot(bot as any).entities['1536'];
    expect(observed.effects).toEqual([]);
    expect(observed.effectParticles).toEqual([{ type: 'entity_effect', data: -13374465 }]);

    bot.entities['1536'] = passengerView;
    const asPassenger = entitySnapshot(bot as any).entities['1536'];
    expect(asPassenger.effects).toEqual([
      expect.objectContaining({ id: 0, name: 'speed', amplifier: 1, duration: 587 }),
      expect.objectContaining({ id: 4, name: 'strength', amplifier: 0, duration: 600 }),
    ]);
    expect(asPassenger.effectParticles).toEqual([{ type: 'entity_effect', data: -13374465 }]);
  });
});
