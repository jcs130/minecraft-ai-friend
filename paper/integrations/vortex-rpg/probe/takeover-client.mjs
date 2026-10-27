/** Real Paper + Vortex + AgentFriend ownership cutover; loopback QA only. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));assert.match(await fs.readFile(stage+'/.qa-only','utf8'),/^VORTEX_TAKEOVER_QA_ONLY$/);
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),mf=require('mineflayer');
const username='ag_VT'+label.replace(/^cold/,'seed');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),report={checks:[],messages:[],receipts:[],errors:[],productionChanged:false};let bot;
const check=(n,v)=>{assert.ok(v,n);report.checks.push(n);};
const rc=async q=>{const s=await command(q,15000,{properties:stage+'/server.properties',port:25929});report.receipts.push({q,s});return s;};
let lastCommand=0;
async function ask(q,pattern=/\[RPG\]|MC_RPG/){await wait(Math.max(0,1100-(Date.now()-lastCommand)));const start=report.messages.length;lastCommand=Date.now();bot.chat(q);for(let i=0;i<55;i++){await wait(100);const list=report.messages.slice(start);if(list.some(s=>pattern.test(s)))return list.join('\n');}throw Error('No response: '+q);}
async function state(){const text=await ask('/mycli status --json',/MC_RPG/);return JSON.parse(text.split('\n').find(s=>s.startsWith('MC_RPG ')).slice(7));}
try{
 check('Vortex enabled',(await rc('version VortexRPG')).includes('1.2.2-alpha'));check('Native bridge enabled',(await rc('version QiandengjiRpg')).includes('0.2.0'));check('AgentFriend takeover candidate',(await rc('version AgentFriend')).includes('0.4.47.21-vortex'));
 const before=await fs.readFile(stage+'/plugins/AgentFriend/profession-ledger.json');
 bot=mf.createBot({host:'127.0.0.1',port:25928,username,auth:'offline',version:'1.21.1',defaultChatPatterns:false,checkTimeoutInterval:60000});
 bot.on('messagestr',s=>report.messages.push(s));bot.on('error',e=>report.errors.push(String(e)));bot.on('kicked',s=>report.errors.push(JSON.stringify(s)));installRecipePacketBypass(bot._client);
 await Promise.race([new Promise(r=>bot.once('spawn',r)),wait(30000).then(()=>{throw Error('spawn timeout');})]);await wait(1600);if(bot.currentWindow)bot.closeWindow(bot.currentWindow);
 const initial=await state();report.initial=initial;check('Single Vortex authority',initial.authority==='VortexRPG'&&!initial.preview);
 check('Actual Vault provider available',initial.economy.available===true);
 const alias=await ask('/mycli rpg status --json',/MC_RPG/);check('Existing rpg status alias retained',alias.includes('VortexRPG'));
 const classes=await ask('/mycli profession list');for(const id of ['knight','mage','ranger','cleric','beastmaster','engineer'])check('Native class '+id,classes.includes(id));
 if(label.startsWith('cold')){
  check('Native class persisted across cold start',initial.class==='knight');check('Native XP persisted across cold start',initial.xp>0);
  check('Actual money persists across cold start',initial.economy.balance>=50);
 }else{
  check('No legacy class automatically adopted',initial.class==='none');
  check('Class choice confirmed saved',(await ask('/mycli profession choose knight',/已选择并保存|MC_RPG/)).includes('已选择并保存'));
  check('Class readback',(await state()).class==='knight');
  const skills=await ask('/mycli skills list');check('Common skills before/after class',skills.includes('prospect')&&skills.includes('night'));check('Native starter spell',skills.includes('fortify'));check('Learning requirement shown',skills.includes('iron_body')&&skills.includes('Lv2'));
  const x=await state();await ask('/mycli tasks list');check('Task listing remains read-only',(await state()).xp===x.xp);
  const cast=await ask('/mycli cast fortify',/技能已执行|failed|冷却|施放失败/);check('Native spell executes',cast.includes('技能已执行'));
  const first=await state();const repeat=await ask('/mycli cast fortify',/冷却|failed/);check('Repeat native cast denied',repeat.includes('冷却'));const second=await state();check('Repeated cast does not consume again',second.mana>=first.mana);
  const old=await ask('/mycli cast sword_thrust',/registered|unknown|技能|not available|unlocked|available/);check('Old skill cannot execute',!old.includes('技能已执行'));
  const info=await ask('/mycli tasks info qd_first_hunt');check('Task gives precise objectives and reward',info.includes('×2')&&info.includes('50货币'));
  await ask('/mycli tasks accept qd_first_hunt',/任务已接取并保存|already/);
  const pending=await ask('/mycli tasks status');check('Task gives current missing count',pending.includes('0/2')&&!pending.includes('可交付'));
  await rc('minecraft:give '+username+' minecraft:diamond_sword 1');await wait(300);await bot.equip(bot.inventory.items().find(i=>i.name==='diamond_sword'),'hand');
  await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:time set midnight');
  const p=bot.entity.position;
  for(let i=0;i<2;i++){
   const tag='qd_takeover_'+i;const beforeXP=(await state()).xp;
   await rc(`minecraft:summon zombie ${Math.floor(p.x)+2} ${Math.floor(p.y)} ${Math.floor(p.z)} {Tags:["${tag}"],NoAI:1b,Silent:1b,Health:1.0f}`);await wait(400);
   const target=Object.values(bot.entities).find(e=>e.name==='zombie'&&e.position.distanceTo(bot.entity.position)<5);assert(target,'nearby QA zombie');bot.attack(target);await wait(900);
   check('Native XP from actual kill '+i,(await state()).xp>beforeXP);
  }
  const ready=await ask('/mycli tasks status');check('Task gives actual completion count and claim action',ready.includes('2/2')&&ready.includes('tasks claim qd_first_hunt'));
  const beforeReward=await state();
  const quest=await ask('/mycli tasks claim qd_first_hunt',/任务已交付|未完成|失败/);check('Native quest reward receipt',quest.includes('任务已交付'));
  const settled=await state();check('Real economy balance credited once',settled.economy.balance===beforeReward.economy.balance+50);
  await ask('/mycli tasks claim qd_first_hunt',/不能交付|已领取|未完成|失败/);const repeated=await state();check('Repeated claim adds no XP',repeated.xp===settled.xp);check('Repeated claim adds no money',repeated.economy.balance===settled.economy.balance);
 }
 check('Old profession ledger retained byte for byte',before.equals(await fs.readFile(stage+'/plugins/AgentFriend/profession-ledger.json')));
 report.final=await state();check('Live connection still usable',bot.entity&&bot._client.state==='play');
}catch(e){report.errors.push(e.stack??String(e));}finally{
 if(bot){bot.quit();await wait(500);}await fs.writeFile(stage+'/takeover-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));
}process.exit(report.errors.length?1:0);
