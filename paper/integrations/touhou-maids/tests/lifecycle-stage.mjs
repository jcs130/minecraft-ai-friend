// Real native lifecycle in an explicitly fresh, loopback-only synthetic world.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
const stage=process.env.MAID_LIFE_QA_STAGE,anchor=process.env.MAID_LIFE_QA_CLIENT_ANCHOR;
assert(stage&&anchor&&process.env.MAID_LIFE_QA_RCON&&process.env.MAID_LIFE_QA_REPORT);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const {command}=await import(pathToFileURL(process.env.MAID_LIFE_QA_RCON));
const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const mode=process.argv[2],phase=process.argv[3];assert(['baseline','candidate'].includes(mode)&&['setup','restart'].includes(phase));
const fixture=stage+'/lifecycle-'+mode+'.json',username='MaidLifeQA';
const report={mode,phase,checks:[],productionChanged:false,realCredentialsUsed:false};
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);};
const until=async(fn,label,ms=25000)=>{for(let end=Date.now()+ms;Date.now()<end;){const x=await fn();if(x)return x;await delay(150);}throw Error('timeout: '+label);};
const ints=id=>{const b=Buffer.from(id.replaceAll('-',''),'hex');return [...Array(4)].map((_,i)=>b.readInt32BE(i*4)).join(',');};
const responses=[],lines=[];let bot,data=phase==='restart'?JSON.parse(await fs.readFile(fixture,'utf8')):{maid:randomUUID()};
let seq=0;
const ask=async(action,value='')=>{
 const id='life_'+Date.now()+'_'+(++seq);await delay(1100);const start=responses.length;
 bot.chat(`/qdmaid ${action} ${data.maid} ${id}${value?' '+value:''}`);
 const reply=await until(()=>responses.slice(start).find(r=>r.action===action&&r.requestId===id),action);
 assert(reply.ok,'synthetic command rejected: '+reply.error);return reply.data;
};
const summon=async()=>{
 await rc(`minecraft:summon touhou_little_maid:maid 5.5 90 0.5 {UUID:[I;${ints(data.maid)}],Owner:[I;${ints(bot.player.uuid)}],CustomName:'"SyntheticLife"',Sitting:1b,NoAI:1b,PersistenceRequired:1b}`);
 await until(()=>Object.values(bot.entities).some(e=>e.uuid===data.maid),'synthetic original maid');await delay(700);
};
const eventFor=(type)=>responses.filter(r=>r.action==='lifecycle'&&r.data?.[type]?.maidId===data.maid);
const graveCount=async id=>{
 await rc(`minecraft:execute store result score gravecount lifeqa run minecraft:data get entity ${id} TombstoneItems.Items`);
 return Number((await rc('minecraft:scoreboard players get gravecount lifeqa')).match(/has (\d+)/)?.[1]);
};
const goodsHash=async id=>{
 assert(process.env.MAID_LIFE_QA_PYTHON,'Supply QA Python with nbtlib');await rc('minecraft:save-all flush');
 const result=await promisify(execFile)(process.env.MAID_LIFE_QA_PYTHON,['-X','utf8',fileURLToPath(new URL('./read-lifecycle-grave.py',import.meta.url)),stage,id]);
 const value=JSON.parse(result.stdout);assert.equal(value.stacks,2);return value.itemsSha256;
};
try{
 await until(async()=>{try{return (await rc('version')).includes('Youer');}catch{return false;}},'QA ready',150000);
 bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username,auth:'offline',hideErrors:true});
 bot.on('error',e=>lines.push('client-error: '+e.message));
 bot.on('messagestr',(s,p)=>{lines.push(s);if(p==='system'&&s.startsWith('QD_MAID '))try{responses.push(JSON.parse(s.slice(8)));}catch{}});
 await until(()=>bot.entity,'QA player');
 if(phase==='setup'){
  await rc('minecraft:gamerule spawnChunkRadius 0');await rc('minecraft:gamerule doMobSpawning false');
  await rc('minecraft:scoreboard objectives add lifeqa dummy');
  await rc('minecraft:fill -8 89 -8 12 89 8 minecraft:stone');await rc(`minecraft:tp ${username} 0.5 90 0.5`);
  await summon();const alive=await ask('context');check('original synthetic maid is alive',alive.lifeState==='alive');
  await rc(`minecraft:item replace entity ${username} hotbar.0 with minecraft:bow`);await ask('transfer','put 0 1 0');
  await rc(`minecraft:item replace entity ${username} hotbar.0 with minecraft:stone 3`);await ask('transfer','put 1 3 0');
  await rc(`minecraft:kill ${data.maid}`);await delay(5800);
  const dead=await ask('context');check('native death is current before recovery',dead.lifeState==='dead');
  data.grave=dead.death.tombstoneId;data.deathEvent=dead.death.eventId;
  check('native grave has film and both item stacks',await graveCount(data.grave)===3);
  await rc(`minecraft:data remove entity ${data.grave} TombstoneItems.Items[{id:"touhou_little_maid:film"}]`);
  check('synthetic film consumed once, goods retained',await graveCount(data.grave)===2);
  data.goodsHash=await goodsHash(data.grave);
  await summon();const recovered=await ask('context');check('same original UUID is alive again',recovered.lifeState==='alive');
  check('recovery has explicit fact with unknown actual revival time',recovered.recovery?.actualRevivalTimeKnown===false&&recovered.recovery?.resolvedDeathEventId===data.deathEvent);
  data.recoveryEvent=recovered.recovery?.eventId??null;
  await delay(5600);check('owner receives one persisted recovery event',eventFor('recovery').length===1&&eventFor('recovery')[0].data.recovery.persisted===true);
  await ask('context');await delay(5300);check('same connection does not repeat recovery',eventFor('recovery').length===1);
  await rc('minecraft:setworldspawn 1000 90 0');await rc(`minecraft:fill 996 89 -4 1004 89 4 minecraft:stone`);await rc(`minecraft:tp ${username} 1000.5 90 0.5`);
  for(let n=0;n<20;n++){const s=await ask('context');if(s.loaded===false){data.unloaded=s;break;}await delay(1000);}
  check('the native entity actually unloaded',data.unloaded?.loaded===false);
  check('old grave cannot classify the unloaded recovered maid as dead',data.unloaded?.lifeState==='unloaded_or_unavailable'&&!data.unloaded?.death);
  await rc('minecraft:save-all flush');await fs.writeFile(fixture,JSON.stringify(data,null,2));
 }else{
  const unloaded=await ask('context');report.restartState=unloaded;
  check('original remains physically unloaded after restart',unloaded.loaded===false);
  check('restart does not turn the old grave into a new death',unloaded.lifeState==='unloaded_or_unavailable'&&!unloaded.death);
  if(mode==='candidate'){
   check('restart retains original recovery id',unloaded.recovery?.eventId===data.recoveryEvent);
   check('old grave is history, not current death',unloaded.historicalDeath?.tombstoneId===data.grave);
   await rc(`minecraft:tp ${username} 0.5 90 0.5`);await until(async()=>(await ask('context')).lifeState==='alive','original reloaded');
   check('old grave goods survive recovery, unload and restart',await graveCount(data.grave)===2&&(await goodsHash(data.grave))===data.goodsHash);
   await rc(`minecraft:kill ${data.maid}`);await delay(5800);const again=await ask('context');
   check('a real second death is detected',again.lifeState==='dead');
   check('second death is a different episode and tombstone',again.death?.eventId!==data.deathEvent&&again.death?.tombstoneId!==data.grave);
   check('second death leaves original grave items intact',await graveCount(data.grave)===2&&(await goodsHash(data.grave))===data.goodsHash);
   report.secondDeath=again.death;
  }
 }
}catch(e){report.failure=String(e);console.log(report.failure);}
finally{
 bot?.quit();report.responses=responses;report.pass=!report.failure&&report.checks.every(c=>c.ok);
 await fs.writeFile(process.env.MAID_LIFE_QA_REPORT,JSON.stringify(report,null,2));
 console.log(JSON.stringify({pass:report.pass,mode,phase,checks:report.checks,failure:report.failure,productionChanged:false}));
 if(!report.pass)process.exitCode=1;
}
