// Isolated ordinary-protocol combat in copied real structures. Never target production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,rmdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mf=require('mineflayer');
const stage='E:/MC/staging/life-buildings-20261003',roots=['E:/MC/ops/repairs/dungeon-network-20261008','F:/MC-backups/repairs/dungeon-network-20261008'];
const phase=process.argv[2]??'pre',rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms)),parse=s=>JSON.parse(s.slice(s.indexOf('{')));
const report={phase,startedAt:new Date().toISOString(),passed:false,checks:[],sha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.95.jar')).digest('hex').toUpperCase()},clients=[];
const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(120);}throw Error(label+' timeout');}
async function connect(name){await rcon('minecraft:whitelist add '+name);const bot=mf.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'}),c={name,bot,lines:[],packets:[],last:0};bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>c.error=String(e));bot._client.on('entity_effect',p=>c.packets.push({type:'effect',...p}));bot.on('health',()=>c.packets.push({type:'health',health:bot.health}));await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j)});clients.push(c);return c;}
async function ask(c,q,prefix){await sleep(Math.max(0,1200-(Date.now()-c.last)));const n=c.lines.length;c.last=Date.now();c.bot.chat(q);if(prefix)await until(()=>c.lines.slice(n).some(s=>s.startsWith(prefix)),q);await sleep(100);return c.lines.slice(n);}
async function result(c,q,reason='success'){const j=parse((await ask(c,q,'MC_SITE_DUNGEON_RESULT ')).find(s=>s.startsWith('MC_SITE_DUNGEON_RESULT ')));check(q+' -> '+reason,j.reason===reason,j);return j;}
async function info(c,id){return parse((await ask(c,'/mycli dungeon info '+id,'MC_SITE_DUNGEON_INFO ')).find(s=>s.startsWith('MC_SITE_DUNGEON_INFO ')));}
async function state(c,id=''){return parse((await ask(c,'/mycli dungeon status '+id,'MC_SITE_DUNGEON_STATE ')).find(s=>s.startsWith('MC_SITE_DUNGEON_STATE ')));}
async function tp(c,point){await rcon(`minecraft:tp ${c.name} ${point[0]+.5} ${point[1]} ${point[2]+.5}`);await until(()=>Math.abs(c.bot.entity.position.x-point[0]-.5)<1&&Math.abs(c.bot.entity.position.y-point[1])<2&&Math.abs(c.bot.entity.position.z-point[2]-.5)<1,'native teleport acknowledgement');await sleep(300);}
async function gear(c){for(const [slot,item] of [['head','netherite_helmet'],['chest','netherite_chestplate'],['legs','netherite_leggings'],['feet','netherite_boots']])await rcon(`minecraft:item replace entity ${c.name} armor.${slot} with minecraft:${item}[minecraft:enchantments={levels:{"minecraft:protection":4}}]`);await rcon(`minecraft:effect give ${c.name} minecraft:regeneration 9999 2 true`);await rcon(`minecraft:effect give ${c.name} minecraft:fire_resistance 9999 0 true`);}
async function enemies(id){return (await rcon('mycli admin dungeons audit')).split('\n').filter(s=>s.startsWith('MC_SITE_DUNGEON_MOB site='+id+' ')).map(s=>({id:s.match(/ id=([^ ]+)/)[1],type:s.match(/ type=([^ ]+)/)[1],health:Number(s.match(/ health=([^ ]+)/)[1]),point:['x','y','z'].map(k=>Number(s.match(new RegExp(' '+k+'=([^ ]+)'))[1]))}));}
async function killWave(c,id){
 for(let pass=0;pass<4;pass++){
 const remaining=await enemies(id);if(!remaining.length)return;
 for(const mob of remaining){
  await tp(c,mob.point);await until(()=>Object.values(c.bot.entities).some(e=>e.uuid===mob.id),'mob native entity');
  const target=Object.values(c.bot.entities).find(e=>e.uuid===mob.id);await c.bot.lookAt(target.position.offset(0,1,0),true);c.bot.attack(target);await sleep(650);
  // Strength is a disposable fixture; a second real attack handles animation/latency.
  if(Object.values(c.bot.entities).some(e=>e.uuid===mob.id)){c.bot.attack(target);await sleep(650);}
 }
 }
 check('all native attacks remove the current wave '+id,(await enemies(id)).length===0,await enemies(id));
}
try{
 await until(async()=>{try{return /0\.3\.95/.test(await rcon('version AgentFriend'));}catch{return false;}},'isolated startup ready',120000);
 check('isolated runtime version',/0\.3\.95/.test(await rcon('version AgentFriend')));
 await rcon('minecraft:gamerule doMobSpawning false');await rcon('minecraft:gamerule keepInventory true');
 check('three registered independent buildings',(await rcon('mycli admin dungeons audit')).includes('ready=true sites=3 activeRuns='+(phase==='pre'?0:2)));
 check('six configurable early trial waves',(await rcon('mycli admin trialwaves audit')).includes('configuredFloors=6 maxMobsPerFloor=12'));
 const a=await connect('SiteKnight95'),b=await connect('SiteMage95'),c=await connect('SitePriest95'),d=await connect('SiteVisitor95');
 for(const x of clients){await gear(x);await rcon(`minecraft:gamemode survival ${x.name}`);}
 const defs={};for(const id of ['undead_crypt','creeping_crypt','bunker'])defs[id]=await info(a,id);
if(phase==='pre'){
  for(const [file,admin,prefix] of [['dungeons.yml','dungeons','status=invalid_configuration'],['trial-waves.yml','trialwaves','status=invalid_configuration']]){const path=stage+'/plugins/AgentFriend/'+file,original=readFileSync(path);try{writeFileSync(path,'schema-version: 999\n');check(file+' invalid reload retains prior valid rules',(await rcon('mycli admin '+admin+' reload')).includes(prefix));}finally{writeFileSync(path,original);}check(file+' valid reload succeeds',(await rcon('mycli admin '+admin+' reload')).includes('status=success'));}
  await ask(a,'/mycli dungeon menu','');await until(()=>a.bot.currentWindow,'site list');check('native menu presents three actual sites',a.bot.currentWindow.slots.slice(10,13).every(Boolean));await a.bot.clickWindow(10,0,0);await until(()=>a.bot.currentWindow?.slots[12]?.name==='iron_sword','site details');check('native detail offers paid approach and explicit start',a.bot.currentWindow.slots[10]?.name==='ender_pearl'&&a.bot.currentWindow.slots[16]?.name==='sunflower');a.bot.closeWindow(a.bot.currentWindow);
  await tp(a,[-593,91,-312]);await result(a,'/mycli dungeon start undead_crypt','walk_to_first_room');
  await tp(a,[-593,91,-312]);await ask(a,'/mycli arena difficulty normal','MC_DUNGEON_DIFFICULTY ');
  await until(async()=>{const lines=await ask(a,'/mycli arena start','');return lines.some(s=>s.startsWith('MC_DUNGEON_START '));},'start after native cooldown',190000);
  await until(async()=>/MC_DUNGEON_MOB floor=1/.test(await rcon('mycli admin dungeonaudit')),'enhanced first wave');
  const audit=await rcon('mycli admin dungeonaudit');check('first trial floor has six enemies and two native witches',(audit.match(/MC_DUNGEON_MOB floor=1/g)||[]).length===6&&(audit.match(/ type=WITCH /g)||[]).length===2,audit);check('first-floor witches have strengthened actual health',/type=WITCH .*health=34\.50/.test(audit),audit);
  const effectStart=a.packets.length;await until(()=>a.packets.slice(effectStart).some(p=>p.type==='effect'&&[2,18,19].includes(p.effectId??p.effect)), 'native witch potion applies a real effect',45000);check('witch AI throws a harmful native potion at the participant',true,a.packets.slice(effectStart).filter(p=>p.type==='effect'));
  check('ranged battle produces actual health damage',a.packets.some(p=>p.type==='health'&&p.health<20));await ask(a,'/mycli arena leave','');await sleep(1200);
  await rcon(`minecraft:effect give ${a.name} minecraft:instant_health 1 10 true`);
  for(const [who,id] of [[a,'undead_crypt'],[b,'creeping_crypt'],[c,'bunker']]){await tp(who,defs[id].start);await result(who,'/mycli dungeon start '+id);}
  await until(async()=>{const s=await rcon('mycli admin dungeons audit');return s.includes('activeRuns=3')&&(s.match(/MC_SITE_DUNGEON_MOB /g)||[]).length>=14;},'parallel native building waves',25000);
  check('three locations fight concurrently under global entity limit',(await rcon('mycli admin dungeons audit')).includes('activeRuns=3'));
  check('maintenance active-run gate includes site challenges',/MC_DUNGEON_AUDIT floor=\d+ active=true/.test(await rcon('mycli admin dungeonaudit')));
  check('active catalogue cannot be changed',(await rcon('mycli admin dungeons reload')).includes('status=active_runs'));
  await result(d,'/mycli dungeon join undead_crypt','muster_closed');await result(a,'/mycli dungeon start bunker','already_in_activity_or_not_survival');
  const mob=(await enemies('undead_crypt'))[0];await tp(d,mob.point);const outsiderEffects=d.packets.length;await sleep(7000);const targetAudit=await rcon('mycli admin dungeons audit');check('nonparticipant is not targeted by managed enemies',!targetAudit.includes('target='+d.bot.player.uuid),targetAudit);check('nonparticipant receives no managed hostile potion',!d.packets.slice(outsiderEffects).some(p=>p.type==='effect'&&[2,18,19].includes(p.effectId??p.effect)));
  for(const x of [a,b,c])await rcon(`minecraft:effect give ${x.name} minecraft:strength 9999 100 true`);
  for(const [who,id] of [[b,'creeping_crypt'],[c,'bunker']]){await killWave(who,id);await until(async()=>(await state(who,id)).stage===2,'actual first room clear '+id);check('actual building room clear advances '+id,(await state(who,id)).phase==='moving');}
  // Keep undead first room alive for normal-restart continuity; complete bunker normally.
  await tp(c,defs.bunker.rooms[1].center);await until(async()=>(await enemies('bunker')).length===4,'second bunker room');await killWave(c,'bunker');await until(async()=>(await state(c,'bunker')).phase==='returning','bunker return phase');
  await result(c,'/mycli dungeon claim bunker','no_pending_reward');await tp(c,defs.bunker.start);await until(async()=>(await state(c)).pendingRewards?.includes('bunker'),'real return creates receipt');
  check('isolated fixture fills actual cached stash and reward queue',(await rcon('sitedungeonqa rewardfull '+c.name)).includes('emerald=2147483647'));await result(c,'/mycli dungeon claim bunker','personal_reward_queue_full');check('full personal queue keeps the unspent dungeon receipt',(await state(c)).pendingRewards?.includes('bunker'));check('isolated reward queue fixture reset',(await rcon('sitedungeonqa rewardreset '+c.name)).includes('emerald=0'));
  const temp=stage+'/plugins/AgentFriend/config.yml.site-dungeon.tmp';mkdirSync(temp);try{await result(c,'/mycli dungeon claim bunker','data_unavailable');check('failed durable write rolls reward queue back',(await rcon('sitedungeonqa rewardaudit '+c.name)).includes('emerald=0'));check('failed durable write retains receipt',(await state(c)).pendingRewards?.includes('bunker'));}finally{rmdirSync(temp);}
  await result(c,'/mycli dungeon claim bunker');await result(c,'/mycli dungeon claim bunker','no_pending_reward');check('independent reward enters existing personal queue',(await ask(c,'/mycli arena rewards list','MC_REWARD_SUMMARY ')).some(s=>s.startsWith('MC_REWARD item=')||s.includes('emerald')));
  // Exercise an unknown removed entity: it must not turn into a free room clear.
  const undead=(await enemies('undead_crypt'))[0];await rcon('minecraft:tp '+undead.id+' -425 -60 677');await sleep(1500);
  const before=await state(a,'undead_crypt');check('escaped or missing enemy cannot silently award a completion',before.stage===1);
  for(const x of [a,b]){x.bot.quit('normal restart checkpoint');}await sleep(1800);
  const expected={sha256:report.sha256,undeadStage:1,creepingStage:2,bunkerClaimed:true};for(const root of roots)writeFileSync(root+'/restart-expected.json',JSON.stringify(expected,null,2));
 }else{
  check('same tested artifact after normal restart',JSON.parse(readFileSync(roots[0]+'/restart-expected.json','utf8')).sha256===report.sha256);
  for(const [who,id,n] of [[a,'undead_crypt',1],[b,'creeping_crypt',2]]){await tp(who,defs[id].rooms[n-1].center);await rcon(`minecraft:effect give ${who.name} minecraft:strength 9999 100 true`);await until(async()=>(await state(who,id)).stage===n,'restored checkpoint '+id);check('uncompleted room resumes independently '+id,(await state(who,id)).participant);}
  await until(async()=>(await enemies('undead_crypt')).length===5,'one restored undead wave');check('restart has exactly one current wave',(await enemies('undead_crypt')).length===5);
  await result(c,'/mycli dungeon claim bunker','no_pending_reward');
  for(const [who,id,start] of [[a,'undead_crypt',0],[b,'creeping_crypt',1]]){
   for(let n=start;n<defs[id].rooms.length;n++){await tp(who,defs[id].rooms[n].center);await until(async()=>(await enemies(id)).length>0,'wave '+id+' '+n);await killWave(who,id);await until(async()=>{const s=await state(who,id);return s.phase==='returning'||s.stage===n+2;},'room clear '+id+' '+n);}
   await tp(who,defs[id].start);await until(async()=>(await state(who)).pendingRewards?.includes(id),'return receipt '+id);await result(who,'/mycli dungeon claim '+id);await result(who,'/mycli dungeon claim '+id,'no_pending_reward');
  }
  check('all managed challenges end without stray owned mobs',(await rcon('mycli admin dungeons audit')).includes('activeRuns=0 trackedMobs=0'));
 }
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(e);}
finally{for(const c of clients){if(c.bot.currentWindow)c.bot.closeWindow(c.bot.currentWindow);c.bot.quit('isolated test complete');}report.finishedAt=new Date().toISOString();report.clients=clients.map(c=>({name:c.name,error:c.error,lastMessages:c.lines.slice(-8)}));for(const root of roots)writeFileSync(root+'/'+phase+'-'+report.finishedAt.replaceAll(':','-')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
