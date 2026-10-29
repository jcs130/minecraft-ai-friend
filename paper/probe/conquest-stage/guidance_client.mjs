/** Real protocol acceptance of the existing dungeon/task commands. Terraform
 * and monster removal here are QA fixtures, never production gameplay proof. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire}from'node:module';
import {command}from'../../ops/rcon-client.mjs';import{installRecipePacketBypass}from'../../ops/mineflayer-client-compat.mjs';
const label=process.argv[2],stage='E:/MC/staging/aincrad-conquest-20261027';assert(/^[a-z0-9]+$/.test(label));
const props=await fs.readFile(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25924\r?$/m);
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:25925});
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),clients=[],report={checks:[],errors:[],receipts:[],fixtures:'isolated copy; clear test floor, no natural-route or autonomous gameplay claim'};
const check=(s,ok)=>{assert.ok(ok,s);report.checks.push(s);};
async function connect(username){const b=mf.createBot({host:'127.0.0.1',port:25924,username,auth:'offline',version:'1.21.1',defaultChatPatterns:false,checkTimeoutInterval:60000});clients.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.errors.push(e.message));b.on('kicked',e=>report.errors.push(JSON.stringify(e)));installRecipePacketBypass(b._client);await Promise.race([new Promise(r=>b.once('spawn',r)),sleep(30000).then(()=>{throw Error('spawn timeout');})]);await sleep(1200);return b;}
async function chat(b,text){await sleep(1200);const start=b.messages.length;b.chat(text);await sleep(700);return b.messages.slice(start);}
async function json(b,text,kind){const lines=await chat(b,text+' --json'),matches=lines.filter(s=>s.startsWith(kind+' '));assert.equal(matches.length,1,`${text}: one structured receipt required, got ${lines.join(' | ')}`);const data=JSON.parse(matches[0].slice(kind.length+1));report.receipts.push({command:text,data});return data;}
try{
 const a=await connect('ag_GuideQA1027'),w=await connect('GuideWitness');await rc('qdqa setup '+a.username);
 const archive=await json(a,'/mycli archive --help','MC_CLI_HELP');check('published archive discovery is preserved',archive.commands?.some(x=>x.name==='list'));
 const help=await json(a,'/mycli dungeon --help','MC_CLI_HELP');check('dungeon first help page exposes list and status',help.commands?.some(x=>x.name==='list')&&help.commands?.some(x=>x.name==='status'));
 const lines=await chat(a,'/mycli dungeon list');report.defaultListChars=lines.join('\n').length;check('list defaults to bounded readable text',lines.filter(x=>x.startsWith('[地下城]')).length<=7&&!lines.some(x=>/^MC_SITE_DUNGEON/.test(x)));
 const list=await json(a,'/mycli dungeon list','MC_SITE_DUNGEON_LIST');check('JSON list is one aggregate with no more than seven rows',Array.isArray(list.items)&&list.items.length<=7);check('all sites include difficulty and level',list.items.every(x=>Number.isInteger(x.normalStars)&&x.recommendedLevel>=1));
 let info=await json(a,'/mycli dungeon info undead_crypt','MC_SITE_DUNGEON_INFO');check('idle site explicitly available despite inactive',info.guidance.available&&info.guidance.state==='travel');
 check('real difficulty multipliers and solo/team preparation are present',info.guidance.difficulty[1].healthMultiplier===1.5&&info.guidance.difficulty[2].damageMultiplier===1.6&&info.guidance.recommendedParty.includes('可单人')&&info.guidance.recommendedEquipment.includes('盾'));
 const text=await chat(a,'/mycli dungeon info undead_crypt');report.defaultInfoChars=text.join('\n').length;check('default info is compact Chinese with actionable gear and party advice',text.length<=5&&text.some(s=>s.includes('装备'))&&text.some(s=>s.includes('队伍'))&&text.some(s=>s.includes('/mycli dungeon travel')));
 await chat(a,'/mycli guild join');await chat(a,'/mycli guild accept tm_qa_crypt');
 let progress=await json(a,'/mycli tasks status','MC_TASKS');
 report.taskReceipt=progress;
 const extract=obj=>obj&&typeof obj==='object'?(obj.guidance?.adventure?obj.guidance:Object.values(obj).map(extract).find(Boolean)):null;
 let guide=extract(progress);check('SITE_CLEAR task receives actual dungeon next step',guide?.phase==='travel'&&guide.nextCommand==='/mycli dungeon travel undead_crypt');
 // Explicit JSON includes transport sequence/time. Compare the actual task
 // state, retaining every gameplay field rather than treating a fresh envelope
 // as evidence that a query advanced the task.
 const stable=value=>JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key])=>!['sequence','observedAt'].includes(key))));
 const frozen=stable(progress);await json(a,'/mycli dungeon status undead_crypt','MC_SITE_DUNGEON_STATE');
 const after=await json(a,'/mycli tasks status','MC_TASKS');check('read queries preserve task stage and zero completion',extract(after)?.ready===false&&stable(after)===frozen);
 const malformed=await chat(a,'/mycli dungeon start undead_crypt normal --unknown');check('bad options rejected before starting',malformed.some(s=>s.includes('INVALID_ARGUMENT')));
 let status=await json(a,'/mycli dungeon status undead_crypt','MC_SITE_DUNGEON_STATE');check('malformed action leaves site idle',status.active===false);
 const [x,y,z]=info.start;await rc(`minecraft:fill ${x-7} ${y-1} ${z-7} ${x+7} ${y-1} ${z+7} minecraft:stone`);await rc(`minecraft:fill ${x-7} ${y} ${z-7} ${x+7} ${y+3} ${z+7} minecraft:air`);await rc(`minecraft:tp ${a.username} ${x+.5} ${y} ${z+.5}`);await sleep(1000);
 info=await json(a,'/mycli dungeon info undead_crypt','MC_SITE_DUNGEON_INFO');check('first-room arrival points to an explicit normal start',info.guidance.state==='ready'&&info.guidance.nextCommand.endsWith('start undead_crypt normal'));
 const started=await json(a,'/mycli dungeon start undead_crypt normal','MC_SITE_DUNGEON_RESULT');check('same start command executes with JSON formatting',started.success===true);
 status=await json(a,'/mycli dungeon status undead_crypt','MC_SITE_DUNGEON_STATE');check('started run is distinguished from an unopened dungeon',status.active===true&&['muster','fighting','moving'].includes(status.guidance.state));
 const other=await json(w,'/mycli dungeon status undead_crypt','MC_SITE_DUNGEON_STATE');check('outsider is told occupied, never to wait at entrance',other.participant===false&&other.guidance.state==='occupied'&&other.guidance.nextCommand==='/mycli dungeon list');
 progress=await json(a,'/mycli tasks status','MC_TASKS');guide=extract(progress);check('task follows the actual live run instead of a generic 0/1 loop',guide&&['muster','fighting','moving'].includes(guide.phase));
 const left=await json(a,'/mycli dungeon leave','MC_SITE_DUNGEON_RESULT');check('leave has a real successful receipt',left.success===true);
 status=await json(a,'/mycli dungeon status undead_crypt','MC_SITE_DUNGEON_STATE');check('cooldown has a precise retry interval and alternative',status.active===false&&status.guidance.state==='cooldown'&&status.guidance.retryAfterMs>0&&status.guidance.nextCommand==='/mycli dungeon list');
 check('partial run never claims a dungeon clear',!(status.pendingRewards||[]).includes('undead_crypt'));
 check('private tool results do not appear in witness chat',!w.messages.some(s=>s.startsWith('MC_MARKET')||s.includes('tm_qa_crypt')));
 check('native clients remain connected',clients.every(b=>b._client.state==='play'));
}catch(e){report.errors.push(e.stack||String(e));report.messages=clients.map(b=>({name:b.username,last:b.messages.slice(-15)}));}
finally{for(const b of clients)b.quit('dungeon guidance QA done');await sleep(500);await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));process.exit(report.errors.length?1:0);}
