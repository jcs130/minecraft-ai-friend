import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { repairRecipeSerializers } from '../core/mineflayer-fixes.ts';

const worldRequire = createRequire(import.meta.url);
const mfRequire = createRequire(worldRequire.resolve('mineflayer'));
const protocolRequire = createRequire(mfRequire.resolve('minecraft-protocol'));
const protocol = mfRequire('minecraft-protocol');

describe('1.20.6 recipe wire compatibility', () => {
  it('decodes real recipe bytes with the same dependency registry as the login client', () => {
    const registry = protocolRequire('minecraft-data')('1.20.6');
    repairRecipeSerializers(registry);
    expect(repairRecipeSerializers(registry)).toBe(false);
    // Four recipes encoded with protocol 766: repair, smelting, stonecutting and smithing trim.
    const bytes = Buffer.from('77040b746573743a7265706169720e000a746573743a736d656c740f04776f6f640001018401000001a30600003e19999ac80108746573743a637574130573746f6e650101010000018802000009746573743a7472696d150101f30900000101e10600000101ae060000', 'hex');
    const parser = protocol.createDeserializer({ state: 'play', isServer: false, version: '1.20.6' });
    const decoded = parser.parsePacketBuffer(bytes);
    expect(decoded.metadata.size).toBe(bytes.length);
    expect(decoded.data.name).toBe('declare_recipes');
    expect(decoded.data.params.recipes).toMatchObject([
      { type: 'minecraft:crafting_special_repairitem', data: { category: 0 } },
      { type: 'minecraft:smelting', data: { group: 'wood', ingredient: [{ itemId: registry.itemsByName.oak_log.id }],
        result: { itemId: registry.itemsByName.charcoal.id }, cookTime: 200 } },
      { type: 'minecraft:stonecutting', data: { group: 'stone', result: { itemId: registry.itemsByName.stone_slab.id } } },
      { type: 'minecraft:smithing_trim', data: { addition: [{ itemId: registry.itemsByName.gold_ingot.id }] } },
    ]);
  });

  it('preserves the registry of other protocol versions', () => {
    const registry = protocolRequire('minecraft-data')('1.20.4');
    const before = JSON.stringify(registry.protocol);
    expect(repairRecipeSerializers(registry)).toBe(false);
    expect(JSON.stringify(registry.protocol)).toBe(before);
  });
});
