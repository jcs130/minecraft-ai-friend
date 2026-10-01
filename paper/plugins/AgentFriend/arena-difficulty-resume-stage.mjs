import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('E:/Cortico/package.json');
const mineflayer=require('mineflayer');
const bot=mineflayer.createBot({host:'127.0.0.1',port:25566,
  username:process.argv[2],auth:'offline',version:'1.20.6'});
const messages=[];
bot.on('messagestr',line=>messages.push(line));
try{
  assert.ok(process.argv[2], 'username from the saved stage run is required');
  await new Promise((resolve,reject)=>{
    bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject);
  });
  bot.chat('/mycli arena status');
  let status=null;
  for(let n=0;n<80;n++){
    status=messages.find(line=>line.includes('MC_DUNGEON status'));
    if(status)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(status,status||messages.slice(-10).join(' | '));
  assert.match(status,/participant=true/);
  assert.match(status,/globalDifficulty=apocalypse/);
  assert.match(status,/globalFloor=6/);
  console.log(JSON.stringify({verdict:'PASS',rejoined:true,
    difficulty:'apocalypse',floor:6}));
}finally{bot.quit();}
