// Isolated cold-chunk and 16-player ownership/teleport check; no production ports.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),stage='E:/MC/staging/life-buildings-20261003';
const roots=['E:/MC/ops/repairs/named-waypoints-20261007','F:/MC-backups/repairs/named-waypoints-20261007'];
const rcon=q=>command(q,20000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,checks:[],candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.89.jar')).digest('hex').toUpperCase(),messages:{},started:new Date().toISOString()};
const clients=[];const check=(s,ok=true)=>{assert.ok(ok,s);report.checks.push(s);console.log('PASS '+s);};
const until=async(f,label)=>{for(let i=0;i<250;i++){if(f())return;await sleep(100);}throw new Error('Timeout '+label);};
const state=async c=>JSON.parse(await rcon('waypointqa position '+c.name));
async function join(name){const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});const c={bot,name,lines:[]};clients.push(c);report.messages[name]=c.lines;bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{report.errors??=[];report.errors.push(String(e));});await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});return c;}
async function ask(c,q,prefix='MC_WAYPOINT_RESULT '){await sleep(Math.max(0,1100-(Date.now()-(c.last??0))));c.last=Date.now();const n=c.lines.length;c.bot.chat(q);await until(()=>c.lines.slice(n).some(s=>s.startsWith(prefix)&&(!prefix.includes('RESULT')||JSON.parse(s.slice(prefix.length)).status!=='pending')),q);return JSON.parse(c.lines.slice(n).findLast(s=>s.startsWith(prefix)&&(!prefix.includes('RESULT')||JSON.parse(s.slice(prefix.length)).status!=='pending')).slice(prefix.length));}
try{
 const old=JSON.parse(readFileSync(roots[0]+'/stage-result.json','utf8'));assert.equal(old.passed,true,'main feature gate');assert.equal(old.candidateSha256,report.candidateSha256);
 const probe=await join('WpCold89');await rcon('waypointqa mana '+probe.name);await rcon('minecraft:tp '+probe.name+' 1212.5 150 1220.5');
 const oldPoints=await ask(probe,'/mycli waypoint list','MC_WAYPOINT_LIST ');for(const p of oldPoints.points)assert.equal((await ask(probe,'/mycli waypoint remove '+p.name)).success,true);
 probe.bot.chat('/mycli waypoint menu');await until(()=>probe.bot.currentWindow,'menu');await probe.bot.clickWindow(49,0,0);await until(()=>probe.bot.currentWindow?.slots[14]?.name==='name_tag','return places');probe.bot.closeWindow(probe.bot.currentWindow);check('waypoint menu returns to public compass places');
 await rcon('execute in minecraft:the_nether run minecraft:forceload remove 1184 1184 1231 1231');
 const unloaded=JSON.parse(await rcon('waypointqa unload world_nether 75 76'));check('fixture destination genuinely unloaded',unloaded.unloaded===true);
 const beforeChunks=JSON.parse(await rcon('waypointqa chunks'));await rcon('waypointqa mana '+probe.name);const before=(await state(probe)).mana;
 let r=await ask(probe,'/mycli goto shared:'+old.persistedShare);const at=await state(probe);
 check('async cold generated chunk teleport succeeds',r.success&&at.world==='world_nether'&&Math.abs(at.x-old.nether.x)<.1);
 check('cold teleport charges exactly once',Math.abs(before-at.mana-6)<.51);
 check('cold teleport never generates new chunks',JSON.parse(await rcon('waypointqa chunks')).generated===beforeChunks.generated);
 await rcon('waypointqa mana '+probe.name);await rcon('execute in minecraft:overworld run minecraft:tp '+probe.name+' -589.5 91 -305.5');
 r=await ask(probe,'/mycli waypoint add 试炼绕行');check('custom points reject trial activity area',r.reason==='in_activity'&&r.spentMana===0);
 probe.bot.quit();await sleep(500);
 const load=[];for(let i=0;i<16;i++)load.push(await join('WpLoad'+String(i).padStart(2,'0')));
 for(let i=0;i<load.length;i++){
  const c=load[i];await rcon('waypointqa mana '+c.name);await rcon(`minecraft:tp ${c.name} ${1202.5+(i%4)*6} 150 ${1202.5+Math.floor(i/4)*6}`);
 }
 await sleep(500);
 const chunks=JSON.parse(await rcon('waypointqa chunks'));const start=Date.now();
 await Promise.all(load.map(async c=>{
  const own=await ask(c,'/mycli waypoint list','MC_WAYPOINT_LIST ');
  for(const p of own.points)assert.equal((await ask(c,'/mycli waypoint remove '+p.name)).success,true);
  const result=await ask(c,'/mycli waypoint add 并发营地');assert.equal(result.success,true);c.point=result.point;
 }));
 check('16 owners concurrently save identical names',new Set(load.map(c=>c.point.owner)).size===16&&new Set(load.map(c=>c.point.id)).size===16);
 for(const c of load){await rcon('waypointqa mana '+c.name);await rcon('execute in minecraft:the_end run minecraft:tp '+c.name+' 1212.5 80 1220.5');await rcon('waypointqa mana '+c.name);}
 const pre=await Promise.all(load.map(state));
 await Promise.all(load.map(async(c,i)=>{
  const result=await ask(c,'/mycli goto personal:并发营地');assert.equal(result.success,true);
  const s=await state(c);assert.equal(s.world,'world');assert.ok(Math.abs(s.x-c.point.x)<.1&&Math.abs(s.z-c.point.z)<.1);assert.ok(Math.abs(pre[i].mana-s.mana-6)<.51);
 }));
 check('16 simultaneous cross-dimension teleports retain owner destination and 6 mana');
 await Promise.all(load.map(async c=>{const own=await ask(c,'/mycli waypoint list','MC_WAYPOINT_LIST ');assert.equal(own.points.length,1);assert.equal(own.points[0].owner,c.point.owner);}));
 check('16 simultaneous lists never leak other private points');
 check('16-way operation never generates chunks',JSON.parse(await rcon('waypointqa chunks')).generated===chunks.generated);
 report.elapsedMs=Date.now()-start;report.mspt=await rcon('mspt');report.online=await rcon('minecraft:list');report.passed=true;
}catch(e){report.error=String(e.stack??e);console.error(report.error);process.exitCode=1;}
finally{for(const c of clients)c.bot.quit();report.finished=new Date().toISOString();for(const root of roots){writeFileSync(root+'/load-result.json',JSON.stringify(report,null,2)+'\n');writeFileSync(root+'/load-result.'+Date.now()+'.json',JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,elapsedMs:report.elapsedMs,error:report.error}));}
