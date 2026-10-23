// Real native-window/item tests, restricted to an explicitly marked loopback copy.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';

const stage=process.env.MC_PUBLIC_STAGE, output=process.env.MC_PUBLIC_REPORT;
assert(stage&&output,'Set MC_PUBLIC_STAGE and MC_PUBLIC_REPORT for a disposable isolated copy');
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert(fs.existsSync(stage+'/.public-facilities-stage'),'missing isolation marker');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
assert.match(props,/^server-port=38670\r?$/m);
assert.match(props,/^rcon.port=38671\r?$/m);
assert.match(props,/^motd=PUBLIC_FACILITIES_ISOLATED_20261024\r?$/m);
const req=createRequire(process.env.MC_PROBE_PACKAGE_JSON??'E:/MC/probe/package.json');
const {Vec3}=req('vec3'), mf=req('mineflayer');
const rc=q=>command(q,15000,{port:38671,properties:stage+'/server.properties'});
const report={startedAt:new Date().toISOString(),passed:false,checks:[],errors:[],evidence:{}};
const bots=[];let closing=false;
const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert(ok,name);console.log('PASS '+name);};
async function until(fn,label,ms=10000){for(const end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await sleep(100);}throw Error('Timeout: '+label);}
async function bounded(promise,ms=3000){let timer;try{return await Promise.race([promise,new Promise((_,j)=>{timer=setTimeout(()=>j(Error('operation timed out')),ms);})]);}finally{clearTimeout(timer);}}
const count=(b,name)=>b.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0);
async function join(username){
 const b=mf.createBot({host:'127.0.0.1',port:38670,username,auth:'offline',version:'1.21.1'});bots.push(b);
 b.lines=[];b.payloads=[];b.on('messagestr',s=>b.lines.push(s));
 b.on('error',e=>{if(!closing)report.errors.push(String(e));});
 b.on('kicked',e=>{if(!closing)report.errors.push('kicked: '+JSON.stringify(e));});
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:land'||p.channel==='mcagent:protection')try{b.payloads.push({channel:p.channel,data:JSON.parse(p.data.toString('utf8'))});}catch{}});
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),username+' spawn',45000);
 b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:land\0mcagent:protection')});
 await rc('minecraft:gamemode survival '+username);return b;
}
async function tp(b,x,y,z){
 b.clearControlStates();if(b.currentWindow)b.closeWindow(b.currentWindow);
 await rc(`minecraft:tp ${b.username} ${x} ${y} ${z}`);
 await until(()=>b.entity.position.distanceTo(new Vec3(x,y,z))<2,'actual teleport');
 await sleep(400);
}
async function cli(b,text,type){
 await sleep(Math.max(0,1200-(Date.now()-(b.lastChat??0))));
 const start=b.payloads.length;b.lastChat=Date.now();b.chat(text);
 return await until(()=>b.payloads.slice(start).map(p=>p.data).find(p=>p.type===type),text);
}
async function open(b,point){
 const block=await until(()=>b.blockAt(new Vec3(...point)),'loaded container');
 assert(['barrel','chest','trapped_chest'].includes(block.name),'actual physical container: '+block.name);
 return bounded(b.openContainer(block));
}
async function roundtrip(b,label,point,stand){
 await tp(b,...stand);await rc(`minecraft:give ${b.username} minecraft:stick 3`);await sleep(300);
 const before=count(b,'stick');let w=await open(b,point);
 check(label+' opens real native container',w.inventoryStart===27||w.inventoryStart===54,{type:w.type,slots:w.inventoryStart});
 const free=w.slots.slice(0,w.inventoryStart).findIndex(x=>!x);
 assert(free>=0,label+' fixture needs one empty slot');
 const inventorySlot=w.slots.findIndex((i,n)=>n>=w.inventoryStart&&i?.name==='stick');
 assert(inventorySlot>=0);await b.clickWindow(inventorySlot,0,0);await b.clickWindow(free,0,0);
 await sleep(350);const deposited=w.slots[free];assert(deposited?.name==='stick');const amount=deposited.count;
 b.closeWindow(w);await sleep(200);w=await open(b,point);
 check(label+' deposit survives close/reopen',w.slots[free]?.name==='stick'&&w.slots[free].count===amount&&count(b,'stick')===before-amount);
 await w.withdraw(deposited.type,deposited.metadata,amount);b.closeWindow(w);await sleep(300);
 check(label+' ordinary withdrawal restores inventory',count(b,'stick')===before);
 report.evidence[label]=await rc('minecraft:data get block '+point.join(' ')+' Items');
}
async function dropPickup(b,label,stand){
 await tp(b,...stand);await rc(`minecraft:give ${b.username} minecraft:cobblestone 2`);await sleep(300);
 const before=count(b,'cobblestone');let spawned=false;
 const spawn=e=>{if(e.name==='item'&&e.position.distanceTo(b.entity.position)<6)spawned=true;};b.on('entitySpawn',spawn);
 const item=b.inventory.items().find(i=>i.name==='cobblestone');
 try{await bounded(b.toss(item.type,item.metadata,1),5000);await until(()=>spawned,label+' dropped entity');
  check(label+' drop actually removed one',count(b,'cobblestone')===before-1,{before,after:count(b,'cobblestone')});
  const entity=Object.values(b.entities).filter(e=>e.name==='item'&&e.position.distanceTo(b.entity.position)<5).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
  assert(entity,'actual dropped item entity');await sleep(1500);await tp(b,entity.position.x,stand[1],entity.position.z);
  await until(()=>count(b,'cobblestone')===before,label+' pickup');check(label+' pickup restores the dropped unit',true);
 }finally{b.off('entitySpawn',spawn);}
}
try{
 check('pinned minimal candidate is running',(await rc('version AgentFriend')).includes('0.4.47.13'));
 const guest=await join('pubGuestQA'), owner=await join('pubOwnerQA');
 check('ordinary guest is not OP',!JSON.parse(fs.readFileSync(stage+'/ops.json','utf8')).some(o=>o.name===guest.username));
 const mine=await cli(guest,'/mycli land info village_public_mine','MC_LAND_INFO');
 check('mine is explicitly public with original owner',mine.publicFacility===true&&mine.accessProfile==='public_facility'&&mine.ownerUuid==='b2f9ceb0-8271-3470-b99f-e1c3ffe4edbd');
 report.evidence.mine=mine;
 const permissions=guest.payloads.map(p=>p.data).find(p=>p.type==='MC_LAND_PERMISSIONS'&&p.id==='village_public_mine');
 check('public permissions separate supplies from building edits',permissions?.container===true&&permissions.drop===true&&permissions.pickup===true&&permissions.break===false&&permissions.place===false,permissions);
 const audit=await rc('mycli admin land audit');report.evidence.audit=audit;
 check('all 15 explicit public profiles are loaded',(audit.match(/"publicFacility":true/g)??[]).length===15);
 check('three original private claims plus fixture remain private',(audit.match(/"publicFacility":false/g)??[]).length===4);
 await roundtrip(guest,'mine',[-657,68,-487],[-660.5,68,-486.5]);
 await roundtrip(guest,'guild hall',[-494,67,-505],[-492.5,67,-503.5]);
 const sharedStart=guest.lines.length;await sleep(1200);guest.chat('/mycli guild shared');await sleep(700);
 check('shared supply guide no longer calls public stock private',guest.lines.slice(sharedStart).some(s=>s.includes('门内补给箱')&&s.includes('自由取放'))&&!guest.lines.slice(sharedStart).some(s=>s.includes('未授权的人无权取放')));
 await dropPickup(guest,'mine',[-660.5,68,-486.5]);
 await dropPickup(guest,'guild hall',[-489.5,67,-502.5]);
 // A disposable PRIVATE claim tests the default policy, independently of public locations.
 const loaded=await rc('minecraft:forceload add 2000 2000 2008 2008');
 report.evidence.fixtureLoad=loaded;await sleep(400);
 await rc('minecraft:fill 2000 80 2000 2008 80 2008 minecraft:stone');
 await rc('minecraft:fill 2000 81 2000 2008 84 2008 minecraft:air');
 const fixture=await rc('minecraft:setblock 2002 81 2002 minecraft:barrel');
 assert(!fixture.includes('not loaded'),fixture);
 await tp(owner,2004.5,81,2002.5);await tp(guest,2004.5,81,2004.5);
 let denied=false;try{const w=await open(guest,[2002,81,2002]);guest.closeWindow(w);}catch(e){report.evidence.privateOpen=String(e);denied=String(e).includes('timed out');}
 check('private physical barrel still refuses visitors',denied&&!guest.currentWindow);
 await roundtrip(owner,'private owner',[2002,81,2002],[2004.5,81,2002.5]);
 await rc('minecraft:give pubGuestQA minecraft:cobblestone 2');await sleep(250);
 const before=count(guest,'cobblestone'),mark=guest.lines.length;
 // Native toss promises can await an empty cursor forever on a denied click; inspect the server result.
 const slot=guest.inventory.items().find(i=>i.name==='cobblestone').slot;
 await guest.clickWindow(slot,0,4);await sleep(1000);
 check('private claim still blocks ordinary drops',count(guest,'cobblestone')===before&&guest.lines.slice(mark).some(s=>s.includes('禁止丢弃')||s.includes('保护区')));
 await tp(owner,2007.5,81,2007.5);
 const privateBefore=count(guest,'amethyst_shard');
 await rc('minecraft:summon minecraft:item 2004.5 81 2004.5 {Item:{id:"minecraft:amethyst_shard",count:1},PickupDelay:0s,Tags:["public_facilities_private_pickup"]}');
 await sleep(900);
 const itemData=await rc('minecraft:data get entity @e[type=minecraft:item,tag=public_facilities_private_pickup,limit=1] Item');
 check('private property pickup remains blocked for guest',count(guest,'amethyst_shard')===privateBefore&&itemData.includes('minecraft:amethyst_shard'));
 await tp(guest,2007.5,81,2007.5);const ownerBefore=count(owner,'amethyst_shard');await tp(owner,2004.5,81,2004.5);
 await until(()=>count(owner,'amethyst_shard')===ownerBefore+1,'private owner pickup');
 check('private owner can pick up actual property',true);
 // Public supply permission must not grant edits, including dismantling the container itself.
 await tp(guest,-660.5,68,-486.5);await rc('minecraft:item replace entity pubGuestQA weapon.mainhand with minecraft:iron_axe');await sleep(250);
 const protectedBlock=guest.blockAt(new Vec3(-657,68,-487));
 await bounded(guest.dig(protectedBlock,true),5000).catch(()=>{});await sleep(400);
 const building=await rc('minecraft:data get block -657 68 -487');
 check('server retains protected container after native dig',building.includes('id: "minecraft:barrel"'),{server:building,clientPredictedType:guest.blockAt(protectedBlock.position)?.name});
 await rc('minecraft:item replace entity pubGuestQA weapon.mainhand with minecraft:iron_sword');await sleep(250);
 report.evidence.bindPreview=await rc('mycli admin bindgear pubGuestQA 0');
 assert(report.evidence.bindPreview.includes('item=IRON_SWORD')&&report.evidence.bindPreview.includes('owner=none'));
 report.evidence.bindApply=await rc('mycli admin bindgear pubGuestQA 0 apply');
 await guest.clickWindow(36,0,4);await sleep(700);
 const bound={id:await rc('minecraft:data get entity pubGuestQA Inventory[{Slot:0b}].id'),owner:await rc('minecraft:data get entity pubGuestQA Inventory[{Slot:0b}].components."minecraft:custom_data".PublicBukkitValues."agentfriend:soulbound_owner"')};
 check('public facility does not bypass bound gear drop protection',bound.id.includes('minecraft:iron_sword')&&bound.owner.includes(guest.player.uuid),bound);
 const header=await cli(guest,'/mycli land info qa_private_storage','MC_LAND_INFO');
 check('private profile remains explicit',header.publicFacility===false&&header.accessProfile==='private');
 check('no native protocol errors',report.errors.length===0,report.errors);
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{closing=true;for(const b of bots)try{if(b.currentWindow)b.closeWindow(b.currentWindow);b.quit('Public-facility isolated test complete');}catch{}await rc('minecraft:forceload remove 2000 2000 2008 2008').catch(()=>{});await sleep(300);report.finishedAt=new Date().toISOString();report.chat=bots.map(b=>({name:b.username,lines:b.lines.slice(-12)}));fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,report:output}));process.exit(process.exitCode??0);}
