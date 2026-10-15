import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
const root=process.env.MC_EXAM_QA_ROOT?.replaceAll('\\','/');
assert(root, 'Set MC_EXAM_QA_ROOT to an isolated fixture root, never the live server');
const stage=root+'/lab';
const mode=process.argv[2];assert(['baseline','candidate','candidate-v2','candidate-v3','final'].includes(mode));
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const setup=JSON.parse(fs.readFileSync(root+'/setup.json'));assert.equal(setup.stage.replaceAll('\\','/'),stage);
const rcon=q=>command(q,15000,{properties:stage+'/server.properties',port:25831});
const bots=[],messages=new Map(),packets=new Map();
const out={at:new Date().toISOString(),mode,checks:[],queries:[],errors:[],productionModified:false};
const check=(name,pass)=>{out.checks.push({name,pass:!!pass});assert(pass,name);};
const profile=()=>{const c=yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));const a=JSON.parse(fs.readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json')).players[setup.qaUuid].academy;return{fame:c['guild-players'][setup.qaUuid].fame,completed:c['guild-players'][setup.qaUuid].completed,active:c['guild-players'][setup.qaUuid].active??null,runId:a.active?.runId,proofs:a.active?.proofs,certificates:Object.keys(a.certificates??{})};};
async function make(name){
 const bot=req('mineflayer').createBot({host:'127.0.0.1',port:25830,username:name,version:'1.21.1',auth:'offline',hideErrors:true,plugins:{physics:false}});
 installRecipePacketBypass(bot._client);bots.push(bot);messages.set(name,[]);packets.set(name,[]);
 bot._client.on('login',()=>bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:exam\0mcagent:market\0mcagent:tasks')}));
 bot.on('messagestr',text=>messages.get(name).push(text));bot.on('error',e=>out.errors.push(String(e)));bot.on('kicked',e=>out.errors.push(JSON.stringify(e)));
 bot._client.on('custom_payload',p=>{if(['mcagent:exam','mcagent:market','mcagent:tasks'].includes(p.channel)){try{packets.get(name).push({channel:p.channel,bytes:p.data.length,data:JSON.parse(p.data.toString('utf8'))});}catch(e){out.errors.push(String(e));}}});
 await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject);});
 await sleep(2300);return bot;
}
async function ask(bot,text){
 const before=messages.get(bot.username).length,n=packets.get(bot.username).length;bot.chat(text);await sleep(650);
 const row={query:text,messages:messages.get(bot.username).slice(before),packets:packets.get(bot.username).slice(n)};out.queries.push(row);return row;
}
const exam=row=>row.packets.find(x=>x.channel==='mcagent:exam')?.data;
try{
 await rcon('difficulty peaceful');
 const qa=await make(setup.qaName),human=await make('ExamHuman16');
 await rcon('gamemode survival '+setup.qaName);
 const start=await ask(qa,mode==='final'?'/mycli guild exam status':'/mycli guild exam start survey_basic');
 check('real QA account starts survey exam',exam(start)?.examId==='survey_basic'&&exam(start)?.state==='active');
 const before=profile();check('actual actor qualifications cloned without promoting',before.fame===setup.sourceFame&&before.completed===setup.sourceCompleted&&before.certificates.includes('inventory_basic'));
 const status=await ask(qa,'/mycli guild exam status');
 const board=await ask(qa,'/mycli guild board');
 const boardRows=board.packets.find(x=>x.channel==='mcagent:market'&&x.data.tasks)?.data.tasks;
 const ruins=boardRows?.find(x=>x.id==='tm_ruins_journal'),map=boardRows?.find(x=>x.id==='tm_map_hunt');
 check('market board is an actual clientbound payload',!!ruins&&!!map);
 if(mode==='baseline'){
  check('baseline falsely labels incompatible ruins task available',ruins.state==='available');
  check('baseline gives no matching contract choices',!exam(status)?.contractOptions);
  const deny=await ask(qa,'/mycli guild accept tm_ruins_journal');
  check('baseline rejects that supposedly available task',deny.messages.some(s=>s.includes('已有在办考试')));
  const mapDeny=await ask(qa,'/mycli guild accept tm_map_hunt');
  check('baseline map requires real target map',mapDeny.messages.some(s=>s.includes('不能接寻宝委托')));
  out.baselineDenials={ruins:deny.messages,map:mapDeny.messages};
 }else{
  const state=exam(status);
  check('status recommends an actually available beginner survey contract',state.nextCommand==='/mycli guild accept tm_starter_trail'&&state.contractOptions.items[0].id==='tm_starter_trail'&&state.contractOptions.items[0].status==='available');
  check('status distinguishes certificate from promotion',state.purpose==='certificate'&&state.gradeIndex===setup.sourceGrade);
  check('choices are bounded and include private exact commands',state.contractOptions.items.length<=7&&state.contractOptions.availableCount>0&&state.scope==='self'&&state.subjectUuid===setup.qaUuid);
  check('market board marks incompatible and missing-map tasks honestly',ruins.state==='exam_contract_incompatible'&&map.state!=='available');
  check('ordinary observer does not receive another account exam/market receipts',!messages.get(human.username).some(s=>s.includes('MC_GUILD_EXAM')&&s.includes(setup.qaUuid))&&!packets.get(human.username).some(p=>p.data.subjectUuid===setup.qaUuid));
  for(const id of ['biome_border','lost_town','tm_ruins_journal']){
   const row=await ask(qa,'/mycli guild accept '+id),denied=exam(row);
   check(id+' rejection is structured and gives a valid recovery command',denied?.ok===false&&denied.reason==='exam_contract_incompatible'&&denied.requestedContractId===id&&denied.nextCommand==='/mycli guild accept tm_starter_trail');
  }
  const held=await ask(qa,'/mycli guild accept tm_map_hunt');check('missing original map is still rejected without accepting',held.messages.some(s=>s.includes('不能接寻宝委托')));
  const json=await ask(qa,'/mycli guild exam status --json');check('explicit JSON status gives exactly one result',json.messages.filter(s=>s.startsWith('MC_GUILD_EXAM ')).length===1&&exam(json)?.contractOptions.items[0].id==='tm_starter_trail');
  const info=await ask(qa,'/mycli guild exam info survey_basic --json');check('active exam info does not recommend starting the same exam again',exam(info)?.eligibility==='in_progress'&&exam(info)?.nextCommand==='/mycli guild accept tm_starter_trail');
  const tasks=await ask(qa,'/mycli tasks info tm_ruins_journal --json');
  check('generic task discovery agrees with the real exam gate',tasks.packets.some(p=>p.channel==='mcagent:tasks'&&p.data.task?.status==='exam_contract_incompatible'));
  const menu=await ask(qa,'/mycli guild market menu');
  check('vanilla chest menu is available to a normal Minecraft connection',JSON.stringify(qa.currentWindow?.title??'').includes('任务市场'));
  const menuItems=qa.currentWindow?.slots.filter(Boolean)??[];
  out.menuComponents=menuItems.map(i=>({name:i.name,components:i.components}));
  check('menu item lore uses real exam eligibility',menuItems.some(i=>JSON.stringify(i.components).includes('exam_contract_incompatible')));
  qa.closeWindow(qa.currentWindow);await sleep(200);
  const humanStatus=await ask(human,'/mycli guild exam status --json');check('human explicit JSON query emits no duplicate prose',humanStatus.messages.length===1&&humanStatus.messages[0].startsWith('MC_GUILD_EXAM '));
  const bad=await ask(human,'/mycli guild exam info missing_exam --json');check('bad explicit JSON query stays structured without prose',bad.messages.length===1&&exam(bad)?.reason==='unknown_exam');
  const help=await ask(human,'/mycli guild exam status --help --json');check('generic help advertises exam JSON query support',help.messages.some(s=>s.includes('"jsonSupported":true')));
  const invalid=await ask(qa,'/mycli guild exam status extra --json');check('invalid JSON arguments fail before any action',exam(invalid)?.reason==='invalid_arguments');
  check('all discovery and failed accepts preserve fame, certificates and the same exam',JSON.stringify(profile())===JSON.stringify(before));
 }
 const accepted=await ask(qa,'/mycli guild accept tm_starter_trail');
 check('the recommended contract is really accepted',profile().active?.id==='tm_starter_trail');
 const attached=await ask(qa,'/mycli guild exam status');
 if(mode!=='baseline')check('attached exam now directs to real contract progress',exam(attached)?.nextCommand==='/mycli guild status'&&exam(attached)?.runId===before.runId);
 check('acceptance did not award a certificate, fame or fake completion',profile().fame===before.fame&&profile().completed===before.completed&&JSON.stringify(profile().certificates)===JSON.stringify(before.certificates));
 check('all native private exam packets are below 16 KiB',packets.get(qa.username).filter(p=>p.channel==='mcagent:exam').every(p=>p.bytes<=16384));
 check('no client protocol errors',out.errors.length===0);
 if(mode==='final'){
  const original=profile();qa.quit('Controlled reconnect test');await sleep(700);
  const reconnected=await make(setup.qaName),status=exam(await ask(reconnected,'/mycli guild exam status --json'));
  check('survey reconnect keeps the same active exam and attached contract',status.state==='active'&&status.runId===original.runId&&profile().active?.id==='tm_starter_trail');
  check('reconnect preserves rewards and existing certificates',profile().fame===original.fame&&JSON.stringify(profile().certificates)===JSON.stringify(original.certificates));
  out.resumeSnapshot=profile();
 }
 out.passed=true;
}catch(e){out.failure=String(e.stack);process.exitCode=1;}
finally{
 for(const bot of bots)bot.quit('Isolated exam offer test complete');await sleep(500);
 fs.writeFileSync(root+'/wire-'+mode+'.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({mode,passed:out.passed,checks:out.checks.length,failure:out.failure,errors:out.errors}));
}
