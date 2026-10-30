import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
const require=createRequire('E:/MC/integrations/qiandengji-harness-20261022/body/package.json');
const mineflayer=require('mineflayer'),stage='E:/MC/staging/communication-contract-20261030';
const output=process.argv[2],cold=process.argv[3]==='cold';
if(!output?.startsWith('E:/MC/ops/repairs/rpg-activities-20261030/'))throw Error('Dedicated QA output required');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],bots=[],chat=[];
const check=(ok,name)=>{if(!ok)throw Error(name);checks.push(name);console.log('PASS '+name);};
const rcon=async text=>{const result=await command(text,18000,{properties:stage+'/server.properties',port:29396});if(result.includes('RPG_QA_ERROR'))throw Error(result);return result;};
const sent=new WeakMap();
const send=async(bot,text)=>{await pause(Math.max(0,1250-(Date.now()-(sent.get(bot)??0))));sent.set(bot,Date.now());bot.chat(text);};
const until=async(predicate,label,timeout=14000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await pause(150);}throw Error('Timed out: '+label);};
const ask=async(bot,text,prefix)=>{const start=bot.received.length;await send(bot,text);await until(()=>bot.received.slice(start).some(s=>s.startsWith(prefix)),text);return bot.received.slice(start).find(s=>s.startsWith(prefix));};
const json=line=>JSON.parse(line.slice(line.indexOf(' ')+1));
const state=async bot=>json(await rcon('qd_rpg_fixture state '+bot.username));
const names=['ag_TrialAlice','ag_TrialBob','ag_TrialEye'];
try{
 for(const username of names){
  const bot=mineflayer.createBot({host:'127.0.0.1',port:29395,username,version:'1.21.1',auth:'offline',hideErrors:true});bots.push(bot);bot.received=[];
  bot.on('messagestr',text=>{bot.received.push(text);chat.push({username,text});});
  bot.on('error',e=>console.log('QA client error '+username+' '+e.message));
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);setTimeout(()=>reject(Error('QA spawn timeout')),20000);});
 }
 const [alice,bob,eye]=bots;
 if(cold){
  await rcon('qd_rpg_fixture loading_diagnostic ag_TrialAlice');
  for(const actor of [alice,bob])await until(async()=>{const actual=await state(actor);await fs.writeFile(output+'/cold-last-state.json',JSON.stringify(actual,null,2));const observed=actual.rpg;return typeof observed.level==='number'&&typeof observed.mana?.current==='number';},'native profile ready after join',15000);
  const saved=JSON.parse(await fs.readFile(output+'/native-before-cold.json','utf8'));
  for(const actor of [alice,bob]){const actual=await state(actor);check(actual.guild.activeId==='party_oath'&&actual.guild.progress===1&&actual.guild.status==='ready_to_submit',actor.username+' actual two-player floor proof survives cold restart');check(actual.participant===false,'ended QA run does not re-enroll on restart');for(const key of ['combat','level','xp','skillPoints','activeSkill'])check(actual.rpg[key]===saved[actor.username][key],actor.username+' native '+key+' survives cold restart');}
  const guide=json(await ask(alice,'/mycli status --json','MC_RPG '));check(guide.guide.reason==='guild_task_active'&&guide.guide.nextCommand==='/mycli guild claim','cold current goal points to original guild claim');
 }else{
  const config=json(await rcon('qd_rpg_fixture config'));check(config.result==='success'&&config.releaseRevision===8&&config.noticeCount===2,'runtime onboarding accepted by real loader with two release lines');
  // End only a prior failed disposable run through the native finish path;
  // fixture refuses any participant other than these three QA UUIDs.
  await rcon('qd_rpg_fixture end_prior_qa');
  await until(async()=>!(await state(alice)).active,'prior disposable run released');
  for(const actor of [alice,bob])await until(async()=>(await state(actor)).rpg.available===true,'native profile ready',15000);
  check((await rcon('qd_rpg_fixture setup')).includes('RPG_QA_READY'),'ordinary isolated fixtures ready');
  check((await rcon('qd_rpg_fixture build')).includes('RPG_QA_ROOMS_READY'),'disposable physical trial rooms prepared without production player data');
  for(const bot of [alice,bob]){
   const existing=(await state(bot)).rpg;
   if(existing.combat==='knight')check(true,'native class preserved for '+bot.username);
   else{const result=json(await ask(bot,'/mycli profession choose knight --json','MC_RPG '));check(result.success===true,'native class chosen for '+bot.username);}
   await rcon('qd_rpg_fixture equip '+bot.username);await rcon('qd_rpg_fixture oldquest '+bot.username);
   const actual=await state(bot);check(!actual.op&&actual.guild.progress===0,'initial old quest has no fabricated proof for '+bot.username);
  }
  const intro=json(await ask(alice,'/mycli intro --json','MC_INTRO '));check(intro.guide.reason==='guild_task_active'&&intro.guide.nextCommand==='/mycli goto arena','intro exposes exact trial route for old guild objective');
  check(!intro.activityGuide.some(s=>s.includes('各有8魔力'))&&intro.activityGuide.some(s=>s.includes('开场免费')),'intro corrects the old cost misinformation');
  check(intro.activityGuide.some(s=>s.includes('每次新开从第1层开始')&&s.includes('历史通关不自动跳层')),'real intro states every ordinary run restarts at floor one');
  const far=json(await ask(alice,'/mycli arena status --json','MC_TRIAL_STATE '));check(far.reason==='reach_trial_entrance'&&far.worldUuid&&far.worldKey&&far.entryMana===0,'trial state has real world identity and actual fees');
  await pause(1000);let from=alice.received.length;await send(alice,'/mycli arena status');await pause(500);check(alice.received.slice(from).filter(s=>s.startsWith('[试炼')).length===2&&!alice.received.slice(from).some(s=>s.startsWith('MC_TRIAL_STATE '))&&alice.received.slice(from).some(s=>s.includes('/mycli goto arena')),'default trial status is concise actionable text');
  from=alice.received.length;await send(alice,'/mycli arena start --json');await pause(500);check(alice.received.slice(from).some(s=>s.includes('invalid_argument'))&&!(await state(alice)).active,'unsupported start flags rejected before mutation');
  const all=[];
  for(let page=1;page<=3;page++){const data=json(await ask(alice,'/mycli world list --page '+page+' --json','MC_WORLD '));check(data.gameplay.length===6&&data.queryOnly===true,'gameplay index page '+page);all.push(...data.gameplay);}
  check(new Set(all.map(x=>x.id)).size===18,'all eighteen player gameplay routes discoverable');
  check(all.find(x=>x.id==='trade').note.includes('拍卖交付尚未开放'),'unimplemented auction not advertised as ready');
  from=alice.received.length;await send(alice,'/mycli world list --page 0');await pause(500);check(alice.received.slice(from).some(s=>s.includes('invalid_argument')),'invalid discovery page gives correction');
  for(const id of ['qd-trial-gather','qd-ruins-gather','qd-explorers-gather']){
   await rcon('wevent start '+id);const event=json(await ask(alice,'/mycli world events --json','MC_WORLD '));
   check(event.events.some(e=>e.id===id&&e.remainingSeconds>0&&e.remainingSeconds<=600),'native WorldEvents starts and exposes '+id);
   await rcon('wevent stop '+id);
  }
  const none=json(await ask(alice,'/mycli world events --json','MC_WORLD '));check(none.status==='idle'&&none.events.length===0,'event end does not invent a remaining activity');
  await rcon('qd_rpg_fixture entrance ag_TrialAlice');await rcon('qd_rpg_fixture entrance ag_TrialBob');await rcon('qd_rpg_fixture entrance ag_TrialEye');
  await rcon('qd_rpg_fixture unequip ag_TrialAlice');const missing=json(await ask(alice,'/mycli arena status --json','MC_TRIAL_STATE '));check(missing.reason==='equipment_missing'&&missing.nextCommand==='/mycli guild shared','missing armor has precise supplement route');
  await send(alice,'/mycli arena start');await pause(600);check(!(await state(alice)).active,'missing loadout does not start a run');await rcon('qd_rpg_fixture equip ag_TrialAlice');
  const ready=json(await ask(alice,'/mycli arena status --json','MC_TRIAL_STATE '));check(ready.canStart===true&&ready.nextCommand==='/mycli arena start','equipped group receives exact start command');
  const before=await state(alice);await send(alice,'/mycli arena start');await until(async()=>{const x=await state(alice);return x.participant&&x.floor===1;},'real start');
  let actual=await state(alice);check(actual.participants.includes('ag_TrialAlice')&&actual.participants.includes('ag_TrialBob')&&!actual.participants.includes('ag_TrialEye'),'two ordinary players enrolled and creative observer excluded');
  check(actual.rpg.mana.current>=before.rpg.mana.current,'ordinary start does not charge eight mana');
  const inTower=json(await ask(alice,'/mycli status --json','MC_RPG '));check(inTower.guide.verifyCommand==='/mycli arena status','generic RPG status keeps the correct trial context');
  for(let floor=1;floor<=2;floor++){
   await until(async()=>(await state(alice)).reason==='fight_remaining','floor '+floor+' native spawn',20000);await rcon('qd_rpg_fixture targets');
   const deadline=Date.now()+65000;
   while(Date.now()<deadline){
    actual=await state(alice);if(actual.reason==='wait_next_floor'||actual.floor>floor)break;
    for(const bot of [alice,bob]){const mob=Object.values(bot.entities).find(e=>['zombie','skeleton','husk','stray','spider','cave_spider','silverfish','witch'].includes(e.name)&&e.position.distanceTo(bot.entity.position)<3.5);if(mob){await bot.lookAt(mob.position.offset(0,1,0),true);bot.attack(mob);}}
    await pause(750);
   }
   check(actual.reason==='wait_next_floor'||actual.floor>floor,'floor '+floor+' cleared by actual vanilla player attacks');
   if(floor===1){await until(async()=>{const x=await state(alice);return x.floor===2&&x.selfFloor===2;},'automatic floor two',18000);check(true,'automatic descent without finding a separate floor-two entrance');}
  }
  for(const bot of [alice,bob]){actual=await state(bot);check(actual.guild.progress===1&&actual.guild.status==='ready_to_submit',bot.username+' native two-person floor-two quest proof recorded');await send(bot,'/mycli arena leave');}
  check(alice.received.some(s=>s.includes('category=daily_limit')&&s.includes('credited=false')),'repeated clear keeps daily loot limit while contract still advances');
  await until(async()=>!(await state(alice)).active,'QA group leaves');
  const claim=json(await ask(alice,'/mycli status --json','MC_RPG '));check(claim.guide.nextCommand==='/mycli guild claim','ready old guild objective leads to its correct claim');
  check(!bob.received.some(s=>s.startsWith('MC_TRIAL_STATE ')),'private trial query did not pollute another player chat');
  const saved={};for(const actor of [alice,bob])saved[actor.username]=(await state(actor)).rpg;
  await fs.writeFile(output+'/native-before-cold.json',JSON.stringify(saved,null,2));
 }
 const result={passed:true,cold,checks,productionConnected:false,modelCalled:false,combatFixture:'Frozen native enemies repositioned only inside disposable QA; real player attacks and clear callbacks, not balance acceptance.'};
 await fs.writeFile(output+'/results-'+(cold?'cold':'flow')+'.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{for(const bot of bots)bot.quit('isolated RPG activities completed');await fs.writeFile(output+'/chat-'+(cold?'cold':'flow')+'.json',JSON.stringify(chat,null,2)+'\n');}
