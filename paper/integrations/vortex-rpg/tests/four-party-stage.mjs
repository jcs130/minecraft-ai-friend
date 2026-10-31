/** Explicit four-client acceptance on the existing marked loopback fixture. Never starts a server. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';

const [stage,output]=process.argv.slice(2);
if(!stage||!output||!path.isAbsolute(stage)||!path.isAbsolute(output)
 ||!stage.replaceAll('\\','/').startsWith('E:/MC/staging/')
 ||fs.readFileSync(stage+'/.communication-qa','utf8').trim()!=='127.0.0.1:29397 20261030'
 ||fs.existsSync(output))throw Error('Fresh marked loopback fixture required');
const properties=fs.readFileSync(stage+'/server.properties','utf8');
if(!/^server-ip=127\.0\.0\.1\s*$/m.test(properties)||!/^server-port=29397\s*$/m.test(properties))throw Error('Loopback binding mismatch');
const require=createRequire('E:/MC/probe/package.json'),bots=[];
const report={passed:false,productionChanged:false,modelCalled:false,checks:[],errors:[]};
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:29398});
const check=(ok,name)=>{if(!ok)throw Error(name);report.checks.push(name);};
async function until(fn,label){const end=Date.now()+18000;while(Date.now()<end){const result=await fn();if(result)return result;await sleep(90);}throw Error('TIMEOUT '+label);}
async function json(bot,line){const start=bot.lines.length;await sleep(350);bot.chat('/mycli guild party '+line+' --json');return until(()=>{
  for(const text of bot.lines.slice(start))if(text.startsWith('MC_RPG '))try{return JSON.parse(text.slice(7));}catch{}
},line);}
async function fixture(bot,action='state'){
  const text=await rc('coopqa '+action+' '+bot.username);
  if(text.includes('COOP_QA loading'))return null;
  const match=text.match(/COOP_QA (\{[^\r\n]+\})/);if(!match)throw Error('Own fixture unavailable');return JSON.parse(match[1]);
}
async function join(index){
  const bot=require('mineflayer').createBot({host:'127.0.0.1',port:29397,version:'1.21.1',
    username:'ag_CP'+Date.now().toString(36).slice(-7)+index,auth:'offline'});
  bots.push(bot);bot.lines=[];bot.on('messagestr',line=>bot.lines.push(line));bot.on('error',e=>report.errors.push(e.name));
  installRecipePacketBypass(bot._client,{enabled:true});
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);setTimeout(()=>reject(Error('SPAWN_TIMEOUT')),40000).unref();});
  await until(()=>fixture(bot),'native profile');await fixture(bot,'setup');
  check((await json(bot,'status')).inParty===false,'own fresh actor '+index+' has no inherited party');return bot;
}
try{
  for(let i=0;i<4;i++)await join(i);
  const [leader,b,c,d]=bots,names=bots.map(bot=>bot.username).join(' ');
  const plan=bot=>json(bot,'plan '+names);
  check((await plan(leader)).nextAction==='create','one selected initiator creates');
  for(const peer of [b,c,d])check((await plan(peer)).nextAction==='wait','peers do not each create a party');
  check((await json(leader,'create')).success,'native party created');
  for(const peer of [b,c,d]){
    const next=await plan(leader);check(next.nextCommand==='/mycli guild party invite '+peer.username,'leader gets one missing member');
    check((await json(leader,'invite '+peer.username)).success,'native invite sent');
    check((await json(peer,'status')).inParty===false,'invitation alone is not membership');
    check((await plan(peer)).nextAction==='accept','recipient sees its matching invite');
    check((await json(peer,'accept')).success,'recipient explicitly accepts');
  }
  const statuses=await Promise.all(bots.map(bot=>json(bot,'status')));
  const id=statuses[0].partyId;
  for(let i=0;i<4;i++){
    check(id&&statuses[i].partyId===id&&statuses[i].memberCount===4,'one actual four-member native roster '+i);
    check((await plan(bots[i])).membershipConfirmed===true,'per-actor plan confirms native membership '+i);
  }
  await fixture(c,'otherworld');
  check((await json(c,'status')).phase==='assembling','cross-world member is not presented as gathered');
  check((await plan(c)).membershipConfirmed===true,'world change does not invent leave or rejoin');
  const mark='four-party-'+Date.now().toString(36),before=bots.map(bot=>bot.lines.length);
  leader.chat(mark);
  await until(()=>b.lines.slice(before[1]).some(line=>line.includes(mark))&&d.lines.slice(before[3]).some(line=>line.includes(mark)),'actual nearby receive');
  await sleep(1000);
  check(!c.lines.slice(before[2]).some(line=>line.includes(mark)),'membership does not bypass cross-world hearing');
  d.quit('Own offline-membership check');
  await until(async()=>{const value=await json(leader,'status');return value.memberCount===4&&value.members.some(member=>member.uuid===statuses[3].selfUuid&&member.online===false);},'offline member retained');
  check((await plan(leader)).reason==='player_offline','offline target produces a known wait instead of fabricated joining');
  check((await json(leader,'disband')).success,'own leader explicitly disbands');
  check((await json(b,'status')).inParty===false,'member sees disbanded state');
  report.passed=true;report.partyId=id;
}catch(error){report.error=String(error.stack);process.exitCode=1;}
finally{for(const bot of bots)bot.quit('Own four-party fixture complete');await sleep(300);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
