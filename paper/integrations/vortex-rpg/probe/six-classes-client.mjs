/** Native six-class effects with real non-OP clients; no production connection. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),mf=require('mineflayer'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const label=process.argv[2]??'six';assert(/^[a-z0-9]+$/.test(label));const suffix=label.replace(/^six/,'');
const report={checks:[],errors:[],classes:[],receipts:[],productionChanged:false};let bot,last=0,messages=[];
const check=(name,value)=>{assert(value,name);report.checks.push(name);};
const rc=async q=>{const result=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,result});return result;};
async function until(f,label,limit=10000){const stop=Date.now()+limit;while(Date.now()<stop){if(await f())return;await wait(100);}throw Error(label+' timeout');}
async function ask(q,pattern=/\[RPG\]|MC_RPG/){await wait(Math.max(0,1100-(Date.now()-last)));const start=messages.length;last=Date.now();bot.chat(q);await until(()=>messages.slice(start).some(s=>pattern.test(s)),q);return messages.slice(start).join('\n');}
async function state(){const s=await ask('/mycli status --json',/MC_RPG/);return JSON.parse(s.split('\n').find(v=>v.startsWith('MC_RPG ')).slice(7));}
async function mobHealth(){const s=await rc('execute at '+bot.username+' run data get entity @e[tag=qd_native_spell,distance=..12,limit=1] Health');const n=Number(s.match(/(-?\d+(?:\.\d+)?)[fd]?$/)?.[1]);assert(Number.isFinite(n),'real tagged monster health: '+s);return n;}
try{
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule naturalRegeneration false');await rc('minecraft:time set midnight');
 for(const[classId,spell]of [['knight','fortify'],['mage','arcane_bolt'],['ranger','hunter_mark'],['cleric','mend'],['beastmaster','beast_call'],['engineer','deploy_turret']]){
  messages=[];last=0;const name='ag_V'+classId+suffix;assert(name.length<=16,'vanilla username bound');
  bot=mf.createBot({host:'127.0.0.1',port:25928,username:name,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});
  bot.on('messagestr',s=>messages.push(s));bot.on('error',e=>report.errors.push(String(e)));bot.on('kicked',r=>report.errors.push(JSON.stringify(r)));installRecipePacketBypass(bot._client);
  await until(()=>bot.entity,'spawn '+name,30000);bot.physicsEnabled=false;await bot.waitForChunksToLoad();await wait(1200);
  const pos=bot.entity.position.floored();
  await rc(`minecraft:execute at ${name} run minecraft:fill ${pos.x-4} ${pos.y-1} ${pos.z-4} ${pos.x+4} ${pos.y-1} ${pos.z+4} minecraft:stone`);
  await until(()=>bot.blockAt(pos.offset(0,-1,0))?.name==='stone','actual loaded QA floor');check(classId+' destination floor arrived',true);
  bot.physicsEnabled=true;await wait(500);if(bot.currentWindow)bot.closeWindow(bot.currentWindow);
  const chosen=await ask('/mycli profession choose '+classId,/已选择并保存|RPG/);check(classId+' saved choice',chosen.includes('已选择并保存'));const selected=await state();check(classId+' actual native class',selected.class===classId);
  const skills=await ask('/mycli skills list');check(classId+' actual native starter',skills.includes(spell));
  await ask('/mycli skills info '+spell);const effects=[];
  bot._client.on('world_particles',p=>effects.push(p));
  await rc(`minecraft:execute at ${name} run minecraft:summon zombie ${pos.x+3} ${pos.y} ${pos.z} {Tags:["qd_native_spell"],NoAI:1b,NoGravity:1b,Silent:1b,Attributes:[{Name:"minecraft:generic.max_health",Base:100.0d}],Health:100.0f}`);await wait(400);
  let before,after;
  if(classId==='cleric'){await rc('minecraft:damage '+name+' 5 minecraft:generic');await wait(700);before=bot.health;}
  else if(classId!=='knight')before=await mobHealth();
  const result=await ask('/mycli cast '+spell,/技能已执行|冷却|未生效|失败|不够/);check(classId+' native cast completed',result.includes('技能已执行'));await wait(650);
  if(classId==='cleric'){after=bot.health;check('cleric real healing',after>before);}
  else if(classId!=='knight'){after=await mobHealth();check(classId+' real target health reduced',after<before);}
  check(classId+' emitted real effect particles',effects.length>0);
  const manaAfter=(await state()).mana;const repeated=await ask('/mycli cast '+spell,/冷却|RPG/);
  // The 2 s mage cooldown may have elapsed while reading state; do not falsely
  // demand a rejection after that real native interval.
  if(classId!=='mage'){check(classId+' native cooldown enforced',repeated.includes('冷却'));check(classId+' repeat does not spend again',(await state()).mana>=manaAfter);}
  report.classes.push({classId,spell,before,after,particles:effects.length});
  await rc('execute at '+name+' run minecraft:kill @e[tag=qd_native_spell,distance=..16]');
  await rc('minecraft:gamemode spectator '+name);await wait(200);
  const blocked=await ask('/mycli cast '+spell,/当前状态|生存角色|不能|RPG/);check(classId+' spectator cannot cast',!blocked.includes('技能已执行'));
  await rc('minecraft:gamemode survival '+name);
  bot.quit();bot=null;await wait(400);
 }
}catch(e){report.errors.push(e.stack);}finally{bot?.quit();await wait(400);await fs.writeFile(stage+'/six-native-classes-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,classes:report.classes,errors:report.errors}));}
process.exit(report.errors.length?1:0);
