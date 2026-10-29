// Guarded loopback QA only. Tests actual admission with server-owned inventory.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027';
assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),report={checks:[],errors:[],messages:[],productionChanged:false};const bots=[];
const rc=q=>command(q,15000,{port:25929,properties:stage+'/server.properties'});
async function until(fn,label,ms=15000){for(let end=Date.now()+ms;Date.now()<end;){if(await fn())return;await wait(100);}throw Error(label+' timeout');}
async function connect(name){const b=require('mineflayer').createBot({host:'127.0.0.1',port:25928,username:name,auth:'offline',version:'1.21.1',checkTimeoutInterval:60000,hideErrors:true});bots.push(b);b.messages=[];installRecipePacketBypass(b._client);b.on('messagestr',s=>{b.messages.push(s);report.messages.push({name,text:s});});b.on('error',e=>report.errors.push(String(e)));await Promise.race([new Promise((resolve,reject)=>{b.once('spawn',resolve);b.once('end',why=>reject(Error('join ended: '+why)));}),wait(30000).then(()=>{throw Error('join timeout');})]);await until(()=>typeof b._client.chat==='function'&&b._client.state==='play','play chat ready');await wait(1700);if(b.currentWindow)b.closeWindow(b.currentWindow);return b;}
async function result(b,q,prefix='MC_SITE_DUNGEON_RESULT '){await wait(1100);let n=b.messages.length;b.chat(q+' --json');await until(()=>b.messages.slice(n).some(s=>s.startsWith(prefix)),q);return JSON.parse(b.messages.slice(n).find(s=>s.startsWith(prefix)).slice(prefix.length));}
async function noRun(b,label){const state=await result(b,'/mycli dungeon status aincrad_01','MC_SITE_DUNGEON_STATE ');assert.equal(state.active,false);report.checks.push(label);}
async function reject(b,expected,label){const row=await result(b,'/mycli dungeon start aincrad_01');assert.equal(row.reason,'equipment_required');assert.deepEqual(row.missingEquipment,expected);assert.equal(row.nextCommand,'/mycli guild shared');assert.match(row.errorMessage,/缺少/);report.checks.push(label);await noRun(b,label+' leaves no active run');}
try{
 const a=await connect('ag_Gear22A'),b=await connect('ag_Gear22B');
 for(const bot of [a,b]){await rc('qdqa cooldown '+bot.username);await rc('qdqa kit '+bot.username);await rc('qdqa castle '+bot.username);bot.chat('/mycli profession choose knight');await wait(1300);}
 await rc('minecraft:clear '+a.username);await reject(a,['靴子','护腿','胸甲','头盔','可用战斗装备（近战武器、弓弩或本职业法器）'],'empty armor and weapon are precisely rejected');
 await rc('qdqa kit '+a.username);await rc('minecraft:item replace entity '+a.username+' armor.head with air');await reject(a,['头盔'],'one missing equipped armor piece is rejected');
 await rc('qdqa kit '+a.username);await rc('minecraft:clear '+a.username+' minecraft:iron_sword');await rc('minecraft:give '+a.username+' minecraft:blaze_rod');await reject(a,['可用战斗装备（近战武器、弓弩或本职业法器）'],'ordinary blaze rod and shield cannot spoof a native staff');
 await rc('minecraft:give '+a.username+' minecraft:iron_sword');await rc('minecraft:item replace entity '+a.username+' weapon.mainhand with minecraft:bow');const ok=await result(a,'/mycli dungeon start aincrad_01');assert.equal(ok.success,true);report.checks.push('full armor and spare sword in inventory are admitted while holding bow');
 await rc('minecraft:item replace entity '+b.username+' armor.chest with air');let denied=await result(b,'/mycli dungeon join aincrad_01');assert.equal(denied.reason,'equipment_required');assert.deepEqual(denied.missingEquipment,['胸甲']);report.checks.push('party join also requires equipped armor');
 let status=await result(b,'/mycli dungeon status aincrad_01','MC_SITE_DUNGEON_STATE ');assert.equal(status.participant,false);report.checks.push('rejected join never adds party membership');
 await rc('minecraft:item replace entity '+b.username+' armor.chest with minecraft:iron_chestplate');let joined=await result(b,'/mycli dungeon join aincrad_01');assert.equal(joined.success,true);report.checks.push('equipped party member is admitted');
 for(const bot of [a,b]){bot.chat('/mycli dungeon leave');await wait(1200);}
 for(const cls of ['knight','mage','ranger','cleric','beastmaster','engineer']){
   const c=await connect('ag_G'+process.argv[2].replace(/\D/g,'')+cls.slice(0,9));await rc('qdqa cooldown '+c.username);await rc('qdqa kit '+c.username);await rc('minecraft:clear '+c.username+' minecraft:iron_sword');
   c.chat('/mycli profession choose '+cls);await wait(1600);await rc('qdqa castle '+c.username);
   const accepted=await result(c,'/mycli dungeon start aincrad_01');assert.equal(accepted.success,true,cls+' starter equipment');report.checks.push(cls+' native starter equipment accepted without extra sword');
   c.chat('/mycli dungeon leave');await wait(1400);c.quit();bots.splice(bots.indexOf(c),1);
 }

}catch(e){report.errors.push(e.stack);}finally{for(const b of bots){try{if(b._client.state==='play'&&typeof b._client.chat==='function'){b.chat('/mycli dungeon leave');await wait(1200);}b.quit();}catch(e){report.errors.push('cleanup: '+e.message);}}await wait(400);await fs.writeFile(stage+'/loadout-'+(process.argv[2]||'qa')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,errors:report.errors}));}process.exit(report.errors.length?1:0);
