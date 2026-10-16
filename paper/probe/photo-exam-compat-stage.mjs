// Native regression for the photo workflow's interaction with old and new exams.
// Fixture preparation is separate; this probe never writes a production config.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage=process.env.MC_PHOTO_TEST_SERVER?.replaceAll('\\','/'),root=process.env.MC_PHOTO_TEST_OUTPUT;
assert(stage?.startsWith('E:/MC/staging/')&&root,'Explicit isolated fixture required');
const properties=fs.readFileSync(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(properties)&&/^server-port=25914$/m.test(properties)&&/^rcon.port=25915$/m.test(properties));
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const expected=JSON.parse(fs.readFileSync(root+'/../exam-expected.json'));
const report={at:new Date().toISOString(),checks:[],queries:[],scope:'Isolated native photo/exam compatibility; no production edits'},bots=[];
report.candidateSha256=createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.47.jar')).digest('hex');
const cfg=()=>yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));
const rc=q=>command(q,20000,{port:25915,properties:stage+'/server.properties'});
function check(name,pass){assert(pass,name);report.checks.push(name);console.log('PASS '+name);}
async function until(fn,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(100);}throw Error('Timeout '+label);}
async function make(username){
 const b=req('mineflayer').createBot({host:'127.0.0.1',port:25914,username,version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});
 bots.push(b);b.physicsEnabled=false;b.receipts=[];b.lines=[];installRecipePacketBypass(b._client);
 b.on('messagestr',s=>b.lines.push(s));
 b._client.on('login',()=>b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:exam\0mcagent:market')}));
 b._client.on('custom_payload',p=>{if(['mcagent:exam','mcagent:market'].includes(p.channel))try{b.receipts.push({channel:p.channel,data:JSON.parse(p.data.toString())});}catch{}});
 await new Promise((resolve,reject)=>{b.once('spawn',resolve);b.once('error',reject);b.once('kicked',reject);});await sleep(1400);return b;
}
async function ask(b,q){const start=b.receipts.length;b.chat(q);await sleep(900);const rows=b.receipts.slice(start);report.queries.push({player:b.username,command:q,receipts:rows});return rows.filter(r=>r.channel==='mcagent:exam').at(-1)?.data;}
try{
 check('combined candidate loaded',(await rc('version AgentFriend')).includes('0.4.47'));
 const old=await make('ag_ExamQA16');
 await rc('minecraft:clear ag_ExamQA16');await sleep(200);
 const state=await ask(old,'/mycli guild exam status --json');
 check('legacy active exam run continues without replacement',state.runId===expected.runId&&state.state==='active');
 check('ordered six-step guide survives',state.guide.steps.map(s=>s.id).join()==='prepare,contract,survey,photograph,return,submit');
 check('guide says direct photography needs no blank maps',state.guide.steps[0].instruction.includes('无需空地图')&&!state.guide.steps[0].instruction.includes('8张'));
 check('current frozen desert contract retained',state.guide.currentContract.id==='tm_desert_pyramid_archive'&&state.guide.currentContract.exploration.minHeightSpan===6);
 const issued=JSON.stringify(cfg()['exam-supplies-issued']);
 const info=await ask(old,'/mycli guild exam supplies info photo --json');
 check('photo prerequisites are explicitly unnecessary',info.status==='not_required'&&info.required===false&&info.count===0);
 const claim=await ask(old,'/mycli guild exam supplies claim photo --json');
 check('legacy photo claim is a successful no-op',claim.ok&&claim.changed===false&&claim.reason==='photo_materials_not_required');
 await ask(old,'/mycli guild exam supplies list --json');
 check('read and redundant claim preserve all original allocations',JSON.stringify(cfg()['exam-supplies-issued'])===issued);
 const take=await ask(old,'/mycli guild exam supplies take photo --json');
 check('previously issued eight blank maps are still retrievable',take.ok&&old.inventory.items().filter(i=>i.name==='map').reduce((n,i)=>n+i.count,0)===8);
 const repeat=await ask(old,'/mycli guild exam supplies take photo --json');
 check('legacy withdrawal does not duplicate old maps',repeat.ok&&repeat.reason==='already_taken'&&old.inventory.items().filter(i=>i.name==='map').reduce((n,i)=>n+i.count,0)===8);
 const fresh=await make(process.env.MC_EXAM_FRESH_NAME??'ExamFresh47');await ask(fresh,'/mycli guild join');await ask(fresh,'/mycli guild exam start survey_basic');
 const freshState=await ask(fresh,'/mycli guild exam status --json');
 check('new ordinary player can start the exploration exam',freshState.state==='active');
 check('new exam issues no blank-map kit',!cfg()['exam-supplies-issued']?.[fresh.player.uuid]?.photo_survey_basic&&!fresh.inventory.items().some(i=>i.name==='map'));
 await ask(fresh,'/mycli guild exam guide');await until(()=>fresh.currentWindow,'native guide');
 const guide=fresh.currentWindow;check('guide button 20 leads to personal photo chest',guide.slots[20]?.name==='chest'&&JSON.stringify(guide.slots[20]).includes('个人奖励箱'));
 await fresh.clickWindow(20,0,0);await sleep(500);check('native button opens original personal chest page menu',fresh.currentWindow&&JSON.stringify(fresh.currentWindow.title).includes('个人'));
 await fresh.closeWindow(fresh.currentWindow);await sleep(300);
 const beforeTickets=JSON.parse(await rc('examsupplyqa tickets')).pluginTickets;
 check('test does not force-load the distant destination',!(await rc('execute in minecraft:overworld run forceload query -1926 -966')).includes('is marked'));
 const start=fresh.receipts.length;fresh.chat('/mycli guild exam supplies claim map --json');
 await until(()=>fresh.receipts.slice(start).some(r=>r.channel==='mcagent:exam'&&r.data.action==='claim'&&r.data.id==='map'&&r.data.status!=='pending'),'original explorer map',40000);
 const supplied=fresh.receipts.slice(start).filter(r=>r.channel==='mcagent:exam'&&r.data.action==='claim'&&r.data.id==='map'&&r.data.status!=='pending').at(-1).data;
 report.map=supplied;check('new explorer map is genuinely verified and points to the desert temple',supplied.ok&&supplied.saved&&supplied.map.x===-1926&&supplied.map.z===-966&&supplied.map.structure==='minecraft:desert_pyramid');
 check('temporary destination tickets are all released',JSON.parse(await rc('examsupplyqa tickets')).pluginTickets===beforeTickets);
 const result=await ask(fresh,'/mycli guild exam supplies take all --json');
 check('free withdrawal transfers genuine map only',result.ok&&result.free&&fresh.inventory.items().some(i=>i.name==='filled_map')&&!fresh.inventory.items().some(i=>i.name==='map'));
 const chart=fresh.inventory.items().find(i=>i.name==='filled_map');check('standard wire item carries real map ID and destination decorations',JSON.stringify(chart.components).includes('map_id')&&JSON.stringify(chart.components).includes('map_decorations'));
 const final=cfg()['guild-players'][expected.id];check('exam guidance preserves original fame and completion count',final.fame===expected.fame&&final.completed===expected.completed);
 report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1;console.log(report.error);}
finally{for(const b of bots)b.quit();await sleep(600);fs.writeFileSync(root+'/exam-compat.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?String(v):v,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
