// Isolated Paper 1.20.6 only. Never run fixture commands against production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync} from 'node:fs';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require = createRequire('E:/MC/probe/package.json');
fix1206PotionProtocol(require);
const mineflayer = require('mineflayer');
const stage = 'E:/MC/staging/life-buildings-20261003';
const repair = 'E:/MC/ops/repairs/village-support-20261006';
const rcon = text => command(text, 12000, {port:25587, properties:stage+'/server.properties'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
const report = {passed:false, results:[], startedAt:new Date().toISOString()};
const until = async (predicate, label, timeout=15000) => {
  const end = Date.now()+timeout;
  while (Date.now()<end) { if(predicate()) return; await sleep(100); }
  throw new Error(label+' timed out');
};
async function join(name) {
  const bot = mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});
  const c = {bot,name,messages:[],village:[],states:[],packets:[],whispers:[]}; clients.push(c);
  bot.on('messagestr', line => c.messages.push(line));
  bot.on('whisper', (from,message) => c.whispers.push({from,message}));
  bot._client.on('packet',(packet,meta) => {
    if(meta.name==='custom_payload') {
      if(packet.channel==='mcagent:village') c.village.push(JSON.parse(packet.data.toString()));
      if(packet.channel==='mcagent:state') c.states.push(JSON.parse(packet.data.toString()));
    }
    if(/title|sound|particle/.test(meta.name)) c.packets.push(meta.name);
  });
  await new Promise((resolve,reject) => {bot.once('spawn',resolve);bot.once('kicked',reject);bot.once('error',reject);});
  await until(()=>c.states.at(-1)?.mana, name+' mana state');
  return c;
}
const mana = c => c.states.at(-1).mana.current;
const status = async c => {
  const n=c.village.length; c.bot.chat('/mycli village threat');
  await until(()=>c.village.slice(n).some(e=>e.kind==='status'),'fresh status');
  return c.village.slice(n).findLast(e=>e.kind==='status');
};
async function support(c,text,reason) {
  const n=c.village.length, before=mana(c), pos=c.bot.entity.position.clone();
  const titles=c.packets.filter(p=>p.includes('title')).length;
  c.bot.chat(text);
  await until(()=>c.village.slice(n).some(e=>e.kind==='support'),'support receipt');
  const receipt=c.village.slice(n).findLast(e=>e.kind==='support');
  assert.equal(receipt.reason,reason);
  if(!receipt.success) {
    assert.equal(receipt.spentMana,0);
    assert.ok(mana(c)>=before-.01,'failed cast consumed mana');
    assert.ok(c.bot.entity.position.distanceTo(pos)<1,'failed cast moved player');
    assert.equal(c.packets.filter(p=>p.includes('title')).length,titles,'failed cast played success title');
  }
  report.results.push({test:reason,player:c.name,manaBefore:before,manaAfter:mana(c),receipt});
  return receipt;
}
let rules={};
try {
  assert.match(await rcon('version AgentFriend'),/0\.3\.85/);
  for(const key of ['doMobSpawning','naturalRegeneration']) {
    const answer=await rcon('minecraft:gamerule '+key);
    rules[key]=/true\s*$/.test(answer.trim());
    await rcon('minecraft:gamerule '+key+' false');
  }
  const suffix=Date.now().toString(36).slice(-5);
  const agentName='VWAgent'+suffix, humanName='VWHuman'+suffix, eyeName='VWEye'+suffix;
  writeFileSync(stage+'/agent-eye-pairs.json',JSON.stringify({schemaVersion:1,pairs:[{agent:agentName,eye:eyeName}]}));
  const a=await join(agentName), human=await join(humanName), eye=await join(eyeName);
  await rcon('minecraft:fill -668 79 -468 -632 79 -432 minecraft:stone');
  await rcon('minecraft:fill -668 80 -468 -632 85 -432 minecraft:air');
  for(const c of [a,human]) {
    await rcon('minecraft:gamemode survival '+c.name);
    await rcon(`minecraft:tp ${c.name} -654.5 80 -438.5`);
  }
  await rcon('minecraft:gamemode spectator '+eye.name);
  await rcon(`minecraft:tp ${eye.name} ${a.name}`);
  await rcon(`minecraft:spectate ${a.name} ${eye.name}`);
  await rcon('minecraft:kill @e[tag=vw85]');
  await sleep(2200);
  assert.equal((await status(a)).active,false,'fixture baseline already had a threat');
  const alertBase=a.whispers.length;
  await rcon('minecraft:summon minecraft:pillager -650 4 -450 {Tags:["vw85"],NoAI:1b,NoGravity:1b}');
  await sleep(5500);
  assert.equal((await status(a)).active,false,'underground structure mob triggered a patrol');
  assert.equal(a.whispers.slice(alertBase).filter(w=>w.message.startsWith('MC_VILLAGE_ALERT ')).length,0);
  report.results.push({test:'underground_no_alarm',passed:true});
  await rcon('minecraft:kill @e[tag=vw85]');
  await rcon('minecraft:summon minecraft:pillager -650 80 -450 {Tags:["vw85"],NoAI:1b,NoGravity:1b}');
  await sleep(1200); await rcon('minecraft:kill @e[tag=vw85]'); await sleep(4200);
  assert.equal(a.whispers.slice(alertBase).filter(w=>w.message.startsWith('MC_VILLAGE_ALERT ')).length,0,'transient entity woke Agent');
  report.results.push({test:'transient_no_alarm',passed:true});
  await rcon('minecraft:summon minecraft:pillager -650 80 -450 {Tags:["vw85"],NoAI:1b,NoGravity:1b,Health:8f}');
  await until(()=>a.whispers.slice(alertBase).some(w=>w.message.startsWith('MC_VILLAGE_ALERT ')),'confirmed urgent alert');
  const wake=a.whispers.findLast(w=>w.message.startsWith('MC_VILLAGE_ALERT '));
  assert.ok(wake.message.length<=256);
  const state=await status(a), oldId=state.eventId;
  assert.equal(state.supportAvailable,true); assert.ok(state.enemies[0].uuid);
  assert.equal(JSON.parse(wake.message.slice(17)).cmd,state.supportCommand);
  assert.ok(human.messages.some(line=>line.includes('[支援传送]')));
  assert.equal(human.whispers.some(w=>w.message.startsWith('MC_VILLAGE_ALERT ')),false,'human received Agent wake');
  const packetStart=a.packets.length, manaBefore=mana(a);
  const arrived=await support(a,state.supportCommand,'arrived');
  assert.equal(arrived.spentMana,8);
  await until(()=>a.messages.some(line=>line.startsWith('MC_TRAVEL id=support mana=8')),'travel receipt');
  await until(()=>mana(a)<=manaBefore-7.5,'actual mana charge');
  const enemy=a.bot.nearestEntity(e=>e.name==='pillager');
  assert.ok(enemy,'live enemy visible after teleport');
  assert.ok(enemy.position.distanceTo(a.bot.entity.position)>=5 && enemy.position.distanceTo(a.bot.entity.position)<=12);
  assert.equal(arrived.enemy.uuid,enemy.uuid);
  const agentLanding=a.bot.entity.position.clone();
  assert.ok(a.packets.slice(packetStart).some(p=>p.includes('title')));
  assert.ok(a.packets.slice(packetStart).some(p=>p.includes('particle')));
  assert.ok(a.packets.slice(packetStart).some(p=>p.includes('sound')));
  assert.ok(a.states.at(-1).abilities.some(e=>e.id==='mycli:support'&&e.cooldownRemainingMs>0));
  await support(a,state.supportCommand,'cooldown');
  await support(human,'/mycli village support ffffffffffff','stale_event');
  await rcon(`minecraft:damage ${human.name} ${human.bot.health-4} minecraft:generic`);
  await until(()=>human.bot.health<6,'low health fixture');
  await support(human,state.supportCommand,'low_health');
  await rcon(`minecraft:effect give ${human.name} minecraft:instant_health 1 5`);
  await until(()=>human.bot.health>=6,'heal fixture');
  for(const c of [a,human]) await rcon(`minecraft:tp ${c.name} -654.5 80 -435.5`);
  await rcon('minecraft:fill -662 80 -462 -638 85 -438 minecraft:stone');
  await rcon('minecraft:fill -650 80 -450 -650 82 -450 minecraft:air');
  await support(human,state.supportCommand,'no_safe_landing');
  await rcon('minecraft:fill -662 80 -462 -638 85 -438 minecraft:air');
  await rcon(`minecraft:tp ${human.name} -654.5 80 -438.5`);
  await rcon(`minecraft:tp ${a.name} ${agentLanding.x} ${agentLanding.y} ${agentLanding.z}`);
  await sleep(250);
  // Controller menu path uses the same server method and resource check.
  human.bot.chat('/mycli menu');
  await until(()=>human.bot.currentWindow,'root compass menu');
  const firstWindow=human.bot.currentWindow.id;
  await human.bot.clickWindow(16,0,0);
  await until(()=>human.bot.currentWindow&&human.bot.currentWindow.id!==firstWindow,'places menu');
  const menuStart=human.village.length;
  await human.bot.clickWindow(23,0,0);
  await until(()=>human.village.slice(menuStart).some(e=>e.kind==='support'&&e.success),'controller menu support');
  assert.ok(human.bot.entity.position.distanceTo(a.bot.entity.position)>1.5,'responders landed on each other');
  report.results.push({test:'menu_support',receipt:human.village.slice(menuStart).findLast(e=>e.kind==='support')});
  await rcon(`minecraft:give ${human.name} minecraft:iron_sword 1`);
  await until(()=>human.bot.inventory.items().some(i=>i.name==='iron_sword'),'real combat sword');
  await human.bot.equip(human.bot.inventory.items().find(i=>i.name==='iron_sword'),'hand');
  const combatTarget=human.bot.nearestEntity(e=>e.name==='pillager');
  assert.ok(combatTarget,'combat target visible');
  const walkDeadline=Date.now()+6000;
  while(combatTarget.position.distanceTo(human.bot.entity.position)>2.7 && Date.now()<walkDeadline) {
    await human.bot.lookAt(combatTarget.position.offset(0,1,0),true);
    human.bot.setControlState('forward',true); await sleep(100);
  }
  human.bot.clearControlStates();
  assert.ok(combatTarget.position.distanceTo(human.bot.entity.position)<=2.8,'walk from safe landing to melee range');
  for(let i=0;i<6&&!human.village.some(e=>e.kind==='defense');i++) {human.bot.attack(combatTarget);await sleep(800);}
  await until(()=>human.village.some(e=>e.kind==='defense'&&e.rewardedToday),'actual player combat reward');
  report.results.push({test:'real_combat_kill',receipt:human.village.findLast(e=>e.kind==='defense')});
  await support(a,state.supportCommand,'no_live_enemy');
  await sleep(22000);
  await rcon('minecraft:summon minecraft:pillager -650 80 -450 {Tags:["vw85"],NoAI:1b,NoGravity:1b,Health:8f}');
  await until(()=>a.whispers.slice(alertBase).filter(w=>w.message.startsWith('MC_VILLAGE_ALERT ')).length===2,'new confirmed incident');
  const fresh=await status(a); assert.notEqual(fresh.eventId,oldId);
  a.bot.chat('/mycli explain cast.support');
  await until(()=>a.messages.some(line=>line.includes('"id":"cast.support"')),'cast support discovery');
  a.bot.chat('/mycli spells explain support');
  await until(()=>a.messages.some(line=>line.startsWith('MC_SPELL_DETAIL ')&&line.includes('"id":"support"')),'support guide');
  assert.match(await rcon('mycli admin villageaudit'),/MC_VILLAGE_AUDIT/);
  await support(a,'/mycli village support '+oldId,'stale_event');
  // Deplete mana through existing charged travel; no debug plugin or OP bypass.
  a.bot.chat('/mycli cast home'); await sleep(1700);
  if(mana(a)>=8) { a.bot.chat('/mycli goto arena'); await sleep(1700); }
  assert.ok(mana(a)<8,'mana fixture insufficient');
  await support(a,fresh.supportCommand,'insufficient_mana');
  assert.equal(a.whispers.slice(alertBase).filter(w=>w.message.startsWith('MC_VILLAGE_ALERT ')).length,2,'same incident repeated wake');
  report.passed=true;
} catch(error) {
  report.error=String(error.stack??error);
  report.clients=clients.map(c=>({name:c.name,mana:mana(c),position:c.bot.entity?.position,
    messages:c.messages.slice(-12),village:c.village.slice(-8)}));
  process.exitCode=1;
} finally {
  try { await rcon('minecraft:kill @e[tag=vw85]'); } catch {}
  for(const [key,value] of Object.entries(rules)) try {await rcon('minecraft:gamerule '+key+' '+value);}catch{}
  for(const c of clients) c.bot.quit();
  report.finishedAt=new Date().toISOString();
  writeFileSync(repair+'/stage-test.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,tests:report.results.map(r=>r.test),error:report.error}));
}
