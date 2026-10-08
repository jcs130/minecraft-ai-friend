// Native movement through the copied buildings. No digging, placing, or production access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const routeRequire=createRequire('E:/MC/ops/repairs/dungeon-network-20261008/routes-runtime/package.json');
const {pathfinder,Movements,goals}=routeRequire('mineflayer-pathfinder'),mf=require('mineflayer');
const stage='E:/MC/staging/life-buildings-20261003',rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,at:new Date().toISOString(),checks:[],sha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.95.jar')).digest('hex')};
let bot;
try{
 assert.match(await rcon('mycli admin dungeons audit'),/ready=true sites=3/);
 await rcon('minecraft:whitelist add SiteRoute95');bot=mf.createBot({host:'127.0.0.1',port:25567,username:'SiteRoute95',auth:'offline',version:'1.20.6'});bot.loadPlugin(pathfinder);
 const lines=[],states=[],effects=[];bot.on('messagestr',s=>lines.push(s));bot._client.on('packet',(p,m)=>{if(m.name==='custom_payload'&&p.channel==='mcagent:state')states.push(JSON.parse(p.data.toString()));if(/title|sound|particle/.test(m.name))effects.push(m.name);});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j)});bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state')});
 await rcon('minecraft:effect give SiteRoute95 minecraft:regeneration 9999 10 true');await rcon('minecraft:effect give SiteRoute95 minecraft:resistance 9999 4 true');
 await rcon('minecraft:tp SiteRoute95 -593.5 91 -312.5');await sleep(1500);bot.chat('/mycli skills learn travel');await sleep(1500);
 const until=async fn=>{for(let n=0;n<100;n++){if(fn())return;await sleep(100);}throw Error('native travel result timeout');};await until(()=>states.length>0);
 const before=states.at(-1),effectIndex=effects.length;bot.chat('/mycli dungeon travel undead_crypt');await until(()=>lines.some(s=>s.startsWith('MC_TRAVEL id=dungeon:undead_crypt mana=8 ')));await until(()=>states.at(-1)?.mana?.current<before.mana.current-6);assert.ok(Math.abs(before.mana.current-states.at(-1).mana.current-8)<1,JSON.stringify({before,after:states.at(-1)}));assert.ok(Math.abs(bot.entity.position.x+425)<5&&Math.abs(bot.entity.position.y-4)<2);assert.ok(effects.slice(effectIndex).some(n=>/title/.test(n))&&effects.slice(effectIndex).some(n=>/particle/.test(n)));report.checks.push({name:'configured entrance travel charges eight real mana and emits native effects',manaBefore:before.mana.current,manaAfter:states.at(-1).mana.current});console.log('PASS paid safe entrance and native spell effects');
 await rcon('minecraft:effect give SiteRoute95 minecraft:regeneration 9999 10 true');await rcon('minecraft:effect give SiteRoute95 minecraft:resistance 9999 4 true');await rcon('minecraft:effect give SiteRoute95 minecraft:night_vision 9999 0 true');
 const moves=new Movements(bot);moves.canDig=false;moves.allow1by1towers=false;moves.allowFreeMotion=false;moves.scafoldingBlocks=[];moves.allowParkour=false;bot.pathfinder.setMovements(moves);bot.pathfinder.thinkTimeout=30000;
 for(const [id,points] of [['undead_crypt',[[-425,4,677],[-420,4,649],[-425,0,663],[-425,4,677]]],['creeping_crypt',[[1159,45,209],[1147,45,223],[1164,45,246],[1159,45,209]]],['bunker',[[-1182,18,-1547],[-1170,18,-1553],[-1182,18,-1547]]]]){
  const p=points[0];await rcon(`minecraft:tp SiteRoute95 ${p[0]+.5} ${p[1]} ${p[2]+.5}`);await sleep(1500);
  for(const target of points.slice(1)){
   const start=bot.entity.position.clone(),began=Date.now();
   let timer;try{await Promise.race([bot.pathfinder.goto(new goals.GoalNear(...target,2)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('native walk timeout '+id+' '+target)),60000);})]);}finally{clearTimeout(timer);}
   const detail={id,target,start:start.toArray(),end:bot.entity.position.toArray(),elapsedMs:Date.now()-began};report.checks.push(detail);console.log('PASS walked '+id+' '+target);
  }
 }
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(e);}
finally{if(bot){bot.pathfinder.stop();bot.quit();}report.finishedAt=new Date().toISOString();for(const root of ['E:/MC/ops/repairs/dungeon-network-20261008','F:/MC-backups/repairs/dungeon-network-20261008'])writeFileSync(root+'/routes-'+report.finishedAt.replaceAll(':','-')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
