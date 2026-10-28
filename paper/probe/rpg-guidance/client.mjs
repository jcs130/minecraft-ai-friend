import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2];assert(/^[a-z0-9]{1,8}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const properties=stage+'/server.properties',props=await fs.readFile(properties,'utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25928\r?$/m);assert.match(props,/^rcon.port=25929\r?$/m);
const report={checks:[],receipts:[],passed:false,productionChanged:false},bots=[],mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
const rc=async q=>{const result=await command(q,15000,{properties,port:25929});report.receipts.push({q,result});return result;};
const until=async(f,name,ms=25000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await f();if(v)return v;await sleep(100);}throw Error('Timeout '+name);};
async function connect(name){const b=mf.createBot({host:'127.0.0.1',port:25928,username:name,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.ready=false;b.messages=[];b.on('spawn',()=>b.ready=true);b.on('messagestr',s=>b.messages.push(s));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.ready&&b.world.getColumnAt(b.entity.position),'spawn');return b;}
let actor,last=0;
async function ask(q,pattern=/\[RPG\]|MC_RPG|已停用|刻印|法杖|MMORPG/){await sleep(Math.max(0,1100-(Date.now()-last)));last=Date.now();const at=actor.messages.length;actor.chat(q);await until(()=>actor.messages.slice(at).some(s=>pattern.test(s)),q);const text=actor.messages.slice(at).join('\n');report.receipts.push({q,text});return text;}
const state=async()=>JSON.parse((await ask('/mycli status --json',/MC_RPG/)).split('\n').find(s=>s.startsWith('MC_RPG ')).slice(7));
const number=(s,key)=>Number(s.match(new RegExp(key+'=(-?[\\d.]+)'))?.[1]);
try{
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule naturalRegeneration false');await rc('minecraft:forceload add 1792 1792 1816 1816');await sleep(400);await rc('minecraft:fill 1792 80 1792 1816 80 1816 stone');await rc('minecraft:fill 1792 81 1792 1816 87 1816 air');
 actor=await connect('ag_GQA'+label);const watcher=await connect('ag_GQAw'+label.slice(-7));await rc(`minecraft:tp ${actor.username} 1802.5 81 1802.5`);await rc(`minecraft:tp ${watcher.username} 1812.5 81 1812.5`);await sleep(3500);
 check('important notice waits for safe survival state',!actor.messages.some(s=>s.includes('[更新 0.4.47.22')));
 const before=await state();check('query does not choose a class',before.class==='none');
 check('native locked spell explains missing class',(await ask('/mycli cast fortify')).includes('class_required'));
 const intro=await ask('/mycli intro');check('one entry explains equipment, class, skills and adventure',intro.includes('普通附魔')||intro.includes('原版')&&intro.includes('[1 职业]')&&intro.includes('[2 技能]')&&intro.includes('[3 冒险]'));
 await rc(`minecraft:gamemode survival ${actor.username}`);await until(()=>actor.messages.some(s=>s.includes('[开始攻略]')),'private release notice');
 check('important release notice reaches coach-disabled Agent once',actor.messages.filter(s=>s.includes('[更新 0.4.47.22')).length===1);
 check('release notice is private to the actor',!watcher.messages.some(s=>s.includes('[更新 0.4.47.22')||s.includes('[开始攻略]')));
 check('delivery revision is persisted on actual player',number(await rc(`gqa ${actor.username} inspect`),'revision')>=2);
 check('retired skill tells unselected player how to begin',(await ask('/mycli cast selfheal')).includes('skill_retired')&&(await ask('/mycli skills info sword_thrust')).includes('/mycli profession list'));
 await ask('/mycli profession choose knight');check('explicit choice is actual native knight',(await state()).class==='knight');
 const guide=await ask('/mycli guide magic');check('old magic guide points to current RPG steps',guide.includes('MMORPG')&&guide.includes('skills prepare'));
 const skills=await ask('/mycli skills list');check('current skill directory exposes native starter',skills.includes('fortify'));
 check('new skill details explain live target and effect',(await ask('/mycli skills info fortify')).includes('目标：自己'));
 check('focus catalogue no longer recommends retired heals',!(await ask('/mycli focus list')).includes('heal'));
 await rc(`gqa ${actor.username} gear plain`);
 check('parameterized common imprint is retained',(await ask('/mycli imprint prospect iron',/附魔台|刻印|RPG/)).includes('附魔台'));
 check('other-class spell gives explicit locked guidance',(await ask('/mycli cast arcane_bolt')).includes('skill_locked'));
 check('single-skill status remains a compatible read-only alias',(await ask('/mycli skills status fortify')).includes('消耗'));
 const tasks=await ask('/mycli tasks list');check('native tasks explain how to inspect requirements',tasks.includes('tasks info')&&!tasks.includes('种田'));
 const mana=(await state()).mana;await ask('/mycli cast fortify');check('new native spell really spends its mana',(await state()).mana<mana);
 await rc(`gqa ${actor.username} gear old`);await sleep(250);const itemBefore=await rc(`gqa ${actor.username} inspect`),mp=(await state()).mana;
 for(const q of ['/mycli cast selfheal','/mycli skills learn sword_thrust','/mycli skills prepare warrior_sky_leap','/mycli imprint selfheal','/mycli focus bind heal'])check('clear retired refusal '+q,(await ask(q)).includes('skill_retired'));
 const itemAfter=await rc(`gqa ${actor.username} inspect`);check('retired imprint preserves old item, enchantments, XP and lapis',number(itemBefore,'hash')===number(itemAfter,'hash')&&number(itemAfter,'sharp')===5&&number(itemAfter,'level')===12&&number(itemAfter,'lapis')===3);
 check('retired casts do not spend native mana',(await state()).mana>=mp);
 const at=actor.messages.length;actor.setControlState('sneak',true);await sleep(180);actor.activateItem();await until(()=>actor.messages.slice(at).some(s=>s.includes('skill_retired')),'old imprinted item usage');actor.deactivateItem();actor.setControlState('sneak',false);check('using old imprinted equipment gives the same explicit guide',true);
 check('unknown ID is distinguished from a retired skill',(await ask('/mycli cast no_such_ability')).includes('unknown_skill'));
 check('common skills remain usable without legacy learning',(await ask('/mycli skills info prospect')).includes('通用技能'));
 const damage=[];
 await rc('minecraft:summon husk 1804.5 81 1802.5 {Tags:["qd_enchant_target"],NoAI:1b,Silent:1b,Attributes:[{Name:"minecraft:generic.max_health",Base:200.0d}],Health:200.0f}');await sleep(600);
 const target=await until(()=>Object.values(actor.entities).find(e=>e.name==='husk'&&e.position.distanceTo(actor.entity.position)<4),'actual hostile target');
 for(const gear of ['plain','enchanted']){await rc(`gqa ${actor.username} gear ${gear}`);await sleep(1300);actor.attack(target);await sleep(300);damage.push(number(await rc(`gqa ${actor.username} damage`),'base'));}
 check('Sharpness V increases real vanilla melee damage',damage[1]>damage[0]);report.sharpness=damage;
 const protection=[];for(const gear of ['plain','enchanted']){await rc(`gqa ${actor.username} armor ${gear}`);let d=-1;for(let i=0;i<5&&d<0;i++){d=number(await rc(`gqa ${actor.username} hurt`),'final');await sleep(250);}protection.push(d);}
 check('Protection IV reduces actual post-armor damage',protection[0]>0&&protection[1]>0&&protection[1]<protection[0]);report.protection=protection;
 const speeds=[],times=[];
 for(const gear of ['pickplain','pickench']){await rc(`gqa ${actor.username} gear ${gear}`);await sleep(250);const p=actor.entity.position.floored(),block=p.offset(1,0,0);await rc(`minecraft:setblock ${block.x} ${block.y} ${block.z} stone`);await until(()=>actor.blockAt(block)?.name==='stone','fresh stone');speeds.push(number((await rc(`gqa ${actor.username} speed`)).replace('SPEED ','v='),'v'));
  // Same early STOP for both tools; native delayed breaking decides when the block really breaks.
  // Avoid Mineflayer 4.39's unrelated enchantments.concat parsing bug.
  await actor.lookAt(block.offset(.5,.5,.5),true);const start=Date.now();actor._client.write('block_dig',{status:0,location:block,face:1,sequence:21});await sleep(100);actor._client.write('block_dig',{status:2,location:block,face:1,sequence:22});await until(()=>actor.blockAt(block)?.name==='air','server block actually broke');times.push(Date.now()-start);}
 check('Efficiency V increases actual server mining speed',speeds[1]>speeds[0]);check('Efficiency V completes a real block break faster',times[1]<times[0]);report.efficiency={speeds,times};
 await rc(`gqa ${actor.username} gear mending`);await rc(`gqa ${actor.username} orb`);await until(async()=>number(await rc(`gqa ${actor.username} inspect`),'damage')<100,'real XP orb mends tool');check('Mending repairs actual retained tool durability',true);
 await rc('minecraft:kill @e[tag=qd_enchant_target,x=1792,y=75,z=1792,dx=24,dy=15,dz=24]');
 const delivered=actor.messages.filter(s=>s.includes('[更新 0.4.47.22')).length;check('normal play does not repeat the same release notice',delivered===1);const name=actor.username;actor.quit();await sleep(650);actor=await connect(name);await rc(`minecraft:gamemode survival ${name}`);await sleep(4000);check('reconnect does not repeat the release announcement',!actor.messages.some(s=>s.includes('[更新 0.4.47.22')));
 report.identity={name,uuid:actor.player.uuid};report.passed=true;
}finally{for(const b of bots)if(!b._client.ended)b.quit();await fs.writeFile(stage+'/rpg-guidance-'+label+'.json',JSON.stringify(report,null,2));}
