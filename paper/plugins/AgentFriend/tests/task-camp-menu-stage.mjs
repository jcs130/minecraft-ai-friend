import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const root='E:/MC/staging/spell-wheel-loadout-20261118-r1';
const properties=root+'/server.properties';
assert.equal((await readFile(root+'/.wheel-loadout-qa','utf8')).trim(),'SYNTHETIC_WHEEL_LOADOUT_ONLY');
const binds=(await readFile(properties,'utf8')).split(/\r?\n/u);
for(const row of ['server-ip=127.0.0.1','server-port=26875','rcon.port=26876','online-mode=false'])assert.ok(binds.includes(row));
const rc=(cmd)=>command(cmd,9000,{port:26876,properties});
const require=createRequire('E:/MC/clients/numen-hosting/release-20261106-r1/core/package/package.json');
const {createBot}=require('mineflayer');
const {Vec3}=require('vec3');
const tasksOnly=process.argv.includes('--tasks-only');
const name=tasksOnly?'TaskCloseQA':'CampCloseQA';
const bot=createBot({host:'127.0.0.1',port:26875,username:name,version:'1.21.1',auth:'offline',hideErrors:true});
const lines=[], checks=[], marketPackets=[];
installRecipePacketBypass(bot._client);
bot.on('messagestr',line=>lines.push(line));
bot.on('error',err=>console.error(err.message));
bot._client.on('custom_payload', packet=>{
 if (packet.channel==='mcagent:market') marketPackets.push(JSON.parse(packet.data.toString('utf8')));
});
const check=(label,yes)=>{assert.ok(yes,label);checks.push(label);console.log('PASS '+label);};
const until=async(fn,label,ms=10000)=>{
  for(let end=Date.now()+ms;Date.now()<end;){
    const result=await fn(); if(result)return result; await delay(150);
  }
  throw new Error('Timed out: '+label+' | '+lines.slice(-5).join(' | '));
};
const text=value=>JSON.stringify(value);
const shown=(pattern)=>bot.currentWindow && text(bot.currentWindow.title).includes(pattern);
const reopen=async (index)=>{
 const existing=bot.currentWindow;
 await bot.clickWindow(index,0,0);
 const next=await until(()=>bot.currentWindow && bot.currentWindow!==existing && bot.currentWindow.slots.some(Boolean) ? bot.currentWindow : null, 'click -> native menu'); await delay(200); return next;
};
const tap=async (index)=>{await bot.clickWindow(index,0,0);await delay(450);};
const close=async()=>{if(bot.currentWindow){bot.closeWindow(bot.currentWindow);await delay(450);}};
const tp=async (x,y,z)=>{
 await rc(`minecraft:tp ${name} ${x} ${y} ${z}`);
 await until(()=>bot.entity.position.distanceTo(new Vec3(x,y,z))<1.5,'arrived at staging point');
 await delay(550);
};
const use=async (x,y,z)=>{
 const pos=new Vec3(x,y,z);
 await until(()=>!!bot.blockAt(pos),'source block loaded');
 await bot.lookAt(pos.offset(.5,.5,.5),true);
 await bot.activateBlock(bot.blockAt(pos));
};
const placed=async (x,y,z,block)=> (await rc(`minecraft:execute if block ${x} ${y} ${z} ${block}`)).includes('Test passed');
const query=async()=> (await rc('mycli admin dungeonaudit')).split(/\r?\n/u).find(l=>l.includes('id=illager_camp'))??'';
const mobs=async()=> (await rc('minecraft:execute in minecraft:overworld if entity @e[tag=afu_site_illager_camp]')).includes('count: 2');
const stageConfig=root+'/plugins/AgentFriend/task-market.yml';
try{
 await until(()=>bot.entity && bot.world.getColumnAt(bot.entity.position),'logged in',40000);
 await rc('minecraft:clear '+name);
 await rc('minecraft:effect clear '+name);
 if (!tasksOnly) {
 await rc('minecraft:difficulty normal');
 await rc('minecraft:forceload add -1090 -1125 -1060 -1105');
 await tp(-1079.5,67,-1116.5);
 const sign=new Vec3(-1081,68,-1117);
 await use(sign.x,sign.y,sign.z);
 await until(()=>shown('黑旗林营'),'camp marker opens physical menu');
 check('Use on the existing sign opens the camp menu',shown('黑旗林营'));
 await tap(12);
 check('missing gear cannot start the guard wave',(await query()).includes('active=false'));
 await tp(-1074.5,67,-1118.5);
 const beforeGate=lines.length;
 await use(-1075,67,-1118);
 await until(()=>lines.slice(beforeGate).some(line=>line.includes('先用营地入口路牌')),'guarded cage gives a useful hint');
 check('a cage cannot be opened before the guards',(await placed(-1075,67,-1118,'minecraft:dark_oak_fence')));
 for (const [slot,item] of [['armor.head','iron_helmet'],['armor.chest','iron_chestplate'],['armor.legs','iron_leggings'],
       ['armor.feet','iron_boots'],['hotbar.0','iron_sword'],['hotbar.1','bow'],['hotbar.2','arrow']]) {
    await rc(`minecraft:item replace entity ${name} ${slot} with minecraft:${item} ${item==='arrow'?32:1}`);
 }
 await rc('minecraft:effect give '+name+' minecraft:resistance 150 3 true');
 await tp(-1079.5,67,-1116.5);
 await use(sign.x,sign.y,sign.z);
 await until(()=>shown('黑旗林营'),'same camp marker reopens');
 await tap(12);
 await until(()=>mobs(),'actual two guards spawn in the first room',18000);
 check('physical menu starts the original first room wave',await mobs());
 await rc('minecraft:kill @e[tag=afu_site_illager_camp]');
 await until(async()=>/stage=2 phase=moving/u.test(await query()),'first guard wave advances the checkpoint');
 await tp(-1074.5,67,-1118.5);
 await use(-1075,67,-1118);
 await until(()=>placed(-1075,67,-1118,'minecraft:dark_oak_door[open=true,half=lower]'),'lower rescue door opens');
 check('two-block interaction opens cage one',(await placed(-1075,68,-1118,'minecraft:dark_oak_door[open=true,half=upper]')));
 await tp(-1068.5,67,-1115.5);
 await until(()=>mobs(),'actually spawns the second wave');
 check('the second room spawns native guards',await mobs());
 await rc('minecraft:kill @e[tag=afu_site_illager_camp]');
 await until(async()=>/active=false/u.test(await query()),'camp clears');
 await tp(-1068.5,67,-1108.5);
 await use(-1069,67,-1110);
 await until(()=>placed(-1069,67,-1110,'minecraft:dark_oak_door[open=true,half=lower]'),'second cage opens');
 check('cage two opens after the last wave',await placed(-1069,68,-1110,'minecraft:dark_oak_door[open=true,half=upper]'));
 await until(async()=>{
  const near=await rc('minecraft:execute in minecraft:overworld positioned -1069 67 -1111 if entity @e[type=minecraft:villager,distance=..20]');
  return near.includes('count: 2');
 },'both existing villagers remain');
 check('both original villagers remain alive in the camp vicinity',true);
 await until(async()=>{
  const second=await rc('minecraft:execute positioned -1068.5 67 -1110.5 if entity @e[type=minecraft:villager,distance=..0.7]');
  return second.includes('Test failed');
 },'second original villager leaves the enclosure');
 check('the rescue moves the original villager to safe ground',true);
 await tp(-1079.5,67,-1116.5);
 await use(sign.x,sign.y,sign.z);
 await until(()=>shown('黑旗林营'),'the entrance is usable with a pending reward');
 check('the same sign has a pending reward chest',bot.currentWindow.slots[30]?.name==='ender_chest');
 const claimMark=lines.length;
 await tap(30);
 await until(()=>lines.slice(claimMark).some(l=>l.includes('领取')&&l.includes('个人')),'reward receipt');
 await use(sign.x,sign.y,sign.z);
 await until(()=>shown('黑旗林营'),'marker after claiming');
 check('a second opening does not show the consumed receipt',bot.currentWindow.slots[30]?.name==='chest');
 await close();
 }

 const content=await readFile(stageConfig,'utf8');
 if(!content.includes('qa_controller_craft:'))await writeFile(stageConfig,content.trimEnd()+`
  qa_controller_craft:
    scope: personal
    title: 手柄联测木工委托
    description: 制作木棍，在同一张委托交付两次。
    icon: STICK
    repeat: once
    reward: {fame: 3, emeralds: 1, bonus: BREAD, bonus-count: 1}
    steps:
      - {title: 第一份木棍, description: 合成木棍一次, goal: craft, item: STICK, target: 1}
      - {title: 第二份木棍, description: 再合成一次, goal: craft, item: STICK, target: 1}
`,'utf8');
 assert.match(await rc('mycli admin market reload'),/已热加载/u);
 bot.chat('/mycli guild market menu');
 await until(()=>shown('任务市场'),'task board is a native inventory');
 while(!bot.currentWindow.slots.slice(0,36).some(i=>i?.name==='stick')) {
   assert.ok(bot.currentWindow.slots[43]);
   await reopen(43);
 }
 const selected=bot.currentWindow.slots.slice(0,36).findIndex(i=>i?.name==='stick');
 await reopen(selected);
 check('primary inventory click goes to a native confirmation',shown('手柄联测木工委托')&&bot.currentWindow.slots[11]?.name==='lime_dye');
 await reopen(11);
 check('same button shows in-progress state after acceptance',bot.currentWindow.slots[11]?.name==='book');
 check('unregistered client receives the original market payload',marketPackets.some(p=>p.type==='MC_MARKET_DETAIL'));
 await reopen(11);
 check('clicking an unfinished item does not consume the contract',bot.currentWindow.slots[11]?.name==='book');
 await close();
 bot.chat('/mycli guild menu');
 await until(()=>shown('冒险者公会'),'original guild board');
 check('physical board section shows the same active task',bot.currentWindow.slots[49]?.name==='book');
 await reopen(49);
 for(let number=1;number<=2;number++){
   await close();
   await rc('minecraft:give '+name+' minecraft:oak_planks 2');
   await until(()=>bot.inventory.items().some(i=>i.name==='oak_planks'&&i.count>=2),'planks received');
   const recipe=await until(()=>bot.recipesFor(bot.registry.itemsByName.stick.id,null,1,null)[0], 'craft recipe; inventory '+JSON.stringify(bot.inventory.items().map(i=>({name:i.name,count:i.count,slot:i.slot}))));
   assert.ok(recipe,'real player crafting recipe');
   await bot.craft(recipe,1,null);
   bot.chat('/mycli guild market menu');
   await until(()=>shown('任务市场'),'return to original board');
   await reopen(36);
   check('same active card shows delivery for stage '+number,bot.currentWindow.slots[11]?.name==='emerald');
   await reopen(11);
   check('stage '+number+' confirms delivery in place',
     bot.currentWindow.slots[11]?.name===(number===1?'book':'gray_dye'));
   await delay(1100);
 }
 console.log(JSON.stringify({passed:true,checks}));
} finally {
 bot.quit('camp and quest isolation done');
 if (!tasksOnly) await rc('minecraft:forceload remove -1090 -1125 -1060 -1105');
}
process.exit(0);
