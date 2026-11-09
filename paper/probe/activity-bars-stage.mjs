import fs from 'node:fs/promises';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{setTimeout as wait}from'node:timers/promises';
import{command}from'file:///E:/MC/ops/rcon-client.mjs';
const stage='E:/MC/staging/eye-bossbar-lifecycle-20261104',root=process.env.ACTIVITY_BAR_QA_ROOT,baseline=process.argv.includes('--baseline'),reboot=process.argv.includes('--reboot');assert(root);
assert.equal((await fs.readFile(stage+'/.eye-bossbar-qa','utf8')).trim(),'isolated eye bossbar QA only');assert.equal(await fs.readFile(stage+'/.activity-bars-qa','utf8'),'FRESH_ACTIVITY_BARS_SYNTHETIC_WORLD');const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1\r?$/m.test(props)&&/^server-port=25956\r?$/m.test(props)&&/^level-name=world\r?$/m.test(props));
const rc=s=>command(s,15000,{port:25957,properties:stage+'/server.properties'}),bots={},events=[],checks=[],names={a:'BossActorAQA',b:'BossActorBQA',eye:'BossEyeQA'};let phase='start';
const until=async(fn,label,ms=20000)=>{for(const end=Date.now()+ms;Date.now()<end;){if(await fn())return;await wait(80);}throw Error('Timeout '+label);};
const check=(name,ok)=>{checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);};
const mf=createRequire('E:/MC/probe/package.json')('mineflayer');
async function connect(key){const bot=mf.createBot({host:'127.0.0.1',port:25956,version:'1.21.1',username:names[key],auth:'offline',hideErrors:true});bots[key]=bot;bot.bars=new Map();bot.lines=[];bot.on('messagestr',s=>bot.lines.push(s));bot.on('error',()=>{});bot._client.on('boss_bar',p=>{events.push({phase,recipient:key,...p,title:p.title?JSON.stringify(p.title):undefined});if(p.action===0)bot.bars.set(p.entityUUID,{title:JSON.stringify(p.title),health:p.health});else if(p.action===1)bot.bars.delete(p.entityUUID);else{const b=bot.bars.get(p.entityUUID);if(b&&p.action===2)b.health=p.health;if(b&&p.action===3)b.title=JSON.stringify(p.title);}});await until(()=>bot.entity&&bot.player?.uuid,key);return bot;}
const qa=async(action,key,kind='gather',seconds=487,progress=.8)=>{const reply=await rc(`activityqa ${action} ${names[key]}${action==='remove'?'':` ${kind} ${seconds} ${progress}`}`);assert(reply.includes('ACTIVITY_QA')&&!reply.includes('_ERROR'),reply);await wait(350);};
const bars=(key,text)=>[...bots[key].bars].filter(([,b])=>!text||b.title?.includes(text));
const gather=key=>[...bots[key].bars].filter(([,b])=>b.title?.includes('探索留影')&&!b.title?.includes('任务'));
const attach=async key=>{await rc(`minecraft:spectate ${names[key]} ${names.eye}`);await wait(700);};
let error;
try{
 await until(async()=>{try{return(await rc('version CortiEyeMirror')).includes(baseline?'0.1.19':'0.1.20');}catch{return false;}},'startup',180000);
 await Promise.all([connect('a'),connect('b'),connect('eye')]);for(const key of Object.keys(names))await rc('minecraft:gamemode creative '+names[key]);await rc('minecraft:gamemode spectator '+names.eye);
 await attach('a');for(const key of Object.keys(names))await qa('remove',key);
 phase='same global event distinct UUIDs';await qa('show','eye');await qa('show','a');await wait(700);
 check('producer gives target and Eye different native UUIDs',gather('a').length===1&&gather('eye').some(([id])=>id!==gather('a')[0]?.[0]));
 check('Eye displays global invitation once',gather('eye').length===1);
 check('activity title explicitly denotes remaining time',gather('a')[0]?.[1].title.includes('剩余约08:10'));
  check('remaining-time fill retains eighty percent',Math.abs((gather('a')[0]?.[1].health??-1)-.8)<.0001);
 phase='updates';await qa('update','a','gather',481,.79);await qa('update','eye','gather',481,.79);check('updates retain one visible invitation',gather('eye').length===1);
 phase='native removal';await qa('remove','eye');await wait(600);const targetId=gather('a')[0]?.[0];check('target snapshot resumes when own bar disappears',gather('eye').length===1&&bots.eye.bars.has(targetId));
 phase='native late ADD';await qa('show','eye','gather',481,.79);await wait(600);check('late own ADD withdraws the mirrored duplicate',gather('eye').length===1&&!bots.eye.bars.has(targetId));
 phase='detach';await rc(`minecraft:execute as ${names.eye} run minecraft:spectate`);await wait(600);check('detaching preserves native camera activity',gather('eye').length===1);await attach('a');
 phase='finished';await qa('remove','a');await qa('remove','eye');check('ended invitation leaves no stale bars',gather('eye').length===0);
 for(const [kind,title]of[['boss','双生首领'],['rescue','试炼救援'],['quest','任务']]){
  phase=kind;await qa('show','eye',kind);await qa('show','a',kind);await wait(500);check('same named '+kind+' bars are independent',bars('eye',title).length===2);await qa('remove','a');await qa('remove','eye');
 }
 phase='different generations';await qa('show','eye','gather',60,.1);await qa('show','a','gather',480,.8);check('different countdown generations are not collapsed',gather('eye').length===2);await qa('remove','a');await qa('remove','eye');
 phase='switch source';await qa('show','a');await qa('show','b','gather',487,.8);await qa('show','eye');await attach('b');check('switching source keeps a single global invitation',gather('eye').length===1);await qa('remove','a');await qa('remove','b');await qa('remove','eye');
 phase='reconnect';await attach('a');await qa('show','a');bots.eye.quit();await wait(600);await connect('eye');await rc('minecraft:gamemode spectator '+names.eye);await attach('a');check('late reconnect receives target ADD before updates',gather('eye').length===1);const id=gather('eye')[0]?.[0],wire=events.filter(e=>e.recipient==='eye'&&e.entityUUID===id&&e.phase===phase);check('new connection starts with ADD',wire[0]?.action===0);
 await qa('remove','a');await wait(400);check('reconnected target REMOVE clears the camera',gather('eye').length===0);
 if(process.argv.includes('--provider')){
  phase='real event API';await rc('wevent start qd-explorers-gather');await until(()=>gather('a').length>0,'real event');await wait(600);
  check('real scheduled-event producer shows one invitation on Eye',gather('eye').length===1);
  check('real producer title has countdown meaning',gather('a')[0]?.[1].title.includes('集结邀请')&&gather('a')[0]?.[1].title.includes('剩余'));
  const start=bots.a.lines.length;bots.a.chat('/mycli world events --json');await until(()=>bots.a.lines.slice(start).some(s=>s.includes('event_time_remaining')),'real CLI event meaning');
  const row=bots.a.lines.slice(start).find(s=>s.includes('event_time_remaining'));check('CLI says remaining time rather than task completion',row.includes('"isTaskProgress":false')&&row.includes('"participationAutomatic":false'));
  await rc('wevent stop qd-explorers-gather');await wait(600);check('real event stop removes native and mirrored invitation',gather('eye').length===0);
 }
 await rc('minecraft:save-all flush');
}catch(e){error=String(e);console.log(error);}
finally{for(const bot of Object.values(bots))bot.quit();const report={baseline,reboot,synthetic:true,productionChanged:false,checks,events,error,passed:!error&&checks.every(c=>c.ok)};await fs.writeFile(root+`/native-${baseline?'baseline':reboot?'reboot':'candidate'}-${Date.now()}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:checks.length,failed:checks.filter(c=>!c.ok).map(c=>c.name),error}));if(!report.passed)process.exitCode=1;}
