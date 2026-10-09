import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const stage=process.argv[2],root=process.argv[3];
assert.equal(stage,'E:/MC/staging/trial-buttons-onboarding-20261009');assert.equal(root,'E:/MC/ops/repairs/trial-buttons-onboarding-20261009');
const previous=JSON.parse(readFileSync(root+'/'+readFileSync(root+'/accepted-test.txt','utf8').trim(),'utf8'));assert.ok(previous.passed);
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);const mf=req('mineflayer');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),rc=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'});
const bots=[],report={passed:false,checks:[],messages:{},camera:[]};
report.candidateSha256=createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.4.jar')).digest('hex').toUpperCase();assert.equal(report.candidateSha256,previous.candidateSha256);
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name)};
async function until(fn,label,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(200)}throw Error(label)}
async function make(username){const b=mf.createBot({host:'127.0.0.1',port:25567,username,version:'1.20.6',auth:'offline'});bots.push(b);report.messages[username]??=[];b.on('messagestr',x=>report.messages[username].push(x));b.on('error',()=>{});b._client.on('camera',x=>report.camera.push({name:username,...x}));await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j)});return b}
const packets=(b,p='MC_COACH ')=>(report.messages[b.username]??[]).filter(x=>x.startsWith(p)).map(x=>JSON.parse(x.slice(p.length)));
async function chat(b,q){b.chat(q);await sleep(700)}
try{
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.4')}catch{await sleep(1000);return false}},'normal isolation startup',120000);
 const a=await make(previous.persist.choice),n=await make(previous.persist.newcomer),q=await make(previous.persist.quiet),eye=await make('TrialEye44');
 await rc('minecraft:gamemode spectator '+eye.username);await rc('minecraft:spectate '+a.username+' '+eye.username);
 await until(()=>report.camera.some(x=>x.name===eye.username&&x.cameraId===a.entity.id),'real Eye attachment after restart');
 check('actual paired native Eye reattaches after normal restart',true);
 await chat(a,'/mycli arena entrance');const entrance=packets(a,'MC_TRIAL_BUTTONS ').at(-1);
 check('all three physical buttons and waxed signs survive normal restart',entrance?.ready===true&&entrance.buttons.length===3);
 check('repeat installation remains no-op after restart',(await rc('mycli admin trialbuttons build')).includes('status=already_ready changedBlocks=0'));
 await chat(a,'/mycli arena difficulty list');check('last manually selected adventure preference persists',report.messages[a.username].some(x=>x.includes('MC_DUNGEON_DIFFICULTY selected=adventure mode=manual')));
 await chat(n,'/mycli coach next');check('real enrollment and life task progress persist',packets(n).some(x=>x.type==='next'&&x.step==='life_progress'));
 const p=JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players[n.player.uuid];
 check('actual paid one-point learning retained',p?.points.spent===1&&p.basicLearned?.fireworks);
 await chat(q,'/mycli coach status');check('personal off persists across normal restart',packets(q).findLast(x=>x.type==='status')?.enabled===false);
 await chat(a,'/mycli coach next');check('private next still reaches exactly attached Eye',packets(eye).some(x=>x.player===a.username&&x.type==='next'));
 await sleep(4500);check('short reconnect does not repeat full welcome',![a,n,q].some(b=>packets(b).some(x=>x.type==='welcome'&&x.player===b.username)));
 check('trial remains idle after reconnect',(await rc('mycli admin dungeonaudit')).includes('active=false'));
 report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1}
finally{for(const b of bots)b.quit();writeFileSync(root+'/restart-test-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}))}
process.exit(process.exitCode??0);
