import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile,readFile} from 'node:fs/promises';
import {command} from '../../ops/rcon-client.mjs';
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const stage=process.argv[2];
if(!/^E:[\\/]MC[\\/]staging[\\/]mining-endermen-[^\\/]+$/i.test(stage))throw Error('isolated fixture only');
const rcon=q=>command(q,10000,{port:25930,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const result={mining:[],endermen:[],errors:[]};
const cold=process.argv[3]==='cold';
const fixtureIds=cold?JSON.parse(await readFile(stage+'/entity-ids.json','utf8')):{};
let bot;
try {
 await rcon('gamerule doMobSpawning false');
 await rcon('gamerule doDaylightCycle false');
 await rcon('time set night');
 for(const version of (cold?['1.21.1']:['1.21.1','1.20.6'])){
  bot=mineflayer.createBot({host:'127.0.0.1',port:25929,username:'ag_MiningQA',auth:'offline',version});
  bot.on('error',e=>result.errors.push(String(e)));
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('end',()=>reject(Error('ended before spawn')));setTimeout(()=>reject(Error('spawn timeout')),20000).unref()});
  await rcon('tp ag_MiningQA 0.5 -60 0.5');
  await rcon('gamemode survival ag_MiningQA');
  await sleep(700);
  // prismarine-item 1.18 returns the raw component object from .enchants,
  // while Mineflayer digTime expects the old array. Decode the RECEIVED ids
  // for this probe only; never invent a level from the item we gave it.
  const receivedEnchants=()=>{
   const raw=bot.heldItem?.componentMap?.get('enchantments')?.data;
   return (raw?.enchantments??[]).map(e=>({name:bot.registry.enchantments[e.id]?.name,lvl:e.level}));
  };
  bot.digTime=block=>block.digTime(bot.heldItem?.type,false,false,!bot.entity.onGround,receivedEnchants(),bot.entity.effects);
  for(const enchanted of (cold?[]:[false,true])){
   await rcon('item replace entity ag_MiningQA weapon.mainhand with minecraft:diamond_pickaxe'+(enchanted?'[minecraft:enchantments={levels:{"minecraft:efficiency":5,"minecraft:mending":1,"minecraft:silk_touch":1,"minecraft:unbreaking":3}}]':''));
   await sleep(600);
   const attributes=await rcon('attribute ag_MiningQA minecraft:player.mining_efficiency get');
   for(const material of ['stone','netherrack']){
    await rcon(`setblock 1 -60 0 minecraft:${material}`);
    await sleep(250);
    const block=bot.blockAt(new Vec3(1,-60,0));
    assert.equal(block?.name,material);
    const row={version,enchanted,material,attributes,enchants:receivedEnchants(),components:bot.heldItem?.components,clientDigMs:bot.digTime(block)};
    if(enchanted)assert.equal(row.enchants.find(e=>e.name==='efficiency')?.lvl,5,JSON.stringify(row.components));
    const start=performance.now();
    await bot.dig(block,true);
    row.elapsedMs=performance.now()-start;
    row.serverConfirmation=await rcon('execute if block 1 -60 0 minecraft:air');
    assert.match(row.serverConfirmation,/Test passed/);
    result.mining.push(row);
   }
  }
  await rcon('clear ag_MiningQA');
  if(!cold){bot.quit(); await sleep(600); bot=undefined;}
 }
 // A holder survives while unloaded/far away; eligible one is cleared at add.
 // Negative cases must retain their block. UUID identity lets checks avoid any
 // world-sized selector or reliance on nearby ordering.
 const cases=[['natural','',false],['named',',CustomName:\'{"text":"Keep me"}\'',true],['persistent',',PersistenceRequired:1b',true],['tagged',',Tags:["quest"]',true],['plugin',',BukkitValues:{"qa:owner":1b}',true],['custom',',"Paper.SpawnReason":"CUSTOM"',true]];
 for(let i=0;i<cases.length;i++){
  const [name,extra,retained]=cases[i];let uuid=fixtureIds[name];
  if(!cold){
   await rcon(`denizen:ex spawn enderman[has_ai=false] l@${3+i*3},-60,0,world reason:${name==='custom'?'custom':'natural'}`);
   await sleep(300);
   const reply=await rcon(`data get entity @e[type=enderman,x=${3+i*3},y=-60,z=0,distance=..1,limit=1] UUID`);
   const ints=reply.match(/\[I;\s*([^\]]+)\]/)?.[1].split(',').map(Number);
   assert.equal(ints?.length,4,reply);
   const bytes=Buffer.alloc(16);ints.forEach((v,i)=>bytes.writeInt32BE(v,i*4));
   const h=bytes.toString('hex');uuid=[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');fixtureIds[name]=uuid;
   await rcon(`data merge entity ${uuid} {PersistenceRequired:0b,carriedBlockState:{Name:"minecraft:dirt"}${extra}}`);
  }
  await sleep(250);
  const response=await rcon(`data get entity ${uuid} carriedBlockState`);
  assert.equal(response.includes('minecraft:dirt'),cold?retained:true,`${name}: ${response}`);
  result.endermen.push({name,retained,response});
 }
 if(!cold)await writeFile(stage+'/entity-ids.json',JSON.stringify(fixtureIds));
 if(cold){
  const uuid=fixtureIds.natural;
  await rcon(`data merge entity ${uuid} {carriedBlockState:{Name:"minecraft:moss_block"}}`);
  const before=await rcon(`data get entity ${uuid} carriedBlockState`);
  assert.match(before,/moss_block/);
  await rcon(`execute in minecraft:the_end run tp ${uuid} 10 70 10`);
  await sleep(700);
  const response=await rcon(`data get entity ${uuid} carriedBlockState`);
  assert.match(response,/Found no elements matching carriedBlockState/);
  result.endermen.push({name:'entity-add-after-startup',retained:false,response});
 }
} catch(e){result.errors.push(e.stack)}
finally {
 bot?.quit();
 await writeFile(stage+(cold?'/client-cold-result.json':'/client-result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({mining:result.mining.map(({components,...r})=>r),endermen:result.endermen,errors:result.errors}));
 process.exit(result.errors.length?1:0);
}
