// Controlled ordinary-protocol fixtures, copied world, isolated port only. No production combat.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mf=require('mineflayer');
const stage='E:/MC/staging/life-buildings-20261003',roots=['E:/MC/ops/repairs/trial-team-revival-20261008','F:/MC-backups/repairs/trial-team-revival-20261008'];
const phase=process.argv[2]??'pre',rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const report={phase,startedAt:new Date().toISOString(),passed:false,checks:[],sha256:hash(stage+'/plugins/AgentFriend-0.3.96.jar')},clients=[];
const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
const json=s=>JSON.parse(s.slice(s.indexOf('{'))),coords=s=>['x','y','z'].map(k=>Number(s.match(new RegExp(' '+k+'=([^ ]+)'))?.[1]));
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150);}throw Error(label+' timeout');}
async function connect(name){await rcon('minecraft:whitelist add '+name);const bot=mf.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'}),c={name,bot,lines:[],deaths:0,last:0,states:[]};bot.on('messagestr',s=>c.lines.push(s));bot.on('death',()=>c.deaths++);bot.on('error',e=>c.error=String(e));bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:state')try{c.states.push(JSON.parse(p.data.toString()));}catch{}});await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject)});clients.push(c);return c;}
async function ask(c,q,prefix='MC_TRIAL_RESCUE_STATE '){await sleep(Math.max(0,1100-(Date.now()-c.last)));const n=c.lines.length;c.last=Date.now();c.bot.chat(q);if(prefix)await until(()=>c.lines.slice(n).some(s=>s.startsWith(prefix)),q);await sleep(70);return c.lines.slice(n);}
async function rescue(c,site=false){return json((await ask(c,site?'/mycli dungeon status':'/mycli arena status')).find(s=>s.startsWith('MC_TRIAL_RESCUE_STATE ')));}
async function site(c,id=''){return json((await ask(c,'/mycli dungeon status '+id,'MC_SITE_DUNGEON_STATE ')).find(s=>s.startsWith('MC_SITE_DUNGEON_STATE ')));}
async function tp(c,p){await rcon(`minecraft:tp ${c.name} ${p.join(' ')}`);await until(()=>c.bot.entity.position.distanceTo({x:p[0],y:p[1],z:p[2]})<1.2,'native teleport '+c.name);await sleep(150);}
async function damage(c){const result=await rcon(`minecraft:damage ${c.name} 1000 minecraft:generic_kill`);assert.ok(!/Unknown|Incorrect/.test(result),result);await sleep(400);}
async function audit(c){return await rcon('trialrescueqa audit '+c.name);}
const inventory=s=>s.match(/inventory=([a-f0-9]+)/)?.[1];
async function fixture(c){await rcon('minecraft:gamemode survival '+c.name);await rcon(`minecraft:effect give ${c.name} minecraft:resistance 99999 4 true`);await rcon(`minecraft:effect give ${c.name} minecraft:strength 99999 100 true`);}
async function reset(){check('isolated reset fixture',(await rcon('trialrescueqa reset')).includes('reset=true'));}
async function stationaryEnemies(){for(const tag of ['afu_dungeon_mob','afu_site_dungeon'])await rcon(`minecraft:execute as @e[tag=${tag}] run data merge entity @s {NoAI:1b}`);}
async function start(a,b,mode='normal'){for(const c of [a,b].filter(Boolean)){await fixture(c);await tp(c,[-593.5,91,-312.5]);}await ask(a,'/mycli arena difficulty '+mode,'MC_DUNGEON_DIFFICULTY ');await ask(a,'/mycli arena start','MC_DUNGEON_START ');await until(async()=>/MC_DUNGEON_MOB floor=1/.test(await rcon('mycli admin dungeonaudit')),'tower wave');await stationaryEnemies();}
async function floor(n){check('isolated floor fixture '+n,(await rcon('trialrescueqa floor '+n)).includes('arrived='));await until(async()=>(await rcon('mycli admin dungeonaudit')).includes('MC_DUNGEON_MOB floor='+n),'floor spawn');await stationaryEnemies();}
async function targets(siteId){const lines=(await rcon(siteId?'mycli admin dungeons audit':'mycli admin dungeonaudit')).split('\n').filter(s=>s.startsWith(siteId?'MC_SITE_DUNGEON_MOB site='+siteId+' ':'MC_DUNGEON_MOB floor='));return lines.map(s=>({uuid:s.match(/ id=([^ ]+)/)[1],pos:coords(s)}));}
async function clear(c,siteId){for(let n=0;n<3;n++){const mobs=await targets(siteId);if(!mobs.length)return;for(const m of mobs){await tp(c,m.pos);await until(()=>Object.values(c.bot.entities).some(e=>e.uuid===m.uuid),'native enemy');const target=Object.values(c.bot.entities).find(e=>e.uuid===m.uuid);await c.bot.lookAt(target.position.offset(0,1,0),true);c.bot.attack(target);await sleep(650);}}assert.equal((await targets(siteId)).length,0,'native attacks clear the fixture wave');}
const offset=(p,x)=>[p[0]+x,p[1],p[2]];
async function down(c,siteId=false){await damage(c);const s=await rescue(c,siteId);check('lethal damage downs '+c.name,s.downed&&c.bot.health===1&&c.deaths===0,s);return s.downedTeammates.find(t=>t.uuid===c.bot.player.uuid);}
async function result(c,q,reason='success'){const j=json((await ask(c,q,'MC_SITE_DUNGEON_RESULT ')).find(s=>s.startsWith('MC_SITE_DUNGEON_RESULT ')));check(q+' -> '+reason,j.reason===reason,j);return j;}
try{
 await until(async()=>{try{return /0\.3\.96/.test(await rcon('version AgentFriend'));}catch{return false;}},'isolated startup',90000);
 check('same isolated runtime version',/0\.3\.96/.test(await rcon('version AgentFriend')));
 await rcon('minecraft:gamerule doMobSpawning false');await rcon('minecraft:gamerule keepInventory true');
 const a=await connect('TrialKnight96'),b=await connect('TrialMedic96');
 if(phase==='post'){
  const expected=JSON.parse(readFileSync(roots[0]+'/restart-expected.json','utf8'));
  await tp(b,offset(expected.towerAnchor,8));
 }
 const c=await connect('TrialScout96'),d=await connect('TrialMage96');
 if(phase==='pre'){
  await reset();for(const x of clients){await fixture(x);await tp(x,[-540.5,67,-452.5]);}
  await rcon('minecraft:gamemode spectator '+c.name);await tp(c,[-593.5,91,-312.5]);
  await rcon(`minecraft:give ${a.name} minecraft:diamond[minecraft:custom_name='{"text":"救援元数据留存"}',minecraft:enchantments={levels:{"minecraft:unbreaking":2}}]`);
  const originalInventory=inventory(await audit(a));
  await start(a,b);
  const mobs=await rcon('trialrescueqa mobs');check('normal floor one restores three legacy zombies',(mobs.match(/type=ZOMBIE/g)||[]).length===3&&!mobs.includes('WITCH'),mobs);check('normal legacy health and weapons',!mobs.includes('IRON_SWORD')&&mobs.includes('max=23.0')&&mobs.includes('STONE_SWORD')&&mobs.includes('STONE_AXE'),mobs);
  check('observer is not a participant',(await ask(c,'/mycli arena status')).some(s=>s.includes('MC_DUNGEON status participant=false')));
  const floorLine=(await ask(a,'/mycli arena status')).find(s=>s.startsWith('MC_DUNGEON floor='));const center=coords(floorLine);
  await tp(a,offset(center,-2));await tp(b,offset(center,8));const point=await down(a);const anchor=[point.x,point.y,point.z];
  check('team receives actionable system rescue instruction',b.lines.some(s=>s.includes('[系统·队友救援]')&&s.includes('连续停留10秒')));
  const oldPos=a.bot.entity.position.clone();a.bot.setControlState('forward',true);await sleep(1300);a.bot.clearControlStates();await sleep(350);check('downed native movement is anchored',a.bot.entity.position.distanceTo(oldPos)<.4,{client:a.bot.entity.position,server:await rcon('minecraft:data get entity '+a.name+' Pos')});
  await ask(a,'/mycli cast heal','MC_TRIAL_RESCUE ');check('downed cast is rejected',a.lines.some(s=>s.includes('status=denied reason=downed')));
  await rcon('minecraft:effect give '+a.name+' minecraft:instant_health 1 10 true');await damage(a);check('downed cannot be killed or healed around rescue',a.bot.health===1&&a.deaths===0,await audit(a));
  check('downed keeps complete native inventory metadata',inventory(await audit(a))===originalInventory);
  await tp(b,offset(anchor,3));await sleep(3100);let s=await rescue(a);check('three seconds does not revive',s.downed&&s.downedTeammates[0].progressMs<10000,s);
  await tp(b,offset(anchor,7));await sleep(400);s=await rescue(a);check('leaving four-block radius resets progress',s.downed&&s.downedTeammates[0].progressMs===0,s);
  await tp(b,offset(anchor,3));await sleep(10100);await until(async()=>!(await rescue(a)).downed,'ten second proximity revive');check('proximity revive restores ten health without death',a.bot.health===10&&a.deaths===0,await audit(a));
  await tp(b,offset(anchor,8));await down(a);const clearAt=Date.now();await clear(b);await until(async()=>!(await rescue(a)).downed,'clear auto revive');check('cleared floor automatically revives without ten-second rescue',Date.now()-clearAt<10000&&a.deaths===0);
  await floor(6);const sixth=await rcon('trialrescueqa mobs');check('normal sixth floor keeps original seven mobs and one witch',(sixth.match(/TRIAL_QA_MOB/g)||[]).length===7&&(sixth.match(/type=WITCH/g)||[]).length===1&&!sixth.includes('RAVAGER'),sixth);
  const sixthLine=(await ask(a,'/mycli arena status')).find(s=>s.startsWith('MC_DUNGEON floor='));const sixthCenter=coords(sixthLine);await tp(a,offset(sixthCenter,-2));await tp(b,offset(sixthCenter,8));await down(a);a.bot.quit('offline clear test');await sleep(600);await clear(b);await sleep(11000);
  const a2=await connect(a.name);await until(async()=>!(await rescue(a2)).downed,'offline cleared teammate recovered');check('offline clear reconnects to current rest floor',(await ask(a2,'/mycli arena status')).some(s=>s.includes('selfFloor=7')),a2.lines.slice(-8));check('offline clear preserves native inventory',inventory(await audit(a2))===originalInventory);
  // Active normal tower checkpoint with a downed member and interrupted rescue.
  await floor(2);const current=coords((await ask(a2,'/mycli arena status')).find(s=>s.startsWith('MC_DUNGEON floor=')));await tp(a2,offset(current,-2));await tp(b,offset(current,8));const k=await down(a2);await tp(b,offset([k.x,k.y,k.z],3));await sleep(3300);
  check('plugin state exposes rescue instructions without changing schema',a2.states.some(v=>v.schemaVersion===1&&v.trialRescue?.downed&&v.trialRescue.instruction.includes('10秒')));
  const towerStateBeforeDisconnect=await rescue(b);
  a2.bot.quit('retain tower downed checkpoint before independent site setup');b.bot.quit('pause tower without completing rescue');
  // Independent site run carries the same downed checkpoint across the same restart.
  await fixture(c);await fixture(d);const info=json((await ask(c,'/mycli dungeon info bunker','MC_SITE_DUNGEON_INFO ')).find(s=>s.startsWith('MC_SITE_DUNGEON_INFO ')));const siteCenter=info.start.map((v,i)=>v+(i===1?0:.5));await tp(c,siteCenter);await tp(d,offset(siteCenter,5));await result(c,'/mycli dungeon start bunker normal');await result(d,'/mycli dungeon join bunker');await until(async()=>(await targets('bunker')).length>0,'site wave');await stationaryEnemies();const siteDown=await down(c,true);
  check('site and tower downed teams are isolated',towerStateBeforeDisconnect.downedTeammates.every(t=>t.uuid===a2.bot.player.uuid)&&(await rescue(d,true)).downedTeammates.every(t=>t.uuid===c.bot.player.uuid));
  const expected={sha256:report.sha256,originalInventory,towerPlayer:a2.name,towerAnchor:[k.x,k.y,k.z],siteCenter,siteAnchor:[siteDown.x,siteDown.y,siteDown.z]};for(const root of roots)writeFileSync(root+'/restart-expected.json',JSON.stringify(expected,null,2));
 }else{
  const expected=JSON.parse(readFileSync(roots[0]+'/restart-expected.json','utf8'));check('same final JAR survives normal restart',expected.sha256===report.sha256);
  for(const x of clients)await fixture(x);
  await until(async()=>(await targets()).length>0&&(await targets('bunker')).length>0,'both resumed waves');
  await stationaryEnemies();
  let as=await rescue(a),cs=await rescue(c,true);check('normal restart preserves tower and site downed members',as.downed&&cs.downed,{as,cs});
  let t=as.downedTeammates.find(x=>x.uuid===a.bot.player.uuid),anchor=[t.x,t.y,t.z];await tp(b,offset(anchor,8));await sleep(500);check('partial rescue progress is not carried across restart',(await rescue(a)).downedTeammates[0].progressMs===0);
  await tp(b,offset(anchor,3));await sleep(10100);await until(async()=>!(await rescue(a)).downed,'tower restart rescue');check('restart rescue retains item metadata',inventory(await audit(a))===expected.originalInventory);
  const siteAnchor=expected.siteAnchor;await tp(d,offset(siteAnchor,3));await sleep(10100);await until(async()=>!(await rescue(c,true)).downed,'site restart rescue');check('site session id survives restart and permits same-team rescue',c.bot.health===10);
  await tp(b,offset(anchor,8));await down(a);await damage(b);await until(async()=>(await rcon('mycli admin dungeonaudit')).includes('towerActive=false'),'tower wipe');check('all down ends only their tower and evacuates to entrance',a.bot.entity.position.y>85&&b.bot.entity.position.y>85&&!(await rescue(a)).downed&&a.deaths===0&&b.deaths===0);check('tower wipe does not terminate independent site',(await site(c)).participant);check('wipe keeps native inventory metadata',inventory(await audit(a))===expected.originalInventory);
  // Same-site outsider at point blank range must not count as a rescuer.
  await tp(c,expected.siteCenter);await tp(d,offset(expected.siteCenter,8));const point=await down(c,true);await tp(a,[point.x,point.y,point.z]);await sleep(10500);check('nonparticipant cannot rescue a different team',(await rescue(c,true)).downed);
  await clear(d,'bunker');await until(async()=>!(await rescue(c,true)).downed,'site room-clear revival');check('cleared building room revives its downed teammate',(await site(c)).stage===2);
  await tp(c,expected.siteCenter);await tp(d,offset(expected.siteCenter,8));await down(c,true);await damage(d);await until(async()=>!(await site(c)).active,'site wipe');check('all down ends building challenge and recovers both members',!(await rescue(c,true)).downed&&c.deaths===0&&d.deaths===0);
  await tp(c,[-540.5,67,-452.5]);await tp(d,[-540.5,67,-452.5]);await tp(a,[-540.5,67,-452.5]);await reset();
  await start(a,b,'adventure');let mobs=await rcon('trialrescueqa mobs');check('adventure keeps strengthened witches and iron weapons',(mobs.match(/type=WITCH/g)||[]).length===2&&mobs.includes('max=51.0')&&mobs.includes('weapon=IRON_SWORD'),mobs);await reset();
  await start(a,b,'apocalypse');mobs=await rcon('trialrescueqa mobs');check('apocalypse keeps strengthened witches',(mobs.match(/type=WITCH/g)||[]).length===2&&mobs.includes('max=75.0'),mobs);await reset();
  await tp(b,[-540.5,67,-452.5]);await start(a,null);const beforeDeaths=a.deaths;await damage(a);await until(()=>a.deaths>beforeDeaths,'solo vanilla death');check('single player remains normal vanilla death',!(await rescue(a)).downed);check('keepInventory remains true',(await rcon('minecraft:gamerule keepInventory')).includes('true'));await reset();
 }
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(e);}
finally{
 for(const c of clients){c.bot.clearControlStates();c.bot.quit('isolated trial rescue test complete');}
 report.finishedAt=new Date().toISOString();report.clients=clients.map(c=>({name:c.name,deaths:c.deaths,position:c.bot.entity?.position,error:c.error,lastMessages:c.lines.slice(-8)}));
 for(const root of roots)writeFileSync(root+'/'+phase+'-'+report.finishedAt.replaceAll(':','-')+'.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));
}
