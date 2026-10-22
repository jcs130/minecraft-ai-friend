import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';

const [stage,output,mode]=process.argv.slice(2),properties=stage+'/server.properties';
assert.match(fs.readFileSync(properties,'utf8'),/^server-ip=127\.0\.0\.1\r?$/m);assert.match(fs.readFileSync(properties,'utf8'),/^server-port=25982\r?$/m);
const rc=q=>command(q,15000,{properties,port:25983});
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const checks=[],report={mode,checks,passed:false},bots=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
async function until(fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(100);}throw Error('Dungeon storage condition timed out');}
async function fixture(q){const raw=await rc('dungeonstorageqa '+q);return JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));}
async function cli(bot,q,prefix='MC_SITE_DUNGEON_RESULT'){
 await sleep(Math.max(0,1050-(Date.now()-(bot.lastChat??0))));bot.lastChat=Date.now();const at=bot.lines.length;bot.chat('/mycli dungeon '+q);
 return until(()=>{const s=bot.lines.slice(at).find(s=>s.startsWith(prefix+' '));return s?JSON.parse(s.slice(prefix.length+1)):null;});
}
const state=bot=>cli(bot,'status undead_crypt','MC_SITE_DUNGEON_STATE');
async function join(){const bot=req('mineflayer').createBot({host:'127.0.0.1',port:25982,username:'ag_StorageQA',auth:'offline',version:'1.21.1',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});bots.push(bot);bot.lines=[];bot.errors=[];bot.physicsEnabled=false;bot.on('messagestr',s=>bot.lines.push(s));bot.on('error',e=>bot.errors.push(e.message));installRecipePacketBypass(bot._client);await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position));return bot;}
const blocker=stage+'/plugins/AgentFriend/config.yml.site-dungeon.tmp';
try{
 const bot=await join();await rc('minecraft:gamemode survival ag_StorageQA');
 if(mode==='seed-old'){
  await fixture('clear');const seeded=await fixture('seed ag_StorageQA old');report.seed=seeded;
  const s=await state(bot);check('old run is genuinely fault paused',s.paused&&s.fault==='data_unavailable'&&s.run===seeded.run);
  check('old run has no fabricated attendance or rewards',s.stage===1&&s.remainingMobs===0&&s.pendingRewards.length===0);
 }else if(mode==='verify-old'){
  const previous=JSON.parse(fs.readFileSync(output.replace('verify-old','seed-old'),'utf8')).seed;
  const original=await fixture('status');check('seven-hour fault checkpoint survives normal restart',original.active&&original.run===previous.run&&original.started===previous.started&&original.fault==='data_unavailable');
  check('owner resumes original run through native CLI',(await cli(bot,'resume')).success);
  await sleep(2000);const restored=await fixture('status');report.restored=restored;
  check('recovery excludes maintenance wait from challenge timer',restored.faultPausedMillis>6*3600_000&&restored.started===previous.started);
  check('resume preserves same run without instant time-limit failure',restored.active&&restored.run===previous.run&&restored.fault==='');
  await fixture('clear');
 }else if(mode==='io-failure'){
  await fixture('clear');await rc('minecraft:fill -432 3 670 -418 3 684 minecraft:stone');await rc('minecraft:fill -432 4 670 -418 10 684 minecraft:air');
  await rc('minecraft:tp ag_StorageQA -425.5 4 677.5');await rc('minecraft:effect give ag_StorageQA resistance 100 4 true');await sleep(500);
  let seeded=await fixture('seed ag_StorageQA live');fs.mkdirSync(blocker);
  try{await until(async()=>{const v=await fixture('status');return v.fault==='data_unavailable';});}
  finally{fs.rmdirSync(blocker);}
  let recovered=await until(async()=>{const v=await fixture('status');return v.fault===''&&v.retries>0?v:null;});
  check('transient write fault recovers original muster without replay',recovered.run===seeded.run&&recovered.retries<=2);
  await sleep(1500);const s=await state(bot);check('recovery does not manufacture clear credit or rewards',s.stage===1&&s.pendingRewards.length===0&&s.remainingMobs<=8);
  await fixture('clear');seeded=await fixture('seed ag_StorageQA live');fs.mkdirSync(blocker);
  try{
   const stopped=await until(async()=>{const v=await fixture('status');return v.retries===2&&v.fault==='data_unavailable'?v:null;},18000);
   await sleep(2300);const later=await fixture('status');check('persistent IO fault stops after two bounded retries',later.run===seeded.run&&later.retries===2&&later.fault==='data_unavailable'&&later.mobs===0);
  }finally{fs.rmdirSync(blocker);}
  check('explicit owner retry succeeds after storage repair',(await cli(bot,'resume')).success);
  check('retry does not issue pending reward',(await state(bot)).pendingRewards.length===0);
  await fixture('clear');
 }else throw Error('seed-old/verify-old/io-failure mode required');
 check('native client remains connected',!bot._client.ended&&bot.errors.length===0);report.passed=true;
}catch(error){report.error=error.stack;throw error;}
finally{for(const bot of bots)bot.quit();await sleep(500);fs.writeFileSync(output,JSON.stringify(report,null,2));}
