import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const bot = mineflayer.createBot({host:'127.0.0.1',port:25566,
  username:`TierMenu${String(Date.now()).slice(-5)}`,auth:'offline',version:'1.20.6'});
const lines=[];
bot.on('messagestr',line=>lines.push(line));
const wait=async(fn,label)=>{
  for(let n=0;n<80;n++){
    const value=fn(); if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error(`Timed out: ${label}`);
};
try{
  await new Promise((resolve,reject)=>{
    bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject);
  });
  bot.chat('/mycli menu');
  const skills=await wait(()=>bot.currentWindow,'skill menu');
  assert.equal(skills.slots[16]?.name,'lodestone');
  await bot.clickWindow(16,0,0);
  const places=await wait(()=>bot.currentWindow!==skills&&bot.currentWindow,'places menu');
  assert.equal(places.slots[18]?.name,'wooden_sword');
  assert.equal(places.slots[19]?.name,'iron_sword');
  assert.equal(places.slots[20]?.name,'diamond_sword');
  assert.equal(places.slots[21]?.name,'compass');
  const icons=[18,19,20,21].map(slot=>places.slots[slot]?.name);
  await bot.clickWindow(19,0,0);
  await wait(()=>lines.some(line=>line.includes('selected=adventure mode=manual')
    && line.includes('changed=true')),'manual tier selected via GUI');
  bot.chat('/mycli menu');
  const skillsAgain=await wait(()=>bot.currentWindow!==places&&bot.currentWindow,'skill menu again');
  await bot.clickWindow(16,0,0);
  const placesAgain=await wait(()=>bot.currentWindow!==skillsAgain&&bot.currentWindow,'places menu again');
  await bot.clickWindow(21,0,0);
  await wait(()=>lines.some(line=>line.includes('selected=normal mode=auto')
    && line.includes('changed=true')),'automatic tier selected via GUI');
  bot.chat('/mycli arena status');
  await wait(()=>lines.some(line=>line.includes('MC_DUNGEON status')
    && line.includes('selectedDifficulty=normal') && line.includes('difficultyMode=auto')),
    'status automatic tier');
  console.log(JSON.stringify({verdict:'PASS',gui:true,selection:'auto',
    icons}));
}finally{bot.quit();}
