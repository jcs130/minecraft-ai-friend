import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { installMineflayerFixes } from '../core/mineflayer-fixes.ts';
import { inventoryReadConfirmed, inventoryReadState, narrateInventorySync } from '../core/inventory-window-sync.ts';

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
  // alwaysEat, seconds, optional usingConvertsTo (boolean + Slot), effects. A second component
  // and a later sword slot expose even a one-byte cursor error. No client encoder.
  const food = Buffer.concat([varint(3), varint(registry.itemsByName.bread.id), varint(2), varint(0),
    varint(20), varint(5), float(.6), Buffer.from([0]), float(1.6),
    ...(converts ? [Buffer.from([1]),varint(1),varint(registry.itemsByName.bowl.id),varint(0),varint(0)] : [Buffer.from([0])]), varint(0),
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

it('reports native player inventory decode failure until a complete new snapshot, without replaying actions', () => {
  const {registry,bot,client} = patchedInventory('1.21.1');
  const Item = mf('prismarine-item')(registry);
  const complete = Buffer.concat([varint(0x13), varint(0), varint(1), varint(46),
    ...Array.from({length:46},()=>varint(0)), varint(0)]);
  const parser = mf('minecraft-protocol').createDeserializer({state:'play',isServer:false,version:'1.21.1',noErrorLogging:true});
  Object.assign(client,{state:'play',deserializer:parser}); client.emit('state','play'); client.emit('state','play');
  let delivered = 0;
  parser.on('data',(decoded:any)=>{delivered++; client.emit(decoded.data.name,decoded.data.params);});
  parser.write(complete);
  expect(inventoryReadState(bot,false).phase).toBe('initial'); // Bridge must still confirm its own initial packet.
  parser.write(complete.subarray(0,8)); // Upstream swallows PartialReadError; guard must still report it.
  expect(delivered).toBe(1);
  expect(inventoryReadState(bot,false)).toMatchObject({phase:'decode_failed'});
  expect(narrateInventorySync(inventoryReadState(bot,false))).toContain('解析失败');
  client.emit('set_slot',{windowId:0,stateId:2,slot:36,item:Item.toNotch(new Item(registry.itemsByName.iron_sword.id,1))});
  expect(inventoryReadConfirmed(bot)).toBe(false); // One known slot is not a complete bag.
  parser.write(complete);
  expect(delivered).toBe(2);
  expect(inventoryReadState(bot).phase).toBe('ready');
  expect(bot.inventory.slots[36]).toBeNull(); // Real empty slots replace old data.
  parser.write(Buffer.concat([complete,Buffer.from([5])])); // Short consumption must never be emitted as good data.
  expect(delivered).toBe(2);
  expect(inventoryReadState(bot).phase).toBe('decode_failed');
  parser.write(complete);
  const closedContainer = Buffer.from(complete.subarray(0,8)); closedContainer[1]=3;
  parser.write(closedContainer);
  expect(inventoryReadState(bot).phase).toBe('ready'); // A late closed window cannot quarantine player slots.
  const stateListeners=client.listenerCount('state'); client.emit('end');
  expect(client.listenerCount('state')).toBe(stateListeners-1);
});

const string = (value: string): Buffer => { const b = Buffer.from(value); return Buffer.concat([varint(b.length), b]); };
const textNbt = (value: string): Buffer => {
  const b = Buffer.from(value), header = Buffer.alloc(3); header[0] = 8; header.writeUInt16BE(b.length, 1);
  return Buffer.concat([header, b]);
};

// Independent layouts: ViaVersion ArmorTrimMaterial1_20_5 TYPE1_20_5/TYPE1_21_2,
// and MCProtocolLib 1.21-1 ItemCodecHelper.readTrimMaterial/readEffectInstance.
// Never encode these fixtures with the same minecraft-data schema being tested.
it.each(['1.20.6', '1.21.1', '1.21.3', '1.21.4'])('reads inline trim without corrupting later slots (%s)', version => {
  const {registry,bot,client} = patchedInventory(version);
  const component = (name: string) => varint(Number(Object.entries(registry.protocol.types.SlotComponentType[1].mappings)
    .find(([,v]) => v === name)![0]));
  const material = Buffer.concat([varint(0), string('quartz'), varint(registry.itemsByName.quartz.id),
    ...(version === '1.21.4' ? [] : [float(.1)]), varint(1),
    ...(['1.20.6', '1.21.1'].includes(version) ? [varint(3)] : [string('minecraft:iron')]),
    string('quartz_darker'), textNbt('石英纹饰')]);
  const pattern = Buffer.concat([varint(0), string('minecraft:sentry'),
    varint(registry.itemsByName.sentry_armor_trim_smithing_template.id), textNbt('哨兵纹饰'), Buffer.from([0])]);
  const armor = Buffer.concat([varint(1), varint(registry.itemsByName.iron_chestplate.id), varint(2), varint(0),
    component('trim'), material, pattern, Buffer.from([1]), component('repair_cost'), varint(7)]);
  const sword = Buffer.concat([varint(1), varint(registry.itemsByName.iron_sword.id), varint(0), varint(0)]);
  const shield = Buffer.concat([varint(1), varint(registry.itemsByName.shield.id), varint(0), varint(0)]);
  const bytes = Buffer.concat([varint(0x13), varint(0), varint(1), varint(46),
    ...Array.from({length:46}, (_,i) => i===6 ? armor : i===36 ? sword : i===45 ? shield : varint(0)), varint(0)]);
  const parser = mf('minecraft-protocol').createDeserializer({state:'play', isServer:false, version});
  const decoded = parser.parsePacketBuffer(bytes);
  expect(decoded.metadata.size).toBe(bytes.length);
  client.emit(decoded.data.name, decoded.data.params);
  expect(inventoryReadConfirmed(bot)).toBe(true);
  expect(bot.inventory.slots[6]).toMatchObject({name:'iron_chestplate',count:1});
  expect(bot.inventory.slots[36]).toMatchObject({name:'iron_sword',count:1});
  expect(bot.inventory.slots[45]).toMatchObject({name:'shield',count:1});
  expect(decoded.data.params.items[6].components).toContainEqual({type:'repair_cost',data:7});
});

it('reads food effects with nested hidden effect, then the next component and weapon', () => {
  const {registry,bot,client} = patchedInventory('1.21.1');
  const effect = Buffer.concat([varint(10), varint(2), varint(600), Buffer.from([0,1,1,1]),
    varint(1), varint(1200), Buffer.from([0,1,0,0]), float(.75)]);
  const food = Buffer.concat([varint(3), varint(registry.itemsByName.bread.id), varint(2), varint(0),
    varint(20), varint(5), float(.6), Buffer.from([0]), float(1.6), Buffer.from([0]), varint(1), effect,
    varint(16), varint(4)]);
  const sword = Buffer.concat([varint(1),varint(registry.itemsByName.iron_sword.id),varint(0),varint(0)]);
  const bytes = Buffer.concat([varint(0x13),varint(0),varint(1),varint(46),
    ...Array.from({length:46},(_,i)=>i===9?food:i===36?sword:varint(0)),varint(0)]);
  const decoded = mf('minecraft-protocol').createDeserializer({state:'play',isServer:false,version:'1.21.1'}).parsePacketBuffer(bytes);
  expect(decoded.metadata.size).toBe(bytes.length);
  client.emit(decoded.data.name,decoded.data.params);
  expect(bot.inventory.slots[36]?.name).toBe('iron_sword');
  expect(decoded.data.params.items[9].components).toContainEqual({type:'repair_cost',data:4});
  const effects=decoded.data.params.items[9].components.find((c:any)=>c.type==='food').data.effects;
  expect(effects[0]).toMatchObject({effect:{id:10,details:{amplifier:2,duration:600,hiddenEffect:{amplifier:1,duration:1200}}},probability:.75});
});

it.each(['1.20.6','1.21.1','1.21.3'])('keeps compatibility corrections within the actual protocol: %s', version => {
  const {registry} = patchedInventory(version);
  const fields = registry.protocol.types.SlotComponent[1].find((f:any)=>f.name==='data').type[1].fields;
  const names = (component:string) => fields[component][1].map((f:any)=>f.name);
  if(version==='1.20.6') expect(names('food')).not.toContain('usingConvertsTo');
  if(version==='1.21.1') expect(names('food')).toContain('usingConvertsTo');
  expect(names('potion_contents').includes('customName')).toBe(version==='1.21.3');
});
