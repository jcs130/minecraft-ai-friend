// Production read-only discovery and native menus. Never starts combat, travels, or claims rewards.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mf=require('mineflayer'),name='TrialRead96',sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={at:new Date().toISOString(),passed:false,checks:[],sha256:createHash('sha256').update(readFileSync('E:/MC/server/plugins/AgentFriend-0.3.96.jar')).digest('hex').toUpperCase()},lines=[],states=[];let bot,added=false;
const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert.ok(ok,name);console.log('PASS '+name);};
async function until(fn,label){for(let n=0;n<150;n++){if(fn())return;await sleep(100);}throw Error(label+' timeout');}
async function ask(q,prefix){await sleep(1250);const n=lines.length;bot.chat(q);if(prefix)await until(()=>lines.slice(n).some(s=>s.startsWith(prefix)),q);return lines.slice(n);}
const parse=s=>JSON.parse(s.slice(s.indexOf('{')));
try{
 check('expected production version',/0\.3\.96/.test(await command('version AgentFriend')));
 const reply=await command('minecraft:whitelist add '+name);assert.match(reply,/Added/);added=true;
 bot=mf.createBot({host:'192.168.3.163',port:25565,username:name,auth:'offline',version:'1.20.6'});bot.on('messagestr',s=>lines.push(s));bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:state')try{states.push(JSON.parse(p.data.toString()));}catch{}});await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j)});
 const list=await ask('/mycli dungeon list','MC_SITE_DUNGEON_LIST '),summary=parse(list.find(s=>s.startsWith('MC_SITE_DUNGEON_LIST '))),items=list.filter(s=>s.startsWith('MC_SITE_DUNGEON_ITEM ')).map(parse);
 check('three separate locations are discoverable',summary.total===3&&summary.parallelSites===true&&items.length===3,summary);
 for(const [id,n] of [['undead_crypt',3],['creeping_crypt',3],['bunker',2]]){const info=parse((await ask('/mycli dungeon info '+id,'MC_SITE_DUNGEON_INFO ')).find(s=>s.startsWith('MC_SITE_DUNGEON_INFO ')));check(id+' exposes real ordered rooms and eight-mana approach',info.id===id&&info.rooms.length===n&&info.approachMana===8,info);}
 for(const id of ['dungeon.list','dungeon.travel','dungeon.start','dungeon.join','dungeon.leave','dungeon.resume','dungeon.claim','dungeon.menu']){const detail=await ask('/mycli explain '+id,'MC_CLI_DETAIL ');check(id+' is discoverable through existing Agent CLI',detail.some(s=>s.includes('"id":"'+id+'"')),detail);}
 await ask('/mycli dungeon menu','');await until(()=>bot.currentWindow,'native dungeon list');check('native list menu contains three buildings',bot.currentWindow.slots.slice(10,13).every(Boolean));await bot.clickWindow(10,0,0);await until(()=>bot.currentWindow?.slots[12]?.name==='iron_sword','native dungeon detail');check('native detail has approach and three difficulties',bot.currentWindow.slots[10]?.name==='ender_pearl'&&[12,13,14].every(n=>bot.currentWindow.slots[n]));bot.closeWindow(bot.currentWindow);
 const status=parse((await ask('/mycli dungeon status','MC_SITE_DUNGEON_STATE ')).find(s=>s.startsWith('MC_SITE_DUNGEON_STATE ')));check('read-only discovery never enrolls this player',status.active===false&&status.participant===false,status);

 for(const mode of ['arena','dungeon']){const reply=await ask('/mycli '+mode+' status','MC_TRIAL_RESCUE_STATE ');const rescue=parse(reply.find(s=>s.startsWith('MC_TRIAL_RESCUE_STATE ')));check(mode+' status teaches proximity and clear rescue',rescue.downed===false&&rescue.radius===4&&rescue.seconds===10&&rescue.downedTeammates.length===0&&rescue.instruction.includes('清完本层/本室')&&rescue.instruction.includes('全队倒下'),rescue);}
 const help=await ask('/mycli explain arena.status','MC_CLI_DETAIL ');check('CLI explanation teaches automatic rescue',help.some(s=>s.includes('4格')&&s.includes('10秒')),help);
 await until(()=>states.some(s=>s.schemaVersion===1&&s.trialRescue?.radius===4),'compatible rescue state payload');check('existing schema gains optional rescue instructions',states.some(s=>s.schemaVersion===1&&s.trialRescue?.seconds===10&&s.trialRescue.instruction.includes('10秒')));
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(e);}
finally{if(bot){if(bot.currentWindow)bot.closeWindow(bot.currentWindow);bot.quit();await sleep(200);}if(added)await command('minecraft:whitelist remove '+name);report.finishedAt=new Date().toISOString();for(const root of ['E:/MC/ops/repairs/trial-team-revival-20261008','F:/MC-backups/repairs/trial-team-revival-20261008'])writeFileSync(root+'/live-'+report.finishedAt.replaceAll(':','-')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
