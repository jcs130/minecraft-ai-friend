import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
// This regression starts a real QA player and trial: require an isolated clone.
const stage=process.env.MC_STAGE_PAPER,ops=process.env.MC_TEST_OPS,root=process.env.MC_TEST_REPORT_DIR;
if(!stage||!ops||!root||!process.env.MC_TEST_REQUIRE_FROM)throw Error('Set MC_STAGE_PAPER, MC_TEST_OPS, MC_TEST_REPORT_DIR and MC_TEST_REQUIRE_FROM');
const propertiesPath=resolve(stage,'server.properties');
const properties=readFileSync(propertiesPath,'utf8');
const prop=key=>properties.split(/\r?\n/).find(l=>l.startsWith(key+'='))?.slice(key.length+1).trim();
const port=Number(prop('server-port')),rconPort=Number(prop('rcon.port'));
if(prop('server-ip')!=='127.0.0.1'||port===25565||rconPort===25575||!port||!rconPort)throw Error('Requires loopback isolated Paper with separate game and RCON ports');
if(existsSync(resolve(root,'.complete')))throw Error('Evidence frozen');
mkdirSync(root,{recursive:true});
const jars=readdirSync(resolve(stage,'plugins')).filter(n=>/^AgentFriend-[0-9.]+\.jar$/.test(n));
if(jars.length!==1)throw Error('Expected exactly one AgentFriend fixture JAR');
const candidateSha256=createHash('sha256').update(readFileSync(resolve(stage,'plugins',jars[0]))).digest('hex');
const {command}=await import(pathToFileURL(resolve(ops,'rcon-client.mjs')));
const {fix1206PotionProtocol}=await import(pathToFileURL(resolve(ops,'minecraft-1206-potion.mjs')));
const {installRecipePacketBypass}=await import(pathToFileURL(resolve(ops,'mineflayer-client-compat.mjs')));
const require=createRequire(resolve(process.env.MC_TEST_REQUIRE_FROM));fix1206PotionProtocol(require);
const phase=process.argv[2];if(!['baseline','fixed','cold'].includes(phase))throw Error('Use baseline/fixed/cold');
const label=process.argv[3]||phase;if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid receipt label');
const username='YsmTQA'+label.replaceAll('-','').slice(-10);
const rcon=q=>command(q,15000,{properties:propertiesPath,port:rconPort});
const bot=require('mineflayer').createBot({host:'127.0.0.1',port,username,version:'1.20.6',auth:'offline',plugins:{physics:false},defaultChatPatterns:false,logErrors:false});
installRecipePacketBypass(bot._client);const lines=[];const report={phase,at:new Date().toISOString(),checks:[],lines,errors:[],scope:'isolated clone; QA only',candidateSha256};
bot.on('messagestr',s=>lines.push(s));bot.on('error',e=>report.errors.push(e.message));
bot._client.on('position',p=>{const v=p.position||p;if(bot.entity&&Number.isFinite(v.x))bot.entity.position.set(v.x,v.y,v.z);bot._client.write('teleport_confirm',{teleportId:p.teleportId});});
async function until(f,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await f())return;await sleep(100);}throw Error('Timeout: '+label);}
function resultSince(start,action){return lines.slice(start).filter(s=>s.startsWith('MC_WAYPOINT_RESULT ')).map(s=>JSON.parse(s.slice(19))).find(j=>j.action===action&&j.status!=='pending');}
async function call(line,action){const start=lines.length;bot.chat(line);await until(()=>resultSince(start,action),line);return resultSince(start,action);}
try{
 await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'world');
 report.audit=await rcon('mycli admin dungeonaudit');if(!report.audit.includes('active=false'))throw Error('Isolated trial active');
 await rcon('minecraft:gamemode survival '+username);
 await rcon('minecraft:tp '+username+' -543.5 66 -439.5');await sleep(500);
 let saved=await call('/mycli waypoint add 入口回程QA','add');
 if(saved.reason==='name_exists')saved=await call('/mycli waypoint update 入口回程QA','update');
 if(!saved.success)throw Error('QA point creation: '+saved.reason);report.checks.push('outside safe point recorded');
 bot.chat('/mycli skills learn travel');await sleep(700);
 bot.chat('/mycli goto arena');await until(()=>lines.some(s=>s.includes('已到试炼场入口')),'arena entrance');
 report.entrance=await rcon('minecraft:data get entity '+username+' Pos');
 const trip=await call('/mycli goto personal:入口回程QA','teleport');report.firstTrip=trip;
 if(phase==='baseline'){
  if(trip.reason!=='in_activity')throw Error('Expected existing bug');report.checks.push('BUG reproduced: inactive lobby incorrectly denies departure as in_activity');
  bot.chat('/mycli arena leave');await sleep(300);
  const again=await call('/mycli goto personal:入口回程QA','teleport');if(again.reason!=='in_activity')throw Error('Expected persistent location denial');report.checks.push('BUG persists after arena leave because only location caused the denial');
 }else{
  if(!trip.success||trip.spentMana!==6)throw Error('Departure: '+trip.reason);report.checks.push('inactive lobby departure succeeds and charges six mana');
  const secondStart=lines.length;bot.chat('/mycli goto arena');await until(()=>lines.slice(secondStart).some(s=>s.includes('已到试炼场入口')),'second actual arena arrival');
  bot.chat('/mycli waypoint remove 试炼禁设QA');await sleep(250);
  const record=await call('/mycli waypoint add 试炼禁设QA','add');if(record.success||record.reason!=='activity_area')throw Error('Activity destination recording allowed');report.checks.push('activity structure cannot become a custom teleport destination');
  if(record.errorMessage?.includes('正在活动')||record.nextAction?.includes('leave')||!record.nextAction?.includes('未参战访客'))throw Error('Protected area advice falsely claims participation');report.checks.push('private advice explains protected destination without falsely claiming active participation');
  const startIndex=lines.length;bot.chat('/mycli arena start');await sleep(500);
  const cooldown=lines.slice(startIndex).map(s=>s.match(/^试炼场休息中，还需 (\d+) 秒/)).find(Boolean);
  if(cooldown){const seconds=Number(cooldown[1]);if(seconds>180)throw Error('Unexpected fixture cooldown');await sleep((seconds+1)*1000);bot.chat('/mycli arena start');}
  await until(async()=>/active=true/.test(await rcon('mycli admin dungeonaudit')),'real active trial');
  const active=await call('/mycli goto personal:入口回程QA','teleport');if(active.success||active.reason!=='in_activity')throw Error('Active battle escape allowed');report.checks.push('actual trial participant remains denied');
  bot.chat('/mycli arena leave');await until(async()=>/active=false/.test(await rcon('mycli admin dungeonaudit')),'leave trial');
 }
 report.success=true;
}catch(e){report.success=false;report.errors.push(e.message);process.exitCode=1;}
finally{bot.quit();writeFileSync(root+'/'+label+'-protocol.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({success:report.success,checks:report.checks,errors:report.errors}));setTimeout(()=>process.exit(report.success?0:1),400);}
