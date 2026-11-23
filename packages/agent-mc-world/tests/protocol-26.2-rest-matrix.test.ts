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
import { viewerSoundPacket } from '../core/viewer-sound-packets.ts';
import { commandTreeFacts } from '../core/command-tree-facts.ts';
import { trackMaps, mapStateOf } from '../core/map-view.ts';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = require(join(root, 'tests/fixtures/vanilla-26.2/rest-matrix-live-evidence.json'));
const windows = require(join(experimental26_2VendorRoot(), 'minecraft-data/overlay/pc/26.2/windows.json'));

beforeAll(() => installExperimentalMinecraftDataResolution());
afterAll(() => uninstallExperimentalMinecraftDataResolution());

describe('26.2 menu口径 is 25 protocol ids plus inventory, not 26 menus', () => {
  it('windows.json has 26 entries = menuId -1 plus ids 0-24, all layoutVerified', () => {
    expect(windows).toHaveLength(26);
    const ids = windows.map((w: any) => w.menuId).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([-1, ...Array.from({ length: 25 }, (_, i) => i)]);
    expect(windows.find((w: any) => w.menuId === -1).id).toBe('minecraft:inventory');
    expect(windows.filter((w: any) => w.menuId >= 0)).toHaveLength(25);
    expect(windows.every((w: any) => w.layoutVerified === true)).toBe(true);
    expect(evidence.menus.windowsJsonEntries).toBe(26);
    expect(evidence.menus.protocolMenuIds).toHaveLength(25);
    expect(evidence.menus.playerInventoryMenuId).toBe(-1);
    expect(evidence.menus.wording).toMatch(/25 protocol menu ids/);
  });
});

describe('26.2 vanilla wire leftover=0 plus core output', () => {
  const nmp = () => require(join(experimental26_2VendorRoot(), 'minecraft-protocol/src/index.js'));

  it('parses official sound_effect bytes and feeds viewerSoundPacket', () => {
    const parser = nmp().createDeserializer({ state: 'play', isServer: false, version: '26.2', noErrorLogging: true });
    const registry = require('prismarine-registry')('26.2');
    for (const sample of evidence.sounds.samples) {
      const bytes = Buffer.from(sample.hex, 'hex');
      const parsed = parser.parsePacketBuffer(bytes);
      expect(parsed.data.name, sample.label).toBe('sound_effect');
      expect(bytes.length - parsed.metadata.size, sample.label).toBe(0);
      const viewer = viewerSoundPacket('sound_effect', parsed.data.params, registry);
      expect(viewer?.name, sample.label).toBe(sample.viewerName);
    }
  });

  it('parses official world_particles bytes for happy_villager', () => {
    const parser = nmp().createDeserializer({ state: 'play', isServer: false, version: '26.2', noErrorLogging: true });
    const bytes = Buffer.from(evidence.particles.sample.hex, 'hex');
    const parsed = parser.parsePacketBuffer(bytes);
    expect(parsed.data.name).toBe('world_particles');
    expect(bytes.length - parsed.metadata.size).toBe(0);
    expect(parsed.data.params.particle).toMatchObject({ type: 'happy_villager' });
  });

  it('parses official recipe_book_settings leftover=0', () => {
    const parser = nmp().createDeserializer({ state: 'play', isServer: false, version: '26.2', noErrorLogging: true });
    const bytes = Buffer.from(evidence.recipes.recipe_book_settings.hex, 'hex');
    const parsed = parser.parsePacketBuffer(bytes);
    expect(parsed.data.name).toBe('recipe_book_settings');
    expect(bytes.length - parsed.metadata.size).toBe(0);
  });

  it('records leftover=0 live declare_commands and extracts core command-tree facts', () => {
    expect(evidence.commands.leftover).toBe(0);
    expect(evidence.commands.facts.nodeCount).toBe(2017);
    expect(evidence.commands.facts.rootLiteralCount).toBe(90);
    expect(evidence.commands.facts.hasGive).toBe(true);
    const facts = commandTreeFacts({
      rootIndex: 0,
      nodes: [
        { children: [1, 2] },
        { extraNodeData: { name: 'give' } },
        { extraNodeData: { name: 'particle' } },
      ],
    });
    expect(facts).toMatchObject({ nodeCount: 3, rootLiteralCount: 2, hasGive: true, hasParticle: true, hasPlaysound: false });
  });

  it('records leftover=0 live 26.2 recipe property sets, recipe book, and map core state', () => {
    expect(evidence.recipes.declare_recipes.leftover).toBe(0);
    expect(evidence.recipes.declare_recipes.recipeCount).toBe(7);
    expect(evidence.recipes.declare_recipes.stoneCutterCount).toBe(319);
    expect(evidence.recipes.recipe_book_add.leftover).toBe(0);
    expect(evidence.recipes.recipe_book_add.entryCount).toBe(64);
    expect(evidence.recipes.recipe_book_add.displays).toMatchObject({ crafting_shaped: 38, crafting_shapeless: 26 });
    expect(evidence.maps.leftover).toBe(0);
    expect(evidence.maps.summary).toMatchObject({ itemDamage: 0, scale: 0, columns: 128, rows: 128, dataLen: 16384, icons: 1 });
    expect(evidence.maps.core.readMapId).toBe(0);
    expect(evidence.maps.core.mapStateOf_0).toMatchObject({ id: 0, scale: 0, colors: true, icons: 1 });

    const client = new EventEmitter();
    const bot = { _client: client, registry: require('prismarine-registry')('26.2') } as any;
    trackMaps(bot);
    const colors = Buffer.alloc(4, 4);
    client.emit('map', { itemDamage: 3, scale: 1, locked: false, icons: [{ type: 0, x: 0, z: 0, direction: 0 }], columns: 2, rows: 2, x: 0, y: 0, data: colors });
    const state = mapStateOf(bot, 3);
    expect(state).toMatchObject({ id: 3, scale: 1, locked: false, painted: true });
    expect(state?.icons).toHaveLength(1);
    expect(state?.colors[0]).toBe(4);
  });
});
