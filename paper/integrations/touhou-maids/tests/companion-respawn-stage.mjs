import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const {createBot}=createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const stage=process.env.PLAYER_NAVIGATION_STAGE,phase=process.env.QA_PHASE;
assert(stage&&['baseline','candidate','restart'].includes(phase));
assert.equal(await readFile(stage+'/.player-navigation-qa','utf8'),'SYNTHETIC_PLAYER_NAVIGATION_ONLY');
const props=await readFile(stage+'/server.properties','utf8');
for(const l of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(props.split(/\r?\n/).includes(l));
const rc=text=>command(text,20000,{port:26462,properties:stage+'/server.properties'});
const qa=async action=>{let s=await rc('respawnqa '+action);let m=s.match(/RESPAWN_QA (\{[^\r\n]+\})/);assert(m,s);return JSON.parse(m[1]);};
const report={synthetic:true,phase,checks:[]};let bot;
function check(name,value){report.checks.push({name,passed:!!value});console.log(value?'PASS':'FAIL',name);assert(value,name);}
async function until(fn,label,ms=20000){for(let end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await wait(200);}throw Error('timeout '+label);}
async function connect(){bot=createBot({host:'127.0.0.1',port:26461,username:'NavActorQA',auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});bot.lines=[];bot.on('messagestr',l=>bot.lines.push(l));bot.on('error',()=>{});installRecipePacketBypass(bot._client);await until(()=>bot.entity&&bot.player?.uuid,'join',45000);await wait(3000);}
try{
 if(phase==='restart'){
  const previous=JSON.parse(await readFile(stage+'/respawn-candidate.json','utf8'));
  await qa('load');let offline=await until(async()=>{let s=await qa('status');report.offline=s;return s.loaded?s:null;},'native entity reload');check('pending recovery survives normal restart with owner offline',offline.waiting&&offline.eventId===previous.pending.eventId&&offline.inventorySha256===previous.pending.inventorySha256);
  await connect();const resumed=await until(async()=>{let s=await qa('status');return s.loaded&&!s.waiting&&s.distance>=0&&s.distance<8?s:null;},'resume saved recovery');
  check('restart restores original identity and exact equipment',resumed.id===previous.pending.id&&resumed.inventorySha256===previous.pending.inventorySha256&&resumed.copies===1);
  check('restart does not create a grave',resumed.graves===previous.pending.graves);report.resumed=resumed;
 }else{
  await connect();await qa('setup');const before=await until(async()=>{let s=await qa('status');return s.loaded&&s.alive?s:null;},'native entity registration');await wait(1000);const hurt=await qa('lethal');report.before=before;report.lethal=hurt;
  if(phase==='baseline'){
   await wait(2000);let after=await qa('status');report.after=after;
   check('baseline native death lacks automatic companion respawn',!after.waiting&&(!after.alive||!after.loaded));
   check('baseline creates native recovery tombstone',after.graves>before.graves);
  }else{
   check('lethal native damage enters five-second recovery',hurt.alive&&hurt.waiting&&hurt.health===1&&hurt.respawn?.state==='waiting_for_safe_respawn');
   check('downed companion retains the original inventory without a grave',hurt.inventorySha256===before.inventorySha256&&hurt.graves===before.graves&&hurt.copies===1);
   let duplicate=await qa('repeat');check('repeated damage retains one recovery identity',duplicate.eventId===hurt.eventId&&duplicate.inventorySha256===before.inventorySha256);
   const recovered=await until(async()=>{const s=await qa('status');return s.loaded&&!s.waiting?s:null;},'automatic recovery');report.recovered=recovered;
   check('original body recovers at partner with full health',recovered.id===before.id&&recovered.health===recovered.maxHealth&&recovered.distance>=0&&recovered.distance<8&&recovered.copies===1);
   check('model voice inventory and protection policy retained',recovered.inventorySha256===before.inventorySha256&&recovered.name===before.name&&recovered.model===before.model&&recovered.voice===before.voice&&recovered.invulnerable===before.invulnerable&&recovered.noAI===before.noAI);
   check('no native grave or manual soul operation required',recovered.graves===before.graves&&recovered.respawn?.requiresTombstone===false);
   let ordinary=await qa('ordinary');await wait(1000);ordinary=await qa('status');check('other native maids retain their original death mechanics',!ordinary.ordinaryAlive&&ordinary.graves===before.graves+1);
   await qa('setup');await wait(1000);let cross=await qa('lethal');report.crossDeparture=cross;report.crossMove=await qa('crossworld');const arrived=await until(async()=>{const s=await qa('status');report.crossLast=s;return s.loaded&&!s.waiting&&s.dimension==='minecraft:the_nether'?s:null;},'cross-dimension recovery');
   check('recovery follows partner to another dimension once',arrived.inventorySha256===cross.inventorySha256&&arrived.copies===1&&arrived.distance>=0&&arrived.distance<8);
   await qa('setup');await wait(1000);let pending=await qa('lethal');bot.quit();bot=null;await wait(6500);let offline=await qa('status');
   check('offline partner preserves protected pending recovery',offline.waiting&&offline.eventId===pending.eventId&&offline.inventorySha256===pending.inventorySha256&&offline.invulnerable);
   report.pending=offline;
  }
 }
 report.success=true;
}catch(e){report.error=String(e.stack||e);report.lastLines=bot?.lines?.slice(-8);console.error(report.error);process.exitCode=1;}
finally{bot?.quit();await writeFile(stage+'/respawn-'+phase+'.json',JSON.stringify(report,null,2));}
