// Disposable Paper 25567 only. Uses production 6/30 point rules and real player commands.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,renameSync,mkdirSync,rmdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const root='E:/MC/ops/repairs/profession-skills-20261008',stage='E:/MC/staging/life-buildings-20261003',mode=process.argv[2]||'pre';
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,mode,startedAt:new Date().toISOString(),candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.92.jar')).digest('hex').toUpperCase(),checks:[],messages:{}},clients=[];
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
const until=async(f,label,ms=15000)=>{let end=Date.now()+ms;while(Date.now()<end){if(await f())return;await sleep(80);}throw Error(label+' timeout');};
const json=s=>JSON.parse(s.slice(s.indexOf('{'))),ledger=()=>JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8'));
const profile=c=>ledger().players[c.uuid],state=async c=>json(await rcon('professionqa state '+c.name));
async function join(name){const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'}),c={bot,name,lines:[],packets:[]};clients.push(c);report.messages[name]=c.lines;
 bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{report.errors??=[];report.errors.push(String(e));});
 bot._client.on('packet',(p,m)=>{if(m.name==='custom_payload'&&p.channel.startsWith('mc'))try{c.packets.push({channel:p.channel,...JSON.parse(p.data.toString())});}catch{}});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});c.uuid=bot._client.uuid;assert.match(c.uuid,/^[0-9a-f-]{36}$/);
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state\0mcviewer:state\0mcagent:event')});await sleep(300);return c;}
async function ask(c,q,prefix){let n=c.lines.length;await sleep(Math.max(0,1120-(Date.now()-(c.last??0))));c.last=Date.now();c.bot.chat(q);if(prefix)await until(()=>c.lines.slice(n).some(s=>s.includes(prefix)),q);await sleep(90);return c.lines.slice(n);}
async function result(c,q,reason='success'){let lines=await ask(c,q,'MC_PROFESSION_RESULT '),data=json(lines.findLast(s=>s.startsWith('MC_PROFESSION_RESULT ')));assert.equal(data.reason,reason,lines.join('\n'));return data;}
async function points(c){let lines=await ask(c,'/mycli skills points','MC_SKILL_POINTS ');return json(lines.findLast(s=>s.startsWith('MC_SKILL_POINTS ')));}
async function info(c,id){let lines=await ask(c,'/mycli skills info '+id,'MC_SKILL ');return json(lines.findLast(s=>s.startsWith('MC_SKILL ')));}
async function tp(c,x=1700.5,z=1700.5){await rcon(`minecraft:tp ${c.name} ${x} 150 ${z}`);await until(()=>Math.abs(c.bot.entity.position.x-x)<.5&&Math.abs(c.bot.entity.position.z-z)<.5,'tp');await sleep(160);}
async function monster(tag,x=1700.5,z=1702.5){await rcon(`minecraft:summon minecraft:husk ${x.toFixed(2)} 150 ${z.toFixed(2)} {Tags:["qa_skill_mob","${tag}"],NoAI:1b,PersistenceRequired:1b,Health:100f,Attributes:[{Name:"minecraft:generic.max_health",Base:100d},{Name:"minecraft:generic.knockback_resistance",Base:1d}]}`);await sleep(200);}
const refill=async c=>rcon('professionqa mana '+c.name);
async function equip(c,item){await rcon('minecraft:give '+c.name+' minecraft:'+item);await sleep(150);let all=c.bot.inventory.items().filter(i=>i.name===item),hot=all.find(i=>i.slot>=36&&i.slot<=44);
 if(hot)c.bot.setQuickBarSlot(hot.slot-36);else{let empty=Array.from({length:9},(_,i)=>i).find(i=>!c.bot.inventory.slots[i+36]);assert.notEqual(empty,undefined);c.bot.setQuickBarSlot(empty);await c.bot.equip(all[0],'hand');}
 c.bot._client.write('held_item_slot',{slotId:c.bot.quickBarSlot});await sleep(150);}
try{
 if(mode==='pre'){
  check('catalog starts with production point settings',json(await rcon('mycli admin professions audit')).ready);
  await rcon('minecraft:gamerule naturalRegeneration false');await rcon('minecraft:gamerule doMobSpawning false');await rcon('minecraft:kill @e[tag=qa_skill_mob]');
  let suffix=Date.now().toString(36).slice(-6);const w=await join('PointW'+suffix),h=await join('PointH'+suffix),old=await join('SkillSword92');
  const allies=[await join('SkillOther92'),await join('SkillLife92'),await join('SkillScout92'),w];
  for(const c of [w,h,old,...allies])await rcon('minecraft:gamemode survival '+c.name);
  await tp(w);await tp(old,1712.5);let initial=await points(w),legacy=await points(old);
  check('new UUID receives six points and no grandfathered entitlement',initial.earned===6&&initial.remaining===6&&initial.cap===30&&!initial.grandfathered,initial);
  check('existing UUID preserves old common skills without spending points',legacy.grandfathered&&(await info(old,'starbolt')).level===1&&legacy.spent===0,legacy);
  await result(w,'/mycli profession choose warrior');check('choosing a branch unlocks starters without free learning',profile(w).unlocked.sword_thrust&&!profile(w).learned.sword_thrust);
  await result(w,'/cast sword_thrust','not_learned');await result(w,'/mycli skills learn sword_arc','locked');await result(w,'/mycli skills learn sword_thrust');
  await result(w,'/mycli skills learn sword_thrust','already_learned');await result(w,'/mycli skills upgrade sword_thrust');await result(w,'/mycli skills upgrade sword_thrust','insufficient_points');
  check('learning and upgrade charge two then three points exactly once',profile(w).points.spent===5&&profile(w).learned.sword_thrust.level===2);
  await result(w,'/cast food','not_learned');await result(w,'/mycli cast starlight','not_learned');await result(w,'/mycli skills learn starlight');await refill(w);await ask(w,'/mycli cast starlight','星尘术：');
  check('common skill costs one point and uses the original cast command',profile(w).points.spent===6&&profile(w).basicLearned.starlight);
  await equip(w,'iron_sword');await monster('qa_point_sword');await w.bot.lookAt(new Vec3(1700.5,151.5,1702.5),true);await refill(w);
  // Deliberately long cooldown verifies washing cannot reset already paid abilities.
  let skillFile=JSON.parse(readFileSync(stage+'/plugins/AgentFriend/skills.yml','utf8'));skillFile.skills.sword_thrust['cooldown-seconds']=600;
  writeFileSync(stage+'/plugins/AgentFriend/skills.yml',JSON.stringify(skillFile));await rcon('mycli admin professions reload');await result(w,'/mycli cast sword_thrust');let deadline=profile(w).cooldowns.sword_thrust;
  await rcon('professionqa mana '+w.name+' 0');await result(w,'/mycli skills respec confirm','insufficient_mana');check('failed respec retains learned levels and spent points',profile(w).points.spent===6&&profile(w).learned.sword_thrust.level===2);
  await refill(w);let before=await state(w);await result(w,'/mycli skills respec confirm');let after=await state(w);
  check('respec refunds all spent points and charges ten mana',profile(w).points.spent===0&&Math.abs(before.mana-after.mana-10)<.4);
  check('respec removes purchases while retaining branch unlocks and cooldowns',!profile(w).learned.sword_thrust&&!profile(w).basicLearned.starlight&&profile(w).unlocked.sword_thrust&&profile(w).combat==='warrior'&&profile(w).cooldowns.sword_thrust===deadline);
  await result(w,'/mycli skills respec confirm','cooldown');await result(w,'/mycli cast starlight','not_learned');await result(w,'/mycli profession choose mage');await result(w,'/mycli skills learn mage_bolt');await result(w,'/mycli skills learn mage_frost');
  await result(w,'/mycli skills upgrade mage_bolt','insufficient_points');await rcon('professionqa level '+w.name+' MINING 6');let earned=await points(w);await result(w,'/mycli skills upgrade mage_bolt');
  check('five additional AuraSkills levels earn one shared point',earned.earned===7&&profile(w).points.spent===7&&profile(w).learned.mage_bolt.level===2,earned);
  await rcon('professionqa level '+w.name+' MINING 1');await points(w);await rcon('professionqa level '+w.name+' MINING 6');check('dropping and restoring levels never farms extra points',(await points(w)).earned===7);
  // Real verified healing contract unlocks the advanced spell, then points purchase each rank.
  await result(h,'/mycli profession choose priest');await result(h,'/mycli skills learn healer_mend');await tp(h,1740.5);
  for(let i=0;i<allies.length;i++){await tp(allies[i],1741.5+i);await rcon('professionqa health '+allies[i].name+' 20');}
  await monster('qa_point_heal',1741.5,1702.5);await ask(h,'/mycli guild accept tm_healer_trial','已接公会委托');await rcon('professionqa hit '+allies[0].name+' qa_point_heal 8');await refill(h);
  await result(h,'/mycli cast healer_mend '+allies[0].name);await ask(h,'/mycli guild claim','委托交付成功');
  check('verified contract unlocks eligibility without free spell or points',profile(h).unlocked.healer_beacon&&!profile(h).learned.healer_beacon&&profile(h).points.spent===2);
  await result(h,'/mycli cast healer_beacon','not_learned');await result(h,'/mycli skills learn healer_beacon');
  await rcon('professionqa level '+h.name+' MINING 61');await rcon('professionqa level '+h.name+' FARMING 61');let full=await points(h);
  check('point earnings stop at the thirty point cap',full.earned===30&&full.cap===30&&full.spent===6,full);
  for(const c of allies)await rcon('professionqa health '+c.name+' 5');await refill(h);await result(h,'/mycli cast healer_beacon');let healed=await Promise.all(allies.map(state));
  check('rank one advanced healing restores eight HP to two allies',healed.filter(s=>s.health>5.1).length===2&&healed.every(s=>s.health<=13.1),healed);
  await result(h,'/mycli skills upgrade healer_beacon');for(const c of allies)await rcon('professionqa health '+c.name+' 5');await refill(h);await result(h,'/mycli cast healer_beacon');healed=await Promise.all(allies.map(state));
  check('rank two heals three allies for ten HP',healed.filter(s=>s.health>5.1).length===3&&healed.every(s=>s.health<=15.1),healed);
  let hp=(await state(allies[0])).health;await rcon('professionqa hit '+allies[0].name+' qa_point_heal 8');let reduced=(await state(allies[0])).health;
  check('rank two protection reduces actual monster damage without full immunity',hp-reduced>0&&hp-reduced<=4.1,{hp,reduced});
  await result(h,'/mycli skills upgrade healer_beacon');for(const c of allies)await rcon('professionqa health '+c.name+' 5');await refill(h);await result(h,'/mycli cast healer_beacon');healed=await Promise.all(allies.map(state));
  check('rank three heals four allies for twelve HP and costs progressively more points',healed.every(s=>s.health>16.9&&s.health<=17.1)&&profile(h).points.spent===19,healed);
  hp=(await state(allies[0])).health;await rcon('professionqa hit '+allies[0].name+' qa_point_heal 8');let protectedHp=(await state(allies[0])).health;
  check('rank three brief protection actually cancels monster attacks',Math.abs(hp-protectedHp)<.01,{hp,protectedHp});await sleep(1700);
  await rcon('professionqa hit '+allies[0].name+' qa_point_heal 8');let wardHp=(await state(allies[0])).health;await rcon('professionqa hit '+allies[0].name+' qa_point_heal 8');let finalHp=(await state(allies[0])).health;
  // Existing AuraSkills defense can reduce the fixture's requested base damage; compare actual final damage.
  check('immunity expires and the remaining ward absorbs only one attack',protectedHp-wardHp>0&&protectedHp-wardHp<=4.1&&Math.abs((wardHp-finalHp)/(protectedHp-wardHp)-2)<.1,{protectedHp,wardHp,finalHp});
  await result(h,'/mycli skills upgrade healer_beacon','max_level');let details=await info(h,'healer_beacon');
  check('skill discovery exposes actual ranks costs targets and protection',details.level===3&&details.levels.map(x=>x.pointCost).join(',')==='4,5,8'&&details.levels[2].targets===4&&details.levels[2].immunityMs===1500,details);
  const book=json(await rcon('professionqa book '+h.name));let text=book.pages.join('').replaceAll('\n','');
  check('status book includes profession points learned ranks upgrade fees and respec rules',text.includes('职业：牧师')&&text.includes('技能点')&&text.replaceAll(' ','').includes('高阶圣愈术3/3')&&text.includes('洗点'),{pages:book.pages.length});
  check('new book pages are paginated for vanilla book height',book.pages.slice(15).every(p=>p.split('\n').length<=13));
  await ask(h,'/mycli skills learnmenu','');await until(()=>h.bot.currentWindow,'learning menu');check('learning menu uses a vanilla container with native respec control',h.bot.currentWindow.slots[48]?.name==='grindstone');await h.bot.clickWindow(48,0,0);await until(()=>JSON.stringify(h.bot.currentWindow?.title).includes('确认'),'respec menu');
  check('respec has a native confirmation menu',h.bot.currentWindow.slots[11]?.name==='experience_bottle');await h.bot.clickWindow(15,0,0);await sleep(200);if(h.bot.currentWindow)h.bot.closeWindow(h.bot.currentWindow);
  // Failed atomic refund must neither lose points nor mana.
  const path=stage+'/plugins/AgentFriend/profession-ledger.json';renameSync(path,path+'.point-test');mkdirSync(path);await refill(h);before=await state(h);await result(h,'/mycli skills respec confirm','data_unavailable');after=await state(h);rmdirSync(path);renameSync(path+'.point-test',path);
  check('unwritable ledger leaves respec points and mana intact',profile(h).points.spent===19&&Math.abs(before.mana-after.mana)<.4);
  const source=profile(h).unlocked.healer_beacon.receipt;await refill(h);await result(h,'/mycli skills respec confirm');check('respec retains earned rare eligibility for relearning',profile(h).points.spent===0&&!profile(h).learned.healer_beacon&&profile(h).unlocked.healer_beacon.receipt===source);
  await result(h,'/mycli skills learn healer_beacon');check('earned skill can be relearned after respec for its original point cost',profile(h).learned.healer_beacon.level===1&&profile(h).points.spent===4);
  writeFileSync(root+'/points-restart-expectations.json',JSON.stringify({w:{name:w.name,uuid:w.uuid,profile:profile(w)},h:{name:h.name,uuid:h.uuid,profile:profile(h)},legacy:ledger().legacyPlayers}));
 }else if(mode==='post'){
  const expected=JSON.parse(readFileSync(root+'/points-restart-expectations.json','utf8')),w=await join(expected.w.name),h=await join(expected.h.name);let wp=await points(w),hp=await points(h);
  check('point balances and purchased ranks survive normal restart',wp.earned===7&&wp.spent===7&&profile(w).learned.mage_bolt.level===2&&hp.earned===30&&hp.spent===4);
  check('first-seen players do not become grandfathered after reconnect',!wp.grandfathered&&!hp.grandfathered&&!(await info(w,'starlight')).level);
  check('respec cooldown persists with its exact deadline',profile(w).cooldowns.respec===expected.w.profile.cooldowns.respec&&profile(h).cooldowns.respec===expected.h.profile.cooldowns.respec);
  check('previous spell cooldown remains after wash and restart',profile(w).cooldowns.sword_thrust===expected.w.profile.cooldowns.sword_thrust);
  check('rare eligibility and paid relearning survive restart',profile(h).unlocked.healer_beacon.receipt===expected.h.profile.unlocked.healer_beacon.receipt&&profile(h).learned.healer_beacon.level===1);
  await result(w,'/cast food','not_learned');await result(w,'/mycli skills respec confirm','cooldown');check('actual old cast and respec gates still enforce persisted state',true);
  await ask(w,'/mycli status','MC_DUNGEON ');await sleep(300);check('old Agent status schema remains one with additive profession points',w.packets.some(p=>p.channel==='mcagent:state'&&p.schemaVersion===1&&p.mana&&p.profession?.points?.earned===7));
 }else throw Error('pre or post required');
 report.passed=true;
}catch(e){report.error=String(e.stack||e);console.error(e);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();const stamp=new Date().toISOString().replaceAll(':','-');for(const dest of [root,'F:/MC-backups/repairs/profession-skills-20261008'])writeFileSync(dest+'/points-'+mode+'-'+stamp+'.json',JSON.stringify(report,null,2));for(const c of clients)try{c.bot.quit('isolated point checks done');}catch{}await sleep(400);}
