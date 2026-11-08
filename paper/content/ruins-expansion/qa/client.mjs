// Real ordinary Mineflayer client, no server command or packet emulation for play.
// Console calls below are explicitly QA setup / authoritative measurement only.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
const [root,dependencies,selected]=process.argv.slice(2);
const mcVersion=process.env.QA_MC_VERSION??'1.21.1';
const mode=process.argv[5]??'adventure';
if(!['normal','adventure','apocalypse'].includes(mode))throw Error('invalid QA difficulty');
if(!root||!dependencies)throw Error('usage: node client.mjs <QA-root> <dependency-package.json> [site-id]');
const coreRoot=process.env.QA_CORE_ROOT;
if(coreRoot)await import(pathToFileURL(path.join(coreRoot,'dist/runtime/core/dependency-patches.js')).href);
const coreFixes=coreRoot?await import(pathToFileURL(path.join(coreRoot,'dist/runtime/core/mineflayer-fixes.js')).href):null;
if(await fs.readFile(path.join(root,'server/.qa-only'),'utf8')!=='QD_RUINS_EXPANSION_20261108')throw Error('QA marker missing');
const properties=await fs.readFile(path.join(root,'server/server.properties'),'utf8');
if(!/^server-ip=127\.0\.0\.1$/m.test(properties)||!/^server-port=40081$/m.test(properties))throw Error('QA loopback binding required');
const require=createRequire(path.resolve(dependencies)),mineflayer=require('mineflayer');
const navigation=createRequire(path.resolve(process.env.QA_NAV_PACKAGE??dependencies));
const {pathfinder,Movements,goals}=navigation('mineflayer-pathfinder');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rc(text){
 const password=properties.match(/^rcon\.password=(.*)$/m)?.[1].trim();
 const packet=(id,type,body)=>{const payload=Buffer.from(body),b=Buffer.alloc(payload.length+14);b.writeInt32LE(b.length-4);b.writeInt32LE(id,4);b.writeInt32LE(type,8);payload.copy(b,12);return b;};
 return new Promise((resolve,reject)=>{
  const socket=net.connect(40085,'127.0.0.1');let buffer=Buffer.alloc(0),answer='',authed=false,settle;
  const finish=error=>{clearTimeout(timer);clearTimeout(settle);socket.destroy();error?reject(error):resolve(answer);};
  const timer=setTimeout(()=>finish(Error('QA RCON timeout; query original action, never replay')),60000);
  socket.on('error',finish);socket.on('connect',()=>socket.write(packet(1,3,password)));
  socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const n=buffer.readInt32LE();if(n<10||n>16777216)return finish(Error('bad frame'));if(buffer.length<n+4)break;const id=buffer.readInt32LE(4),type=buffer.readInt32LE(8),body=buffer.subarray(12,n+2).toString();buffer=buffer.subarray(n+4);if(id===-1)return finish(Error('auth failed'));if(!authed&&id===1&&type===2){authed=true;socket.write(packet(2,2,text));}else if(authed&&id===2){answer+=body;clearTimeout(settle);settle=setTimeout(()=>finish(),80);}}});
 });
}
const report={schemaVersion:1,startedAt:new Date().toISOString(),qaOnly:true,ordinaryClient:true,balanceTest:false,setup:'synthetic account, console-provided armour and Sharpness XX test sword; real health/AI/loot definitions unchanged',sites:[],checks:[],failures:[]};
report.clientBackend='mineflayer';report.unmodifiedDependencies=!coreRoot;report.coreCompatibility=coreRoot?JSON.parse(await fs.readFile(path.join(coreRoot,'package.json'),'utf8')).version:null;
const protocolRequire=createRequire(require.resolve('mineflayer'));
report.dependencies={mineflayer:require('mineflayer/package.json').version,protocol:protocolRequire('minecraft-protocol/package.json').version,pathfinder:navigation('mineflayer-pathfinder/package.json').version};
const output=path.join(root,'client-'+(selected??'all')+'-'+Date.now()+'-result.json');report.difficulty=mode;
async function save(){await fs.writeFile(output,JSON.stringify(report,null,2));}
function check(name,ok,data){report.checks.push({name,ok:!!ok,data});if(!ok)throw Error(name+': '+JSON.stringify(data));}
async function until(fn,label,ms=20000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(bot?.lastError)throw Error('client disconnected during '+label+': '+bot.lastError);const result=await fn();if(result)return result;await sleep(150);}throw Error('timeout: '+label);}
let bot;const bots=[];let lastCommandAt=0;
const originalConsoleError=console.error,originalConsoleLog=console.log;
function observeParser(args){const message=args.map(String).join(' ');if(!message.startsWith('{')&&/PartialReadError|Read error for|Failed to deserialize/.test(message)){report.parserError??=message.slice(0,1200);if(bot)bot.lastError='protocol parser error: '+message.slice(0,300);}}
console.error=(...args)=>{observeParser(args);originalConsoleError(...args);};
console.log=(...args)=>{observeParser(args);originalConsoleLog(...args);};
async function login(username){
 const b=mineflayer.createBot({host:'127.0.0.1',port:40081,username,version:mcVersion,auth:'offline',hideErrors:false});report.minecraftVersion=mcVersion;b.loadPlugin(pathfinder);b.messages=[];b.on('messagestr',text=>b.messages.push(text));b.on('error',error=>{b.lastError=String(error);});b.on('kicked',reason=>{b.lastError=JSON.stringify(reason);});bots.push(b);
 if(coreFixes)b.loadPlugin(body=>coreFixes.installMineflayerFixes(body,{info:message=>{(report.coreMessages??=[]).push(message);},warn:message=>{(report.coreWarnings??=[]).push(message);},error:message=>{body.lastError=String(message);},debug(){}}));
 b._client.on('error',error=>{b.lastError=String(error);});b.skillEvents=[];
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:event')try{b.skillEvents.push(JSON.parse(p.data.toString('utf8')));}catch{b.lastError='invalid skill event JSON';}});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('login timeout '+b.lastError)),30000);b.once('spawn',()=>{clearTimeout(timer);resolve();});b.once('end',()=>{clearTimeout(timer);reject(Error('disconnected '+b.lastError));});});
 await sleep(1200);const movements=new Movements(b);movements.canDig=false;movements.allow1by1towers=false;movements.allowParkour=false;movements.canOpenDoors=true;movements.allowFreeMotion=false;b.pathfinder.setMovements(movements);b.pathfinder.thinkTimeout=8000;return b;
}
async function command(text,prefix='MC_SITE_DUNGEON_RESULT'){
 // Keep vanilla's spam gate intact. Polling is an observation, not an excuse to
 // send seven commands per second or to raise the server's packet/chat limits.
 await sleep(Math.max(0,1200-(Date.now()-lastCommandAt)));lastCommandAt=Date.now();
 const start=bot.messages.length;bot.chat(text);
 return until(()=>{const message=bot.messages.slice(start).find(m=>m.startsWith(prefix+' '));return message?JSON.parse(message.slice(prefix.length+1)):null;},text,15000);
}
async function status(id){return command('/mycli dungeon status '+id+' --json','MC_SITE_DUNGEON_STATE');}
function stopPath(){bot.pathfinder.stop();bot.pathfinder.setGoal(null);bot.clearControlStates();}
async function readStash(){
 await sleep(Math.max(0,1200-(Date.now()-lastCommandAt)));lastCommandAt=Date.now();
 const start=bot.messages.length;bot.chat('/mycli arena stash');
 let window;try{window=await until(()=>bot.currentWindow,'personal stash window',12000);}catch(error){throw Error(String(error)+' messages: '+bot.messages.slice(start).join(' | '));}
 check('real personal double chest window',window.inventoryStart===54,{type:window.type,inventoryStart:window.inventoryStart});
 await sleep(500);
 const items=window.slots.slice(0,window.inventoryStart).filter(Boolean).map(i=>({slot:i.slot,name:i.name,count:i.count}));
 const totals={};for(const i of items)totals[i.name]=(totals[i.name]??0)+i.count;
 bot.closeWindow(window);await sleep(150);return {items,totals};
}
async function walk(point,label){
 const start=bot.entity.position.clone();let timer;
 try{await Promise.race([bot.pathfinder.goto(new goals.GoalNear(point[0],point[1],point[2],1)),new Promise((_,reject)=>{timer=setTimeout(()=>{stopPath();reject(Error('walk timeout '+label));},45000);})]);}
 finally{clearTimeout(timer);bot.clearControlStates();}
 const end=bot.entity.position;check('walk arrived '+label,end.distanceTo(start)>0&&Math.abs(end.x-point[0])<3&&Math.abs(end.y-point[1])<2&&Math.abs(end.z-point[2])<3,{from:start,to:end,target:point});
}
async function fight(id,stage){
 const before=(await status(id)).stage;const deadline=Date.now()+120000;let hits=0,focus=null,lastCast=0;
 while(Date.now()<deadline){
  const state=await status(id);if(!state.active||state.stage!==before)return {hits,state};if(state.fault)throw Error('real dungeon fault '+JSON.stringify(state));
  const rows=JSON.parse((await rc('qruins mobs')).trim()).mobs;
  if(!rows.length){await sleep(500);continue;}
  // Focus one real living UUID; changing to the nearest witch every tick lets
  // all of them heal back to full without ever finishing the intended target.
  const target=rows.find(m=>m.uuid===focus)??rows.sort((a,b)=>bot.entity.position.distanceTo({x:a.position[0],y:a.position[1],z:a.position[2]})-bot.entity.position.distanceTo({x:b.position[0],y:b.position[1],z:b.position[2]}))[0];focus=target.uuid;
  let entity=bot.entities[target.id];if(!entity){await sleep(300);continue;}
  if(entity.position.distanceTo(bot.entity.position)>3.1&&entity.name==='blaze'){
   const bow=bot.inventory.items().find(i=>i.name==='bow');if(!bow)throw Error('ranged equipment missing');
   await bot.equip(bow,'hand');const d=entity.position.distanceTo(bot.entity.position),drop=.025*(d/3)**2;
   await bot.lookAt(entity.position.offset(0,(entity.height??1.8)*.65+drop,0),true);bot.activateItem();await sleep(1100);bot.deactivateItem();await sleep(500);hits++;continue;
  }
  if(entity.position.distanceTo(bot.entity.position)>2.7){
   try{await Promise.race([bot.pathfinder.goto(new goals.GoalNear(entity.position.x,entity.position.y,entity.position.z,2)),sleep(6000).then(()=>{throw Error('combat approach timeout');})]);}
   catch(error){stopPath();throw Error('unreachable enemy '+JSON.stringify(target)+' '+String(error));}
  }
  entity=bot.entities[target.id];if(!entity)continue;
  const sword=bot.inventory.items().find(i=>i.name==='netherite_sword');if(sword&&bot.heldItem?.type!==sword.type)await bot.equip(sword,'hand');
  if(entity.name==='witch'&&Date.now()-lastCast>8500){await sleep(Math.max(0,1200-(Date.now()-lastCommandAt)));lastCommandAt=Date.now();bot.chat('/mycli cast starbolt');lastCast=Date.now();await sleep(300);}
  await bot.lookAt(entity.position.offset(0,Math.min(1,entity.height??1),0),true);
  if(entity.position.distanceTo(bot.entity.position)<=3.1){bot.attack(entity);hits++;}
  await sleep(650);
 }
 throw Error('combat timeout '+id+' '+stage);
}
try{
 bot=await login(process.env.QA_PLAYER??'RuinQA');const setup=JSON.parse((await rc('qruins setup '+bot.username)).trim());check('bounded QA setup completed',setup.success,setup);
 // Stash dispatch uses the installed trial-tower runtime. Construct its real QA
 // fixture instead of merely setting dungeon-built=true on an empty world.
 const qaConfig=await fs.readFile(path.join(root,'server/plugins/AgentFriend/config.yml'),'utf8');
 if(!/^dungeon-built: true$/m.test(qaConfig)){
  if(!/^arena-built: true$/m.test(qaConfig))report.arenaFixture=await rc('mycli admin buildarena');
  report.trialFixture=await rc('mycli admin builddungeon');
 }
 await rc('minecraft:give '+bot.username+' minecraft:bow[minecraft:enchantments={levels:{"minecraft:power":10}}]');await rc('minecraft:give '+bot.username+' minecraft:arrow 128');await sleep(600);
 check('ordinary player has no OP',!JSON.parse((await rc('qruins state '+bot.username)).trim()).op);
 const manifest=JSON.parse(await fs.readFile(path.join(root,'server/ruins-content/manifest.json'),'utf8'));
 const sites=selected&&selected!=='all'?manifest.sites.filter(s=>s.id===selected):manifest.sites;
 const audit=await rc('mycli admin dungeons audit');report.busyOnStart=[...audit.matchAll(/id=([a-z0-9_]+) rooms=\d+ active=true/g)].map(m=>m[1]);
 sites.sort((a,b)=>Number(report.busyOnStart.includes(a.id))-Number(report.busyOnStart.includes(b.id)));
 check('requested sites really exist',sites.length>0);
 for(const site of sites){
  const row={id:site.id,rooms:[],startedAt:new Date().toISOString()};report.sites.push(row);
  try{
   await rc('qruins heal '+bot.username);
   const info=await command('/mycli dungeon info '+site.id+' --json','MC_SITE_DUNGEON_INFO');check('real catalogue '+site.id,info.rooms?.length===3,info);
   const prior=await status(site.id);
   if(prior.active&&prior.participant){row.resumedOriginalRun=prior;check('original accepted run reconciled after disconnect '+site.id,prior.stage>=1&&prior.stage<=3&&!prior.fault,prior);}
   else{
    row.travel=await command('/mycli dungeon travel '+site.id+' --json');check('ordinary travel '+site.id,row.travel.success,row.travel);
    await sleep(1500);check('actual entry position '+site.id,bot.entity.position.distanceTo({x:site.centres[0][0]+.5,y:site.centres[0][1],z:site.centres[0][2]+.5})<3,bot.entity.position);
    row.start=await command('/mycli dungeon start '+site.id+' '+mode+' --json');check('ordinary start '+site.id,row.start.success,row.start);
   }
   await until(async()=>{const s=await status(site.id);if(s.fault)throw Error('spawn fault '+s.fault);return s.phase==='fighting';},'first real wave',22000);
   for(let i=prior.active&&prior.participant?prior.stage-1:0;i<3;i++){
    if(i&&(!row.resumedOriginalRun||i!==prior.stage-1)){await rc('qruins heal '+bot.username);await walk(site.centres[i],site.id+' room '+(i+1));}
    await until(async()=>{const s=await status(site.id);if(s.fault)throw Error('spawn fault '+s.fault);return s.phase==='fighting';},'real wave '+(i+1),15000);
    await sleep(1300);const mobs=JSON.parse((await rc('qruins mobs')).trim()).mobs;
    check('AI and target '+site.id+' '+i,mobs.length>0&&mobs.every(m=>m.ai&&m.target===bot.player.uuid),mobs);
    const weapons={SKELETON:'BOW',STRAY:'BOW',PILLAGER:'CROSSBOW',VINDICATOR:'IRON_AXE',DROWNED:'TRIDENT',WITHER_SKELETON:'STONE_SWORD'};
    check('real equipped weapons '+site.id+' '+i,mobs.every(m=>!weapons[m.type]||m.hand===weapons[m.type]),mobs);
    row.rooms.push({stage:i+1,mobs});
    await sleep(3300);row.rooms.at(-1).observedAI=JSON.parse((await rc('qruins mobs')).trim()).mobs;
    row.rooms.at(-1).combat=await fight(site.id,i+1);await save();
   }
   const completed=await until(async()=>{const s=await status(site.id);return !s.active?s:null;},'completion ledger');
   check('real pending reward '+site.id,completed.pendingRewards?.includes(site.id),completed);row.completed=completed;
   await rc('qruins mana '+bot.username);const beforeStash=await readStash();
   row.claim=await command('/mycli dungeon claim '+site.id+' --json');check('atomic claim '+site.id,row.claim.success,row.claim);
   const afterStash=await readStash();const reward=completed.pendingRewardDetails.find(r=>r.id===site.id);
   row.stash={before:beforeStash,after:afterStash,expected:reward};
   for(const [item,count] of [['emerald',reward.emeralds],[reward.item.toLowerCase(),reward.count]])check('actual reward stack '+site.id+' '+item,(afterStash.totals[item]??0)-(beforeStash.totals[item]??0)===count,{before:beforeStash.totals[item]??0,after:afterStash.totals[item]??0,expectedIncrease:count});
   row.duplicate=await command('/mycli dungeon claim '+site.id+' --json');check('no duplicate reward '+site.id,!row.duplicate.success,row.duplicate);
   row.passed=true;
  }catch(error){row.passed=false;row.error=String(error.stack??error);report.failures.push({id:site.id,error:row.error});stopPath();const current=await status(site.id).catch(()=>null);row.finalState=current;if(current?.active&&current.participant)row.leave=await command('/mycli dungeon leave --json').catch(()=>null);}
  await save();console.log(JSON.stringify({id:site.id,passed:row.passed,error:row.error?.slice(0,300)}));if(bot.lastError)break;
 }
 report.finalPlayer=JSON.parse((await rc('qruins state '+bot.username)).trim());report.passed=report.failures.length===0;
}finally{report.endedAt=new Date().toISOString();report.messages=bot?.messages.slice(-160);report.skillEvents=bot?.skillEvents;if(report.parserError)report.passed=false;await save();for(const b of bots)b.quit();console.error=originalConsoleError;console.log=originalConsoleLog;}
if(!report.passed)process.exitCode=1;
