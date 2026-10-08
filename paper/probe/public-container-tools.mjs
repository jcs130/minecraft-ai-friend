// Native open-only checks; fixture tool belongs only to this temporary QA identity.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {writeFileSync,readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mf=require('mineflayer'),{Vec3}=require('vec3');
const mode=process.argv[2]??'stage',live=mode.startsWith('live'),stage='E:/MC/staging/life-buildings-20261003',name=live?'GuildAccess95QA':'GuildToolStage95',rcon=q=>live?command(q,15000):command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const jar=(live?'E:/MC/server':stage)+'/plugins/AgentFriend-'+(mode==='live-before'?'0.3.94':'0.3.95')+'.jar';
const report={mode,at:new Date().toISOString(),passed:false,sha256:createHash('sha256').update(readFileSync(jar)).digest('hex').toUpperCase(),checks:[]},lines=[];let bot,added=false;
const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert.ok(ok,name);console.log('PASS '+name);};
async function open(point){await rcon(`minecraft:tp ${name} -474.5 67 ${point[2]+.5}`);await sleep(500);let timer;try{return await Promise.race([bot.openContainer(bot.blockAt(new Vec3(...point))),new Promise((_,j)=>{timer=setTimeout(()=>j(Error('container open timeout')),3000);})]);}finally{clearTimeout(timer);}}
try{
 check('correct runtime',new RegExp(mode==='live-before'?'0\\.3\\.94':'0\\.3\\.95').test(await rcon('version AgentFriend')));
 const allow=await rcon('minecraft:whitelist add '+name);added=allow.includes('Added');assert.ok(added,'temporary identity already exists');
 bot=mf.createBot({host:live?'192.168.3.163':'127.0.0.1',port:live?25565:25567,username:name,auth:'offline',version:'1.20.6'});bot.on('messagestr',s=>lines.push(s));await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j)});bot.setQuickBarSlot(8);bot.clearControlStates();
 const empty=await open([-473,69,-489]);check('empty hand opens upper public chest',empty.inventoryStart===54);bot.closeWindow(empty);
 const tools=mode==='live-before'?['iron_axe']:['iron_axe','iron_hoe','iron_shovel'];
 for(const tool of tools){await rcon(`minecraft:item replace entity ${name} weapon.mainhand with minecraft:${tool}`);await sleep(250);
  for(const y of mode==='live-before'?[69]:[67,69,71])for(const z of mode==='live-before'?[-489]:[-495,-493,-491,-489]){
   const n=lines.length;let window,error;try{window=await open([-473,y,z]);}catch(e){error=String(e);}
   if(mode==='live-before')check('reproduced tool-triggered wrong private-land refusal',!window&&lines.slice(n).some(s=>s.startsWith('MC_LAND_ACCESS ')&&s.includes('"action":"place"')),lines.slice(n));
   else{check(tool+' opens public '+y+','+z,!!window&&window.inventoryStart===54,{error,messages:lines.slice(n)});}
   if(window)bot.closeWindow(window);
  }
 }
 if(mode!=='live-before'){
  for(const [action,point] of [['break',[-473,69,-489]],['container',[-494,67,-505]]]){if(action==='container')await rcon(`minecraft:tp ${name} -492.5 67 -503.5`);await sleep(1250);const n=lines.length;bot.chat('/mycli protect '+action+' '+point.join(' '));await sleep(500);check(action+' keeps private ownership',lines.slice(n).some(s=>s.startsWith('MC_PROTECTION ')&&s.includes('"allowed":false')),lines.slice(n));}
  const n=lines.length;await bot.activateBlock(bot.blockAt(new Vec3(-494,67,-505)));await sleep(500);check('holding tool still gets explicit denial before private barrel opens',!bot.currentWindow&&lines.slice(n).some(s=>/^MC_(LAND|GUILD)_ACCESS /.test(s)&&s.includes('"allowed":false')),lines.slice(n));
 }
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(e);}
finally{if(bot){if(bot.currentWindow)bot.closeWindow(bot.currentWindow);for(const tool of ['iron_axe','iron_hoe','iron_shovel'])await rcon('minecraft:clear '+name+' minecraft:'+tool);bot.quit();await sleep(250);}if(added)await rcon('minecraft:whitelist remove '+name);report.finishedAt=new Date().toISOString();report.messages=lines.slice(-8);for(const root of ['E:/MC/ops/repairs/dungeon-network-20261008','F:/MC-backups/repairs/dungeon-network-20261008'])writeFileSync(root+'/container-tools-'+mode+'-'+report.finishedAt.replaceAll(':','-')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({mode,passed:report.passed,checks:report.checks.length,error:report.error}));}
