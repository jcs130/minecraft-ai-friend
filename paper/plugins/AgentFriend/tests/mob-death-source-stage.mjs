// Run only against a disposable loopback fixture. Record the server packet and the Agent decoder separately.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as wait} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const stage = process.env.MOB_DEATH_STAGE;
assert.equal((await readFile(stage+'/.mob-death-qa','utf8')).trim(),'SYNTHETIC_MOB_DEATH_ONLY');
const properties = stage+'/server.properties';
const config = (await readFile(properties,'utf8')).split(/\r?\n/);
for (const line of ['server-ip=127.0.0.1','server-port=26986','rcon.port=26987']) assert(config.includes(line));
const rc = text => command(text,12000,{port:26987,properties});
const {createBot} = createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const {MOB_DEATH_CHANNEL, observeMobDeaths, ownKillCredit, fatalDamageText} =
  await import(pathToFileURL(process.env.MOB_DEATH_DECODER).href);
const checks=[], receipts=[], bots=[];
const check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('PASS',name);};
async function until(fn,name,ms=12000) {
  for (const end=Date.now()+ms;Date.now()<end;){const value=fn();if(value)return value;await wait(80);}
  throw Error('Timed out: '+name);
}
async function join(username,subscribe) {
  const bot=createBot({host:'127.0.0.1',port:26986,username,version:'1.21.1',auth:'offline',hideErrors:true});
  bots.push(bot);bot.frames=[];bot.lines=[];bot.on('error',()=>{});
  installRecipePacketBypass(bot._client);
  bot.on('messagestr',line=>{if(line.startsWith('MC_MOB_DEATH '))bot.lines.push(JSON.parse(line.slice(13)));});
  await until(()=>bot.entity?.position&&bot.player?.uuid,username,45000);
  if(subscribe)observeMobDeaths(bot,event=>bot.frames.push(event));
  return bot;
}
const selector='@e[type=minecraft:zombie,tag=fd_subject,limit=1]';
async function mob(watcher,tag,x,health=1,extra='') {
  const previous=new Set(Object.values(watcher.entities).map(e=>e.uuid));
  const position=x+' 100 219';
  const result=await rc('minecraft:summon minecraft:zombie '+position+' {Tags:["fd_subject","'+tag+'"],NoAI:1b,Silent:1b,PersistenceRequired:1b,Health:'+health+'f,CustomName:\'{"text":"'+tag+'"}\''+extra+'}');
  assert.match(result,/Summoned|召唤|生成/i);
  return until(()=>Object.values(watcher.entities).find(e=>e.name==='zombie'&&e.isValid&&!previous.has(e.uuid)&&Math.abs(e.position.x-x)<1&&e.position.distanceTo(watcher.entity.position)<15),'fresh native zombie');
}
async function seen(observer,subject) {
  const receipt=await until(()=>observer.frames.find(f=>f.victim.uuid===subject.uuid),'death of '+subject.uuid);
  receipts.push(receipt);
  check('exact victim UUID, runtime ID and observation time for '+receipt.victim.name,receipt.victim.entityId===subject.id&&receipt.occurredAt>0);
  return receipt;
}
const before = await readFile(stage+'/qa-pairs.json','utf8');
try {
  await writeFile(stage+'/qa-pairs.json',JSON.stringify({schemaVersion:1,pairs:[{agent:'ag_QaDeath',eye:'QaDeathEye'}]}));
  await rc('minecraft:forceload add 208 208 232 232');
  await rc('minecraft:fill 208 99 208 231 99 229 minecraft:stone');
  await rc('minecraft:fill 208 100 208 231 104 229 minecraft:air');
  await rc('minecraft:difficulty normal');
  await rc('minecraft:gamerule doDaylightCycle false');
  await rc('minecraft:time set midnight');
  await rc('minecraft:kill @e[tag=fd_subject]');
  await rc('minecraft:kill @e[tag=fd_source]');
  await rc('minecraft:kill @e[tag=fd_arrow]');
  const shooter=await join('QaDeathShooter',true), witness=await join('QaDeathWitness',true), legacy=await join('ag_QaDeath',false);
  for(const [b,x,z] of [[shooter,215,219],[witness,215,217],[legacy,215,216]]){
    await rc('minecraft:gamemode survival '+b.username);
    await rc('minecraft:tp '+b.username+' '+x+' 100 '+z);
    await until(()=>Math.abs(b.entity.position.x-x)<1.5,b.username+' arrived');
  }
  await rc('minecraft:item replace entity '+shooter.username+' weapon.mainhand with minecraft:diamond_sword');
  await wait(2800);
  const first=await mob(shooter,'FD_Melee',217);
  await shooter.lookAt(first.position.offset(0,1,0),true);shooter.attack(first);
  const melee=await seen(witness,first);
  check('native melee names player for both damage roles',melee.damageType==='minecraft:player_attack'&&melee.causingEntity?.uuid===shooter.player.uuid&&melee.directEntity?.uuid===shooter.player.uuid&&!melee.indirect);
  check('owner and witness have different kill credit',ownKillCredit(shooter,melee)===true&&ownKillCredit(witness,melee)===false);
  check('private fallback and binary receipt share one event ID',(await until(()=>legacy.lines.find(f=>f.victim.uuid===first.uuid),'legacy chat')).eventId===melee.eventId);
  check('subscribed client receives no duplicate chat fallback',witness.lines.length===0);
  const second=await mob(shooter,'FD_Bow',222);
  await rc('minecraft:item replace entity '+shooter.username+' weapon.mainhand with minecraft:bow');
  await rc('minecraft:give '+shooter.username+' minecraft:arrow 8');
  await until(()=>shooter.heldItem?.name==='bow'&&shooter.inventory.items().some(i=>i.name==='arrow'),'bow equipped');
  await shooter.lookAt(second.position.offset(0,1.25,0),true);shooter.activateItem();await wait(1200);shooter.deactivateItem();
  const arrow=await seen(witness,second);
  check('real arrow retains shooter, projectile type and distinct UUID',arrow.damageType==='minecraft:arrow'&&arrow.causingEntity?.name===shooter.username
    &&arrow.causingEntity.uuid===shooter.player.uuid&&arrow.directEntity?.type==='minecraft:arrow'&&arrow.directEntity.uuid!==shooter.player.uuid&&arrow.indirect);
  check('agent-readable sentence names the shooter and arrow',fatalDamageText(arrow).includes(shooter.username)&&fatalDamageText(arrow).includes('箭'));
  const third=await mob(shooter,'FD_Fall',217,15);
  await rc('minecraft:damage '+selector+' 1 minecraft:player_attack by '+shooter.username);await wait(900);
  await rc('minecraft:damage '+selector+' 100 minecraft:fall');
  const fall=await seen(witness,third);
  check('environmental final damage gives no credit to the earlier player',fall.damageType==='minecraft:fall'&&fall.causingEntity===null&&fall.directEntity===null&&ownKillCredit(shooter,fall)===false);
  await rc('minecraft:summon minecraft:skeleton 220 100 219 {Tags:["fd_source"],NoAI:1b,Silent:1b,CustomName:\'{"text":"QA Archer"}\'}');
  await rc('minecraft:summon minecraft:arrow 219 99 219 {Tags:["fd_arrow"],NoGravity:1b}');
  const fourth=await mob(shooter,'FD_Skeleton',217,5);
  await rc('minecraft:damage '+selector+' 100 minecraft:arrow by @e[tag=fd_arrow,limit=1] from @e[tag=fd_source,limit=1]');
  const sk=await seen(witness,fourth);
  check('skeleton damage source names the mob and arrow separately',sk.causingEntity?.type==='minecraft:skeleton'&&sk.causingEntity.name==='QA Archer'&&sk.directEntity?.type==='minecraft:arrow');
  const saved=await mob(shooter,'FD_Totem',217,10,',HandItems:[{},{id:"minecraft:totem_of_undying",count:1}]');
  await rc('minecraft:damage '+selector+' 40 minecraft:player_attack by '+shooter.username);await wait(900);
  const hp=await rc('minecraft:data get entity '+selector+' Health');
  check('survived fatal-looking hit emits no death receipt',Number.parseFloat(hp.trim().match(/([0-9.]+)f$/)?.[1])>0&&!witness.frames.some(f=>f.victim.uuid===saved.uuid));
  await rc('minecraft:kill '+selector);await wait(700);
  await rc('minecraft:tp '+witness.username+' 1000 105 1000');await until(()=>witness.entity.position.x>900,'witness left');
  const remote=await mob(shooter,'FD_Remote',217,4);
  await rc('minecraft:damage '+selector+' 50 minecraft:fall');
  await seen(shooter,remote);await wait(450);
  check('untracked remote witness receives no report',!witness.frames.some(f=>f.victim.uuid===remote.uuid));
  check('one event per recorded death',new Set(receipts.map(f=>f.eventId)).size===receipts.length);
} finally {
  for(const bot of bots)bot.quit();
  await writeFile(stage+'/qa-pairs.json',before);
  if(process.env.MOB_DEATH_REPORT)await writeFile(process.env.MOB_DEATH_REPORT,JSON.stringify({checks,receipts,syntheticOnly:true},null,2));
}
