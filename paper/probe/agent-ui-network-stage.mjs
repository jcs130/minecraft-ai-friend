// Native protocol checks. All item/world mutations are restricted to this loopback QA world.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const stage='E:/MC/staging/dungeon-participation-20261011';
const props=readFileSync(`${stage}/server.properties`,'utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
assert.match(props,/^server-port=25567\r?$/m);
assert.match(props,/^motd=Dungeon participation isolated check\r?$/m);
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const {createBot}=require('mineflayer'),{Vec3}=require('vec3');
const {command}=await import('file:///E:/MC/ops/rcon-client.mjs');
const rcon=text=>command(text,15000,{properties:`${stage}/server.properties`,port:25587});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={at:new Date().toISOString(),checks:[],errors:[],fixture:'Controlled Mineflayer clients, console-only named loopback QA fixtures. No autonomous LLM or real Bedrock hardware acceptance.'};
const bots=[];let closing=false;
function check(name,pass,detail){report.checks.push({name,pass:!!pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);assert.ok(pass,name);}
async function until(fn,label,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(100);}throw Error('timeout: '+label);}
async function connect(username){
 const b=createBot({username,host:'127.0.0.1',port:25567,version:'1.20.6',auth:'offline',physicsEnabled:false});bots.push(b);b.lines=[];b.packets=[];
 b.on('messagestr',text=>b.lines.push(text));b._client.on('packet',(data,meta)=>{
  if(['window_items','trade_list','update_health','set_slot','open_window','close_window','advancements'].includes(meta.name))b.packets.push({name:meta.name,at:Date.now(),windowId:data.windowId});
 });
 b.on('error',e=>{if(!closing)report.errors.push(`${username}: ${e.message}`);});b.on('kicked',e=>{if(!closing)report.errors.push(`${username}: ${JSON.stringify(e)}`);});
 await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error('login timeout')),20000);b.once('spawn',()=>{clearTimeout(t);b.physicsEnabled=false;ok();});b.once('error',no);});await sleep(1700);return b;
}
async function tp(b,x,z=100.5){await rcon(`minecraft:tp ${b.username} ${x} 101 ${z}`);await sleep(150);}
async function qa(text){assert.match(await rcon('dungeonqa '+text),/DUNGEON_QA_OK/);}
async function ask(b,text,match){const at=b.lines.length;b.chat('/'+text);await until(()=>b.lines.slice(at).some(x=>typeof match==='string'?x.includes(match):match.test(x)),text);return b.lines.slice(at);}
async function inventory(b){const rows=await ask(b,'mycli inventory','MC_INVENTORY ');return JSON.parse(rows.find(x=>x.startsWith('MC_INVENTORY ')).slice(13));}
const count=(b,id)=>b.inventory.items().filter(x=>x.name===id).reduce((sum,x)=>sum+x.count,0);
const displayedCount=(b,id)=>(b.currentWindow?b.currentWindow.slots.slice(b.currentWindow.inventoryStart,b.currentWindow.inventoryEnd):b.inventory.slots).filter(x=>x?.name===id).reduce((sum,x)=>sum+x.count,0);
const cut=()=>new Map(bots.map(b=>[b,b.lines.length]));
const recent=(b,from)=>b.lines.slice(from.get(b));
async function toss(giver,receiver,id,amount=1){
 await tp(receiver,160.5);await tp(giver,165.5);await rcon(`minecraft:give ${giver.username} minecraft:${id} ${amount}`);
 await until(()=>count(giver,id)>=amount,'giver actual item');
 const entityBefore=new Set(Object.keys(giver.entities));
 await giver.tossStack(giver.inventory.items().find(x=>x.name===id));
 await until(()=>Object.values(giver.entities).some(e=>e.name==='item'&&!entityBefore.has(String(e.id))),'actual dropped entity');
 const drop=Object.values(giver.entities).find(e=>e.name==='item'&&!entityBefore.has(String(e.id)));
 await tp(giver,157.5);await sleep(1000);const position=drop.position.clone();await tp(receiver,position.x,position.z);return drop.id;
}
try{
 check('candidate versions', (await rcon('version AgentFriend')).includes('0.4.22')&&(await rcon('version CortiEyeMirror')).includes('0.1.13'));
 const a=await connect('RoomQA'),giver=await connect('RoomQAB'),other=await connect('RoomQAC'),eye=await connect('RoomQA_eye');
 eye._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('spectatorplus:screen_sync')});await sleep(1800);
 check('Eye actually attached',(await rcon('cortieye')).includes('attached=true'));
 await qa('fixtures');await rcon('minecraft:kill @e[type=minecraft:item]');await rcon('gamerule naturalRegeneration false');await rcon('gamerule logAdminCommands false');
 for(const b of [a,giver,other]){await rcon(`minecraft:gamemode survival ${b.username}`);await rcon(`minecraft:clear ${b.username}`);await tp(b,b===a?160.5:b===giver?157.5:150.5);}
 let from=cut();await ask(a,'mycli inventory','MC_INVENTORY ');await sleep(400);
 check('own CLI result absent for unrelated players',!recent(giver,from).some(x=>x.includes('MC_INVENTORY '))&&!recent(other,from).some(x=>x.includes('MC_INVENTORY ')));
 check('paired Eye sees subject private CLI result',recent(eye,from).some(x=>x.includes('MC_INVENTORY ')));
 from=cut();await ask(a,'minecraft:msg RoomQAB 私聊隔离检查','私聊隔离检查');await sleep(400);
 check('private chat reaches recipient but not bystander',recent(giver,from).some(x=>x.includes('私聊隔离检查'))&&!recent(other,from).some(x=>x.includes('私聊隔离检查')));
 from=cut();await qa('tower_notice');await sleep(500);
 check('tower notices only enrolled player and paired Eye',recent(a,from).some(x=>x.includes('【试炼塔·'))&&recent(eye,from).some(x=>x.includes('隔离消息归属检查'))&&!recent(giver,from).some(x=>x.includes('隔离消息归属检查'))&&!recent(other,from).some(x=>x.includes('隔离消息归属检查')));
 from=cut();await qa('tower_status');await sleep(300);const tower=recent(a,from);
 check('tower status fixture retains legacy prefix and Chinese context',tower.some(x=>x.includes('【试炼塔】'))&&tower.some(x=>x.includes('activityType=trial_tower')));
 const site=await ask(a,'mycli dungeon status','MC_SITE_DUNGEON_STATE');
 const siteData=JSON.parse(site.find(x=>x.startsWith('MC_SITE_DUNGEON_STATE ')).slice(22));
 check('site dungeon context has Chinese label and owner',siteData.activityType==='site_dungeon'&&siteData.activityLabel==='遗迹地下城'&&siteData.recipient===a.username&&siteData.language==='zh-CN',siteData);
 a.chat('/mycli menu');await until(()=>!!a.currentWindow,'compass');
 check('compass has recognisable camera button',JSON.stringify(a.currentWindow.slots[17]).includes('女神相机'));
 await a.clickWindow(17,0,0);await until(()=>!!a.currentWindow&&JSON.stringify(a.currentWindow.title).includes('女神相机'),'camera from compass');
 check('native camera menu has all views, posters and exit',a.currentWindow.slots[10]&&a.currentWindow.slots[12]&&a.currentWindow.slots[14]&&a.currentWindow.slots[19]&&a.currentWindow.slots[21]&&a.currentWindow.slots[23]&&a.currentWindow.slots[26]);
 await a.clickWindow(18,0,0);await until(()=>a.currentWindow?.slots.length>27,'camera return compass');check('return button works',!!a.currentWindow);a.closeWindow(a.currentWindow);
 a.chat('/mycli photo');await until(()=>!!a.currentWindow,'default photo opens menu');await a.clickWindow(26,0,0);await until(()=>!a.currentWindow,'camera close');check('photo default and close button work',!a.currentWindow);
 from=cut();await ask(a,'mycli photo take 视角检查 俯视','相机');await sleep(300);
 check('Chinese perspective accepted and failure stays private',!recent(a,from).some(x=>x.includes('用法：'))&&!recent(giver,from).some(x=>x.includes('视角检查'))&&!recent(other,from).some(x=>x.includes('[女神相机]')));
 await ask(a,'mycli photo status','无需截图上传');check('camera help says automatic menu-first',a.lines.at(-1)?.includes('截图')||a.lines.some(x=>x.includes('/mycli photo menu')));
 from=cut();await toss(giver,a,'diamond_chestplate');await until(()=>count(a,'diamond_chestplate')===1,'receiver chestplate');await until(()=>recent(a,from).some(x=>x.includes('【收到物品】')),'gift receipt');
 check('successful gift sends sender and receiver private receipts',recent(giver,from).some(x=>x.includes('【交物确认】'))&&recent(a,from).some(x=>x.includes('钻石胸甲 ×1'))&&!recent(other,from).some(x=>x.includes('交物确认')||x.includes('收到物品')));
 await until(()=>count(eye,'diamond_chestplate')===1,'Eye native actual gift inventory');
 let inv=await inventory(a);check('server native body Eye and query agree',count(a,'diamond_chestplate')===1&&count(eye,'diamond_chestplate')===1&&inv.items.some(x=>x.id==='minecraft:diamond_chestplate'&&x.amount===1&&x.windowSlot===(x.slot<9?x.slot+36:x.slot)));
 const before=JSON.stringify(a.inventory.slots);await ask(a,'mycli inventory refresh','MC_INVENTORY ');await sleep(400);check('refresh does not move duplicate or delete items',before===JSON.stringify(a.inventory.slots));
 await qa('health RoomQA 18');await sleep(900);let p=eye.packets.length;await qa('health RoomQA 16');await sleep(700);
 check('health update arrives without full inventory retransmission',eye.packets.slice(p).some(x=>x.name==='update_health')&&!eye.packets.slice(p).some(x=>x.name==='window_items'&&x.windowId===0),eye.packets.slice(p));
 await rcon('minecraft:kill @e[type=minecraft:item]');await qa('full_inventory');from=cut();await toss(giver,a,'bread',4);await until(()=>count(a,'bread')===64,'partial bread pickup');await sleep(600);
 check('partial pickup receipt states accepted one not discarded remainder',recent(a,from).some(x=>x.includes('面包 ×1'))&&!recent(a,from).some(x=>x.includes('面包 ×4')));
 check('remaining three stay actual ground items',(await rcon('data get entity @e[type=minecraft:item,limit=1,sort=nearest] Item')).includes('count: 3'));
 await rcon('minecraft:kill @e[type=minecraft:item]');await rcon('minecraft:clear RoomQA');await qa('reject_pickup true');from=cut();await toss(giver,a,'iron_pickaxe');await sleep(1000);
 check('cancelled pickup sends no false confirmation',count(a,'iron_pickaxe')===0&&!recent(a,from).some(x=>x.includes('收到物品'))&&!recent(giver,from).some(x=>x.includes('交物确认')));
 await qa('reject_pickup false');await sleep(700);await until(()=>count(a,'iron_pickaxe')===1,'pickup after cancellation lifted');
 await rcon('minecraft:clear RoomQA');await tp(a,173.5);await rcon('minecraft:give RoomQA minecraft:wheat 8');
 // Invoke the original shortcut recovery before measuring idle traffic; its real inventory change must be sent.
 await qa('shortcut RoomQA');await until(()=>a.inventory.items().some(x=>x.name==='player_head'),'existing backpack shortcut restored');await sleep(600);
 const villager=Object.values(a.entities).find(x=>x.name==='villager'&&Math.abs(x.position.x-174.5)<1);assert.ok(villager);
 const merchant=await a.openVillager(villager);await until(()=>!!eye.currentWindow,'Eye merchant');await sleep(800);p=eye.packets.length;await sleep(2200);
 const idle=eye.packets.slice(p).filter(x=>x.name==='trade_list'||x.name==='window_items');
 check('idle merchant sends no repeated offers or full pages',idle.length===0,idle);
 p=eye.packets.length;await a.trade(merchant,0,1);await sleep(800);
 inv=await inventory(a);
 check('real trade changes native open-window contents and server inventory',displayedCount(a,'emerald')===1&&displayedCount(eye,'emerald')===1&&inv.items.some(x=>x.id==='minecraft:emerald'&&x.amount===1),{bodyWindow:displayedCount(a,'emerald'),eyeWindow:displayedCount(eye,'emerald'),server:inv.items,packets:eye.packets.slice(p)});
 eye.closeWindow(eye.currentWindow);await sleep(800);check('Eye manually closed trade does not reopen',!eye.currentWindow);
 a.closeWindow(a.currentWindow);await tp(a,169.5);await a.openContainer(a.blockAt(new Vec3(170,101,100)));await until(()=>!!eye.currentWindow,'Eye chest');
 await tp(a,169.95);await until(()=>!a.currentWindow&&!eye.currentWindow,'movement closes both native windows');check('movement closes actual body and Eye windows',!a.currentWindow&&!eye.currentWindow);
 await qa('permit RoomQA');a.chat('/minepacks:backpack open');await until(()=>!!a.currentWindow,'actual Minepacks');await tp(a,169.5);await until(()=>!a.currentWindow,'movement closes real backpack');check('actual backpack automatically closes on movement',!a.currentWindow);
 check('tests kept gameplay clients non OP',JSON.parse(readFileSync(`${stage}/ops.json`,'utf8')).length===0);
 await rcon('minecraft:op RoomQAC');await rcon('minecraft:op RoomQAB');await ask(giver,'luckperms:lp group default permission unset minecraft.admin.command_feedback',/minecraft.admin.command_feedback/);await sleep(500);await rcon('gamerule logAdminCommands true');from=cut();giver.chat('/minecraft:time set 18000');await sleep(500);const beforeAdmin=recent(other,from);
 await rcon('gamerule logAdminCommands false');from=cut();giver.chat('/minecraft:time set 18000');await sleep(500);
 check('logAdminCommands alone does not suppress other OP feedback',beforeAdmin.some(x=>/18000|time|时间/.test(x))&&recent(other,from).some(x=>/18000|time|时间/.test(x)),{before:beforeAdmin,after:recent(other,from)});
 await ask(giver,'luckperms:lp group default permission set minecraft.admin.command_feedback false',/minecraft.admin.command_feedback/);await sleep(600);
 from=cut();giver.chat('/minecraft:time set 18000');await sleep(500);
 check('permission denial suppresses admin broadcast while retaining sender result',!recent(other,from).some(x=>/18000|time|时间/.test(x))&&recent(giver,from).some(x=>/18000|time|时间/.test(x)),{other:recent(other,from),sender:recent(giver,from)});
 check('acting OP retains own command result with admin logging off',recent(giver,from).some(x=>/18000|time|时间/.test(x)));
 await rcon('minecraft:deop RoomQAC');await rcon('minecraft:deop RoomQAB');check('own native feedback remains enabled',(await rcon('gamerule sendCommandFeedback')).includes('true'));
 await rcon('gamerule announceAdvancements false');await rcon('minecraft:advancement revoke RoomQAB only minecraft:adventure/root');from=cut();p=giver.packets.length;
 await rcon('minecraft:advancement grant RoomQAB only minecraft:adventure/root');await sleep(600);
 check('native advancement remains private protocol state without public chat',giver.packets.slice(p).some(x=>x.name==='advancements')&&!recent(a,from).some(x=>/RoomQAB.*advancement/.test(x)));
 check('no test connection errors',report.errors.length===0,report.errors);
}catch(e){report.failure=e.stack;console.error(e);process.exitCode=1;}
finally{await rcon('minecraft:deop RoomQAC').catch(()=>{});await rcon('minecraft:deop RoomQAB').catch(()=>{});closing=true;for(const b of bots)report[b.username]={lines:b.lines,packets:b.packets,inventory:b.inventory.items().map(x=>({name:x.name,count:x.count,slot:x.slot}))};for(const b of bots)b.quit();await sleep(500);writeFileSync(process.env.MC_TEST_REPORT??'E:/MC/ops/repairs/agent-ui-network-20261011/stage-test.json',JSON.stringify(report,null,2));}
