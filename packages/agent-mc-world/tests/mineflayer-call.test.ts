import { expect, it } from 'vitest';
import { BOT_METHODS } from '../core/method-capabilities.ts';
import { mineflayerCallHelp, resolveMineflayerCall } from '../src/client/mineflayer-call.ts';
import { readToolHelp } from '../src/client/tool-help.ts';

it('maps supported native calls and provider-safe names to the canonical tool without embedding argument text', () => {
  for (const method of BOT_METHODS) expect(mineflayerCallHelp('bot.'+method)?.method).toBe('bot.'+method);
  const point={x:1,y:64,z:-3};
  const expected={name:'mymc_script',args:{code:'return await bot.lookAt(...params.args)',params:{args:[point,true]},waitMs:1000}};
  expect(resolveMineflayerCall('mineflayer_look_at',{point,force:true},'mymc')).toEqual(expected);
  expect(resolveMineflayerCall('bot.lookAt',{args:[point,true]},'mymc')).toEqual(expected);
  const text='hello); throw Error("unexpected")';
  expect(resolveMineflayerCall('bot.chat',{message:text},'my')).toEqual({name:'my_do',args:{steps:[{skill:'chat',text}]}});
  expect(resolveMineflayerCall('bot_inventory_items',{})).toEqual({name:'mc_bag',args:{detail:'slots'}});
  expect(resolveMineflayerCall('bot.loadPlugin',{})).toBeUndefined();
  expect(()=>resolveMineflayerCall('bot.lookAt',{force:true})).toThrow(/Missing/);
  expect(()=>resolveMineflayerCall('bot.lookAt',{args:[point],force:true})).toThrow();
  expect(()=>resolveMineflayerCall('bot.inventory.items',{args:[1]})).toThrow();
});

it('only describes aliases whose canonical target is available', () => {
  const tool={name:'my_bag',description:'Bag',parameters:{type:'object'}};
  expect(JSON.parse(readToolHelp([tool],{name:'bot.inventory.items'}).text).alias.canonicalTool).toBe('my_bag');
  expect(readToolHelp([tool],{name:'bot.dig'}).failed).toBe(true);
});
