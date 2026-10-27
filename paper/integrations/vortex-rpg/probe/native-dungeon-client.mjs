// Isolated lifecycle test: real attacks and original receipts; fixture only
// supplies initial gear/level and freezes enemies. Does not test LLM tactics.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {command} from '../../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),nav=createRequire('E:/MC/research/qiandengji-main-20261023/packages/agent-mc-world/package.json');const {pathfinder,Movements,goals}=nav('mineflayer-pathfinder');
const label=process.argv[2],username='ag_Clear'+label.replace(/\D/g,'');assert(username.length<=16);
const wait=ms=>new Promise(r=>setTimeout(r,ms)),report={checks:[],errors:[],messages:[],hits:0,fixtureRecoveries:0,productionChanged:false};let bot,last=0;
const rc=q=>command(q,15000,{port:25929,properties:stage+'/server.properties'});
const check=(v,label)=>{assert.ok(v,label);report.checks.push(label);};
async function until(fn,label,ms=18000){for(let end=Date.now()+ms;Date.now()<end;){if(await fn())return;await wait(100);}throw Error(label+' timeout');}
async function ask(q,pattern=/\[RPG\]|MC_RPG/){await wait(Math.max(0,1100-(Date.now()-last)));last=Date.now();let n=report.messages.length;bot.chat(q);await until(()=>report.messages.slice(n).some(s=>pattern.test(s)),q);return report.messages.slice(n).join('\n');}
async function state(){const text=await ask('/mycli status --json',/^MC_RPG /);return JSON.parse(text.split('\n').find(s=>s.startsWith('MC_RPG ')).slice(7));}
try{
 bot=require('mineflayer').createBot({host:'127.0.0.1',port:25928,username,auth:'offline',version:'1.21.1',checkTimeoutInterval:60000,hideErrors:true});bot.loadPlugin(pathfinder);installRecipePacketBypass(bot._client);bot.on('messagestr',s=>report.messages.push(s));bot.on('error',e=>report.errors.push(String(e)));
 await Promise.race([new Promise(r=>bot.once('spawn',r)),wait(30000).then(()=>{throw Error('spawn timeout');})]);await wait(1600);if(bot.currentWindow)bot.closeWindow(bot.currentWindow);
 await rc('qdqa kit '+username);await ask('/mycli profession choose knight',/已选择并保存/);await rc('qdqa nativelevel '+username);await wait(1200);await rc('qdqa cooldown '+username);await rc('qdqa castle '+username);await bot.waitForChunksToLoad();
 await ask('/mycli tasks accept qd_floor_scout',/任务已接取并保存/);
 const m=new Movements(bot);m.canDig=false;m.allow1by1towers=false;m.allowParkour=false;m.scafoldingBlocks=[];bot.pathfinder.setMovements(m);
 await bot.pathfinder.goto(new goals.GoalNear(854,69,-1144,0));await wait(1500);
 let scout=await ask('/mycli tasks status');check(scout.includes('qd_floor_scout')&&scout.includes('1/1'),'actual arrival completes native scouting objective');
 await ask('/mycli tasks claim qd_floor_scout',/任务已交付/);await ask('/mycli tasks accept qd_floor_clear',/任务已接取并保存/);
 const denied=await ask('/mycli guild exam start conquest_basic',/MC_GUILD_EXAM/);check(denied.includes('guild_registration_required')&&denied.includes('/mycli guild join'),'unregistered exam gives the correct free registration command');
 await ask('/mycli guild join',/公会|冒险|登记|MC_GUILD/);
 const enrolled=await ask('/mycli guild exam start conquest_basic',/MC_GUILD_EXAM/);check(enrolled.includes('"state":"active"'),'real conquest exam starts after registration');
 await bot.equip(bot.inventory.items().find(i=>i.name==='iron_sword'),'hand');
 await ask('/mycli dungeon start aincrad_01',/集结10秒|success/);
 for(const [n,pos]of [[856,69,-1144],[844,69,-1160],[832,69,-1176]].entries()){
  await bot.pathfinder.goto(new goals.GoalNear(...pos,1));let spawned=false,cleared=false,freezeAt=0,recoverAt=0;
  for(let end=Date.now()+100000;Date.now()<end;){
   const enemies=Object.values(bot.entities).filter(e=>['husk','skeleton','vindicator'].includes(e.name)&&e.position.distanceTo(bot.entity.position)<26);
   if(enemies.length){spawned=true;if(Date.now()>freezeAt){await rc('qdqa freeze '+username);freezeAt=Date.now()+3000;}
    const target=enemies.sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
    if(target.position.distanceTo(bot.entity.position)>2.8)bot.pathfinder.setGoal(new goals.GoalFollow(target,2),true);
    else{bot.pathfinder.setGoal(null);bot.clearControlStates();await bot.lookAt(target.position.offset(0,1.1,0));bot.attack(target);report.hits++;}
    if(bot.health<16&&Date.now()>recoverAt){await rc('qdqa recover '+username);report.fixtureRecoveries++;recoverAt=Date.now()+4000;}
   }else if(spawned){await wait(1000);const text=await ask('/mycli dungeon status aincrad_01 --json',/^MC_SITE_DUNGEON_STATE /);const state=JSON.parse(text.split('\n').find(s=>s.startsWith('MC_SITE_DUNGEON_STATE ')).slice(22));if(['moving','returning'].includes(state.phase)){cleared=true;break;}}
   await wait(700);
  }
  bot.pathfinder.setGoal(null);bot.clearControlStates();check(spawned&&cleared,'room '+(n+1)+' cleared by actual melee packets');
 }
 const pending=await ask('/mycli tasks status');check(pending.includes('0/1'),'native quest is not complete before original return settlement');
 await bot.pathfinder.goto(new goals.GoalNear(856,69,-1144,1));await wait(2500);
 report.receipt=await rc('qdqa receipt '+username);check(report.receipt.includes('receipt=true')&&report.receipt.includes('floorProof=true'),'return produces original durable floor and loot receipts');
 const ready=await ask('/mycli tasks status');check(ready.includes('qd_floor_clear')&&ready.includes('1/1'),'committed original dungeon receipt advances native quest');
 const before=await state();await ask('/mycli tasks claim qd_floor_clear',/任务已交付/);const after=await state();check(after.xp===before.xp+500&&after.economy.balance===before.economy.balance+150,'native quest credits actual 500 XP and 150 currency');
 await ask('/mycli tasks claim qd_floor_clear',/不能交付|已领取|未完成|失败/);const again=await state();check(again.xp===after.xp&&again.economy.balance===after.economy.balance,'repeated native claim does not duplicate reward');
 const exam=await ask('/mycli guild exam status',/考试|实练|认证|ready|可交卷/);report.exam=exam;check(/ready|可交卷|可提交|已达成/.test(exam),'actual dungeon clear satisfies conquest exam');
 await ask('/mycli dungeon claim aincrad_01',/\[地下城\]|奖励|success/);check((await rc('qdqa receipt '+username)).includes('claimed='),'original dungeon claim remains usable');
}catch(e){report.errors.push(e.stack);}finally{if(bot){bot.pathfinder?.setGoal(null);if(report.errors.length&&typeof bot._client.chat==='function'){bot.chat('/mycli dungeon leave');await wait(1200);}bot.quit();}await wait(500);await fs.writeFile(stage+'/native-dungeon-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,errors:report.errors,hits:report.hits,recoveries:report.fixtureRecoveries}));}process.exit(report.errors.length?1:0);
