// Own actors and explicitly marked loopback QA only. No model or production connection.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';
const stage='E:/MC/staging/communication-contract-20261030',output=process.argv[2],mode=process.argv[3]??'flow';
assert(output?.startsWith('E:/MC/ops/repairs/dungeon-lifecycle-20261030/run-'));
assert(['flow','cold'].includes(mode));assert.equal((await fs.readFile(stage+'/.communication-qa','utf8')).trim(),'127.0.0.1:29395 20261030');
const mineflayer=createRequire('E:/MC/integrations/qiandengji-harness-20261022/body/package.json')('mineflayer');
const bots=[],result={checks:[],receipts:[],productionConnected:false};
function check(value,name){assert(value,name);result.checks.push(name);console.log('PASS '+name);}
async function until(fn,name,timeout=20000){for(const end=Date.now()+timeout;Date.now()<end;){const value=await fn();if(value)return value;await pause(150);}throw Error('timeout '+name);}
async function rc(text){const reply=await command(text,12000,{properties:stage+'/server.properties',port:29396});result.receipts.push({command:text,reply});assert(!reply.includes('LIFE_QA_ERROR'),reply);return reply;}
async function fixture(action,bot,extra=''){return rc('qd_life_fixture '+action+' '+bot.username+(extra?' '+extra:''));}
async function observed(bot){const line=await fixture('state',bot);return JSON.parse(line.slice(line.indexOf('LIFE_QA_STATE ')+14));}
async function ask(bot,text,prefix){await pause(Math.max(0,1250-(Date.now()-(bot.lastCall??0))));const start=bot.messages.length;bot.lastCall=Date.now();bot.chat(text);const line=await until(()=>bot.messages.slice(start).find(v=>v.startsWith(prefix)),text);const data=JSON.parse(line.slice(prefix.length));result.receipts.push({player:bot.username,command:text,data});return data;}
const state=bot=>ask(bot,'/mycli dungeon status qa_lifecycle --json','MC_SITE_DUNGEON_STATE ');
const act=(bot,text)=>ask(bot,'/mycli dungeon '+text+' --json','MC_SITE_DUNGEON_RESULT ');
async function nativeAfter(bot,mark,test){return until(()=>bot.native.slice(mark).map(v=>v.trialRescue).find(v=>v&&test(v)),'native rescue payload');}
async function connect(username){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:29395,username,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000});bots.push(bot);bot.messages=[];bot.native=[];bot.deaths=0;
 bot.on('messagestr',text=>bot.messages.push(text));bot.on('death',()=>bot.deaths++);
 bot._client.on('custom_payload',packet=>{if(packet.channel==='mcagent:state')try{bot.native.push(JSON.parse(packet.data.toString('utf8')));}catch{}});
 bot.on('error',error=>result.receipts.push({player:username,error:String(error)}));
 await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'spawn '+username,30000);bot.physicsEnabled=false;return bot;
}
try{
 const [alice,bob,eye]=await Promise.all(['ag_LifeAlice','ag_LifeBob','ag_LifeEye'].map(connect));
 if(mode==='cold'){
  const prior=JSON.parse(await fs.readFile(output+'/flow.json','utf8'));
  for(const bot of [alice,bob]){
   const value=await state(bot),saved=prior.final[bot.username];
   check(value.lifecycle==='ended'&&!value.participant&&!value.rescueActive&&value.participantRun==='','cold status has no active rescue '+bot.username);
   check(value.lastOutcome.run===saved.run&&value.lastOutcome.reason===saved.reason,'cold history keeps real terminal evidence '+bot.username);
   check(value.lastOutcome.lifecycle==='ended'&&!value.lastOutcome.rescueActive,'old schema outcome normalized without reviving rescue '+bot.username);
   const current=await observed(bot);check(JSON.stringify(current.inventory)===JSON.stringify(prior.inventories[bot.username]),'cold actor inventory preserved '+bot.username);
   check(!current.rescue.active&&!current.rescue.rescueActive&&!('checkpoint' in current.rescue),'cold native snapshot clears stale checkpoint '+bot.username);
  }
 }else{
  await fixture('setup',alice);
  const before=await state(alice);check(before.lifecycle==='none'&&!before.rescueActive,'unregistered role is never protected');
  const initial=(await observed(alice)).rescue;check(!initial.active&&!initial.rescueActive&&!('checkpoint' in initial),'native no-run state contains no checkpoint guarantee');
  const outsiderMark=eye.messages.length;const start=await act(alice,'start qa_lifecycle');check(start.success,'real CLI opens a fresh solo run');
  let current=await state(alice);const firstRun=current.run;
  check(current.lifecycle==='active'&&current.participantRun===firstRun&&current.rescueActive,'current run and rescue are bound to actual participant');
  check(current.remainingSeconds>1750&&current.remainingSeconds<=1800&&current.timeLimitSeconds===1800,'live countdown matches the real 30 minute limit');
  check((await observed(alice)).rescue.active,'native rescue becomes active');
  await fixture('outside',alice);current=await state(alice);
  check(current.participant&&!current.rescueActive,'membership outside the site does not promise checkpoint rescue');
  const outside=(await observed(alice)).rescue;check(outside.active&&!outside.rescueActive&&outside.instruction.includes('此处不保证'),'native outside-scope instruction is explicit');
  await fixture('inside',alice);
  await until(async()=>{const s=await state(alice);return s.phase==='fighting';},'real encounter begins',25000);await fixture('freeze',alice);
  const inventoryBefore=(await observed(alice)).inventory;
  await rc('minecraft:damage '+alice.username+' 1000 minecraft:generic');
  await until(async()=>{const s=await state(alice);return s.failures===1;},'one actual checkpoint failure');
  await until(async()=>!(await observed(alice)).rescue.downed,'checkpoint recovery');
  check(alice.deaths===0&&JSON.stringify((await observed(alice)).inventory)===JSON.stringify(inventoryBefore),'real lethal hit during valid run returns without death or inventory loss');
  await fixture('age',alice,'1740');current=await state(alice);check(current.remainingSeconds>=55&&current.remainingSeconds<=60,'countdown reflects current runtime clock, not a cached start receipt');
  const endNativeMark=alice.native.length,noticeMark=alice.messages.length;const standingBefore=await observed(alice);
  await fixture('age',alice,'1801');
  await until(()=>alice.messages.slice(noticeMark).some(v=>v.includes('本场参战与存档点救援已失效')),'private terminal notice');
  current=await state(alice);
  check(!current.active&&!current.participant&&current.lifecycle==='ended'&&!current.rescueActive&&current.participantRun==='','timeout invalidates current membership and rescue');
  check(current.endReason==='time_limit'&&current.lastOutcome.run===firstRun&&current.lastOutcome.failures===1&&current.lastOutcome.maxFailures===3,'timeout is distinct from consuming three failures');
  check(current.phase==='ended'&&!('remainingSeconds' in current)&&!('checkpoint' in current),'terminal top-level state does not retain a live checkpoint or clock');
  const after=await observed(alice);
  check(after.x===standingBefore.x&&after.y===standingBefore.y&&after.z===standingBefore.z,'timeout keeps the existing standing-player location policy');
  check(JSON.stringify(after.inventory)===JSON.stringify(standingBefore.inventory),'timeout preserves exact actor inventory');
  const received=await nativeAfter(alice,endNativeMark,v=>!v.active&&!v.rescueActive&&!('checkpoint' in v));
  check(received.instruction.includes('当前没有有效')&&received.instruction.includes('旧坐标'),'actual custom payload clears the old checkpoint after timeout');
  check(!eye.messages.slice(outsiderMark).some(v=>v.includes('地下城结束')||v.includes(firstRun)),'terminal receipts do not reach an unrelated observer');
  await pause(1250);const plainMark=alice.messages.length;alice.chat('/mycli dungeon status qa_lifecycle');alice.lastCall=Date.now();await pause(700);
  const plain=alice.messages.slice(plainMark);check(plain.some(v=>v.includes('超过30分钟')&&v.includes('救援已失效'))&&!plain.some(v=>v.startsWith('MC_SITE_DUNGEON_')||v.startsWith('MC_TRIAL_RESCUE_STATE')),'default terminal status is concise text with the real end reason');
  await fixture('cooldown',bob);await fixture('inside',bob);check((await act(bob,'start qa_lifecycle')).success,'different player can open next run');
  current=await state(alice);check(current.active&&!current.participant&&current.lifecycle==='ended'&&!current.rescueActive&&current.participantRun===''&&current.lastOutcome.run===firstRun,'another active run never restores the previous participant rescue');
  check((await act(bob,'leave')).success,'normal leave terminates next solo run');
  await fixture('cooldown',alice);await fixture('inside',alice);check((await act(alice,'start qa_lifecycle')).success,'same player must explicitly open a new run');
  await fixture('inside',bob);check((await act(bob,'join qa_lifecycle')).success,'second actor registers through the actual join command');
  const party=(await observed(alice)).rescue;check(party.participants===2&&party.rescueEnabled&&party.rescueActive,'two registered teammates enable native rescue');
  check((await act(alice,'leave')).success,'one member can leave without ending the other member run');
  current=await state(alice);check(!current.participant&&current.lifecycle==='ended'&&current.endReason==='member_left'&&!current.rescueActive,'member leave invalidates only that member rescue');
  check((await state(bob)).participant&&(await observed(bob)).rescue.rescueActive,'remaining member retains the current solo checkpoint rule');
  check((await act(bob,'leave')).success,'last member ends the actual run');
  result.final={};result.inventories={};for(const bot of [alice,bob]){result.final[bot.username]=(await state(bot)).lastOutcome;result.inventories[bot.username]=(await observed(bot)).inventory;}
 }
 result.passed=true;
}catch(error){result.failed=String(error);throw error;}
finally{result.actorMessages=bots.map(bot=>({name:bot.username,messages:bot.messages.slice(-25)}));for(const bot of bots)bot.quit('isolated lifecycle check complete');await fs.writeFile(output+'/'+mode+'.json',JSON.stringify(result,null,2));}
