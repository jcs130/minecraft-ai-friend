/** Restart boundary for the real isolated checkpoint test, including final CLI help. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const out=process.argv[2],stage='E:/MC/staging/vortex-takeover-20261027';assert(out?.startsWith('E:/MC/ops/repairs/rpg-checkpoint-20261029-'));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const before=JSON.parse(await fs.readFile(out+'/checkpoint-audit.json','utf8'));assert(before.mechanismsComplete);
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),bots=[],report={checks:[],receipts:[],productionChanged:false};
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(fn,label,ms=30000)=>{for(const end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await sleep(150);}throw Error('timeout '+label);};
const rc=async q=>{const s=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,text:s});return s;};
async function connect(name){const b=mf.createBot({host:'127.0.0.1',port:25928,username:name,version:'1.21.1',auth:'offline',respawn:true,hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn');b.physicsEnabled=false;return b;}
async function chat(b,q){await sleep(Math.max(0,1100-(Date.now()-(b.lastChat??0))));b.lastChat=Date.now();const mark=b.messages.length;b.chat(q);await sleep(250);return mark;}
async function state(b,id){const mark=await chat(b,'/mycli dungeon status '+id+' --json');const s=await until(()=>b.messages.slice(mark).find(s=>s.startsWith('MC_SITE_DUNGEON_STATE ')),'state');const v=JSON.parse(s.slice('MC_SITE_DUNGEON_STATE '.length));report.receipts.push({name:b.username,id,state:v});return v;}
try{
 const [a,b,x]=await Promise.all(before.beforeCold.names.slice(0,3).map(connect));await sleep(600);
 const team=await state(a,'qa_team_retry'),solo=await state(x,'qa_solo_retry');
 check('normal cold restart preserves the shared team failure count',team.active&&team.failures===1&&team.attemptsRemaining===2&&team.stage===before.beforeCold.team.stage);
 check('normal cold restart preserves the solo failure count',solo.active&&solo.failures===1&&solo.attemptsRemaining===2);
 check('cleared room attendance is not awarded again by restart',team.attendance===before.beforeCold.team.attendance&&team.checkpointRoom===1);
 const buddy=await state(b,'qa_team_retry');check('run roster still contains both teammates after native party session expires',buddy.participant&&buddy.run===team.run);
 check('repeated status queries never spend or refill chances',(await state(a,'qa_team_retry')).failures===1);
 const free=a.inventory.items().filter(i=>i.name==='diamond').reduce((n,i)=>n+i.count,0);check('actual retained inventory survives restart',free===3);
 let mark=await chat(a,'/mycli help arena.stash');await until(()=>a.messages.slice(mark).some(s=>s.includes('无需学习')||s.includes('无需开界面')),'new storage help');
 check('live help describes common remote storage without obsolete training',!a.messages.slice(mark).some(s=>s.includes('需先学travel')));
 mark=await chat(a,'/mycli help dungeon.start');await until(()=>a.messages.slice(mark).some(s=>s.includes('第三次战败')),'checkpoint help');check('live help explains the actual checkpoint and Boss-lock rules',a.messages.slice(mark).some(s=>s.includes('Boss房间')));
 for(const p of [a,b]){await rc('minecraft:tp '+p.username+' 3412.5 81 2400.5');await rc('qduse heal '+p.username);}
 await until(async()=>(await state(a,'qa_team_retry')).phase==='fighting','team resumes');await rc('qduse freezehostiles '+a.username);
 await rc('minecraft:damage @e[tag=afu_site_qa_team_retry,limit=1] 1000 minecraft:player_attack by '+a.username);
 const next=await until(async()=>{const s=await state(a,'qa_team_retry');return s.stage===3?s:false;},'next room after restart');
 check('team can continue clearing rooms after a real restart',next.checkpointRoom===2&&next.failures===1&&next.attendance===2);
 for(const p of [a,b])await chat(p,'/mycli dungeon leave --json');await chat(x,'/mycli dungeon leave --json');await sleep(600);
 const audit=await rc('mycli admin dungeons audit');check('isolated test leaves no active challenge',/activeRuns=0\b/.test(audit));report.complete=true;await rc('minecraft:stop');
}catch(error){report.failed=String(error);throw error;}
finally{for(const b of bots)b.quit();await fs.writeFile(out+'/checkpoint-cold-audit.json',JSON.stringify(report,null,2)+'\n');}
