import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';
const stage=resolve(process.env.TRAVEL_POINT_STAGE);
assert.equal(await readFile(resolve(stage,'.travel-point-qa'),'utf8'),'SYNTHETIC_TRAVEL_POINT_ONLY');
const properties=resolve(stage,'server.properties');
const settings=await readFile(properties,'utf8');
for(const value of ['server-ip=127.0.0.1','server-port=26461','rcon.port=26462'])assert(settings.includes(value));
const {createBot}=createRequire(process.env.MINEFLAYER_PACKAGE)('mineflayer');
const rc=text=>command(text,25000,{port:26462,properties});
const qa=async text=>JSON.parse((await rc('travelpointqa '+text)).split('TRAVEL_POINT_QA ')[1]);
const report={synthetic:true,checks:[]};let bot;
const check=(label,value)=>{report.checks.push({label,passed:!!value});console.log(`${value?'PASS':'FAIL'} ${label}`);assert(value,label);};
async function until(f,label,ms=14000){for(const end=Date.now()+ms;Date.now()<end;){const v=await f();if(v)return v;await delay(150);}throw Error('Timeout: '+label);}
async function ask(text,match){await delay(1200);const start=bot.lines.length;bot.chat(text);return until(()=>bot.lines.slice(start).find(match),text);}
async function go(id){await qa('refill');const before=await qa('status');
 const line=await ask('/mycli goto '+id,line=>line.startsWith('MC_TRAVEL ')&&line.includes('target='+id+' ')&&!line.includes('status=pending'));
 const after=await qa('status');report.lastTravel={id,line,before,after};return {line,before,after};}
try{
 bot=createBot({host:'127.0.0.1',port:26461,username:'TravelPointQA',auth:'offline',version:'1.21.1',physicsEnabled:false,hideErrors:true});
 bot.lines=[];bot.on('messagestr',line=>bot.lines.push(line));bot.on('error',error=>report.clientError=error.message);
 installRecipePacketBypass(bot._client);
 await until(()=>bot.entity&&bot.player?.uuid,'synthetic Java client',45000);
 await rc('minecraft:gamemode survival TravelPointQA');
 check('candidate actually loaded',(await rc('version AgentFriend')).includes('0.4.47.77-verified-travel'));
 report.audit=await qa('audit');
 check('all thirteen saved public points checked with native collision shapes',report.audit.points.length===13&&report.audit.points.every(p=>p.blockReads<=512));
 if(process.env.TRAVEL_MARKERS_INSTALLED==='1')
  check('all public landings remain resolvable after native marker installation',report.audit.points.every(p=>p.found));
 else check('blocked or unsupported original public points reproduced',report.audit.points.filter(p=>p.issue).length>=5);
 const before=await qa('status');
 await ask('/mycli waypoint',line=>line.startsWith('MC_WAYPOINT_LIST '));
 const after=await qa('status');
 check('catalog is read only',JSON.stringify(before.position)===JSON.stringify(after.position));
 check('catalog includes aincrad and the real guild point',bot.lines.some(l=>l.startsWith('MC_WAYPOINT id=aincrad '))&&bot.lines.some(l=>l.startsWith('MC_WAYPOINT id=guild ')));
 for(const id of ['yellowstone','moonlight','snow','cherry','village','oasis','aincrad']){
  const point=report.audit.points.find(p=>p.id===id);
  const result=await go(id);
  if(!point.found){check(id+' fails explicitly instead of claiming arrival',result.line.includes('status=denied'));continue;}
  check(id+' returns a real arrival',result.line.includes('status=arrived')&&result.after.world===point.worldName);
  check(id+' uses the verified safe landing',result.after.position.every((v,i)=>Math.abs(v-point.safeDestination[i])<.01));
  const cost=result.before.mana.current-result.after.mana.current;check(id+' charges only once',cost>5&&cost<=6.01);
 }
 const bookmark='城市测试点'+Date.now().toString().slice(-6);
 await ask('/mycli waypoint add '+bookmark,l=>l.startsWith('MC_WAYPOINT_RESULT ')&&l.includes('"action":"add"'));
 const list=JSON.parse((await ask('/mycli waypoint list',l=>l.startsWith('MC_WAYPOINT_LIST '))).slice('MC_WAYPOINT_LIST '.length));
 const point=list.points.find(p=>p.name===bookmark);
 check('personal bookmark names its actual custom world',point?.worldName==='aincrad'&&point.worldLabel==='艾恩葛朗特');
 check('bookmark is not presented as an official mission entrance',point.source==='player_named_bookmark'&&point.landingChecked&&point.landingStatus==='checked_safe');
 await qa('cancel true');const denied=await go('yellowstone');await qa('cancel false');
 check('protection cancellation is an explicit failure',denied.line.includes('status=denied')&&denied.line.includes('teleport_rejected'));
 check('denied travel neither moves nor spends mana',denied.before.world===denied.after.world&&JSON.stringify(denied.before.position)===JSON.stringify(denied.after.position)&&denied.after.mana.current>=denied.before.mana.current);
 const start=bot.lines.length;bot.chat('/mycli menu places');
 await until(()=>bot.currentWindow,'travel menu');
 check('native inventory menu exposes aincrad without exceeding its slots',bot.currentWindow.slots[27]?.name==='ender_eye');bot.closeWindow(bot.currentWindow);
 check('client remains connected',!report.clientError&&!!bot.entity);
}catch(error){report.error=String(error.stack||error);report.lastLines=bot?.lines.slice(-20);console.error(report.error);process.exitCode=1;}
finally{bot?.quit();await writeFile(resolve(stage,'..','travel-proof.json'),JSON.stringify(report,null,2));}
