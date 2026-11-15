import {createRequire} from 'node:module';
import {setTimeout as wait} from 'node:timers/promises';
import fs from 'node:fs/promises';
import {command} from '../../../ops/rcon-client.mjs';
const require=createRequire(process.env.MINEFLAYER_PACKAGE);
const {createBot}=require('mineflayer');
const stage=process.env.SOUL_SPELL_STAGE;
if(!stage||await fs.readFile(stage+'/.soul-spell-qa','utf8')!=='SYNTHETIC_ONLY')throw Error('isolated fixture required');
const rc=cmd=>command(cmd,15000,{port:25953,properties:stage+'/server.properties'});
const bot=createBot({host:'127.0.0.1',port:25952,username:'SoulSpellQA',version:'1.21.1',auth:'offline'});
bot.on('error',e=>console.log('client error',e.message));
bot.on('kicked',r=>console.log('client kicked',JSON.stringify(r)));
try {
  await Promise.race([new Promise(r=>bot.once('spawn',r)),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('spawn timeout')),45000);t.unref();})]);
  console.log('connected synthetic actor');
  for(const item of ['minecraft:stick','touhou_little_maid:smart_slab_init','touhou_little_maid:smart_slab_empty','touhou_little_maid:hakurei_gohei']) {
    const r=await rc('soulqa '+item);console.log(r);if(process.env.QA_PHASE!=='baseline'&&(!r.includes('QA_MAP key='+item)||r.includes('QA_MAP_ERROR')))throw Error('map failed '+item);
    await wait(300);
  }
  if(process.env.QA_PHASE==='functional') {
    const initial=await rc('soulqa inspect');const n=Number(initial.match(/maids=(\d+)/)[1]);
    for(const [index,hand] of ['main','off'].entries()) {
      console.log(await rc('soulqa prepare-'+hand));await wait(1000);
      bot._client.write('block_place',{location:{x:0,y:63,z:0},direction:1,hand:index,cursorX:.5,cursorY:1,cursorZ:.5,insideBlock:false,sequence:index+1});
      await wait(1500);const r=await rc('soulqa inspect');console.log(r);
      if(!r.includes('maids='+(n+index+1))||!r.includes('owned='+(n+index+1)))throw Error('native soul placement did not create exactly one owned maid');
    }
    console.log(await rc('soulqa protect'));
  }
}finally {bot.quit();await wait(500);}
