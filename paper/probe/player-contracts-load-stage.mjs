// Sixteen independent ordinary protocol clients and a real spectator; isolation only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mf=require('mineflayer');
const stage='E:/MC/staging/life-buildings-20261003',roots=['E:/MC/ops/repairs/player-contracts-20261008','F:/MC-backups/repairs/player-contracts-20261008'];
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,startedAt:new Date().toISOString(),candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.93.jar')).digest('hex').toUpperCase(),checks:[]},clients=[];
function check(name,ok,detail){report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);}
async function until(f,label){const end=Date.now()+18000;while(Date.now()<end){if(f())return;await sleep(80);}throw Error(label+' timeout');}
async function join(name){await rcon('minecraft:whitelist add '+name);let b=mf.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'}),c={name,bot:b,lines:[],packets:[],ended:false};clients.push(c);b.on('messagestr',s=>c.lines.push(s));b.on('error',e=>c.error=String(e));b.on('end',()=>c.ended=true);b._client.on('camera',p=>c.cameraPacket=p);b._client.on('custom_payload',p=>{if(['mcagent:state','mcviewer:state'].includes(p.channel))try{c.packets.push({channel:p.channel,...JSON.parse(p.data.toString())});}catch{}});await new Promise((r,j)=>{b.once('spawn',r);b.once('kicked',j);b.once('error',j)});b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state\0mcviewer:state\0mcagent:commission')});return c;}
async function ask(c,q,prefix){const n=c.lines.length;await sleep(Math.max(0,1200-(Date.now()-(c.last??0))));c.last=Date.now();c.bot.chat(q);await until(()=>c.lines.slice(n).some(s=>s.startsWith(prefix)),q);}
try{
 const names=Array.from({length:16},(_,i)=>'CommLoad93_'+String(i).padStart(2,'0')),registry={schemaVersion:1,pairs:names.map((agent,i)=>({agent,eye:i===0?'CommEye93':'CommCam93_'+String(i).padStart(2,'0')}))};writeFileSync(stage+'/agent-eye-pairs.json',JSON.stringify(registry));await sleep(5500);
 const agents=[];for(const name of names){let c=await join(name);agents.push(c);await rcon('minecraft:tp '+name+' 1710 150 1710');}
 const eye=await join('CommEye93');await rcon('minecraft:gamemode spectator CommEye93');await rcon('minecraft:spectate '+names[0]+' CommEye93');await sleep(1600);
 report.beforeChunks=await rcon('paper chunkinfo');report.beforeMspt=await rcon('mspt');const start=Date.now();
 for(const [q,prefix] of [['/mycli commission list','MC_COMMISSION_LIST '],['/mycli arena stash list 10','MC_STASH_SUMMARY '],['/mycli skills points','MC_SKILL_POINTS '],['/mycli explain commission.claim','MC_CLI_DETAIL ']])await Promise.all(agents.map(c=>ask(c,q,prefix)));
 await sleep(6000);report.elapsedMs=Date.now()-start;report.afterChunks=await rcon('paper chunkinfo');report.mspt=await rcon('mspt');report.eye={targetAgent:names[0],targetEntityId:agents[0].bot.entity.id,cameraPacket:eye.cameraPacket};
 check('all sixteen ordinary clients receive new private contract replies',agents.every(c=>c.lines.some(s=>s.startsWith('MC_COMMISSION_LIST '))));
 check('all sixteen old stash commands see ten-page capacity',agents.every(c=>c.lines.some(s=>s.startsWith('MC_STASH_SUMMARY ')&&s.includes('capacity=540'))));
 check('all sixteen old state channels keep schema one and mana',agents.every(c=>c.packets.some(p=>p.channel==='mcagent:state'&&p.schemaVersion===1&&p.abilities&&p.mana)));
 check('real registered Eye stays attached and receives private contract text',eye.cameraPacket?.cameraId===agents[0].bot.entity.id&&eye.lines.some(s=>s.startsWith('MC_COMMISSION_LIST ')),report.eye);
 check('Eye receives legacy viewer state without client changes',eye.packets.some(p=>p.channel==='mcviewer:state'&&p.schemaVersion===1&&p.abilities&&p.mana));
 check('all seventeen clients stay connected',clients.every(c=>!c.ended&&!c.error));
 const average=Number(report.mspt.replace(/§[0-9A-FK-OR]/gi,'').match(/◴\s*([\d.]+)/)?.[1]);check('bounded warm-area workload stays below 50ms average tick',Number.isFinite(average)&&average<50,report.mspt);
 report.passed=true;
}catch(e){report.error=String(e.stack||e);console.error(e);process.exitCode=1;}
finally{report.messages=Object.fromEntries(clients.map(c=>[c.name,c.lines]));for(const c of clients)c.bot.quit('isolated load checks complete');await sleep(500);report.finishedAt=new Date().toISOString();for(const root of roots)writeFileSync(root+'/load-'+new Date().toISOString().replaceAll(':','-')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,mspt:report.mspt}));}
