import '../core/dependency-patches.ts';
import {createRequire} from 'node:module';
import {expect,it} from 'vitest';
const req=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const protocol=req('minecraft-protocol');
const data=req('minecraft-data');
// Individual packets reproduced from the isolated, unmodified Paper 1.21.1 server.
const recipes=[
  ['minecraft:smelting','7701126d696e6563726166743a63686172636f616c0f000220018a01000001ac010000019701000001a1010000018401000001a60100000191010000019b010000018801000001aa0100000195010000019f010000018601000001a80100000193010000019d010000018701000001a90100000194010000019e010000018501000001a70100000192010000019c010000018b01000001ad010000019801000001a2010000018901000001ab010000019601000001a001000001a40600003e19999ac801'],
  ['minecraft:crafting_special_shielddecoration','77011b6d696e6563726166743a736869656c645f6465636f726174696f6e0b03'],
  ['minecraft:crafting_decorated_pot','7701176d696e6563726166743a6465636f72617465645f706f741603'],
];
it.each(recipes)('reads the original 1.21.1 recipe serializer id for %s', (type,hex)=>{
  const before=JSON.stringify(data('26.1').protocol);
  const buffer=Buffer.from(hex,'hex');
  const parsed=protocol.createDeserializer({state:'play',version:'1.21.1',isServer:false}).parsePacketBuffer(buffer);
  expect(parsed.data.name).toBe('declare_recipes');
  expect(parsed.data.params.recipes).toHaveLength(1);
  expect(parsed.data.params.recipes[0].type).toBe(type);
  expect(parsed.metadata.size).toBe(buffer.length);
  expect(protocol.createSerializer({state:'play',version:'1.21.1',isServer:true}).createPacketBuffer(parsed.data)).toEqual(buffer);
  expect(JSON.stringify(data('26.1').protocol)).toBe(before);
});
