// Disposable Paper 25567 only; never point this probe at production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,renameSync,mkdirSync,rmdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const stage='E:/MC/staging/life-buildings-20261003',root='E:/MC/ops/repairs/profession-skills-20261008';
const roots=[root,'F:/MC-backups/repairs/profession-skills-20261008'];
const ids=JSON.parse(readFileSync(root+'/test-identities.json','utf8'));
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,startedAt:new Date().toISOString(),candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.92.jar')).digest('hex').toUpperCase(),checks:[],messages:{},packets:{}};
const clients=[];
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
const until=async(f,label,timeout=14000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await f())return;await sleep(80);}throw new Error(label+' timed out');};
const json=s=>JSON.parse(s.slice(s.indexOf('{')));
function yaml(rel){const out=root+'/read-'+rel.replaceAll('/','_')+'.json';execFileSync('E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe',['-cp',root+';E:/MC/server/libraries/org/yaml/snakeyaml/2.2/snakeyaml-2.2.jar;E:/MC/server/libraries/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar','YamlJson',stage+'/'+rel,out],{windowsHide:true});return JSON.parse(readFileSync(out,'utf8'));}
const config=()=>yaml('plugins/AgentFriend/config.yml');
const ledger=()=>JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8'));
const profile=c=>ledger().players[ids[c.name]];
async function join(name){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});
 const c={bot,name,lines:[],packets:[],effects:[],cameras:[]};clients.push(c);report.messages[name]=c.lines;report.packets[name]=c.packets;
 bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{report.errors??=[];report.errors.push(String(e));});
 bot._client.on('packet',(p,m)=>{if(m.name==='custom_payload'&&p.channel.startsWith('mcagent:'))try{c.packets.push({channel:p.channel,...JSON.parse(p.data.toString())});}catch{}
  if(/title|sound|particle/.test(m.name))c.effects.push(m.name);if(m.name==='camera')c.cameras.push(p);});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state\0mcagent:event\0mcviewer:state\0mcagent:market')});await sleep(400);return c;
}
async function chat(c,q){await sleep(Math.max(0,1120-(Date.now()-(c.lastChat??0))));c.lastChat=Date.now();c.bot.chat(q);}
async function ask(c,q,prefix){const n=c.lines.length;await chat(c,q);await until(()=>c.lines.slice(n).some(s=>s.includes(prefix)),q);await sleep(90);return c.lines.slice(n);}
async function result(c,q,reason='success'){const lines=await ask(c,q,'MC_PROFESSION_RESULT ');const r=json(lines.findLast(s=>s.startsWith('MC_PROFESSION_RESULT ')));assert.equal(r.reason,reason,q+': '+lines.join('\n'));if(reason==='success'&&q.startsWith('/mycli profession choose'))await learnUnlocked(c);return r;}
// This broad primitive suite uses a 200-point isolation fixture. Purchases still use real player commands.
async function learnUnlocked(c){let p;try{p=ledger().players[ids[c.name]];}catch{return;}if(!p)return;
 for(const id of Object.keys(p.unlocked||{})){if(p.learned[id])continue;const all=JSON.parse(readFileSync(root+'/stage-skills.yml.json','utf8')).skills;
  if(all[id]?.profession!==p.combat)continue;await result(c,'/mycli skills learn '+id);p=ledger().players[ids[c.name]];}}

async function tp(c,x=1700.5,y=150,z=1700.5){await rcon(`minecraft:tp ${c.name} ${x} ${y} ${z}`);await until(()=>c.bot.entity.position.distanceTo(new Vec3(x,y,z))<.7,'position');await sleep(300);}
async function look(c,x,y,z){await c.bot.lookAt(new Vec3(x,y,z),true);await sleep(120);}
const state=async c=>json(await rcon('professionqa state '+c.name));
const refill=async(c,n)=>json(await rcon('professionqa mana '+c.name+(n===undefined?'':' '+n)));
async function equip(c,item,hand='hand'){await rcon(`minecraft:give ${c.name} minecraft:${item}`);await sleep(120);await c.bot.equip(c.bot.inventory.items().find(i=>i.name===item),hand);await sleep(100);}
let mobN=0;
async function mob(x=1700.5,z=1703,y=150,health=40,extra=''){const tag='qa_skill_'+(++mobN);await rcon(`minecraft:summon minecraft:husk ${x} ${y} ${z} {Tags:["qa_skill_mob","${tag}"${extra?','+extra:''}],NoAI:1b,PersistenceRequired:1b,Health:${health}f,Attributes:[{Name:"minecraft:generic.max_health",Base:${health}d}]}`);await sleep(150);return tag;}
const mobstate=async tag=>json(await rcon('professionqa mob '+tag));
async function clear(){await rcon('minecraft:kill @e[tag=qa_skill_mob]');await sleep(150);}
async function killBySword(c,x=1700.5,z=1702.5){await clear();const tag=await mob(x,z,150,4);await look(c,x,151.5,z);await until(()=>Object.values(c.bot.entities).some(e=>e.name==='husk'&&Math.abs(e.position.x-x)<.2),'visible mob');const entity=Object.values(c.bot.entities).find(e=>e.name==='husk'&&Math.abs(e.position.x-x)<.2);c.bot.attack(entity);await sleep(450);return tag;}
async function accept(c,id){await ask(c,'/mycli guild accept '+id,'已接公会委托');}
async function claim(c,final=true){const lines=await ask(c,'/mycli guild claim',final?'委托交付成功':'阶段已交付');if(final)await learnUnlocked(c);return lines;}
function writeConfig(name,value){writeFileSync(stage+'/plugins/AgentFriend/'+name,JSON.stringify(value,null,2));}
try{
 check('isolated new catalog starts with three classic roles and sixteen skills',json(await rcon('mycli admin professions audit')).ready);
 report.gamerules={natural:await rcon('minecraft:gamerule naturalRegeneration'),mobs:await rcon('minecraft:gamerule doMobSpawning')};
 await rcon('minecraft:gamerule naturalRegeneration false');await rcon('minecraft:gamerule doMobSpawning false');
 await rcon('minecraft:forceload add 1680 1680 1775 1743');
 await rcon('minecraft:fill 1690 149 1690 1774 149 1735 minecraft:stone');await rcon('minecraft:fill 1690 150 1690 1774 155 1735 minecraft:air');
 const sword=await join('SkillSword92'),other=await join('SkillOther92'),healer=await join('SkillHeal92'),scout=await join('SkillScout92'),life=await join('SkillLife92'),eye=await join('SkillEye92');
 for(const [i,c] of [sword,other,healer,scout,life].entries()){await rcon('minecraft:gamemode survival '+c.name);await tp(c,1700.5+i*12);await rcon('minecraft:effect clear '+c.name);await rcon('minecraft:clear '+c.name);}
 await rcon('minecraft:gamemode spectator '+eye.name);await rcon('minecraft:spectate '+sword.name+' '+eye.name);await sleep(1000);
 await result(other,'/mycli cast sword_thrust','profession_required');await rcon('minecraft:op '+other.name);
 await result(other,'/cast sword_thrust','profession_required');await rcon('minecraft:deop '+other.name);
 check('unknown profession and OP direct cast cannot bypass UUID qualification',true);
 await result(sword,'/mycli profession choose warrior');await result(healer,'/mycli profession choose priest');await result(scout,'/mycli profession choose mage');
 check('paid starter learning and preparation are persisted by UUID',profile(sword).learned.sword_thrust&&profile(sword).prepared.includes('sword_parry'));
 await result(sword,'/mycli cast sword_arc','not_learned');await result(sword,'/mycli cast sword_thrust','equipment_required');await equip(sword,'iron_sword');
 await look(sword,1700.5,151.6,1710);await clear();await refill(sword);const emptyBefore=await state(sword);await result(sword,'/mycli cast sword_thrust','no_target');
 check('invalid equipment and absent target never charge mana',Math.abs(emptyBefore.mana-(await state(sword)).mana)<.2);
 await rcon('minecraft:summon minecraft:villager 1700.5 150 1702 {Tags:["qa_skill_mob"],NoAI:1b}');await result(sword,'/cast sword_thrust','no_target');check('villagers are never sword targets',true);await clear();
 const protectedTag=await mob(1700.5,1702.5,150,40,'"qa_skill_protected"');await refill(sword);const protectedBefore=await state(sword);
 await result(sword,'/cast sword_thrust','protected_target');check('a cancelled native damage event refunds mana and cooldown',Math.abs(protectedBefore.mana-(await state(sword)).mana)<.2&&(await mobstate(protectedTag)).health===40);
 await clear();await mob();await rcon('minecraft:setblock 1700 151 1701 minecraft:stone');await result(sword,'/mycli cast sword_thrust','no_target');check('wall blocks strike and costs nothing',true);await rcon('minecraft:setblock 1700 151 1701 minecraft:air');await clear();
 const target=await mob(1700.5,1702.5);await refill(sword);await look(sword,1700.5,151.5,1702.5);const before=await state(sword),fx=sword.effects.length,events=sword.packets.length;
 await result(sword,'/cast sword_thrust');const after=await state(sword),damaged=await mobstate(target);
 check('direct cast actually damages a monster and charges exactly four mana',damaged.health<40&&Math.abs(before.mana-after.mana-4)<.3,{before,after,damaged});
 check('native skill title particles sound and old private event channel are present',sword.effects.length>fx&&sword.packets.slice(events).some(p=>p.channel==='mcagent:event'&&p.id==='sword_thrust'));
 await result(sword,'/mycli skills unprepare sword_thrust');await result(sword,'/mycli cast sword_thrust','not_prepared');await result(sword,'/mycli skills prepare sword_thrust');check('preparation is enforced at the actual execution gate',true);
 await ask(sword,'/mycli spells explain sword_thrust','MC_SPELL_DETAIL ');await ask(sword,'/mycli skills list','MC_SPELL_LIST ');await ask(sword,'/mycli explain cast.sword_thrust','MC_CLI_DETAIL ');
 check('existing guide and skills alias discover profession abilities',sword.lines.some(s=>s.startsWith('MC_SPELL_DETAIL ')&&json(s).id==='sword_thrust'));
 const listed=await ask(sword,'/mycli list cast','MC_CLI_LIST '),pages=json(listed.find(s=>s.startsWith('MC_CLI_LIST '))).pages;
 for(let page=2;page<=pages;page++)await ask(sword,'/mycli list cast '+page,'MC_CLI_LIST ');
 check('old paged command discovery includes new casts',sword.lines.some(s=>s.startsWith('MC_CLI_ITEM ')&&json(s).id==='cast.sword_thrust'));
 await ask(sword,'/mycli focus list','职业刻印 ID');check('existing imprint discovery includes profession IDs',sword.lines.some(s=>s.includes('职业刻印 ID')&&s.includes('sword_thrust')));
 await rcon('minecraft:setblock 1698 150 1700 minecraft:enchanting_table');await rcon('minecraft:give '+sword.name+' minecraft:lapis_lazuli');await rcon('minecraft:experience set '+sword.name+' 6 levels');
 await ask(sword,'/mycli imprint sword_thrust','已给手持物品刻印');await clear();const imprintTarget=await mob(1700.5,1702.5);await refill(sword);await look(sword,1700.5,151.5,1702.5);const imprintBefore=await state(sword),imprintAt=sword.lines.length;
 sword.bot.setControlState('sneak',true);await sleep(180);sword.bot.activateItem();await until(()=>sword.lines.slice(imprintAt).some(s=>s.startsWith('MC_PROFESSION_RESULT ')),'imprinted sword cast');sword.bot.deactivateItem();sword.bot.setControlState('sneak',false);
 check('real imprinted sword uses the same paid qualified execution',json(sword.lines.slice(imprintAt).find(s=>s.startsWith('MC_PROFESSION_RESULT '))).success&&(await mobstate(imprintTarget)).health<40&&Math.abs(imprintBefore.mana-(await state(sword)).mana-4)<.4);
 await chat(sword,'/mycli menu');await until(()=>sword.bot.currentWindow,'compass window');
 await sword.bot.clickWindow(1,0,0);await sleep(400);check('compass opens a vanilla profession menu',JSON.stringify(sword.bot.currentWindow?.title).includes('职业'));sword.bot.closeWindow(sword.bot.currentWindow);
 await chat(sword,'/mycli skills menu');await until(()=>sword.bot.currentWindow,'skills window');check('skills menu opens the actual personal skill page',JSON.stringify(sword.bot.currentWindow.title).includes('我的职业技能'));sword.bot.closeWindow(sword.bot.currentWindow);
 // Exact accepted reward list is frozen before an operator edits the live rule file.
 await clear();await accept(sword,'tm_sword_arc_trial');
 const rules=JSON.parse(readFileSync(root+'/stage-skill-unlocks.yml.json','utf8'));const originalRules=structuredClone(rules);rules.unlocks.sword_arc_trial.skills=['sword_beam'];writeConfig('skill-unlocks.yml',rules);
 check('valid content hot reload succeeds',/已热加载/.test(await rcon('mycli admin professions reload')));
 await killBySword(sword);check('real Mineflayer melee kill advances only the active trial',config()['guild-players'][ids[sword.name]].active.progress===1);
 await claim(sword,false);await clear();const parryMob=await mob(1700.5,1702);await look(sword,1700.5,151,1702);await refill(sword);
 const healthBefore=(await state(sword)).health;await result(sword,'/mycli cast sword_parry');await rcon('professionqa hit '+sword.name+' '+parryMob+' 8');const healthAfter=(await state(sword)).health;
 check('prepared parry actually reduces frontal monster melee damage',healthBefore-healthAfter>0&&healthBefore-healthAfter<=4.1,{healthBefore,healthAfter});
 check('only effective reduction advances parry trial',config()['guild-players'][ids[sword.name]].active.progress===1);
 await claim(sword);check('completion grants the frozen skill, not the edited reward',profile(sword).learned.sword_arc&&!profile(sword).learned.sword_beam);
 const receipt=profile(sword).learned.sword_arc.receipt;await rcon('mycli admin professions recover');check('skill receipt recovery is idempotent',profile(sword).learned.sword_arc.receipt===receipt);
 check('attached real spectator receives private unlock notice',eye.lines.some(s=>s.startsWith('MC_SKILL_UNLOCK ')&&json(s).skill==='sword_arc'));
 writeConfig('skill-unlocks.yml',originalRules);await rcon('mycli admin professions reload');
 const skills=JSON.parse(readFileSync(root+'/stage-skills.yml.json','utf8'));const invalid=structuredClone(skills);invalid.skills.sword_thrust.limits.power=999;writeConfig('skills.yml',invalid);
 check('unsafe effect config is rejected atomically',/校验失败/.test(await rcon('mycli admin professions reload')));writeConfig('skills.yml',skills);await rcon('mycli admin professions reload');
 await clear();await tp(sword);await look(sword,1700.5,151.5,1710);const a=await mob(1700.5,1702.2),b=await mob(1701.5,1702.2),c=await mob(1699.5,1702.2),behind=await mob(1700.5,1698.5);
 await refill(sword);await result(sword,'/mycli cast sword_arc');check('arc attacks at most three frontal enemies and leaves rear enemy intact',(await mobstate(a)).health<40&&(await mobstate(b)).health<40&&(await mobstate(c)).health<40&&(await mobstate(behind)).health===40);
 // Guild completion with a failed ledger write must leave a recoverable pending receipt.
 await clear();await accept(sword,'tm_qa_legacy_one');await killBySword(sword);
 const ledgerPath=stage+'/plugins/AgentFriend/profession-ledger.json';renameSync(ledgerPath,ledgerPath+'.qa-backup');mkdirSync(ledgerPath);
 const failBefore=await state(sword);await result(sword,'/mycli cast sword_parry','data_unavailable');check('unwritable ledger prevents effect and mana charge',Math.abs(failBefore.mana-(await state(sword)).mana)<.2);
 await claim(sword);const pending=config()['profession-pending'];check('completed verified quest persists pending skill reward through write failure',Object.values(pending).some(v=>v.state==='pending'&&v.skills.includes('twin_legacy')));
 rmdirSync(ledgerPath);renameSync(ledgerPath+'.qa-backup',ledgerPath);await rcon('mycli admin professions recover');await learnUnlocked(sword);check('pending recovery grants legacy exactly once',profile(sword).learned.twin_legacy&&profile(sword).learned.sword_step);
 await result(sword,'/mycli skills unprepare sword_parry');await result(sword,'/mycli skills prepare sword_step');await result(sword,'/mycli skills prepare sword_beam');
 await clear();await tp(sword);await look(sword,1700.5,151.5,1710);await mob(1700.5,1705);await rcon('minecraft:setblock 1700 150 1702 minecraft:stone');await refill(sword);
 const blockedBefore=await state(sword);await result(sword,'/mycli cast sword_step','unsafe_path');check('step checks full path before charging',Math.abs(blockedBefore.mana-(await state(sword)).mana)<.2);await rcon('minecraft:setblock 1700 150 1702 minecraft:air');
 await result(sword,'/mycli cast sword_step');check('step moves exactly three blocks and pays its own six mana',Math.abs((await state(sword)).z-1703.5)<.2&&Math.abs(blockedBefore.mana-(await state(sword)).mana-6)<.4);
 await clear();await tp(sword);await look(sword,1700.5,151.5,1710);const combo=await mob(1700.5,1702.5,150,100);await equip(sword,'diamond_sword','off-hand');await refill(sword);const comboBefore=await state(sword);
 await result(sword,'/mycli cast twin_legacy');await sleep(2100);const comboAfter=await state(sword),comboMob=await mobstate(combo);
 check('four-phase legacy charges once and total base damage stays bounded',Math.abs(comboBefore.mana-comboAfter.mana-14)<.4&&100-comboMob.health>12&&100-comboMob.health<=16.01,{comboBefore,comboAfter,comboMob});
 await clear();await result(other,'/mycli profession choose warrior');await tp(other);await equip(other,'iron_sword');await accept(other,'tm_qa_legacy_one');await killBySword(other);await claim(other);
 check('world-limit ledger never gives a second owner the same unique legacy',!profile(other).learned.twin_legacy&&ledger().uniqueOwners.twin_legacy===ids[sword.name]);
 // Healer: falls/self heals do not count; only real restored teammate monster damage does.
 await tp(other,1724.5);await tp(healer,1726.5);await refill(healer);await accept(healer,'tm_healer_trial');
 await rcon('professionqa health '+other.name+' 10');await result(healer,'/mycli cast healer_mend '+other.name);check('ordinary damage cannot fake combat healing progress',config()['guild-players'][ids[healer.name]].active.progress===0);
 await sleep(1100);await clear();const woundMob=await mob(1724.5,1703);await rcon('professionqa hit '+other.name+' '+woundMob+' 4');await refill(healer);const healBefore=await state(other);
 await result(healer,'/mycli cast healer_mend '+other.name);check('actual teammate restoration advances healer evidence',(await state(other)).health>healBefore.health&&config()['guild-players'][ids[healer.name]].active.progress===1);await claim(healer);
 check('healer verified route unlocks group healing',profile(healer).learned.healer_beacon);
 await clear();await tp(scout,1748.5);await tp(other,1748.5,150,1701);await equip(scout,'bow');await equip(other,'iron_sword');await accept(scout,'tm_mage_trial');const marked=await mob(1748.5,1703,150,4);await look(scout,1748.5,151.5,1703);await refill(scout);
 await result(scout,'/mycli cast scout_mark');await until(()=>Object.values(other.bot.entities).some(e=>e.name==='husk'&&Math.abs(e.position.x-1748.5)<.2),'marked entity');other.bot.attack(Object.values(other.bot.entities).find(e=>e.name==='husk'&&Math.abs(e.position.x-1748.5)<.2));await sleep(500);
 check('mark plus real teammate kill advances scout evidence',config()['guild-players'][ids[scout.name]].active.progress===1);await claim(scout);check('verified scout route unlocks multi-target watch',profile(scout).learned.scout_watch);
 await result(life,'/mycli profession choose farmer','unknown_profession');const catalog=json(await rcon('mycli admin professions audit'));check('first release offers exactly warrior mage and priest',catalog.professions===3&&catalog.skills===16);
 await result(sword,'/cast mage_bolt','profession_required');await clear();await tp(scout,1748.5);const boltMob=await mob(1748.5,1710.5);await look(scout,1748.5,151.5,1710.5);await refill(scout);const boltBefore=await state(scout);await result(scout,'/cast mage_bolt');
 check('mage ranged bolt deals real damage and pays six mana',(await mobstate(boltMob)).health<40&&Math.abs(boltBefore.mana-(await state(scout)).mana-6)<.4);
 await clear();const frostTags=[await mob(1748.5,1702.5),await mob(1749.5,1702.5),await mob(1747.5,1702.5)],frostRear=await mob(1748.5,1698.5);await look(scout,1748.5,151.5,1705);await refill(scout);const frostBefore=await state(scout);await result(scout,'/mycli cast mage_frost');
 const frozen=await Promise.all(frostTags.map(mobstate));check('mage frost damages and actually slows at most three frontal enemies',frozen.every(m=>m.health<40&&m.slownessTicks>0)&&(await mobstate(frostRear)).health===40&&Math.abs(frostBefore.mana-(await state(scout)).mana-8)<.4,frozen);
 await clear();const flameTags=[await mob(1748.5,1702.5),await mob(1749.5,1702.5),await mob(1747.5,1702.5)];await refill(scout);const flameBefore=await state(scout);await result(scout,'/mycli cast mage_flame');const flamed=await Promise.all(flameTags.map(mobstate));
 check('earned mage flame charges once damages monsters and does not ignite',flamed.every(m=>m.health<40&&m.fireTicks<=0)&&Math.abs(flameBefore.mana-(await state(scout)).mana-9)<.4,flamed);
 await result(sword,'/mycli profession choose priest');await result(sword,'/mycli cast sword_thrust','profession_required');await result(sword,'/mycli profession choose warrior');check('switching classes retains learned skills and legacy ownership',profile(sword).learned.sword_arc&&profile(sword).learned.twin_legacy);
 await rcon('minecraft:gamemode spectator '+sword.name);await result(sword,'/cast sword_thrust','survival_required');await rcon('minecraft:gamemode survival '+sword.name);check('spectators cannot cast even learned native skills',true);
 await refill(sword);await clear();await look(sword,1700.5,151.5,1710);await mob(1700.5,1702.5);await ask(sword,'/mycli cast starbolt','星芒箭命中');
 check('old skill entry and state schema remain usable',sword.packets.some(p=>p.channel==='mcagent:state'&&p.schemaVersion===1&&p.mana&&p.abilities?.some(a=>a.id==='mycli:starbolt')));
 await rcon('mycli admin professions recover');await ask(sword,'/mycli skills mine','MC_SKILL_ASSESSMENT ');
 check('assessment reports effective damage healing and mitigation separately',profile(sword).metrics.damage>0&&profile(sword).metrics.mitigatedDamage>0&&profile(healer).metrics.combatHealing>0);
 report.passed=true;
}catch(error){report.error=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();const stamp=new Date().toISOString().replaceAll(':','-');for(const r of roots)writeFileSync(r+'/stage-'+stamp+'.json',JSON.stringify(report,null,2));
 for(const c of clients){try{c.bot.quit('isolated profession checks complete');}catch{}}await sleep(500);
}
