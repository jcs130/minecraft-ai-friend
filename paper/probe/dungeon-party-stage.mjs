// Opt-in multiplayer and shared attendance/reward checks on the isolated native server.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mf=require('mineflayer');
const stage='E:/MC/staging/life-buildings-20261003',roots=['E:/MC/ops/repairs/dungeon-network-20261008','F:/MC-backups/repairs/dungeon-network-20261008'];
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms)),parse=s=>JSON.parse(s.slice(s.indexOf('{')));
const report={at:new Date().toISOString(),passed:false,checks:[],sha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.95.jar')).digest('hex').toUpperCase()},clients=[];
const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150);}throw Error(label+' timeout');}
async function connect(name){const allow=await rcon('minecraft:whitelist add '+name);assert.ok(allow.includes('Added'),'fresh QA identity required');const bot=mf.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'}),c={name,bot,lines:[],last:0};clients.push(c);bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>c.error=String(e));await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j)});await rcon('minecraft:effect give '+name+' minecraft:resistance 9999 4 true');await rcon('minecraft:effect give '+name+' minecraft:strength 9999 100 true');return c;}
async function ask(c,q,prefix){await sleep(Math.max(0,1200-(Date.now()-c.last)));const n=c.lines.length;c.last=Date.now();c.bot.chat(q);await until(()=>c.lines.slice(n).some(s=>s.startsWith(prefix)),q);return parse(c.lines.slice(n).find(s=>s.startsWith(prefix)));}
async function result(c,q,reason='success'){const data=await ask(c,q,'MC_SITE_DUNGEON_RESULT ');check(q+' '+c.name+' -> '+reason,data.reason===reason,data);return data;}
const state=c=>ask(c,'/mycli dungeon status','MC_SITE_DUNGEON_STATE ');
async function tp(c,p){await rcon(`minecraft:tp ${c.name} ${p[0]+.5} ${p[1]} ${p[2]+.5}`);await until(()=>c.bot.entity.position.distanceTo({x:p[0]+.5,y:p[1],z:p[2]+.5})<2,'native position acknowledgement');await sleep(250);}
async function enemies(){return (await rcon('mycli admin dungeons audit')).split('\n').filter(s=>s.startsWith('MC_SITE_DUNGEON_MOB site=bunker ')).map(s=>({id:s.match(/ id=([^ ]+)/)[1],type:s.match(/ type=([^ ]+)/)[1],health:Number(s.match(/ health=([^ ]+)/)[1]),point:['x','y','z'].map(k=>Number(s.match(new RegExp(' '+k+'=([^ ]+)'))[1]))}));}
async function killWave(c){for(let pass=0;pass<4;pass++){const remaining=await enemies();if(!remaining.length)return;for(const mob of remaining){await tp(c,mob.point);await until(()=>Object.values(c.bot.entities).some(e=>e.uuid===mob.id),'native hostile');const e=Object.values(c.bot.entities).find(e=>e.uuid===mob.id);await c.bot.lookAt(e.position.offset(0,1,0),true);c.bot.attack(e);await sleep(700);if(Object.values(c.bot.entities).some(e=>e.uuid===mob.id)){c.bot.attack(e);await sleep(700);}}}assert.equal((await enemies()).length,0);}
try{
 check('tested runtime is loaded',/0\.3\.95/.test(await rcon('version AgentFriend')));
 const a=await connect('SiteParty95A'),b=await connect('SiteParty95B'),visitor=await connect('SiteParty95C'),first=[-1182,18,-1547],second=[-1170,18,-1553];
 for(const c of clients)await tp(c,first);
 await result(a,'/mycli dungeon start bunker normal');await result(b,'/mycli dungeon join bunker');
 const status=await state(b);check('explicit join gives the second member participation',status.participant===true);check('nearby outsider is not enrolled',(await state(visitor)).participant===false);
 await until(async()=>(await enemies()).length===4,'two-member wave');
 const wave=await enemies();check('two-member enemies use actual 1.2 health scaling',wave.filter(e=>e.type==='PILLAGER').every(e=>Math.abs(e.health-40.8)<.1),wave);
 await killWave(a);await until(async()=>(await state(b)).stage===2,'shared first clear');
 for(const c of clients)await tp(c,second);await until(async()=>(await enemies()).length===4,'second cooperative room');await killWave(a);
 await until(async()=>(await state(b)).phase==='returning','shared physical return required');
 await result(b,'/mycli dungeon claim bunker','no_pending_reward');
 for(const c of clients)await tp(c,first);
 for(const c of [a,b]){await until(async()=>(await state(c)).pendingRewards?.includes('bunker'),'separate earned receipt '+c.name);await result(c,'/mycli dungeon claim bunker');await result(c,'/mycli dungeon claim bunker','no_pending_reward');}
 await result(visitor,'/mycli dungeon claim bunker','no_pending_reward');
 check('cooperative run cleans owned enemies',(await rcon('mycli admin dungeons audit')).includes('activeRuns=0 trackedMobs=0'));
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(e);}
finally{for(const c of clients){c.bot.quit();await rcon('minecraft:whitelist remove '+c.name);}report.finishedAt=new Date().toISOString();for(const root of roots)writeFileSync(root+'/party-'+report.finishedAt.replaceAll(':','-')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
