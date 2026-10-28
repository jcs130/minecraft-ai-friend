/** Six newly unlocked class abilities, including real multi-target damage and ally healing. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]{1,6}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');const report={checks:[],receipts:[],abilities:[],productionChanged:false},bots=[];let bot,last=0;
const check=(name,value)=>{assert(value,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(f,label,ms=25000)=>{for(let end=Date.now()+ms;Date.now()<end;){const v=await f();if(v)return v;await sleep(100);}throw Error(label);};
const rc=async q=>{const result=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,result});return result;};
async function connect(name,x){const b=mf.createBot({host:'127.0.0.1',port:25928,username:name,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'world');b.physicsEnabled=false;await rc(`minecraft:fill ${x-4} 80 1798 ${x+6} 80 1806 stone`);await rc(`minecraft:gamemode survival ${name}`);await rc(`minecraft:tp ${name} ${x}.5 81 1802.5`);await until(()=>Math.abs(b.entity.position.x-x-.5)<.1,'actual teleport packet');await sleep(1500);return b;}
async function json(q){await sleep(Math.max(0,1100-(Date.now()-last)));last=Date.now();const n=bot.messages.length;bot.chat(q);const text=await until(()=>bot.messages.slice(n).find(s=>s.startsWith('MC_RPG ')),q);report.receipts.push({q,text});return JSON.parse(text.slice(7));}
async function hp(tag){const text=await rc(`execute at ${bot.username} run data get entity @e[tag=${tag},distance=..16,limit=1] Health`);return Number(text.match(/([\d.]+)f$/)?.[1]);}
try{
 await rc('minecraft:time set midnight');
 for(const [index,cls]of ['knight','mage','ranger','cleric','beastmaster','engineer'].entries()){
  const x=1922+index*64;bot=await connect('ag_RUS'+index+label,x);await json('/mycli profession choose '+cls+' --json');await rc('qduse xp '+bot.username+' 10000');
  const skills=await json('/mycli skills list --json'),node=skills.learnable.find(n=>n.grantedSpellId);assert(node,cls+' active node');const learned=await json('/mycli skills learn '+node.id+' --json');check(cls+' new active node actually saved',learned.success&&learned.saved);
  const info=await json('/mycli skills info '+node.id+' --json');check(cls+' learned info gives real spell definition and cast command',info.learned&&info.definition&&info.nextCommand==='/mycli cast '+node.grantedSpellId);
  await json('/mycli skills prepare '+node.grantedSpellId+' --json');check(cls+' click skill can be read back',(await json('/mycli skills status --json')).activeSpell===node.grantedSpellId);
  const state=await json('/mycli status --json');await rc('qduse clearhostiles '+bot.username);await rc('qduse mana '+bot.username+' '+state.maxMana);
  let before,after,ally;
  if(cls==='cleric'){ally=await connect('ag_RUally'+label,x+2);await sleep(3500);await rc('minecraft:damage '+ally.username+' 6 minecraft:generic');await sleep(300);before=ally.health;check('healing ally really injured',before<20);}
  else{
   for(let i=0;i<2;i++){const tag='qd_use_multi'+i;await rc(`summon zombie ${x+3+i}.5 81 1802.5 {Tags:["${tag}"],NoAI:1b,NoGravity:1b,Silent:1b}`);await sleep(300);await rc(`execute at ${bot.username} as @e[tag=${tag},distance=..16,limit=1] run attribute @s minecraft:generic.max_health base set 200`);await rc(`execute at ${bot.username} as @e[tag=${tag},distance=..16,limit=1] run data merge entity @s {Health:200.0f}`);}
   before=[await hp('qd_use_multi0'),await hp('qd_use_multi1')];
  }
  const result=await json('/mycli cast '+node.grantedSpellId+' --json');check(cls+' new active ability completes',result.success);await sleep(700);
  if(cls==='cleric'){after=ally.health;check('cleric unlocked group heal heals another real player',after>before);ally.quit();}
  else{after=[await hp('qd_use_multi0'),await hp('qd_use_multi1')];const targetLimit=info.definition.targeters.find(t=>t.type==='nearby_monster')?.limit??1;check(cls+' damage follows actual multi-target definition',after[0]<before[0]&&(targetLimit<2||after[1]<before[1]));await rc(`execute at ${bot.username} run kill @e[tag=qd_use_multi0,distance=..16]`);await rc(`execute at ${bot.username} run kill @e[tag=qd_use_multi1,distance=..16]`);}
  report.abilities.push({cls,node:node.id,spell:node.grantedSpellId,before,after});bot.quit();await sleep(300);
 }
 report.passed=true;
}catch(e){report.error=e.stack;throw e;}finally{for(const b of bots)b.quit();await fs.writeFile(stage+'/rpg-unlocked-'+label+'.json',JSON.stringify(report,null,2));}
