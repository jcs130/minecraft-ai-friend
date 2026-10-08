// Read-only public inventory/permission verification. No item withdrawal or terrain edits.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3'),name='GuildStore94QA';
const phase=process.argv[2]??'online',roots=['E:/MC/ops/repairs/guild-storage-20261008','F:/MC-backups/repairs/guild-storage-20261008'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),rcon=q=>command(q,15000),parse=s=>JSON.parse(s.slice(s.indexOf('{')));
const report={phase,startedAt:new Date().toISOString(),passed:false,checks:[],boxes:[]};let bot,added=false;const lines=[];
const check=(name,value,detail)=>{report.checks.push({name,passed:!!value,detail});assert.ok(value,name);};
async function ask(q,prefix){const n=lines.length;bot.chat(q);for(let i=0;i<160;i++){if(lines.slice(n).some(s=>s.startsWith(prefix)))return lines.slice(n);await sleep(80);}throw Error(q+' timeout');}
try{
 report.version=await rcon('version AgentFriend');check('expected formal plugin version',new RegExp(phase==='released'?'0\\.3\\.94':'0\\.3\\.92').test(report.version));
 const reply=await rcon('minecraft:whitelist add '+name);assert.match(reply,/Added/);added=true;
 bot=mineflayer.createBot({host:'192.168.3.163',port:25565,username:name,auth:'offline',version:'1.20.6'});bot.on('messagestr',s=>lines.push(s));
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});bot.setQuickBarSlot(8);await sleep(500);
 const lands=parse(await rcon('mycli admin land audit'));const hall=lands.lands.find(l=>l.id==='adventurers_guild'),warehouse=lands.lands.find(l=>l.id==='adventurers_guild_storage');
 check('guild remains owned by original human UUID',hall.ownerUuid==='00000000-0000-0000-0009-00000d9f9c7b');
 check('upper warehouse shares original owner and has sixteen public halves',warehouse.ownerUuid===hall.ownerUuid&&warehouse.publicContainers===16);
 for(const y of [67,69,71])for(const z of [-495,-493,-491,-489]){
  await rcon(`minecraft:tp ${name} -474.5 67 ${z+.5}`);await sleep(180);const block=bot.blockAt(new Vec3(-473,y,z));assert.equal(block?.name,'chest');
  const w=await bot.openContainer(block);check('nonowner opens '+y+','+z+' from ground',w.inventoryStart===54);report.boxes.push({y,z,used:w.slots.slice(0,54).filter(Boolean).length});bot.closeWindow(w);await sleep(120);
 }
 const denied=await ask('/mycli protect break -473 69 -489','MC_PROTECTION ');check('warehouse cannot be dismantled by a nonowner',denied.some(s=>s.includes('"allowed":false')));
 await sleep(1250);const publicAccess=await ask('/mycli protect container -473 69 -489','MC_PROTECTION ');check('public upper chest access is explicitly allowed',publicAccess.some(s=>s.includes('"allowed":true')));
 await rcon(`minecraft:tp ${name} -492.5 67 -503.5`);await sleep(1250);const privateAccess=await ask('/mycli protect container -494 67 -505','MC_PROTECTION ');check('original guild private barrel still refuses nonowner',privateAccess.some(s=>s.includes('"allowed":false')));
 if(phase==='released'){
  await sleep(1250);const shared=await ask('/mycli guild shared','MC_GUILD_SHARED_OVERFLOW ');check('legacy directions plus overflow directions exposed',shared.filter(s=>s.startsWith('MC_GUILD_SHARED ')).length===4&&shared.filter(s=>s.startsWith('MC_GUILD_SHARED_OVERFLOW ')).length===8);
  const audit=parse(await rcon('mycli admin sharedstorage audit'));check('released runtime recognizes all 648 slots',audit.slots===648&&audit.categories.every(c=>c.available));
 }
 report.eye=await rcon('cortieye');check('actual original Eye remains attached',report.eye.includes('camera=online')&&report.eye.includes('attached=true'));
 report.passed=true;
}catch(e){report.error=String(e.stack||e);report.messages=lines.slice(-10);process.exitCode=1;}
finally{
 if(bot){if(bot.currentWindow)bot.closeWindow(bot.currentWindow);bot.quit();await sleep(200);}if(added)await rcon('minecraft:whitelist remove '+name);
 report.roster=await rcon('minecraft:list uuids');report.finishedAt=new Date().toISOString();for(const root of roots)writeFileSync(root+'/live-'+report.finishedAt.replaceAll(':','-')+'.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,boxes:report.boxes,error:report.error}));
}
