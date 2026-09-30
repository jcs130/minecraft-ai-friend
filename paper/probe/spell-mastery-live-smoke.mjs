// Read-only gameplay smoke on production; a temporary whitelisted player is removed on exit.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire('E:/Cortico/package.json');
const mineflayer=require('mineflayer');
const rcon=command=>execFileSync('node',['E:/MC/probe/rcon.mjs',command],{encoding:'utf8'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const username=`MSQA${Date.now().toString(36).slice(-8)}`;
let bot;
const lines=[], states=[];
try {
  assert.match(rcon(`minecraft:whitelist add ${username}`),/Added|added|白名单/);
  bot=mineflayer.createBot({host:'127.0.0.1',port:25565,username,auth:'offline',version:'1.20.6'});
  bot.on('messagestr',line=>lines.push(line));
  bot._client.on('custom_payload',packet=>{
    if(packet.channel==='mcviewer:state') states.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
  });
  await Promise.race([
    new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);
      bot.once('kicked',reason=>reject(new Error(JSON.stringify(reason))));}),
    sleep(20000).then(()=>{throw new Error('spawn timeout');}),
  ]);
  bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcviewer:state')});
  await sleep(2200);
  bot.chat('/mycli mastery');
  for(let i=0;i<30 && !lines.some(line=>line.startsWith('MC_MASTERY id=starbolt'));i++) await sleep(100);
  const record=lines.find(line=>line.startsWith('MC_MASTERY id=starbolt'));
  assert.match(record ?? '',/level=1 uses=0 requiredUses=8 category=combat/);
  const menu=new Promise(resolve=>bot.once('windowOpen',resolve));
  bot.chat('/mycli menu');
  const first=await menu;
  assert.equal(first.slots[5]?.name,'experience_bottle');
  const page=new Promise(resolve=>bot.once('windowOpen',resolve));
  await bot.clickWindow(5,0,0);
  const second=await page;
  assert.equal(second.slots[9]?.name,'amethyst_shard');
  bot.closeWindow(second);
  assert.ok(states.some(state=>state.abilities?.some(ability=>ability.id==='mycli:starbolt'&&ability.level===1)));
  console.log(JSON.stringify({ok:true,version:'0.3.36',username,masteryEntries:lines.filter(line=>line.startsWith('MC_MASTERY')).length,
    viewerPackets:states.length,controllerMenu:true}));
} finally {
  if(bot) bot.quit();
  rcon(`minecraft:whitelist remove ${username}`);
}
