import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),wait=ms=>new Promise(r=>setTimeout(r,ms));const report={checks:[],errors:[],productionChanged:false};let bot,messages=[],last=0;
const rc=q=>command(q,15000,{port:25929,properties:stage+'/server.properties'});
async function until(fn,label,ms=12000){for(let end=Date.now()+ms;Date.now()<end;){if(await fn())return;await wait(100);}throw Error(label+' timeout');}
async function ask(q,pattern=/^MC_RPG /){await wait(Math.max(0,1200-(Date.now()-last)));last=Date.now();let n=messages.length;bot.chat(q);await until(()=>messages.slice(n).some(s=>pattern.test(s)),q);return messages.slice(n).find(s=>pattern.test(s));}
async function state(){for(let n=0;n<8;n++){const r=JSON.parse((await ask('/mycli status --json')).slice(7));if(r.authority==='VortexRPG')return r;}throw Error('profile never ready');}
async function connect(username){messages=[];bot=require('mineflayer').createBot({host:'127.0.0.1',port:25928,username,auth:'offline',version:'1.21.1',checkTimeoutInterval:60000,hideErrors:true});installRecipePacketBypass(bot._client);bot.on('messagestr',s=>messages.push(s));bot.on('error',e=>report.errors.push(String(e)));await Promise.race([new Promise(r=>bot.once('spawn',r)),wait(25000).then(()=>{throw Error('join timeout');})]);await wait(400);if(bot.currentWindow)bot.closeWindow(bot.currentWindow);}
try{
 const name='ag_Profile'+process.argv[2].replace(/\D/g,'');await connect(name);await state();await ask('/mycli profession choose mage',/已选择并保存/);await rc('qdqa nativelevel '+name);await wait(700);const before=await state();assert.equal(before.class,'mage');assert.equal(before.xp,1000);report.checks.push('native class and experience actually initialized');
 for(let i=0;i<3;i++){
  bot.quit();await wait(150);await connect(name);const r=await state();assert.equal(r.class,'mage');assert.equal(r.xp,1000);assert(r.mana>=0);report.checks.push('cached fast reconnect '+i+' retains role XP and usable mana');
 }
 bot.quit();await wait(500);await connect('ag_Clear29');const cold=await state();assert.equal(cold.class,'knight');assert(cold.xp>1500&&cold.economy.balance===190);report.checks.push('full-clear native role XP and real currency persist after normal restart');
 const receipt=await rc('qdqa receipt ag_Clear29');assert(receipt.includes('floorProof=true')&&!receipt.includes('claimed= '));report.checks.push('original claimed floor proof survives native handoff and restart');
 const beforeClaim=await state();await ask('/mycli tasks claim qd_floor_clear',/不能交付|已领取|未完成|失败/);const after=await state();assert.equal(after.xp,beforeClaim.xp);assert.equal(after.economy.balance,beforeClaim.economy.balance);report.checks.push('cold repeated quest claim adds no XP or currency');
}catch(e){report.errors.push(e.stack);}finally{bot?.quit();await wait(400);await fs.writeFile(stage+'/profile-reconnect-'+process.argv[2]+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}process.exit(report.errors.length?1:0);
