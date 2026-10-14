// Exercises actual server handlers with ordinary native clients in the loopback QA copy.
// Fixtures prepare resources and combat; these checks are not autonomous LLM results.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/life-challenges-20261014/paper';
const output='E:/MC/ops/repairs/cli-contract-20261014';
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25678\r?$/m);assert.match(props,/^rcon.port=25679\r?$/m);assert.match(props,/^motd=Life challenges isolated check\r?$/m);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const {Vec3}=req('vec3');
const report={at:new Date().toISOString(),mode:process.argv[2]??'initial',checks:[],errors:[],fixtures:[],samples:{},sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.39.jar')).digest('hex')};
const bots=[];let closing=false;
const rc=async q=>{const answer=await command(q,15000,{port:25679,properties:stage+'/server.properties'});report.fixtures.push({q,answer});return answer;};
const qa=async q=>assert.match(await rc('lifeqa '+q),/LIFE_QA_OK/);
const check=(name,ok)=>{report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);};
async function until(fn,label,ms=18000){const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(100);}throw Error('Timeout '+label);}
async function join(username){
 await rc('minecraft:whitelist add '+username);
 const b=req('mineflayer').createBot({host:'127.0.0.1',port:25678,username,auth:'offline',version:'1.20.6',checkTimeoutInterval:60000});bots.push(b);installRecipePacketBypass(b._client);b.lines=[];b.camera=[];b.inventoryPackets=[];
 b._client.on('window_items',packet=>{b.inventoryPackets.push({at:Date.now(),packet});if(b.inventoryPackets.length>30)b.inventoryPackets.shift();});
 b.on('messagestr',s=>b.lines.push(s));b._client.on('camera',p=>b.camera.push(p.cameraId));
 b.on('error',e=>{if(!closing&&!b.expectedClose)report.errors.push(username+': '+e.message);});b.on('kicked',e=>{if(!closing&&!b.expectedClose)report.errors.push(username+': '+JSON.stringify(e));});
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),username+' world',45000);return b;
}
async function chat(b,q){await sleep(Math.max(0,1150-(Date.now()-(b.lastChat??0))));b.lastChat=Date.now();b.chat(q);}
const responses=(b,at=0)=>b.lines.slice(at).filter(l=>l.startsWith('MC_CHALLENGE ')).map(l=>JSON.parse(l.slice(13)));
async function cli(b,q,predicate=()=>true){const at=b.lines.length;await chat(b,'/mycli challenge '+q);return await until(()=>responses(b,at).find(predicate),q);}
const status=b=>cli(b,'status',o=>o.type==='status'||o.status==='denied');
async function reached(b,steps){return await until(async()=>{const s=await status(b);return s.completedSteps===steps&&s.durable?s:false;},'recorded '+steps,25000);}
async function tp(b,x,y,z){await rc('minecraft:tp '+b.username+' '+x+' '+y+' '+z);await until(()=>b.entity.position.distanceTo(new Vec3(x,y,z))<1.1,'teleport');await sleep(350);}
const amount=(b,name)=>b.inventory.items().filter(i=>i.name===name).reduce((s,i)=>s+i.count,0);
async function close(b){if(b.currentWindow)b.closeWindow(b.currentWindow);await sleep(500);}
async function bag(b){await chat(b,'/minepacks:backpack open');await until(()=>b.currentWindow&&b.currentWindow.inventoryStart===54,'Minepacks window');await sleep(150);return b.currentWindow;}
async function shift(b,slot){assert(slot>=0);await b.clickWindow(slot,0,1);await sleep(400);}
async function handoff(from,to,material,count){
 const origin=from.entity.position.clone();await from.lookAt(to.entity.position.offset(0,1,0),true);await sleep(250);
 await from.toss(from.registry.itemsByName[material].id,null,count);await tp(from,2009.5,101,2006.5);await sleep(450);
 if(amount(to,material)<count){const item=await until(()=>Object.values(to.entities).find(e=>e.name==='item'&&e.position.distanceTo(origin)<6),'visible handoff item');await tp(to,item.position.x,101,item.position.z);}
 await until(()=>amount(to,material)>=count,'actual recipient pickup');
}
async function setup(b,x){await rc('minecraft:gamemode survival '+b.username);await rc('minecraft:effect give '+b.username+' minecraft:resistance 99999 4 true');await rc('lp user '+b.username+' permission set backpack.use true');await rc('lp user '+b.username+' permission set backpack.size.6 true');await tp(b,x,101,2002.5);}
function record(id){return JSON.parse(fs.readFileSync(stage+'/plugins/AgentFriend/challenge-runs/'+id+'.json','utf8'));}
try{
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.39');}catch{return false;}},'isolated server ready',90000);
 check('candidate enabled',(await rc('version AgentFriend')).includes('0.4.39'));
 const a=await join('ag_LifeA'),b=await join('ag_LifeB'),c=await join('ag_LifeC'),other=await join('LifeVisitor'),eye=await join('ag_LifeA_eye');
 await until(()=>eye.game.gameMode==='spectator'&&eye.camera.at(-1)===a.entity.id,'actual paired Eye',25000);check('real Eye follows participating account',true);
 if(report.mode==='resume'){
  const prior=JSON.parse(fs.readFileSync(output+'/resume-expectations.json','utf8'));
  for(const id of prior.completed){const s=await cli(a,'result '+id,o=>o.runId===id);check('completed record survives restart '+id,s.success&&s.durable);}
  const stopped=await cli(a,'result '+prior.active,o=>o.runId===prior.active);check('active attempt explicitly interrupted by maintenance',stopped.state==='interrupted'&&stopped.reason==='server_stopped'&&stopped.completedSteps===0);
  const before=fs.readFileSync(stage+'/plugins/AgentFriend/challenge-runs/'+prior.active+'.json','utf8');await status(a);check('status does not resume or rewrite interrupted attempt',before===fs.readFileSync(stage+'/plugins/AgentFriend/challenge-runs/'+prior.active+'.json','utf8'));
  check('foreign record remains private',(await cli(other,'result '+prior.completed[0]+' --json')).reason==='record_unavailable');
 }else{
  await qa('reset');await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule naturalRegeneration false');
  await rc('minecraft:forceload add 1998 1998 2012 2008');await rc('minecraft:fill 1998 100 1998 2012 100 2008 stone');await rc('minecraft:fill 1998 101 1998 2012 109 2008 air');
  await rc('minecraft:kill @e[type=minecraft:item,x=2005,y=101,z=2003,distance=..14]');
  for(const [i,bot] of [a,b,c,other].entries())await setup(bot,2001.5+i*3);
  for(const bot of [a,b,c]){await cli(bot,'cancel');await close(bot);}
  // Repeated QA runs retain old evidence, but empty only the dedicated fixture accounts' bags.
  for(const bot of [a,b,c]){let w=await bag(bot);for(let slot=0;slot<54;slot++)if(w.slots[slot])await shift(bot,slot);await close(bot);await rc('minecraft:clear '+bot.username);}
  await rc('minecraft:give '+a.username+' minecraft:cobblestone 32');await sleep(300);
  let at=a.lines.length;const catalog=await cli(a,'list',o=>o.type==='catalog');await sleep(250);check('three tasks in one concise catalogue reply',catalog.items.length===3&&responses(a,at).filter(o=>o.type==='catalog').length===1);
  const archiveCount=fs.readdirSync(stage+'/plugins/AgentFriend/challenge-runs').filter(x=>x.endsWith('.json')).length;
  await cli(a,'info backpack_roundtrip',o=>o.type==='detail');await chat(a,'/mycli progress challenge 1');await sleep(250);
  check('discovery and progress create no attempt',fs.readdirSync(stage+'/plugins/AgentFriend/challenge-runs').filter(x=>x.endsWith('.json')).length===archiveCount);
  at=other.lines.length;await chat(other,'/mycli challenge list');await sleep(400);check('human receives Chinese without machine JSON',other.lines.slice(at).some(l=>l.includes('生活挑战'))&&!other.lines.slice(at).some(l=>l.startsWith('MC_CHALLENGE ')));
  await chat(other,'/mycli world menu');await until(()=>other.currentWindow,'world menu');check('native world menu discovers challenges',other.currentWindow.slots[24]?.name==='writable_book');await other.clickWindow(24,0,0);await until(()=>other.currentWindow&&JSON.stringify(other.currentWindow.title).includes('生活能力'),'challenge menu');await close(other);
  const outsiderAt=other.lines.length,eyeAt=eye.lines.length;
  let s=await cli(a,'start backpack_roundtrip',o=>o.type==='status');const bagRun=s.runId;check('start only prepares without beginning timer',s.state==='forming'&&s.startedAt===0);
  check('write receipt declares start and its side effect',s.trigger==='start'&&s.readOnly===false);
  const readState=await status(a);check('status receipt is explicitly read-only',readState.trigger==='status'&&readState.readOnly===true);
  check('repeated start is same attempt',(await cli(a,'start backpack_roundtrip',o=>o.type==='status')).runId===bagRun);
  await cli(a,'begin',o=>o.state==='running');
  let w=await bag(a);await reached(a,1);let slot=w.slots.findIndex((i,n)=>n>=54&&i?.name==='cobblestone');
  await shift(a,slot);await close(a);s=await reached(a,2);check('deposit is an intermediate server state',!s.success&&s.nextStep==='bag_reopen'&&amount(a,'cobblestone')===0);
  w=await bag(a);await reached(a,3);slot=w.slots.findIndex((i,n)=>n<54&&i?.name==='cobblestone');await shift(a,slot);await close(a);s=await reached(a,4);
  check('real Minepacks cycle succeeds and keeps exact items',s.success&&amount(a,'cobblestone')===32&&!a.inventory.selectedItem);
  report.samples.backpack=record(bagRun);check('evidence records empty cursor and conserved totals',report.samples.backpack.events.filter(e=>e.type.startsWith('bag_')).every(e=>e.detail.cursorEmpty)&&new Set(report.samples.backpack.events.filter(e=>e.type.startsWith('bag_')).map(e=>e.detail.totalHash)).size===1);
  check('outsider does not see private challenge progress',!other.lines.slice(outsiderAt).some(l=>l.includes('行囊有序')||l.startsWith('MC_CHALLENGE')));
  check('Eye gets readable feedback without machine receipts',eye.lines.slice(eyeAt).some(l=>l.includes('行囊有序'))&&!eye.lines.slice(eyeAt).some(l=>l.startsWith('MC_CHALLENGE')));
  check('foreign run cannot be read',(await cli(b,'result '+bagRun)).reason==='record_unavailable');
  await cli(a,'start backpack_roundtrip',o=>o.type==='status');await cli(a,'begin',o=>o.state==='running');w=await bag(a);await reached(a,1);await close(a);check('old completion does not pass a fresh run',(await status(a)).completedSteps===1);await cli(a,'cancel',o=>o.state==='cancelled');
  // A three-role native chain. Only the fixtures supply one standing log; clients must harvest/craft/transfer.
  for(const bot of [a,b,c]){await rc('minecraft:clear '+bot.username+' minecraft:oak_log');await rc('minecraft:clear '+bot.username+' minecraft:oak_planks');}
  await tp(a,2001.5,101,2002.5);await tp(b,2007.5,101,2002.5);await tp(c,2010.5,101,2002.5);
  s=await cli(a,'start supply_chain',o=>o.type==='status');const supplyRun=s.runId;
  await cli(b,'join '+supplyRun+' maker',o=>o.type==='status');await cli(c,'join '+supplyRun+' receiver',o=>o.type==='status');await cli(a,'begin',o=>o.state==='running');
  await rc('minecraft:setblock 2001 101 2001 minecraft:oak_log');await until(()=>a.blockAt(new Vec3(2001,101,2001))?.name==='oak_log','log loaded');
  await a.dig(a.blockAt(new Vec3(2001,101,2001)));await tp(a,2001.5,101,2001.5);await until(()=>amount(a,'oak_log')>=1,'gathered log');await reached(a,1);
  await tp(b,2003,101,2001.5);await handoff(a,b,'oak_log',1);await reached(a,2);
  const recipe=b.recipesFor(b.registry.itemsByName.oak_planks.id,null,1,null)[0];assert(recipe);await b.craft(recipe,1,null);await reached(a,3);
  // Server proof can arrive before the final inventory packet. Observe; never replay the craft.
  report.samples.craftClientInitial={logs:amount(b,'oak_log'),planks:amount(b,'oak_planks'),cursor:b.inventory.selectedItem};
  const craftSettled=()=>amount(b,'oak_log')===0&&amount(b,'oak_planks')===4&&!b.inventory.selectedItem;
  try{await until(craftSettled,'craft inventory packets settle',5000);}catch{
   const refreshAt=Date.now();await chat(b,'/mycli inventory refresh');
   const native=await until(()=>b.inventoryPackets.find(p=>p.at>=refreshAt&&p.packet.windowId===0),'fresh native inventory');
   const Item=req('prismarine-item')(b.registry),cursor=Item.fromNotch(native.packet.carriedItem),items=native.packet.items.map(Item.fromNotch);
   report.samples.craftServerRefresh={stateId:native.packet.stateId,cursor:cursor&&{name:cursor.name,count:cursor.count},items:items.map((item,slot)=>item&&{slot,name:item.name,count:item.count}).filter(Boolean)};
   // A craft may have produced items on the server cursor while its last put-away
   // was rejected. Only after a fresh server snapshot proves that exact state do
   // we perform ONE new put-away click. Never repeat the recipe or a stale click.
   if(cursor?.name==='oak_planks'&&cursor.count===4&&!items.some(i=>i?.name==='oak_log'||i?.name==='oak_planks')){
    const destination=items.findIndex((item,slot)=>slot>=9&&slot<45&&!item);assert(destination>=0,'safe empty destination');
    assert.equal(b.inventory.selectedItem?.name,'oak_planks');assert.equal(b.inventory.selectedItem?.count,4);
    report.fixtures.push({action:'put_away_confirmed_server_cursor_once',destination,recipeReplayed:false});await b.clickWindow(destination,0,0);
   }
   await until(craftSettled,'craft server inventory refresh',5000);
  }
  check('native craft consumed one log and produced four planks',craftSettled());
  await tp(c,2004.5,101,2001.5);await handoff(b,c,'oak_planks',4);await reached(a,4);
  await rc('minecraft:setblock 2004 101 2000 minecraft:chest');await until(()=>c.blockAt(new Vec3(2004,101,2000))?.name==='chest','chest');const chest=await c.openContainer(c.blockAt(new Vec3(2004,101,2000)));await chest.deposit(c.registry.itemsByName.oak_planks.id,null,4);await close(c);s=await reached(a,5);
  check('three-role supply completes from actual actions',s.success&&amount(c,'oak_planks')===0);report.samples.supply=record(supplyRun);
  check('three distinct contributors retained',new Set(report.samples.supply.events.filter(e=>e.type.endsWith('handoff')||e.type==='wood_gathered').map(e=>e.actorUuid)).size===3);
  // Rescue is genuine ten-second native proximity. Combat completion is a labeled controlled fixture.
  s=await cli(a,'start party_rescue',o=>o.type==='status');const rescueRun=s.runId;await cli(b,'join '+rescueRun+' partner',o=>o.type==='status');await cli(a,'begin',o=>o.state==='running');
  await tp(a,-593.5,91,-312.5);await tp(b,-592.5,91,-312.5);await chat(a,'/mycli arena difficulty normal');await chat(a,'/mycli arena start');
  await until(async()=>(await rc('mycli admin dungeonaudit')).includes('MC_DUNGEON_MOB floor=1'),'trial starts',25000);await rc('minecraft:execute as @e[tag=afu_dungeon_mob] run data merge entity @s {NoAI:1b}');await sleep(500);
  let pos=a.entity.position.clone();await tp(b,pos.x+2,pos.y,pos.z);await rc('minecraft:damage '+b.username+' 1000 minecraft:generic_kill');
  await until(()=>b.health===1,'downed');await cli(b,'status',o=>o.runId===rescueRun);check('downed participant can still query challenge',true);
  await reached(a,1);check('real proximity revival restores partner',b.health===10);await qa('clear');s=await reached(a,2);check('same-room clear completes rescue challenge',s.success);report.samples.rescue=record(rescueRun);await qa('reset');
  // A disconnect records interruption instead of replaying operations.
  await tp(a,2001.5,101,2002.5);await cli(a,'start backpack_roundtrip',o=>o.type==='status');await cli(a,'begin',o=>o.state==='running');const interrupted=(await status(a)).runId;
  eye.expectedClose=true;a.quit('controlled disconnect');await sleep(700);check('disconnect preserves explicit failure reason',record(interrupted).reason==='participant_disconnected');
  const again=await join('ag_LifeA');check('reconnect does not auto-restart or auto-pass',(await status(again)).state==='interrupted');
  // Leave a forming attempt for a real normal-stop/restart check.
  s=await cli(again,'start backpack_roundtrip',o=>o.type==='status');fs.writeFileSync(output+'/resume-expectations.json',JSON.stringify({completed:[bagRun,supplyRun,rescueRun],active:s.runId}));
  closing=true;await rc('stop');await sleep(1000);
 }
 check('no unexpected protocol errors',report.errors.length===0);report.passed=true;
}catch(error){report.failure=String(error.stack);process.exitCode=1;}
finally{
 closing=true;for(const bot of bots)try{bot.quit('isolated challenge QA complete');}catch{}
 await sleep(300);report.clients=bots.map(b=>({name:b.username,messages:b.lines.slice(-25)}));
 const file=output+'/stage-'+report.mode+'-'+Date.now()+'.json';fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,failure:report.failure,errors:report.errors,file}));process.exit(process.exitCode??0);
}
