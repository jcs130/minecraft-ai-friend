// Restart, native raid adapter and 16-connection bounded skill checks. Stage 25567 only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const root='E:/MC/ops/repairs/profession-skills-20261008',stage='E:/MC/staging/life-buildings-20261003',mode=process.argv[2]||'pre';
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ids=JSON.parse(readFileSync(root+'/test-identities.json','utf8')),clients=[];
const report={passed:false,mode,startedAt:new Date().toISOString(),candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.92.jar')).digest('hex').toUpperCase(),checks:[],messages:{}};
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
const until=async(f,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await f())return;await sleep(100);}throw Error(label+' timeout');};
const json=s=>JSON.parse(s.slice(s.indexOf('{'))),ledger=()=>JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8'));
async function join(name){const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'}),c={bot,name,lines:[],packets:[],ends:0};clients.push(c);report.messages[name]=c.lines;
 bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{report.errors??=[];report.errors.push(String(e));});bot.on('end',()=>c.ends++);
 bot._client.on('packet',(p,m)=>{if(m.name==='custom_payload'&&p.channel.startsWith('mc'))try{c.packets.push({channel:p.channel,...JSON.parse(p.data.toString())});}catch{}});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state\0mcviewer:state\0mcagent:market\0mcagent:event')});await sleep(100);return c;}
async function ask(c,q,prefix){const n=c.lines.length;await sleep(Math.max(0,1120-(Date.now()-(c.last??0))));c.last=Date.now();c.bot.chat(q);await until(()=>c.lines.slice(n).some(s=>s.includes(prefix)),q);await sleep(80);return c.lines.slice(n);}
async function result(c,q,reason='success'){const lines=await ask(c,q,'MC_PROFESSION_RESULT ');const data=json(lines.findLast(s=>s.startsWith('MC_PROFESSION_RESULT ')));assert.equal(data.reason,reason,lines.join('\n'));if(reason==='success'&&q.startsWith('/mycli profession choose'))await learnUnlocked(c);return data;}
// This broad primitive suite uses a 200-point isolation fixture. Purchases still use real player commands.
async function learnUnlocked(c){let p;try{p=ledger().players[ids[c.name]];}catch{return;}if(!p)return;
 for(const id of Object.keys(p.unlocked||{})){if(p.learned[id])continue;const all=JSON.parse(readFileSync(root+'/stage-skills.yml.json','utf8')).skills;
  if(all[id]?.profession!==p.combat)continue;await result(c,'/mycli skills learn '+id);p=ledger().players[ids[c.name]];}}

async function tp(c,x=1700.5,z=1700.5){await rcon(`minecraft:tp ${c.name} ${x} 150 ${z}`);await until(()=>Math.abs(c.bot.entity.position.x-x)<.5&&Math.abs(c.bot.entity.position.z-z)<.5,'tp');await sleep(150);}
async function equip(c,item,hand='hand'){
 if(c.bot.currentWindow){c.bot.closeWindow(c.bot.currentWindow);await sleep(150);}await rcon(`minecraft:give ${c.name} minecraft:${item}`);await sleep(150);
 const candidates=c.bot.inventory.items().filter(i=>i.name===item),hotbar=candidates.find(i=>i.slot>=36&&i.slot<=44);
 if(hand==='hand'&&hotbar)c.bot.setQuickBarSlot(hotbar.slot-36);
 else{if(hand==='hand'){const empty=Array.from({length:9},(_,i)=>i).find(i=>!c.bot.inventory.slots[36+i]);assert.notEqual(empty,undefined,'fixture needs an empty unprotected hotbar slot');c.bot.setQuickBarSlot(empty);}
  const found=candidates.find(i=>hand!=='off-hand'||i.slot!==36+c.bot.quickBarSlot)||candidates[0];await c.bot.equip(found,hand);}
 if(hand==='hand')c.bot._client.write('held_item_slot',{slotId:c.bot.quickBarSlot});await sleep(200);
}
const state=async c=>json(await rcon('professionqa state '+c.name));
const refill=async c=>rcon('professionqa mana '+c.name);
async function monster(tag,x=1700.5,z=1702.5,health=100,type='husk'){await rcon(`minecraft:summon minecraft:${type} ${x.toFixed(2)} 150 ${z.toFixed(2)} {Tags:["qa_skill_mob","${tag}"],NoAI:1b,PersistenceRequired:1b,Health:${health}f,Attributes:[{Name:"minecraft:generic.max_health",Base:${health}d},{Name:"minecraft:generic.knockback_resistance",Base:1.0d}]}`);await sleep(150);}
try{
 if(mode==='pre'){
  const sword=await join('SkillSword92'),guard=await join('SkillOther92'),observer=await join('SkillScout92');
  await rcon('minecraft:kill @e[tag=qa_skill_mob]');await tp(guard);await tp(observer,1712.5);
  await result(guard,'/mycli profession choose warrior');await result(observer,'/mycli profession choose warrior');
  await equip(guard,'iron_sword');await equip(guard,'shield','off-hand');
  await monster('qa_raid92',1700.5,1702.5,100,'pillager');
  check('native raider joins a real ongoing Raid object',json(await rcon('professionqa raidcreate qa_raid92 910292')).raid===910292);
  await guard.bot.lookAt(new Vec3(1700.5,151.5,1702.5),true);await sleep(200);
  const enemy=Object.values(guard.bot.entities).find(e=>e.name==='pillager');assert.ok(enemy);
  for(let n=0;n<3;n++){guard.bot.attack(enemy);await sleep(1000);}await ask(guard,'/mycli skills mine','MC_SKILL_ASSESSMENT ');
  const raid=Object.values(ledger().raids)[0];
  check('actual player attacks create persisted raid contribution',raid?.participants?.[ids[guard.name]]?.damage>=10,raid);
  const rules=JSON.parse(readFileSync(root+'/stage-skill-unlocks.yml.json','utf8'));const changed=structuredClone(rules);changed.unlocks.village_oath.skills=['healer_beacon'];
  writeFileSync(stage+'/plugins/AgentFriend/skill-unlocks.yml',JSON.stringify(changed));await rcon('mycli admin professions reload');
  guard.bot.quit('verify offline event reward');await sleep(250);await rcon('professionqa raidfinish VICTORY');
  check('confirmed victory grants frozen reward to offline contributor',ledger().players[ids[guard.name]].unlocked.guardian_oath&&!ledger().players[ids[guard.name]].unlocked.healer_beacon);
  check('mere observer receives no event skill',!ledger().players[ids[observer.name]].unlocked.guardian_oath);
  const receipt=ledger().players[ids[guard.name]].unlocked.guardian_oath.receipt;await rcon('professionqa raidfinish VICTORY');await rcon('mycli admin professions recover');
  check('repeated raid outcome never duplicates the skill grant',ledger().players[ids[guard.name]].unlocked.guardian_oath.receipt===receipt);
  writeFileSync(stage+'/plugins/AgentFriend/skill-unlocks.yml',JSON.stringify(rules));await rcon('mycli admin professions reload');
  await tp(sword);await equip(sword,'iron_sword');await equip(sword,'diamond_sword','off-hand');await rcon('minecraft:kill @e[tag=qa_skill_mob]');await monster('qa_combo_interrupt');
  await sword.bot.lookAt(new Vec3(1700.5,151.5,1702.5),true);await refill(sword);const before=await state(sword);await result(sword,'/mycli cast twin_legacy');
  // Actual teleport event interrupts the remaining phases; the first strike remains paid.
  await tp(sword,1708.5);await sleep(2100);const after=await state(sword),mob=json(await rcon('professionqa mob qa_combo_interrupt'));
  check('teleport interrupts later phases without refunding an already active legacy',100-mob.health>0&&100-mob.health<8&&Math.abs(before.mana-after.mana-14)<.5,{before,after,mob});
  await tp(sword);await ask(sword,'/mycli guild accept tm_sword_road_trial','已接公会委托');
  const skills=JSON.parse(readFileSync(root+'/stage-skills.yml.json','utf8'));skills.skills.sword_thrust['cooldown-seconds']=600;
  writeFileSync(stage+'/plugins/AgentFriend/skills.yml',JSON.stringify(skills));await rcon('mycli admin professions reload');await refill(sword);await sword.bot.lookAt(new Vec3(1700.5,151.5,1702.5),true);await result(sword,'/mycli cast sword_thrust');
  const deadline=ledger().players[ids[sword.name]].cooldowns.sword_thrust;
  await result(sword,'/mycli profession choose priest');await result(sword,'/mycli profession choose warrior');
  check('profession switching does not reset persistent cooldown',ledger().players[ids[sword.name]].cooldowns.sword_thrust===deadline);
  await result(sword,'/mycli cast sword_thrust','cooldown');
  writeFileSync(root+'/restart-expectations.json',JSON.stringify({deadline,learned:ledger().players[ids[sword.name]].learned,uniqueOwners:ledger().uniqueOwners,raidReceipt:receipt}));
 }else if(mode==='post'){
  const expected=JSON.parse(readFileSync(root+'/restart-expectations.json','utf8'));const sword=await join('SkillSword92'),eye=await join('SkillEye92');
  await rcon('minecraft:gamemode spectator '+eye.name);await rcon('minecraft:spectate '+sword.name+' '+eye.name);await sleep(1200);
  check('ledger and selected skills load after a normal restart',json(await rcon('mycli admin professions audit')).ready&&JSON.stringify(ledger().players[ids[sword.name]].learned)===JSON.stringify(expected.learned));
  await equip(sword,'iron_sword');report.equipment={quickBarSlot:sword.bot.quickBarSlot,heldItem:sword.bot.heldItem?.name,serverItem:await rcon('minecraft:data get entity '+sword.name+' SelectedItem'),serverSlot:await rcon('minecraft:data get entity '+sword.name+' SelectedItemSlot')};
  await result(sword,'/cast sword_thrust','cooldown');check('cooldown deadline survives normal restart exactly',ledger().players[ids[sword.name]].cooldowns.sword_thrust===expected.deadline);
  check('global unique owner survives restart',JSON.stringify(ledger().uniqueOwners)===JSON.stringify(expected.uniqueOwners));
  const lines=await ask(sword,'/mycli guild engineering tm_sword_road_trial','MC_MARKET_DETAIL');
  check('in-flight task preserves accepted multi-step definition after restart',sword.packets.some(p=>p.type==='MC_MARKET_DETAIL'&&p.currentStep===1&&p.steps.length===2));
  await rcon('professionqa floor '+sword.name+' 3 2');await ask(sword,'/mycli guild claim','阶段已交付');
  await rcon('professionqa floor '+sword.name+' 5 2');await ask(sword,'/mycli guild claim','委托交付成功');
  check('existing verified dungeon-floor adapter can complete resumed profession contract',sword.lines.some(s=>s.includes('委托交付成功')));
  await ask(sword,'/mycli skills mine','MC_SKILL_ASSESSMENT ');await sleep(400);
  check('Eye remains attached and receives private post-restart skills',eye.lines.some(s=>s.startsWith('MC_SKILL ')));
  check('both legacy status channels keep schemaVersion 1 and their old fields',sword.packets.some(p=>p.channel==='mcagent:state'&&p.schemaVersion===1&&p.abilities&&p.mana)&&sword.packets.some(p=>p.channel==='mcviewer:state'&&p.schemaVersion===1&&p.abilities));
 }else if(mode==='corrupt'){
  const raw=readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8'),sword=await join('SkillSword92');
  check('invalid ledger disables only new profession writes',!json(await rcon('mycli admin professions audit')).ready);
  await result(sword,'/mycli profession choose warrior','data_unavailable');await result(sword,'/cast sword_thrust','data_unavailable');
  await ask(sword,'/mycli spells explain starbolt','MC_SPELL_DETAIL ');await ask(sword,'/mycli status','MC_DUNGEON ');await sleep(1000);
  check('old commands and legacy state channel remain usable with bad new ledger',sword.packets.some(p=>p.channel==='mcagent:state'&&p.schemaVersion===1&&p.mana&&p.abilities)&&sword.lines.some(s=>s.startsWith('MC_SPELL_DETAIL ')&&json(s).id==='starbolt'));
  check('invalid ledger bytes are preserved rather than overwritten',readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')===raw);
 }else if(mode==='load'){
  // Restore the one-second stage fixture after the deliberate restart cooldown test.
  writeFileSync(stage+'/plugins/AgentFriend/skills.yml',readFileSync(root+'/stage-skills.yml.json','utf8'));await rcon('mycli admin professions reload');
  await rcon('minecraft:kill @e[tag=qa_skill_mob]');
  const agents=[];for(let i=0;i<16;i++)agents.push(await join('SkillLoad92_'+String(i).padStart(2,'0')));
  const eye=await join('SkillEye92');await rcon('minecraft:gamemode spectator '+eye.name);await rcon('minecraft:spectate '+agents[0].name+' '+eye.name);
  for(let i=0;i<16;i++){
   const c=agents[i],x=1700.5+(i%8)*8,z=1712.5+Math.floor(i/8)*12;await rcon('minecraft:gamemode survival '+c.name);await tp(c,x,z);
   c.role=['warrior','mage','priest'][i%3];c.cast=c.role==='warrior'?'sword_thrust':c.role==='mage'?'mage_bolt':'healer_mend '+c.name;
   await result(c,'/mycli profession choose '+c.role);if(c.role==='warrior')await equip(c,'iron_sword');await c.bot.lookAt(new Vec3(x,151.5,z+2.5),true);if(c.role!=='priest')await monster('qa_load_'+i,x,z+2.5,200);
  }
  await sleep(3000);const chunks=json(await rcon('professionqa chunks')),baseline=await rcon('mspt');const started=Date.now();
  for(let wave=0;wave<3;wave++)await Promise.all(agents.map(async c=>{await refill(c);if(c.role==='priest')await rcon('professionqa health '+c.name+' 8');await result(c,'/mycli cast '+c.cast);await ask(c,'/mycli profession status','MC_PROFESSION ');}));
  await sleep(6000);const ending=json(await rcon('professionqa chunks'));report.load={agents:16,eyes:1,professions:{warrior:6,mage:5,priest:5},casts:48,queries:48,elapsedMs:Date.now()-started,before:chunks,after:ending,baselineMspt:baseline,mspt:await rcon('mspt')};
  check('16 independent agents each receive successful paid skill receipts',agents.every(c=>c.lines.filter(s=>s.startsWith('MC_PROFESSION_RESULT ')&&json(s).action==='cast'&&json(s).success).length===3));
  check('controlled warm-area concurrent skill workload generates no new chunks',ending.generated===chunks.generated,{chunks,ending});
  check('all 17 clients stay connected throughout the bounded workload',clients.every(c=>c.ends===0));
  const tickText=report.load.mspt.replace(/§[0-9A-FK-OR]/gi,''),tickAverage=Number(tickText.match(/◴\s*([\d.]+)/)?.[1]);
  check('server remains below 50 ms average tick after workload',Number.isFinite(tickAverage)&&tickAverage<50,report.load.mspt);
 }else throw Error('mode must be pre/post/load/corrupt');
 report.passed=true;
}catch(error){report.error=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();const stamp=new Date().toISOString().replaceAll(':','-');for(const dest of [root,'F:/MC-backups/repairs/profession-skills-20261008'])writeFileSync(dest+'/operations-'+mode+'-'+stamp+'.json',JSON.stringify(report,null,2));for(const c of clients)try{c.bot.quit('isolated operations checks complete');}catch{}await sleep(400);}
