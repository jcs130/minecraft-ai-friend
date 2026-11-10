// Starts no service. Requires a fresh marked loopback lab with HudBaselineProbe and synthetic players.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, writeFile, realpath} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';

const options=new Map();
for(let i=2;i<process.argv.length;i+=2){
  assert(['--stage-dir','--phase','--package'].includes(process.argv[i]) && process.argv[i+1]);
  options.set(process.argv[i],process.argv[i+1]);
}
const stage=await realpath(resolve(options.get('--stage-dir'))), phase=options.get('--phase');
assert(['baseline','candidate'].includes(phase));
assert.equal((await readFile(join(stage,'.spectator-hud-qa'),'utf8')).trim(),'20261110 127.0.0.1:29541');
const properties=Object.fromEntries((await readFile(join(stage,'server.properties'),'utf8')).split(/\r?\n/)
  .filter(l=>l.includes('=')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));
assert.equal(properties['server-ip'],'127.0.0.1'); assert.equal(properties['server-port'],'29541');
assert.equal(properties['rcon.port'],'29542');
const require=createRequire(options.get('--package')??'E:/MC/probe/package.json');
const mineflayer=require('mineflayer');
const channels=['hotbar_sync','selected_slot_sync','food_sync','experience_sync'].map(c=>'spectatorplus:'+c);
const inventory='spectatorplus:inventory_sync';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const checks=[], failures=[], bots=[];
const report={phase,startedAt:new Date().toISOString(),gamePort:29541,rconPort:29542,syntheticPlayersOnly:true,checks};
function check(name,condition,details){checks.push({name,passed:Boolean(condition),...(details===undefined?{}:{details})});if(!condition)failures.push(name);}
async function rc(command){
 return await new Promise((resolveReply,reject)=>{
  const socket=net.connect(29542,'127.0.0.1');let data=Buffer.alloc(0),auth=false,reply='',settle,done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timeout);clearTimeout(settle);socket.destroy();error?reject(error):resolveReply(reply.replace(/§[0-9a-fk-or]/gi,'').trim());};
  const timeout=setTimeout(()=>finish(Error('Isolated RCON timeout')),10000);
  const frame=(id,type,text)=>{const body=Buffer.from(text),out=Buffer.alloc(body.length+14);out.writeInt32LE(body.length+10);out.writeInt32LE(id,4);out.writeInt32LE(type,8);body.copy(out,12);return out;};
  socket.on('error',finish);socket.on('connect',()=>socket.write(frame(1,3,properties['rcon.password'])));
  socket.on('data',chunk=>{data=Buffer.concat([data,chunk]);while(data.length>=12){const size=data.readInt32LE();assert(size>=10&&size<1048576);if(data.length<size+4)return;
    const id=data.readInt32LE(4),type=data.readInt32LE(8),body=data.subarray(12,size+2).toString();data=data.subarray(size+4);
    if(id===-1)return finish(Error('Isolated RCON authentication failed'));
    if(!auth&&id===1&&type===2){auth=true;socket.write(frame(2,2,command));}
    else if(auth&&id===2&&type===0){reply+=body;clearTimeout(settle);settle=setTimeout(()=>finish(),70);}
  }});
 });
}
async function until(fn,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Isolated state wait timed out');}
async function facts(command='facts'){
 const text=await rc('hudprobe '+command);const start=text.indexOf('{');assert(start>=0,text);return JSON.parse(text.slice(start));
}
async function connect(name){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:29541,username:name,auth:'offline',version:'1.21.1',hideErrors:true});
 bots.push(bot);bot.hud=[];bot.failures=[];
 bot._client.on('custom_payload',p=>{if(p.channel.startsWith('spectatorplus:'))bot.hud.push({channel:p.channel,data:Buffer.from(p.data)});});
 bot.on('error',e=>bot.failures.push(e.message));bot.on('kicked',e=>bot.failures.push(String(e)));
 await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Synthetic client spawn timeout')),15000);bot.once('spawn',()=>{clearTimeout(timer);yes();});});
 return bot;
}
function register(bot,cs=channels){bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from(cs.join('\0'))});}
const count=bot=>Object.fromEntries(channels.map(c=>[c,bot.hud.filter(p=>p.channel===c).length]));
const uuid=b=>b.subarray(0,16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
function request(bot,id,extra=0){bot._client.write('custom_payload',{channel:'spectatorplus:request_inventory_open',data:Buffer.concat([Buffer.from(id.replaceAll('-',''),'hex'),Buffer.alloc(extra)])});}
function decodeItems(bytes){let at=16;const length=bytes.readInt32BE(at);at+=4;const items=[];for(let i=0;i<length;i++){
 const known=Boolean(bytes[at++]);let size=null,sha256=null;if(known){size=bytes.readInt32BE(at);at+=4;assert(size>=0&&at+size<=bytes.length);sha256=createHash('sha256').update(bytes.subarray(at,at+size)).digest('hex');at+=size;}items.push({known,size,sha256});
 }assert.equal(at,bytes.length);return items;}

try{
 const subject=await connect('HudSubject'), eye=await connect('HudLens');
 await rc('time set noon');await rc('gamerule doDaylightCycle false');await rc('gamerule doMobSpawning false');
 await facts('fixture');let truth=await facts();await until(async()=>{truth=await facts();return truth.target===truth.subject;});
 eye.hud=[];register(eye,[...channels,inventory,'spectatorplus:screen_sync','spectatorplus:screen_cursor_sync']);await sleep(1000);
 report.initialCounts=count(eye);report.initialTruth=truth;
 for(const channel of channels)check('Late-ready initial '+channel,report.initialCounts[channel]===1,report.initialCounts[channel]);
 const initial=eye.hud.filter(p=>channels.includes(p.channel));
 check('All received initial values retain the actual target UUID',initial.length===4&&initial.every(p=>uuid(p.data)===truth.subject));
 const selected=initial.find(p=>p.channel.endsWith(':selected_slot_sync'));
 check('Selected slot is the actual held slot',selected&&selected.data.readUInt8(16)===truth.slot);
 const food=initial.find(p=>p.channel.endsWith(':food_sync'));
 check('Food and saturation use actual target values',food&&food.data.readInt32BE(16)===truth.food&&food.data.readFloatBE(20)===truth.saturation);
 const xp=initial.find(p=>p.channel.endsWith(':experience_sync'));
 check('XP baseline follows the installed protocol fields',xp&&xp.data.readFloatBE(16)===truth.progress&&xp.data.readInt32BE(20)===truth.needed&&xp.data.readInt32BE(24)===truth.level);
 const hotbar=initial.find(p=>p.channel.endsWith(':hotbar_sync'));
 const slots=hotbar?decodeItems(hotbar.data):[];
 check('Nine explicit slots include real items and known empty slots',slots.length===9&&slots.every(s=>s.known)&&slots[0].size>0&&slots[7].size>0&&slots[1].size===0);
 const initialCount=initial.length;await sleep(1200);check('No polling baseline traffic while idle',eye.hud.filter(p=>channels.includes(p.channel)).length===initialCount);
 eye.hud=[];request(eye,truth.subject);await sleep(700);
 const full=eye.hud.find(p=>p.channel===inventory);
 check('Explicit E still reads the actual 36 inventory slots',full&&uuid(full.data)===truth.subject&&decodeItems(full.data).length===36);
 for(const channel of channels)check('Explicit E also refreshes '+channel,count(eye)[channel]===1,count(eye)[channel]);
 if(phase==='candidate'){
  eye.hud=[];eye._client.write('custom_payload',{channel:'minecraft:unregister',data:Buffer.from(channels[1])});await sleep(150);register(eye,[channels[1]]);await sleep(500);
  check('One re-registered channel gets one baseline',count(eye)[channels[1]]===1&&channels.filter(c=>c!==channels[1]).every(c=>count(eye)[c]===0),count(eye));
  await facts('deny food true');eye.hud=[];request(eye,truth.subject);await sleep(500);
  check('Food permission remains enforced',count(eye)[channels[2]]===0&&channels.filter(c=>c!==channels[2]).every(c=>count(eye)[c]===1),count(eye));
  await facts('deny food false');await facts('slot 3');eye.hud=[];request(eye,truth.subject);await sleep(500);
  check('Refresh reads a newly selected real slot',eye.hud.find(p=>p.channel===channels[1])?.data.readUInt8(16)===3);
  eye.hud=[];request(eye,truth.subject,1);await sleep(500);check('Malformed request does not trigger a baseline',channels.every(c=>count(eye)[c]===0));
  eye.hud=[];request(eye,'00000000-0000-4000-8000-000000009999');await sleep(500);check('Unrelated requested UUID receives no baseline',channels.every(c=>count(eye)[c]===0));
  eye.hud=[];await facts('queue-detach');await sleep(500);check('Queued delivery rechecks attachment after detachment',channels.every(c=>count(eye)[c]===0));
  eye.hud=[];request(eye,truth.subject);await sleep(500);check('Detached inventory request cannot expose HUD data',channels.every(c=>count(eye)[c]===0));
  await rc('spectate HudSubject HudLens');await sleep(500);check('One legitimate reattachment restores all four baselines',channels.every(c=>count(eye)[c]===1),count(eye));
  const stranger=await connect('HudStranger');await rc('gamemode spectator HudStranger');await rc('spectate HudSubject HudStranger');await sleep(300);stranger.hud=[];register(stranger);await sleep(500);
  check('A registered channel alone grants no additional pair access',channels.every(c=>count(stranger)[c]===0),count(stranger));stranger.quit();
  eye.quit();await sleep(600);const again=await connect('HudLens');register(again,channels);await sleep(1100);
  check('Same-UUID reconnect gets a fresh connection baseline',channels.every(c=>count(again)[c]===1),count(again));
  check('No synthetic protocol errors',bots.every(b=>b.failures.length===0),bots.map(b=>({name:b.username,errors:b.failures})));
 }
}catch(error){report.error=error.stack;failures.push('stage exception');}
finally{
 for(const bot of bots)try{bot.quit();}catch{}
 await sleep(250);try{await rc('stop');report.normalStopRequested=true;}catch{report.normalStopRequested=true;}
 report.completedAt=new Date().toISOString();report.failures=failures;report.passed=failures.length===0;
 await writeFile(join(resolve(stage,'..'),phase+'.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({phase,passed:report.passed,checks:checks.length,failures,initialCounts:report.initialCounts,error:report.error}));
 process.exitCode=failures.length?1:0;
}
