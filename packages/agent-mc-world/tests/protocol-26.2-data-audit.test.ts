import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests/fixtures/vanilla-26.2');
const overlay = join(root, 'vendor/experimental-26.2/minecraft-data/overlay/pc/26.2');
const official261 = join(root, 'node_modules/minecraft-data/minecraft-data/data/pc/26.1');

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function namespaced(name: string) {
  return name.includes(':') ? name : `minecraft:${name}`;
}

function resourceOf(name: string) {
  const n = namespaced(name);
  const tail = n.slice('minecraft:'.length);
  return tail.includes('.') ? `minecraft:${tail.slice(tail.indexOf('.') + 1)}` : n;
}

function mcdataPairs(arr: any[], fields: string[]) {
  return (arr as any[]).map((item, i) => {
    const id = item.id ?? i;
    let name = fields.map((f) => item[f]).find(Boolean);
    if (fields.includes('resource') && item.resource) name = item.resource;
    return { id, name: namespaced(String(name)) };
  });
}

function vanillaPairs(excerpt: any, key: string) {
  const entries = excerpt.registries[key].entries as Record<string, { protocol_id: number }>;
  return Object.entries(entries)
    .map(([name, meta]) => ({ id: meta.protocol_id, name }))
    .sort((a, b) => a.id - b.id);
}

function packetMapper(protocol: any, state: string, direction: string): Record<string, number> {
  const pkt = protocol[state]?.[direction]?.types?.packet;
  const out: Record<string, number> = {};
  if (!Array.isArray(pkt) || pkt[0] !== 'container') return out;
  for (const field of pkt[1]) {
    const t = field?.type;
    if (Array.isArray(t) && t[0] === 'mapper') {
      const mappings = t[1]?.mappings ?? {};
      for (const [hex, name] of Object.entries(mappings)) {
        out[String(name)] = String(hex).startsWith('0x') ? parseInt(String(hex), 16) : Number(hex);
      }
    }
  }
  return out;
}

function packetSchema(protocol: any, state: string, direction: string, name: string) {
  return protocol[state]?.[direction]?.types?.[`packet_${name}`] ?? null;
}

describe('26.2 static data vs vanilla 26.2 generator fixtures', () => {
  const excerpt = readJson(join(fixtures, 'registries-excerpt.json'));
  const packets = readJson(join(fixtures, 'packets.json'));
  const proto22 = readJson(join(overlay, 'protocol.json'));
  let proto21: any;
  try {
    proto21 = readJson(join(official261, 'protocol.json'));
  } catch {
    proto21 = null;
  }

  it('matches vanilla attribute protocol ids, and does not map movement_speed to scale', () => {
    const vendor = readJson(join(overlay, 'attributes.json'));
    const vanilla = vanillaPairs(excerpt, 'minecraft:attribute');
    const byId = new Map(vendor.map((a: any, i: number) => [a.id ?? i, a]));
    expect(vendor).toHaveLength(vanilla.length);
    for (const row of vanilla) {
      const got = byId.get(row.id) as any;
      expect(got, `missing vendor attribute id ${row.id} ${row.name}`).toBeTruthy();
      expect(namespaced(got.resource || got.name)).toBe(row.name);
    }
    const speed = vendor.find((a: any) => namespaced(a.resource || '') === 'minecraft:movement_speed');
    const scale = vendor.find((a: any) => namespaced(a.resource || '') === 'minecraft:scale');
    expect(speed.id).not.toBe(scale.id);
    expect(speed.id).toBe(26);
    expect(scale.id).toBe(30);
  });

  it('keeps the 26.2 entity_update_attributes key mapper aligned with vanilla attribute ids', () => {
    const mapper = packetMapper(proto22, 'play', 'toClient');
    // mapper here is packet names; get attribute mappings from the packet schema.
    const schema = packetSchema(proto22, 'play', 'toClient', 'entity_update_attributes');
    const json = JSON.stringify(schema);
    const match = json.match(/"mappings":\{([^}]+)\}/);
    expect(match, 'attribute mappings present').toBeTruthy();
    const mappings = JSON.parse('{' + match![1] + '}');
    const vanilla = vanillaPairs(excerpt, 'minecraft:attribute');
    expect(Object.keys(mappings)).toHaveLength(vanilla.length);
    for (const row of vanilla) {
      const raw = mappings[String(row.id)];
      expect(resourceOf(String(raw)), `id ${row.id}`).toBe(row.name);
    }
    expect(resourceOf(String(mappings['26']))).toBe('minecraft:movement_speed');
    expect(resourceOf(String(mappings['30']))).toBe('minecraft:scale');
  });

  it('ships a 26.2 effects table whose ids and resource names match vanilla mob_effect', () => {
    const vendor = readJson(join(overlay, 'effects.json'));
    const vanilla = vanillaPairs(excerpt, 'minecraft:mob_effect');
    expect(vendor).toHaveLength(vanilla.length);
    for (const row of vanilla) {
      const got = vendor.find((e: any) => e.id === row.id);
      expect(got.resource).toBe(row.name);
      expect(namespaced(got.name)).toBe(row.name);
    }
    expect(vendor[26]).toMatchObject({ id: 26, name: 'unluck', resource: 'minecraft:unluck' });
  });

  it.each([
    ['minecraft:block', 'blocks.json'],
    ['minecraft:item', 'items.json'],
    ['minecraft:entity_type', 'entities.json'],
    ['minecraft:particle_type', 'particles.json'],
  ])('matches vanilla %s ids and names', (registry, file) => {
    const vendor = readJson(join(overlay, file));
    const vanilla = vanillaPairs(excerpt, registry);
    expect(vendor.length).toBe(vanilla.length);
    const byId = new Map(vendor.map((a: any, i: number) => [a.id ?? i, namespaced(a.name)]));
    for (const row of vanilla) {
      expect(byId.get(row.id), row.name).toBe(row.name);
    }
  });

  it('has the same protocol_id set as vanilla in every login/configuration/play/status direction', () => {
    const states: Array<[string, string, string, string]> = [
      ['login', 'toClient', 'login', 'clientbound'],
      ['login', 'toServer', 'login', 'serverbound'],
      ['configuration', 'toClient', 'configuration', 'clientbound'],
      ['configuration', 'toServer', 'configuration', 'serverbound'],
      ['play', 'toClient', 'play', 'clientbound'],
      ['play', 'toServer', 'play', 'serverbound'],
      ['status', 'toClient', 'status', 'clientbound'],
      ['status', 'toServer', 'status', 'serverbound'],
    ];
    for (const [nmpState, nmpDir, vanPhase, vanDir] of states) {
      const nmp = packetMapper(proto22, nmpState, nmpDir);
      const van = packets[vanPhase][vanDir] as Record<string, { protocol_id: number }>;
      const nmpIds = new Set(Object.values(nmp));
      const vanIds = new Set(Object.values(van).map((e) => e.protocol_id));
      expect(nmpIds, `${nmpState}/${nmpDir}`).toEqual(vanIds);
    }
  });

  it('keeps 26.2 map_chunk and light schemas identical to 26.1, and does not reuse the 26.1 login/success field lists', () => {
    expect(proto21, 'official 26.1 protocol.json must be resolvable').toBeTruthy();
    const equal = [
      ['play', 'toClient', 'map_chunk'],
      ['play', 'toClient', 'update_light'],
      ['play', 'toClient', 'block_change'],
      ['play', 'toClient', 'multi_block_change'],
      ['play', 'toClient', 'tile_entity_data'],
      ['play', 'toClient', 'chunk_biomes'],
      ['play', 'toClient', 'unload_chunk'],
    ] as const;
    for (const [state, dir, name] of equal) {
      expect(packetSchema(proto22, state, dir, name), name).toEqual(packetSchema(proto21, state, dir, name));
    }
    const success22 = JSON.stringify(packetSchema(proto22, 'login', 'toClient', 'success'));
    const success21 = JSON.stringify(packetSchema(proto21, 'login', 'toClient', 'success'));
    expect(success22).toContain('sessionId');
    expect(success21).not.toContain('sessionId');
    const login22 = JSON.stringify(packetSchema(proto22, 'play', 'toClient', 'login'));
    const login21 = JSON.stringify(packetSchema(proto21, 'play', 'toClient', 'login'));
    expect(login22).toContain('onlineMode');
    expect(login21).not.toContain('onlineMode');
    const attr22 = JSON.stringify(packetSchema(proto22, 'play', 'toClient', 'entity_update_attributes'));
    const attr21 = JSON.stringify(packetSchema(proto21, 'play', 'toClient', 'entity_update_attributes'));
    expect(attr22).not.toEqual(attr21);
  });

  it('ships a 26.2 note-block instruments table matching vanilla note_block property order', () => {
    const vendor = readJson(join(overlay, 'instruments.json'));
    expect(vendor).toHaveLength(27);
    expect(vendor.map((i: any) => i.name)).toEqual([
      'harp', 'basedrum', 'snare', 'hat', 'bass', 'flute', 'bell', 'guitar', 'chime', 'xylophone',
      'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling', 'trumpet', 'trumpet_exposed',
      'trumpet_oxidized', 'trumpet_weathered', 'zombie', 'skeleton', 'creeper', 'dragon', 'wither_skeleton',
      'piglin', 'custom_head',
    ]);
    vendor.forEach((row: any, i: number) => expect(row.id).toBe(i));
  });

  it('keeps goat-horn datapack instruments separate from note-block instruments', () => {
    const horns = readJson(join(overlay, 'goatHornInstruments.json'));
    const notes = readJson(join(overlay, 'instruments.json'));
    expect(horns).toHaveLength(8);
    const names = horns.map((h: any) => h.resource || `minecraft:${h.name}`).sort();
    expect(names).toEqual([
      'minecraft:admire_goat_horn', 'minecraft:call_goat_horn', 'minecraft:dream_goat_horn',
      'minecraft:feel_goat_horn', 'minecraft:ponder_goat_horn', 'minecraft:seek_goat_horn',
      'minecraft:sing_goat_horn', 'minecraft:yearn_goat_horn',
    ]);
    const noteNames = new Set(notes.map((i: any) => i.name));
    const ids = horns.map((h: any) => h.id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(horns.find((h: any) => h.name === 'ponder_goat_horn').id).toBe(4);
    for (const horn of horns) {
      expect(noteNames.has(horn.name)).toBe(false);
      expect(horn.idStatus).toBe('runtime-registry-vanilla-127.0.0.1');
    }
  });

  it('ships mapIcons including vanilla trial_chambers id 34', () => {
    const vendor = readJson(join(overlay, 'mapIcons.json'));
    const vanilla = vanillaPairs(excerpt, 'minecraft:map_decoration_type');
    expect(vendor).toHaveLength(vanilla.length);
    expect(vendor).toHaveLength(35);
    for (const row of vanilla) {
      const got = vendor.find((i: any) => i.id === row.id);
      expect(got, `missing map icon ${row.id} ${row.name}`).toBeTruthy();
      expect(`minecraft:${got.name}`).toBe(row.name);
    }
    expect(vendor[34]).toMatchObject({ id: 34, name: 'trial_chambers' });
  });

  it('ships a 26.2 windows table with all 25 menu protocol ids and named slot layouts', () => {
    const vendor = readJson(join(overlay, 'windows.json'));
    const vanilla = vanillaPairs(excerpt, 'minecraft:menu');
    const byId = new Map(vendor.filter((w: any) => w.menuId >= 0).map((w: any) => [w.menuId, w]));
    expect(vanilla).toHaveLength(25);
    expect(byId.size).toBe(25);
    for (const row of vanilla) {
      const got = byId.get(row.id) as any;
      expect(got, `missing menu ${row.id} ${row.name}`).toBeTruthy();
      expect(got.id).toBe(row.name);
      expect(Array.isArray(got.slots) && got.slots.length > 0).toBe(true);
      if (got.id === 'minecraft:lectern') {
        // Live vanilla 26.2 window_items length is 1; player inventory is not appended.
        expect(got.totalSlots).toBe(1);
        expect(got.inventoryStart).toBe(1);
        expect(got.inventoryEnd).toBe(0);
      } else {
        expect(got.totalSlots).toBe(got.inventoryStart + 36);
      }
    }
    expect(byId.get(2).layoutVerified).toBe(true);
    expect(byId.get(5)).toMatchObject({ id: 'minecraft:generic_9x6', inventoryStart: 54, totalSlots: 90, layoutVerified: true });
    expect(byId.get(0)).toMatchObject({ id: 'minecraft:generic_9x1', inventoryStart: 9, totalSlots: 45, layoutVerified: true });
    expect(byId.get(1)).toMatchObject({ id: 'minecraft:generic_9x2', inventoryStart: 18, totalSlots: 54, layoutVerified: true });
    expect(byId.get(3)).toMatchObject({ id: 'minecraft:generic_9x4', inventoryStart: 36, totalSlots: 72, layoutVerified: true });
    expect(byId.get(4)).toMatchObject({ id: 'minecraft:generic_9x5', inventoryStart: 45, totalSlots: 81, layoutVerified: true });
    expect(byId.get(17)).toMatchObject({ id: 'minecraft:lectern', totalSlots: 1, inventoryStart: 1, layoutVerified: true });
    expect(byId.get(19)).toMatchObject({ id: 'minecraft:merchant', inventoryStart: 3, totalSlots: 39, layoutVerified: true });
    expect(byId.get(21).layoutVerified).toBe(true);
    expect(byId.get(21)).toMatchObject({ id: 'minecraft:smithing', inventoryStart: 4, totalSlots: 40 });
    expect(byId.get(23).id).toBe('minecraft:cartography_table');
    expect(byId.get(7)).toMatchObject({ id: 'minecraft:crafter_3x3', inventoryStart: 10, totalSlots: 46 });
    const inv = vendor.find((w: any) => w.menuId === -1);
    expect(inv.id).toBe('minecraft:inventory');
    expect(inv.totalSlots).toBe(46);
  });

  it('ships 26.2 enchantments whose ids and names match vanilla runtime registry_data', () => {
    const vendor = readJson(join(overlay, 'enchantments.json'));
    expect(vendor).toHaveLength(43);
    const runtime = ['aqua_affinity','bane_of_arthropods','binding_curse','blast_protection','breach','channeling','density','depth_strider','efficiency','feather_falling','fire_aspect','fire_protection','flame','fortune','frost_walker','impaling','infinity','knockback','looting','loyalty','luck_of_the_sea','lunge','lure','mending','multishot','piercing','power','projectile_protection','protection','punch','quick_charge','respiration','riptide','sharpness','silk_touch','smite','soul_speed','sweeping_edge','swift_sneak','thorns','unbreaking','vanishing_curse','wind_burst'];
    expect(vendor.map((e: any) => e.name)).toEqual(runtime);
    vendor.forEach((e: any, i: number) => expect(e.id ?? i).toBe(i));
  });

  it('records remaining static gaps instead of pretending aliases are complete', () => {
    const components = vanillaPairs(excerpt, 'minecraft:data_component_type');
    expect(components.length).toBe(111);
    // goat-horn network ids and window layouts are explicit and not silently complete
    const windows = readJson(join(overlay, 'windows.json'));
    const unverified = windows.filter((w: any) => w.menuId >= 0 && w.layoutVerified !== true).map((w: any) => w.id);
    expect(unverified).toEqual([]);
    expect(unverified).not.toContain('minecraft:lectern');
    expect(unverified).not.toContain('minecraft:merchant');
    expect(unverified).not.toContain('minecraft:generic_9x6');
    expect(unverified).not.toContain('minecraft:smithing');
    expect(unverified).not.toContain('minecraft:crafter_3x3');
    expect(unverified).not.toContain('minecraft:generic_9x3');
  });
});
