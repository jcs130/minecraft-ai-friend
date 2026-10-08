// Read-only skill discovery through ordinary Java protocol. Never learns, casts, or changes profession.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mf=require('mineflayer');
const phase=process.argv[2];assert.ok(['stage','live'].includes(phase),'Explicit stage or live required');
const stage=phase==='stage',server=stage?'E:/MC/staging/life-buildings-20261003':'E:/MC/server',roots=['E:/MC/ops/repairs/skill-discovery-20261008','F:/MC-backups/repairs/skill-discovery-20261008'];
const rcon=q=>command(q,15000,stage?{port:25587,properties:server+'/server.properties'}:{}),sleep=ms=>new Promise(r=>setTimeout(r,ms)),name='SkillRead97',lines=[];
const report={phase,at:new Date().toISOString(),passed:false,checks:[],sha256:createHash('sha256').update(readFileSync(server+'/plugins/AgentFriend-0.3.97.jar')).digest('hex').toUpperCase()},before=JSON.parse(readFileSync(roots[0]+'/audit-before.json','utf8'));let bot,added=false,last=0;
const parse=s=>JSON.parse(s.slice(s.indexOf('{'))),check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert.ok(ok,name);console.log('PASS '+name);};
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error(label+' timeout');}
async function ask(q,prefix){await sleep(Math.max(0,1150-(Date.now()-last)));const n=lines.length;last=Date.now();bot.chat(q);await until(()=>lines.slice(n).some(s=>s.startsWith(prefix)),q);await sleep(120);return lines.slice(n);}
async function list(filter,page){const q='/mycli skills list '+(filter==='all'?'':filter+' ')+page,r=await ask(q,'MC_SPELL_LIST ');return {header:parse(r.find(s=>s.startsWith('MC_SPELL_LIST '))),items:r.filter(s=>s.startsWith('MC_SPELL_ITEM ')).map(parse),lines:r};}
try{
 await until(async()=>{try{return (await rcon('version AgentFriend')).includes('0.3.97');}catch{return false;}},'runtime ready',90000);
 check('expected final runtime',true,report.sha256);
 const reply=await rcon('minecraft:whitelist add '+name);assert.match(reply,/Added/);added=true;
 bot=mf.createBot({host:stage?'127.0.0.1':'192.168.3.163',port:stage?25567:25565,username:name,auth:'offline',version:'1.20.6'});bot.on('messagestr',s=>lines.push(s));bot.on('error',e=>report.connectionError=String(e));await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j)});
 await until(()=>lines.some(s=>s.includes('[系统·技能目录]')&&s.includes('职业16项')),'login skill hint');
 check('login teaches class catalog and rescue rule',lines.some(s=>s.includes('list warrior|mage|priest'))&&lines.some(s=>s.includes('副本规则')&&s.includes('4格10秒')));
 const initialPoints=parse((await ask('/mycli skills points','MC_SKILL_POINTS ')).find(s=>s.startsWith('MC_SKILL_POINTS ')));
 const baseline=before['/mycli skills mine'].filter(s=>s.startsWith('MC_SKILL ')).map(parse),allIds=[];
 for(const filter of ['all','common','profession','warrior','mage','priest']){
  let r=await list(filter,1),items=[...r.items];
  for(let page=2;page<=r.header.pages;page++){const next=await list(filter,page);assert.equal(next.header.page,page);assert.equal(next.header.filter,filter);items.push(...next.items);}
  const expected=baseline.filter(s=>filter==='all'||filter==='profession'&&s.profession!=='common'||filter===s.profession).map(s=>s.id).sort();
  check(filter+' discovers every matching skill',JSON.stringify(items.map(s=>s.id).sort())===JSON.stringify(expected)&&r.header.total===items.length,{total:items.length,pages:r.header.pages});
  check(filter+' header exposes class count and version',r.header.schemaVersion===1&&r.header.catalogTotal===36&&r.header.commonTotal===20&&r.header.professionTotal===16&&r.header.catalogVersion==='0.3.97'&&r.header.professionListCommand==='/mycli skills list profession');
  assert.ok(items.every(s=>s.profession&&s.summary&&s.detailCommand==='/mycli skills info '+s.id));
  if(filter==='all')allIds.push(...items.map(s=>s.id));
 }
 const first=await list('all',1),oldFirst=before['/mycli skills list 1'].filter(s=>s.startsWith('MC_SPELL_ITEM ')).map(parse);
 check('legacy first page and native fields remain identical',JSON.stringify(first.items.map(s=>Object.fromEntries(Object.keys(oldFirst[0]).map(k=>[k,s[k]]))))===JSON.stringify(oldFirst)&&first.header.pages===6);
 const filteredNext=await list('profession',1);check('next-page command retains filter',filteredNext.lines.includes('MC_SPELL_NEXT /mycli spells list profession 2'));
 const alias=await ask('/mycli spells list priest','MC_SPELL_LIST ');check('spells alias supports class filter',parse(alias.find(s=>s.startsWith('MC_SPELL_LIST '))).total===3&&alias.some(s=>s.includes('healer_beacon')));
 for(const id of ['skills.list','skills.explain','spells.list','spells.explain']){const d=parse((await ask('/mycli explain '+id,'MC_CLI_DETAIL ')).find(s=>s.startsWith('MC_CLI_DETAIL ')));check(id+' is registered for Agent discovery',d.id===id&&d.mode==='read'&&d.usage.includes('/mycli'));}
 const detail=parse((await ask('/mycli skills info healer_beacon','MC_SKILL ')).find(s=>s.startsWith('MC_SKILL '))),oldDetail=parse(before['/mycli skills info healer_beacon'].find(s=>s.startsWith('MC_SKILL ')));
 check('advanced group heal ranks and prices remain unchanged',JSON.stringify(detail.levels)===JSON.stringify(oldDetail.levels)&&detail.levels.length===3,{id:detail.id,levels:detail.levels});
 const explain=parse((await ask('/mycli skills explain healer_beacon','MC_SPELL_DETAIL ')).find(s=>s.startsWith('MC_SPELL_DETAIL ')));check('class effect description is unchanged',JSON.stringify(explain)===JSON.stringify(parse(before['/mycli skills explain healer_beacon'].find(s=>s.startsWith('MC_SPELL_DETAIL ')))));
 for(const [q,code] of [['/mycli skills list nope','UNKNOWN_FILTER'],['/mycli skills list priest 0','INVALID_PAGE'],['/mycli skills list priest abc','INVALID_PAGE']]){const error=parse((await ask(q,'MC_SPELL_ERROR ')).find(s=>s.startsWith('MC_SPELL_ERROR ')));check(q+' rejects invalid input',error.code===code);}
 const help=await ask('/mycli help','/mycli skills list ');check('help exposes direct class discovery',help.some(s=>s.includes('profession|warrior|mage|priest')));
 const guide=await ask('/mycli guide magic','Agent：');check('magic guide teaches discovery and learning',guide.some(s=>s.includes('skills list profession')&&s.includes('skills info <ID>')));
 const rescue=parse((await ask('/mycli arena status','MC_TRIAL_RESCUE_STATE ')).find(s=>s.startsWith('MC_TRIAL_RESCUE_STATE ')));check('rescue remains automatic dungeon rule',rescue.radius===4&&rescue.seconds===10&&rescue.instruction.includes('清完本层/本室')&&!allIds.includes('rescue'));
 const mine=(await ask('/mycli skills mine','MC_SKILL_ASSESSMENT ')).filter(s=>s.startsWith('MC_SKILL ')).map(parse),points=parse((await ask('/mycli skills points','MC_SKILL_POINTS ')).find(s=>s.startsWith('MC_SKILL_POINTS ')));
 check('read-only discovery neither learns nor spends points',mine.length===36&&mine.every(s=>s.learned===baseline.find(b=>b.id===s.id)?.learned)&&JSON.stringify(points)===JSON.stringify(initialPoints));
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(e);}
finally{if(bot)bot.quit();await sleep(300);if(added)await rcon('minecraft:whitelist remove '+name);report.finishedAt=new Date().toISOString();for(const root of roots)writeFileSync(root+'/'+phase+'-'+report.finishedAt.replaceAll(':','-')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
