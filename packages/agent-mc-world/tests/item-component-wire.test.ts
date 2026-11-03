import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { installMineflayerFixes } from '../core/mineflayer-fixes.ts';
import { inventoryReadConfirmed } from '../core/inventory-window-sync.ts';

const mf = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const varint = (value: number): Buffer => {
  const bytes: number[] = [];
  do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte); } while (value);
  return Buffer.from(bytes);
};
const float = (value: number): Buffer => { const b = Buffer.alloc(4); b.writeFloatBE(value); return b; };

function patchedInventory(version: string) {
  const registry = mf('prismarine-registry')(version);
  const client = Object.assign(new EventEmitter(), { write() {} });
  const bot = Object.assign(new EventEmitter(), { registry, version, _client: client,
    supportFeature: registry.supportFeature, craft: async () => {}, placeBlock: async () => {},
    _updateBlockState() {}, clearControlStates() {}, stopDigging() {},
    entity: { id: 1, position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' },
  }) as unknown as Bot;
  mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
  installMineflayerFixes(bot, { info() {}, warn() {}, error() {}, debug() {} } as never);
  return {registry,bot,client};
}

it.each([false, true])('decodes protocol 767 food and subsequent inventory slots, converts to bowl=%s', converts => {
  const {registry,bot,client} = patchedInventory('1.21.1');

  // Independent wire layout from Java 1.21.1 FoodComponent: nutrition, saturation,
  // alwaysEat, seconds, usingConvertsTo (empty Slot), effects. A second component
  // and a later sword slot expose even a one-byte cursor error. No client encoder.
  const food = Buffer.concat([varint(3), varint(registry.itemsByName.bread.id), varint(2), varint(0),
    varint(20), varint(5), float(.6), Buffer.from([0]), float(1.6),
    ...(converts ? [varint(1),varint(registry.itemsByName.bowl.id),varint(0),varint(0)] : [varint(0)]), varint(0),
    varint(16), varint(4)]); // repair_cost following food
  const sword = Buffer.concat([varint(1), varint(registry.itemsByName.iron_sword.id), varint(0), varint(0)]);
  const bytes = Buffer.concat([varint(0x13), Buffer.from([0]), varint(1), varint(46),
    ...Array.from({ length: 46 }, (_, i) => i === 9 ? food : i === 36 ? sword : varint(0)), varint(0)]);
  const parser = mf('minecraft-protocol').createDeserializer({ state: 'play', isServer: false, version: '1.21.1' });
  const decoded = parser.parsePacketBuffer(bytes);
  expect(decoded.metadata.size).toBe(bytes.length);
  expect(decoded.data.name).toBe('window_items');
  client.emit(decoded.data.name, decoded.data.params);
  expect(inventoryReadConfirmed(bot)).toBe(true);
  expect(bot.inventory.slots[9]).toMatchObject({ name: 'bread', count: 3 });
  expect(bot.inventory.slots[36]).toMatchObject({ name: 'iron_sword', count: 1 });
  expect(decoded.data.params.items[9].components).toContainEqual({ type: 'repair_cost', data: 4 });
});

it.each(['1.20.6','1.21.1','1.21.3'])('keeps compatibility corrections within the actual protocol: %s', version => {
  const {registry} = patchedInventory(version);
  const fields = registry.protocol.types.SlotComponent[1].find((f:any)=>f.name==='data').type[1].fields;
  const names = (component:string) => fields[component][1].map((f:any)=>f.name);
  if(version==='1.20.6') expect(names('food')).not.toContain('usingConvertsTo');
  if(version==='1.21.1') expect(names('food')).toContain('usingConvertsTo');
  expect(names('potion_contents').includes('customName')).toBe(version==='1.21.3');
});
