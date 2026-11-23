import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  experimental26_2VendorRoot,
  installExperimentalMinecraftDataResolution,
  uninstallExperimentalMinecraftDataResolution,
} from '../core/experimental-26.2.ts';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vanillaPath = join(root, 'tests/fixtures/vanilla-26.2/vanilla-entity-metadata-indexes.json');
const serializersPath = join(root, 'tests/fixtures/vanilla-26.2/vanilla-entity-data-serializers.json');

function overlayKey(field: string): string {
  let short = field.split('.').pop() ?? field;
  short = short.replace(/^DATA_/, '').replace(/^ID_/, '').replace(/_ID$/, '');
  short = short.toLowerCase();
  short = short.replace(/^trusted_id_/, 'trusted_');
  if (short === 'villager_data_finalized') short = 'villager_finalized';
  return short;
}

beforeAll(() => {
  installExperimentalMinecraftDataResolution();
});

afterAll(() => {
  uninstallExperimentalMinecraftDataResolution();
});

describe('26.2 vanilla SynchedEntityData vs overlay', () => {
  it('aligns all 158 entity types index-for-index with official accessors (names mapped, indexes not invented)', () => {
    const vanilla = JSON.parse(readFileSync(vanillaPath, 'utf8')) as {
      entityTypeCount: number;
      classesLoaded: number;
      specialOrFailed: number;
      entityTypes: Array<{
        id: number;
        name: string;
        implementationClass?: string;
        accessorCount?: number;
        idRegistryCount?: number;
        accessors?: Array<{ id: number; field: string; serializerId: number; serializerField: string }>;
      }>;
    };
    const mcData = require(join(experimental26_2VendorRoot(), 'minecraft-data'))('26.2');
    expect(vanilla.entityTypeCount).toBe(158);
    expect(vanilla.classesLoaded).toBe(158);
    expect(vanilla.specialOrFailed).toBe(0);
    expect(mcData.entitiesArray ?? Object.values(mcData.entities)).toHaveLength(158);

    const diffs: string[] = [];
    for (const type of vanilla.entityTypes) {
      const short = type.name.replace(/^minecraft:/, '');
      const overlay = mcData.entitiesByName[short] ?? mcData.entities.find((e: any) => e.id === type.id);
      if (!overlay) {
        diffs.push(`${type.name}: missing from overlay`);
        continue;
      }
      const vKeys = (type.accessors ?? []).map((a) => overlayKey(a.field));
      const oKeys = overlay.metadataKeys ?? [];
      if (type.accessorCount !== type.idRegistryCount) {
        diffs.push(`${type.name}: accessorCount ${type.accessorCount} != idRegistryCount ${type.idRegistryCount}`);
      }
      if (vKeys.join('\0') !== oKeys.join('\0')) {
        diffs.push(`${type.name}: vanilla[${vKeys.join(',')}] overlay[${oKeys.join(',')}]`);
      }
    }
    expect(diffs, diffs.join('\n')).toEqual([]);
  });

  it('documents official EntityDataSerializers ids 0-42 without inventing indexes', () => {
    const serializers = JSON.parse(readFileSync(serializersPath, 'utf8')) as {
      serializers: Array<{ field: string; id: number }>;
    };
    expect(serializers.serializers.map((s) => s.id)).toEqual([...Array(43).keys()]);
    expect(serializers.serializers[0]).toMatchObject({ id: 0, field: 'BYTE' });
    expect(serializers.serializers[42]).toMatchObject({ id: 42, field: 'HUMANOID_ARM' });
  });
});
