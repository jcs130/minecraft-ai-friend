import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { findBankCell, wetNote } from '../core/terrain.ts';
const require = createRequire(import.meta.url);
const Block = require('prismarine-block')('1.21.1');
const data = require('minecraft-data')('1.21.1');
const block = (name: string, properties = {}) => Block.fromProperties(data.blocksByName[name].id, properties, 0);
const target = new Vec3(17, 51, 383);
const key = (p: Vec3) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
function fixture(material = 'air', properties = {}, support = 'stone') {
 const cells = new Map([[key(target.offset(0,-1,0)), block(support,support === 'oak_slab' ? {type:'bottom',waterlogged:false} : {})], [key(target), block(material, properties)], [key(target.offset(0,1,0)), block('air')]]);
 const bot = { entity: { position: new Vec3(15,52,381) }, blockAt: (p: Vec3) => cells.get(key(p)) ?? block('water') };
 return {bot,cells};
}
describe('bank candidates use actual 1.21.1 fluid and body geometry', () => {
 it.each([['glow_lichen',{waterlogged:true,down:true}],['lava',{level:0}]] as const)('rejects %s inside the body', (name, properties) => {
  const {bot}=fixture(name,properties); expect(findBankCell(bot,null,16)).toBeNull();
  expect(wetNote(bot)).toContain('本次采样未确认');
 });
 it('preserves a dry supported position without claiming nearest or reachable', () => {
  const {bot}=fixture('glow_lichen',{waterlogged:false,down:true});
  expect(findBankCell(bot,null,16)).toEqual({x:17,y:51,z:383});
  expect(wetNote(bot)).toContain('干燥站位候选 (17, 51, 383)');
  expect(wetNote(bot)).toContain('路径与可达性尚未验证'); expect(wetNote(bot)).not.toContain('最近');
 });
 it('rejects partial-height support, protruding collision, and unknown owner cells', () => {
  const slab=fixture('air',{},'oak_slab');expect(findBankCell(slab.bot,null,16)).toBeNull();
  const fence=fixture('air',{},'oak_fence');expect(findBankCell(fence.bot,null,16)).toBeNull();
  const {bot}=fixture();const read=bot.blockAt;
  bot.blockAt=(p:Vec3)=>key(p)===key(target.offset(1,0,0))?null:read(p);
  expect(findBankCell(bot,null,16)).toBeNull();
 });
});
