// Isolated Paper 25567 only. Fixtures must never target production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json'); fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'), {Vec3}=require('vec3');
const stage='E:/MC/staging/life-buildings-20261003', repair='E:/MC/ops/repairs/guild-ownership-20261006';
const rcon=text=>command(text,15000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clients=[], report={passed:false,results:[],startedAt:new Date().toISOString()};
const until=async(test,label,timeout=12000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(test())return;await sleep(100);}throw new Error(label+' timed out');};
const privatePos=new Vec3(-494,67,-505), publicPos=new Vec3(-473,67,-495);
const fixtures=[[-480,74,-502],[-479,74,-502],[-480,75,-500],[-479,75,-500]];
let snapshotReady=false, fixturesReady=false;
async function join(name){
  const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});
  const c={bot,name,messages:[],protection:[],village:[],packets:[]};clients.push(c);
  bot.on('messagestr',line=>c.messages.push(line));
  bot._client.on('packet',(packet,meta)=>{
    if(meta.name==='custom_payload'&&packet.channel==='mcagent:protection')c.protection.push(JSON.parse(packet.data.toString()));
    if(meta.name==='open_window')c.packets.push(meta.name);
  });
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject);});
  await sleep(2400); await rcon('minecraft:clear '+name);await sleep(300);bot.setQuickBarSlot(8);return c;
}
async function tp(c,x,y,z){await rcon(`minecraft:tp ${c.name} ${x} ${y} ${z}`);await until(()=>c.bot.entity.position.distanceTo(new Vec3(x,y,z))<2,'teleport');await sleep(350);}
const count=(c,name)=>{const w=c.bot.currentWindow;const items=w?w.slots.slice(w.inventoryStart,w.inventoryEnd).filter(Boolean):c.bot.inventory.items();return items.filter(item=>item.name===name).reduce((sum,item)=>sum+item.count,0);};
async function denied(c,pos,action='container'){
  const start=c.messages.length, packets=c.packets.length;
  c.bot.activateBlock(c.bot.blockAt(pos));
  await until(()=>c.messages.slice(start).some(line=>line.startsWith('MC_GUILD_ACCESS ')),action+' denied receipt');
  const line=c.messages.slice(start).find(line=>line.startsWith('MC_GUILD_ACCESS '));
  const data=JSON.parse(line.slice('MC_GUILD_ACCESS '.length));
  assert.equal(data.allowed,false);assert.equal(data.reason,'guild_owner_only');assert.equal(data.owner,'萌萌');
  assert.equal(data.publicCommand,'/mycli guild shared');assert.ok(line.length<400,'receipt fits Cortico chat cap');
  assert.ok(c.messages.slice(start).some(line=>line.includes('无权操作')&&line.includes('公共箱')));
  await sleep(250); assert.equal(c.packets.length,packets,'denied chest must never open');
  assert.ok(c.protection.some(packet=>packet.reason==='guild_owner_only'),'unregistered custom channel delivered');
  report.results.push({test:action+'_denied',receipt:data,length:line.length});
}
async function open(c,pos){return c.bot.openContainer(c.bot.blockAt(pos));}
async function preflight(c,pos,allowed){const base=c.messages.length;c.bot.chat(`/mycli protect container ${pos.x} ${pos.y} ${pos.z}`);
  await until(()=>c.messages.slice(base).some(line=>line.startsWith('MC_PROTECTION ')),'preflight');
  const data=JSON.parse(c.messages.slice(base).find(line=>line.startsWith('MC_PROTECTION ')).slice(14));assert.equal(data.allowed,allowed);return data;}
try{
  assert.match(await rcon('version AgentFriend'),/0\.3\.86/);
  const owner=await join('GuildOwner86'), guest=await join('GuildGuest86'), human=await join('GuildHuman86'),eye=await join('GuildEye86');
  await rcon('minecraft:gamemode spectator '+eye.name);
  await rcon('minecraft:spectate '+guest.name+' '+eye.name);
  const auditText=await rcon('mycli admin guildstorageaudit'); const audit=JSON.parse(auditText.slice(auditText.indexOf('{')));
  assert.equal(audit.ownerUuid,owner.bot.player.uuid);assert.equal(audit.opBypass,false);report.audit=audit;
  await tp(owner,-492.5,67,-505.5);await tp(guest,-492.5,67,-503.5);await tp(human,-491.5,67,-503.5);
  // Keep the complete SNBT server-side: vanilla data-get chat truncates long inventories.
  await rcon('minecraft:data modify storage guildownership:stage originalItems set from block -494 67 -505 Items');snapshotReady=true;
  await rcon('minecraft:item replace block -494 67 -505 container.25 with minecraft:iron_ingot 3');
  await denied(guest,privatePos);await denied(human,privatePos,'human_container');
  await rcon('minecraft:op '+guest.name);await sleep(1100);await denied(guest,privatePos,'op_container');await rcon('minecraft:deop '+guest.name);
  const outsideBefore=count(guest,'iron_ingot');assert.equal(outsideBefore,0);
  report.results.push({test:'private_preflight',receipt:await preflight(guest,privatePos,false)});
  report.results.push({test:'owner_preflight',receipt:await preflight(owner,privatePos,true)});
  const ownWindow=await open(owner,privatePos);assert.equal(ownWindow.type,'minecraft:generic_9x3');
  const iron=ownWindow.containerItems().find(item=>item.name==='iron_ingot');assert.ok(iron);
  await ownWindow.withdraw(iron.type,null,3);assert.equal(count(owner,'iron_ingot'),3);
  await ownWindow.deposit(iron.type,null,3);owner.bot.closeWindow(ownWindow);report.results.push({test:'owner_withdraw_deposit',passed:true});
  await tp(guest,-474.5,67,-495.5);const publicCheck=await preflight(guest,publicPos,true);report.results.push({test:'public_preflight',receipt:publicCheck});
  await rcon('minecraft:give '+guest.name+' minecraft:iron_ingot 2');await until(()=>count(guest,'iron_ingot')===2,'public fixture');
  const publicWindow=await open(guest,publicPos);assert.equal(publicWindow.inventoryStart,54);
  const totalBefore=publicWindow.containerItems().filter(item=>item.name==='iron_ingot').reduce((sum,item)=>sum+item.count,0);
  await publicWindow.deposit(iron.type,null,2);guest.bot.closeWindow(publicWindow);
  await tp(human,-471.5,67,-495.5);const rightPublic=await open(human,new Vec3(-472,67,-495));
  assert.equal(rightPublic.inventoryStart,54);assert.equal(rightPublic.containerItems().filter(item=>item.name==='iron_ingot').reduce((sum,item)=>sum+item.count,0),totalBefore+2);
  await rightPublic.withdraw(iron.type,null,2);human.bot.closeWindow(rightPublic);report.results.push({test:'public_both_halves_cross_player',passed:true});
  // An outside half of a double chest must not unlock its protected inside half.
  for(const p of fixtures)assert.equal(owner.bot.blockAt(new Vec3(...p))?.name,'air','temporary fixture replaces only air');
  fixturesReady=true;
  await rcon('minecraft:setblock -480 75 -500 minecraft:chest[facing=north,type=left]');
  await rcon('minecraft:setblock -479 75 -500 minecraft:chest[facing=north,type=right]');
  await rcon('minecraft:gamemode creative '+guest.name);guest.bot.creative.startFlying();guest.bot.entity.velocity=new Vec3(0,0,0);await tp(guest,-477.5,75,-500.5);
  assert.ok(guest.bot.entity.position.distanceTo(new Vec3(-479,75,-500))<4,'boundary fixture in reach');
  await denied(guest,new Vec3(-479,75,-500),'double_chest_outside_half');
  await tp(guest,-474.5,67,-495.5);guest.bot.creative.stopFlying();await rcon('minecraft:gamemode survival '+guest.name);
  await rcon('minecraft:setblock -479 74 -502 minecraft:barrel');await rcon('minecraft:setblock -480 74 -502 minecraft:hopper[facing=east]');
  await rcon('minecraft:item replace block -480 74 -502 container.0 with minecraft:iron_ingot 5');await sleep(1200);
  const hopperSource=await rcon('minecraft:data get block -480 74 -502 Items'),hopperDest=await rcon('minecraft:data get block -479 74 -502 Items');
  assert.match(hopperSource,/count: 5/);assert.match(hopperDest,/\[\]/);report.results.push({test:'hopper_export_blocked',passed:true});
  await rcon('minecraft:setblock -480 74 -502 minecraft:barrel');await rcon('minecraft:setblock -479 74 -502 minecraft:hopper[facing=west]');
  await rcon('minecraft:item replace block -479 74 -502 container.0 with minecraft:iron_ingot 4');await sleep(1200);
  assert.match(await rcon('minecraft:data get block -479 74 -502 Items'),/count: 4/);assert.match(await rcon('minecraft:data get block -480 74 -502 Items'),/\[\]/);
  report.results.push({test:'hopper_import_blocked',passed:true});
  // Private item ownership follows the dropped entity, while player drops are refused.
  await tp(guest,-489.5,67,-503.5);await rcon('minecraft:give '+guest.name+' minecraft:iron_ingot 1');await until(()=>count(guest,'iron_ingot')===1,'drop fixture');
  const dropBase=guest.messages.length;await guest.bot.tossStack(guest.bot.inventory.items().find(item=>item.name==='iron_ingot'));await sleep(400);
  assert.equal(count(guest,'iron_ingot'),1);assert.ok(guest.messages.slice(dropBase).some(line=>line.includes('"action":"drop"')));report.results.push({test:'nonowner_drop_restored',passed:true});
  const emeraldBefore=count(guest,'emerald');await rcon('minecraft:summon minecraft:item -489.5 67 -503.5 {Tags:["GuildOwnership86"],NoGravity:1b,PickupDelay:0s,Item:{id:"minecraft:emerald",count:1}}');
  await sleep(1200);assert.equal(count(guest,'emerald'),emeraldBefore);assert.match(await rcon('minecraft:data get entity @e[tag=GuildOwnership86,type=minecraft:item,limit=1] Item'),/emerald/);
  assert.ok(guest.messages.some(line=>line.includes('"action":"pickup"')));await tp(guest,-474.5,67,-495.5);const ownerEmerald=count(owner,'emerald');
  await tp(owner,-489.5,67,-503.5);await until(()=>count(owner,'emerald')===ownerEmerald+1,'owner pickup');report.results.push({test:'private_pickup_owner_only',passed:true});
  await rcon('minecraft:summon minecraft:armor_stand -487.5 67 -503.5 {Tags:["GuildOwnership86","GuildArmor86"],NoGravity:1b,ArmorItems:[{},{},{id:"minecraft:iron_chestplate",count:1},{}]}');
  await tp(guest,-487.5,67,-502);await sleep(300);const stand=Object.values(guest.bot.entities).find(e=>e.name==='armor_stand'&&e.position.distanceTo(guest.bot.entity.position)<3);assert.ok(stand);
  const armorBefore=await rcon('minecraft:data get entity @e[tag=GuildArmor86,limit=1] ArmorItems');guest.bot.activateEntity(stand);guest.bot.attack(stand);await sleep(450);
  assert.equal(await rcon('minecraft:data get entity @e[tag=GuildArmor86,limit=1] ArmorItems'),armorBefore);assert.ok(guest.messages.some(line=>line.includes('"action":"display"')));
  report.results.push({test:'armor_stand_no_theft_or_damage',passed:true});
  await rcon('minecraft:summon minecraft:item_frame -489 68 -507 {Tags:["GuildOwnership86","GuildFrame86"],TileX:-489,TileY:68,TileZ:-507,Facing:3b,Item:{id:"minecraft:diamond",count:1}}');
  await tp(guest,-489.5,67,-505.5);await sleep(300);const frame=Object.values(guest.bot.entities).find(e=>e.name==='item_frame'&&e.position.distanceTo(guest.bot.entity.position)<3);assert.ok(frame,'supported item-frame fixture visible');
  const frameBefore=await rcon('minecraft:data get entity @e[tag=GuildFrame86,limit=1] Item');guest.bot.attack(frame);guest.bot.activateEntity(frame);await sleep(450);
  assert.equal(await rcon('minecraft:data get entity @e[tag=GuildFrame86,limit=1] Item'),frameBefore);report.results.push({test:'item_frame_no_theft',passed:true});
  guest.bot.chat('/mycli guild shared');await until(()=>guest.messages.some(line=>line.startsWith('MC_GUILD_SHARED ')),'public directions');
  guest.bot.chat('/mycli list protect');await until(()=>guest.messages.some(line=>line.includes('protect.container')),'container CLI discoverable');
  await until(()=>eye.messages.some(line=>line.startsWith('MC_GUILD_ACCESS ')),'registered Eye private refusal mirror');
  report.results.push({test:'eye_denial_mirror_and_discovery',passed:true});
  assert.equal(count(guest,'iron_ingot'),1,'private stock never reaches nonowner');report.passed=true;
}catch(error){report.error=String(error.stack??error);report.clients=clients.map(c=>({name:c.name,messages:c.messages.slice(-12),protection:c.protection.slice(-5)}));process.exitCode=1;
}finally{
  for(const c of clients)c.bot.quit();await sleep(250);
  if(snapshotReady)try{await rcon('minecraft:data modify block -494 67 -505 Items set from storage guildownership:stage originalItems');await rcon('minecraft:data remove storage guildownership:stage originalItems');}catch{}
  if(fixturesReady)for(const [x,y,z] of fixtures)try{await rcon(`minecraft:setblock ${x} ${y} ${z} minecraft:air`);}catch{}
  try{
    await rcon('minecraft:deop GuildGuest86');
    await rcon('execute as @e[tag=GuildOwnership86] run minecraft:data remove entity @s BukkitValues."agentfriend:guild_property_owner"');
    await rcon('minecraft:tp @e[tag=GuildOwnership86] -469 90 -489');
    await rcon('minecraft:kill @e[tag=GuildOwnership86]');
  }catch{}
  report.finishedAt=new Date().toISOString();writeFileSync(repair+'/stage-test.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,tests:report.results.map(r=>r.test),error:report.error}));
}
