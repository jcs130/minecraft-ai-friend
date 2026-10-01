// Production smoke for the 15-floor expansion. Temporary whitelist entry is removed on exit.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire('E:/Cortico/package.json');
const mineflayer=require('mineflayer');
const rcon=cmd=>execFileSync('node',['E:/MC/probe/rcon.mjs',cmd],{encoding:'utf8'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const name=`ChalQA${String(Date.now()).slice(-5)}`;
let bot;
let added=false;
const lines=[];
try{
  assert.match(rcon(`whitelist add ${name}`),/Added|added|白名单/);
  added=true;
  bot=mineflayer.createBot({host:'127.0.0.1',port:25565,username:name,auth:'offline',version:'1.20.6'});
  bot.on('messagestr',line=>lines.push(line));
  await new Promise((resolve,reject)=>{
    bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject);
    setTimeout(()=>reject(new Error('spawn timeout')),30000).unref();
  });
  lines.length=0;bot.chat('/mycli arena status');await sleep(600);
  const status=lines.find(line=>line.startsWith('MC_DUNGEON status '));
  assert.ok(status);assert.match(status,/participant=false/);assert.match(status,/maxFloor=15/);
  lines.length=0;bot.chat('/mycli arena loot');await sleep(600);
  assert.match(lines.join('\n'),/dailyLimitPerFloor=1/);
  rcon(`tp ${name} -588 91 -310`);await sleep(850);
  if(bot.currentWindow)bot.closeWindow(bot.currentWindow);
  bot.setQuickBarSlot(8);
  await sleep(400);
  const merchant=Object.values(bot.entities).find(e=>e.name==='villager'
    && Math.abs(e.position.x+587.5)<1.5 && Math.abs(e.position.z+310.5)<2);
  assert.ok(merchant,'entrance equipment merchant');
  const window=await new Promise((resolve,reject)=>{
    bot.once('windowOpen',resolve);
    setTimeout(()=>reject(new Error('shop menu timeout')),5000).unref();
    bot.activateEntity(merchant);
  });
  assert.equal(window.slots[12]?.name,'diamond_sword',JSON.stringify({
    title:window.title,slotCount:window.slots.length,
    first:window.slots.slice(0,17).map(item=>item?.name||null),
    merchantPosition:merchant.position.toString(),
  }));
  bot.closeWindow(window);
  console.log(JSON.stringify({verdict:'PASS',status,shop:'vanilla inventory, diamond_sword offer'}));
}finally{
  if(bot)bot.quit();
  if(added)rcon(`whitelist remove ${name}`);
}
