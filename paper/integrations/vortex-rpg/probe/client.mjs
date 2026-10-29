// A real unmodified Mineflayer protocol client, not an LLM performance benchmark.
import {createRequire}from'node:module';import fs from'node:fs/promises';import readline from'node:readline';import assert from'node:assert/strict';
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json'),mineflayer=require('mineflayer');
const [output,mode,username='ag_VortexQA']=process.argv.slice(2);if(!output?.startsWith('E:\\MC\\staging\\vortex-mmo-20261027\\')&&!output?.startsWith('E:/MC/staging/vortex-mmo-20261027/'))throw Error('isolated output only');
if(!/^ag_VortexQA\d{0,3}$/.test(username))throw Error('fixture account only');
const report={checks:[],errors:[],messages:[],nativeProtocol:'1.21.1',clientMods:[],cold:mode==='cold'};let id=0;const acks=new Map();
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);acks.get(m.ack)?.();acks.delete(m.ack);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const check=(label,test)=>{assert.ok(test,label);report.checks.push(label);};
const fixture=async command=>{command=command.replaceAll('ag_VortexQA ',username+' ');const key=++id;const ack=new Promise(r=>acks.set(key,r));process.stdout.write('QA_COMMAND '+JSON.stringify({id:key,command})+'\n');await ack;await sleep(450);};
const options={host:'127.0.0.1',port:25926,version:'1.21.1',auth:'offline',checkTimeoutInterval:60000};
const bot=mineflayer.createBot({...options,username}),peer=mineflayer.createBot({...options,username:'ag_VortexPeer'+username.slice(10)});const peerMessages=[];
bot.on('error',e=>report.errors.push(String(e)));bot.on('kicked',e=>report.errors.push('kicked:'+JSON.stringify(e)));bot.on('messagestr',text=>report.messages.push(text));peer.on('messagestr',text=>peerMessages.push(text));peer.on('error',e=>report.errors.push('peer:'+e.message));
async function spawn(b){await Promise.race([new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);}),sleep(25000).then(()=>{throw Error('spawn timeout');})]);}
let lastCommand=0;
async function cmd(text){text=text.replace('/mycli rpg class','/mycli profession').replace('/mycli rpg skills','/mycli skills').replace('/mycli rpg quests','/mycli tasks').replace('/mycli rpg shop','/mycli trade').replace('/mycli rpg town','/mycli waypoint').replace('/mycli rpg cast','/mycli cast').replace('/mycli rpg status','/mycli status');await sleep(Math.max(0,1100-(Date.now()-lastCommand)));let start=report.messages.length;bot.chat(text+' --json');lastCommand=Date.now();for(let n=0;n<60;n++){await sleep(100);const found=report.messages.slice(start).find(s=>s.startsWith('MC_RPG '));if(found)return JSON.parse(found.slice(7));}throw Error('reply timeout: '+text);}
const count=name=>bot.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0);
try{
 await Promise.all([spawn(bot),spawn(peer)]);await sleep(2500);let state;
 for(let i=0;i<20;i++){state=await cmd('/mycli rpg status');if(state.authority)break;await sleep(300);}
 check('native profile loaded',state.authority==='VortexRPG');check('vanilla protocol direct join',bot.entity.position.y>-100);
 if(mode==='cold'){
  check('class survived normal restart',state.class==='knight');check('earned level survived restart',state.level>=2);
  check('traded inventory persisted',count('bread')>=8&&count('emerald')===9);
  const q=await cmd('/mycli rpg quests status');check('quest completion survived restart',q.completed.includes('qd_first_hunt'));
  const before=state.xp;const claim=await cmd('/mycli rpg quests claim qd_first_hunt');check('duplicate reward still rejected after restart',claim.success===false);check('no duplicate XP after restart',(await cmd('/mycli rpg status')).xp===before);
 }else{
  check('read-only status does not choose class',state.class==='none');const info=await cmd('/mycli rpg class info knight');check('class info read-only',info.queryOnly&&info.id==='knight');
  const help=await cmd('/mycli rpg class choose knight --help');check('help does not choose class',help.queryOnly&&(await cmd('/mycli rpg status')).class==='none');
  const classes=await cmd('/mycli rpg class list');check('six native classes exposed',classes.classes.length===6);
  const chosen=await cmd('/mycli rpg class choose knight');check('class API completed and saved',chosen.success&&chosen.saved);await sleep(400);
  state=await cmd('/mycli rpg status');check('actual class selected',state.class==='knight');const weapons=count('iron_sword');check('native starter equipment received',weapons>=1);
  const again=await cmd('/mycli rpg class choose knight');check('same class choice idempotent',again.success&&count('iron_sword')===weapons);
  check('cannot silently replace existing class',(await cmd('/mycli rpg class choose mage')).success===false);
  const skills=await cmd('/mycli rpg skills list');check('native spell available',skills.available.includes('fortify'));
  const before=await cmd('/mycli rpg status');const cast=await cmd('/mycli rpg cast fortify');check('native Fortify executed',cast.success===true);
  const after=await cmd('/mycli rpg status');check('cast charged the same mana shown in HUD',after.mana<before.mana);
  const duplicate=await cmd('/mycli rpg cast fortify');check('cooldown rejected duplicate cast',duplicate.success===false);check('cooldown failure does not spend more mana',(await cmd('/mycli rpg status')).mana>=after.mana);
  const qi=await cmd('/mycli rpg quests info qd_first_hunt');check('quest info read-only',qi.queryOnly);let qs=await cmd('/mycli rpg quests status');check('reading quest did not accept it',!qs.quests.qd_first_hunt);
  check('accept saved native quest',(await cmd('/mycli rpg quests accept qd_first_hunt')).success);
  const pre=await cmd('/mycli rpg status');check('incomplete quest cannot be claimed',(await cmd('/mycli rpg quests claim qd_first_hunt')).success===false);check('no reward for incomplete task',(await cmd('/mycli rpg status')).xp===pre.xp);
  await fixture('tp ag_VortexQA 0 -60 0');await fixture('give ag_VortexQA minecraft:emerald 10');
  const quoted=await cmd('/mycli rpg shop info quartermaster');check('shop offers use standard emerald currency',quoted.currency==='emerald');const coins=count('emerald');const bread=count('bread');
  const tradePacket=new Promise(resolve=>bot._client.once('trade_list',resolve));await cmd('/mycli rpg shop open quartermaster');const packet=await tradePacket;await sleep(300);check('standard merchant window opened',bot.currentWindow?.type==='minecraft:merchant');check('opening does not charge money',count('emerald')===coins);
  const Item=require('prismarine-item')(bot.registry),window=bot.currentWindow;
  // Same standard trade packet normalization as Mineflayer's MIT villager plugin.
  window.trades=packet.trades.map(t=>({...t,inputItem1:Item.fromNotch(t.inputItem1),outputItem:Item.fromNotch(t.outputItem),hasItem2:false,realPrice:Item.fromNotch(t.inputItem1).count}));
  await bot.trade(window,0,1);await sleep(400);bot.closeWindow(window);await sleep(300);
  check('actual trade consumes exactly one emerald',count('emerald')===coins-1);check('actual trade grants eight bread',count('bread')===bread+8);check('trade cursor empty',bot.inventory.selectedItem==null);
  await fixture('summon minecraft:zombie 2 -60 0 {NoAI:1b,PersistenceRequired:1b,Health:6f,Attributes:[{Name:"minecraft:generic.max_health",Base:6d}],Tags:["qd_vortex_qa"]}');
  await fixture('summon minecraft:zombie 2 -60 1 {NoAI:1b,PersistenceRequired:1b,Health:6f,Attributes:[{Name:"minecraft:generic.max_health",Base:6d}],Tags:["qd_vortex_qa"]}');
  const sword=bot.inventory.items().find(i=>i.name==='iron_sword');await bot.equip(sword,'hand');
  for(let rounds=0;rounds<8;rounds++){const targets=Object.values(bot.entities).filter(e=>e.name==='zombie'&&e.position.distanceTo(bot.entity.position)<3.2);if(!targets.length)break;await bot.lookAt(targets[0].position.offset(0,1,0));bot.attack(targets[0]);await sleep(700);}
  qs=await cmd('/mycli rpg quests status');check('real attacks progressed kill objective',qs.quests.qd_first_hunt.objectives[0].current===2);
  const xp0=(await cmd('/mycli rpg status')).xp;check('completed quest claimed',(await cmd('/mycli rpg quests claim qd_first_hunt')).success);await sleep(250);
  const xp1=(await cmd('/mycli rpg status')).xp;check('native quest XP awarded once',xp1===xp0+180);check('immediate duplicate claim rejected',(await cmd('/mycli rpg quests claim qd_first_hunt')).success===false);check('duplicate claim awards no XP',(await cmd('/mycli rpg status')).xp===xp1);
  await cmd('/mycli rpg quests accept qd_city_scout');await fixture('tp ag_VortexQA 0 -60 0');bot.setControlState('forward',true);await sleep(450);bot.clearControlStates();qs=await cmd('/mycli rpg quests status');check('same world alone is not exploration proof',qs.quests.qd_city_scout.objectives[0].current===0);
  await fixture('tp ag_VortexQA 12 -60 12');bot.setControlState('forward',true);await sleep(400);bot.clearControlStates();await sleep(300);qs=await cmd('/mycli rpg quests status');check('reaching the configured coordinates progresses exploration',qs.quests.qd_city_scout.objectives[0].current===1);
  check('private tool output not broadcast',!peerMessages.some(s=>s.startsWith('MC_RPG ')));
  report.legalPhaseEndedAt=new Date().toISOString();await fixture('tp ag_VortexQA 0 -60 0');await sleep(2200);
  // Deliberate illegal movement is confined to this fresh marked QA server.
  // It proves enforcement; no username-based exemption is granted to this bot.
  bot.physicsEnabled=false;const origin=bot.entity.position.clone();
  for(let n=1;n<=90;n++){bot._client.write('position',{x:origin.x,y:origin.y+n*.32,z:origin.z,onGround:false});await sleep(50);}
  report.illegalAttempt={from:origin.toArray(),requestedY:origin.y+90*.32,observedY:bot.entity.position.y};
  await fixture('tp ag_VortexQA 0 -60 0');bot.physicsEnabled=true;
 }
 check('client remains connected',bot._client.state==='play');
}catch(error){report.errors.push(error.stack||String(error));}
finally{bot.clearControlStates();bot.quit('isolated Vortex test complete');peer.quit('isolated witness complete');await sleep(800);await fs.writeFile(output,JSON.stringify(report,null,2));process.stdout.write(JSON.stringify({checks:report.checks.length,errors:report.errors.length})+'\n');process.exit(report.errors.length?1:0);}
