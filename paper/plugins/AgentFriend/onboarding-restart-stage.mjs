import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const root='E:/MC/ops/repairs/agent-onboarding-20261009',stage='E:/MC/staging/agent-onboarding-20261009',req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);const mf=req('mineflayer'),sleep=ms=>new Promise(r=>setTimeout(r,ms)),rc=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),bots=[];
const prior=JSON.parse(readFileSync(root+'/'+readFileSync(root+'/accepted-test.txt','utf8').trim(),'utf8'));assert.ok(prior.passed);
const settingsFile=stage+'/plugins/AgentFriend/onboarding.yml',settings=readFileSync(settingsFile,'utf8');
const report={passed:false,checks:[],messages:{},camera:[]},check=(n,ok)=>{assert.ok(ok,n);report.checks.push(n);console.log('PASS '+n)};
async function make(username){const b=mf.createBot({host:'127.0.0.1',port:25567,username,version:'1.20.6',auth:'offline'});bots.push(b);report.messages[username]=[];b.on('messagestr',s=>report.messages[username].push(s));b._client.on('camera',p=>report.camera.push({player:username,...p}));await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j)});return b}
const packets=b=>report.messages[b.username].filter(s=>s.startsWith('MC_COACH ')).map(s=>JSON.parse(s.slice(9)));
async function status(b){const n=packets(b).length;b.chat('/mycli coach status');await sleep(800);return packets(b).slice(n).findLast(x=>x.type==='status')}
try{
 const a=await make('OnboardNew42'),b=await make('OnboardOther42'),eye=await make('OnboardEye42');await sleep(1800);
 const as=await status(a),bs=await status(b);
 check('six real onboarding milestones survive normal server restart',as.onboarding.completed&&as.onboarding.checklist.every(x=>x.done));
 check('paid skill and spending survive restart unchanged',JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players[a.player.uuid].points.spent===prior.graduated.spent);
 check('personal off survives normal server restart',bs.enabled===false&&!bs.onboarding.guild.joined);
 check('same-revision welcome is not repeated on short restart',!packets(a).some(x=>x.type==='welcome'));
 await rc('minecraft:gamemode spectator '+eye.username);await rc('minecraft:spectate '+a.username+' '+eye.username);await sleep(1800);check('original exact Eye registration still attaches after restart',report.camera.some(x=>x.player===eye.username&&x.cameraId===a.entity.id));
 a.chat('/mycli coach next');await sleep(900);check('private graduation reply still reaches actual paired Eye',packets(eye).some(x=>x.type==='next'&&x.player===a.username&&x.completed));
 await sleep(8000);check('off player receives no welcome or reminder after restart',!packets(b).some(x=>['welcome','reminder'].includes(x.type)));
 report.audit=await rc('mycli admin coach audit');report.mspt=await rc('mspt');check('read-only audit reports actual complete and pending players',report.audit.includes('name=OnboardNew42 step=complete')&&report.audit.includes('name=OnboardOther42 step=register'));
 writeFileSync(settingsFile,settings.replace('pause-seconds: 12','pause-seconds: 30'));assert.ok((await rc('mycli admin coach reload')).includes('status=success'));
 const ordinary=await make('ag_Unlisted42');ordinary.chat('/mycli coach on');await sleep(600);ordinary.chat('/mycli coach later');await sleep(600);
 report.deathFixtures=[];
 for(let i=0;i<3;i++){
  await rc('minecraft:tp '+ordinary.username+' -660 81 -478');await sleep(250);
  const killed=await rc('minecraft:kill '+ordinary.username);await sleep(400);
  // Paper may show the death screen before Mineflayer receives update_health=0.
  // Send the real vanilla respawn request and verify server health, not stale bot.health.
  ordinary._client.write('client_command',ordinary.supportFeature('respawnIsPayload')?{payload:0}:{actionId:0});await sleep(700);
  const health=await rc('minecraft:data get entity '+ordinary.username+' Health');
  report.deathFixtures.push({killed,health});assert.ok(/: (?:[1-9]\d*(?:\.\d+)?)[fF]/.test(health),'native client must actually respawn before next death: '+health);await sleep(4200);
 }
 report.actualDeaths=await rc('minecraft:data get entity '+ordinary.username+' BukkitValues."agentfriend:coach_death_count"');assert.ok(/: 3$/.test(report.actualDeaths),'fixture requires three actual death events: '+report.actualDeaths);
 await sleep(5000);check('personal pause also suppresses original pending-death reminders',!packets(ordinary).some(x=>x.reason==='deaths'));
 const deadline=Date.now()+16000;while(!packets(ordinary).some(x=>x.reason==='deaths')&&Date.now()<deadline)await sleep(200);
 check('original three-death reminder resumes after pause and preserves commands',packets(ordinary).some(x=>x.reason==='deaths'&&x.deaths===3&&x.commands.includes('/mycli spells explain selfheal')));
 report.passed=true;
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1}
finally{writeFileSync(settingsFile,settings);await rc('mycli admin coach reload').catch(()=>{});for(const b of bots)b.quit();writeFileSync(root+'/restart-test-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
