// Native protocol integration test. Use only a disposable, stopped-copy isolation server.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const stage=process.argv[2],root=process.argv[3];
assert.ok(stage==='E:/MC/staging/agent-onboarding-20261009' && root==='E:/MC/ops/repairs/agent-onboarding-20261009','Explicit isolation paths required');
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);const mf=req('mineflayer');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),rc=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'});
const bots=[],report={passed:false,checks:[],messages:{},camera:[],setup:'Native clients; admin fixture supplies only isolation positions, emeralds, damage and mana. No ledger completion writes.'};
const check=(n,ok)=>{assert.ok(ok,n);report.checks.push(n);console.log('PASS '+n)};
async function until(fn,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error(label+' timeout')}
const lines=b=>report.messages[b.username],packets=(b,prefix='MC_COACH ')=>(lines(b)??[]).filter(s=>s.startsWith(prefix)).map(s=>JSON.parse(s.slice(prefix.length)));
const auto=b=>packets(b).filter(x=>x.reason==='onboarding'&&['welcome','reminder'].includes(x.type));
async function make(username){const b=mf.createBot({host:'127.0.0.1',port:25567,username,version:'1.20.6',auth:'offline'});bots.push(b);report.messages[username]??=[];b.on('messagestr',s=>lines(b).push(s));b.on('error',e=>report.connectionError=String(e));b._client.on('camera',p=>report.camera.push({player:username,...p}));await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j)});return b}
async function chat(b,q,delay=650){b.chat(q);await sleep(delay)}
async function query(b,q='/mycli coach next',type='next'){const n=packets(b).length;await chat(b,q);await until(()=>packets(b).slice(n).some(p=>p.type===type),q);return packets(b).slice(n).findLast(p=>p.type===type)}
const profile=b=>JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players[b.player.uuid];
const state=async b=>JSON.parse(await rc('worldqa state '+b.username));
const items=(b,id)=>b.inventory.items().filter(i=>i.name===id).reduce((n,i)=>n+i.count,0);
const title=b=>JSON.stringify(b.currentWindow?.title??'');
const settingsFile=stage+'/plugins/AgentFriend/onboarding.yml',settings=readFileSync(settingsFile,'utf8');
try{
 const a=await make('OnboardNew42'),b=await make('OnboardOther42'),ordinary=await make('ag_Unlisted42'),eye=await make('OnboardEye42');
 await until(()=>auto(a).some(x=>x.type==='welcome')&&auto(b).some(x=>x.type==='welcome'),'registered welcome');
 check('registered Agents get private welcome with real register step',auto(a)[0].step==='register'&&auto(a)[0].nextCommand==='/mycli guild join'&&auto(a)[0].checklist.length===6);
 check('unregistered ag_ name and registered Eye in survival receive no automatic onboarding',auto(ordinary).length===0&&auto(eye).length===0);
 const fresh=await query(a,'/mycli coach status','status');
 check('welcome and status neither enroll nor spend nor accept',!fresh.onboarding.guild.joined&&!fresh.onboarding.guide.started&&!fresh.onboarding.life.activeId&&!fresh.onboarding.guild.activeId&&(profile(a)?.points.spent??0)===0);
 await chat(eye,'/mycli coach on');check('registered Eye cannot enable personal automation even in survival',packets(eye,'MC_COACH_ERROR ').some(x=>x.code==='SPECTATOR'));
 await rc('minecraft:gamemode spectator '+eye.username);await rc('minecraft:spectate '+a.username+' '+eye.username);await sleep(2200);
 check('paired native Eye actually attaches',report.camera.some(x=>x.player===eye.username&&x.cameraId===a.entity.id));
 const beforeB=packets(b).filter(x=>x.type==='next').length,beforeEye=packets(eye).filter(x=>x.type==='next').length;
 await query(a);await sleep(300);
 check('private next reaches only owner and actually attached paired Eye',packets(b).filter(x=>x.type==='next').length===beforeB&&packets(ordinary).length===0&&packets(eye).filter(x=>x.type==='next').length>beforeEye);
 await chat(a,'/mycli list coach');check('CLI discovers all new guidance commands',['coach.next','coach.guide','coach.menu','coach.later'].every(id=>packets(a,'MC_CLI_ITEM ').some(x=>x.id===id)));
 await chat(a,'/mycli admin coach reload');check('ordinary player cannot reload onboarding',lines(a).some(s=>s.includes('只允许服务器控制台维护迎新指引')));
 await chat(a,'/mycli guide menu');await a.clickWindow(18,0,0);await sleep(450);
 check('compass journey guide opens native onboarding page',title(a).includes('新手入门')&&a.currentWindow.slots.length===63);
 const inventoryCount=a.inventory.items().length;await a.clickWindow(19,0,1);await sleep(250);const shiftState=await query(a,'/mycli coach status','status');check('shift click cannot register or steal menu icons',title(a).includes('新手入门')&&a.inventory.items().length===inventoryCount&&!shiftState.onboarding.guild.joined);a.closeWindow(a.currentWindow);
 await chat(a,'/mycli coach menu');await a.clickWindow(19,0,0);await sleep(500);check('explicit register click advances real guild state',(await query(a)).step==='guide_start');
 await chat(a,'/mycli coach menu');await a.clickWindow(20,0,0);await sleep(500);check('explicit enrol click starts original three-proof lesson',(await query(a)).step==='catalog');
 await chat(a,'/mycli coach menu');await a.clickWindow(21,0,0);await sleep(600);check('reading native skill directory records actual catalog proof',(await query(a)).step==='cast');
 const paidBefore=profile(a)?.points.spent??0;await query(a,'/mycli coach guide','guide');check('full guidance does not automatically learn suggested skill',(profile(a)?.points.spent??0)===paidBefore&&!profile(a)?.basicLearned?.fireworks);
 await chat(a,'/mycli skills learn fireworks');check('explicit native skill learning spends exactly one point',(profile(a)?.points.spent??0)===paidBefore+1);
 await rc('worldqa mana '+a.username+' 0');await chat(a,'/mycli cast fireworks');check('failed spell does not fabricate tutorial proof',(await query(a)).step==='cast');
 await rc('worldqa mana '+a.username+' 20');const manaBefore=JSON.parse(await rc('worldqa mana '+a.username)).mana;await chat(a,'/mycli cast fireworks');
 check('successful spell uses real mana and advances to life contract',(await query(a)).step==='life_accept'&&JSON.parse(await rc('worldqa mana '+a.username)).mana<manaBefore);
 await chat(a,'/mycli life accept author_story');check('active life contract is respected rather than replaced',(await query(a)).step==='life_progress');
 await chat(a,'/mycli life write 太短|只有几个字');check('invalid book cannot advance lesson',(await query(a)).step==='life_progress');
 const booksBefore=items(a,'written_book');await chat(a,'/mycli life write 初来千灯纪|今天我来到千灯纪的村庄，先登记为冒险者，再向导师报名实习。我学会读技能目录，成功施放了烟花术，最后把真正的旅途写进这本书。');
 check('native signed book is retained and real progress prompts claim',items(a,'written_book')===booksBefore+1&&(await query(a)).step==='life_claim');
 await chat(a,'/mycli life claim',1100);check('actual successful life hand-in completes three proofs',(await query(a)).step==='guild_accept');
 await chat(a,'/mycli guild accept tm_first_spell');check('existing market acceptance advances onboarding',(await query(a)).step==='guild_progress'&&(await state(a)).id==='tm_first_spell');
 await sleep(10500);await rc('worldqa mana '+a.username+' 20');await chat(a,'/mycli cast fireworks');await chat(a,'/mycli guild claim',1200);check('first contract requires real post-accept skill then actual next stage',(await state(a)).step===1);
 await rc('minecraft:give '+a.username+' minecraft:emerald 16');await rc('minecraft:tp '+a.username+' -546.5 67 -443.5');await sleep(900);
 const entities=JSON.parse(await rc('worldqa entities -547 67 -442')).entities,trader=entities.find(e=>e.name?.includes('补给商'));assert.ok(trader&&a.entities[trader.id],'actual supply merchant visible');
 const villager=await a.openVillager(a.entities[trader.id]);check('merely opening merchant does not complete adventure',(await state(a)).progress===0);await a.trade(villager,0,1);villager.close();await sleep(700);
 check('native paid merchant trade supplies final contract proof',(await state(a)).progress===1);await chat(a,'/mycli guild claim',1200);
 const graduated=await query(a,'/mycli coach guide','guide');check('graduation derives six completed milestones and normal guild receipt',graduated.completed&&graduated.checklist.every(x=>x.done)&&(await state(a)).id==='');
 // Hot settings validation and personal control exercise actual timers, not a mocked scheduler.
 writeFileSync(settingsFile,settings.replace('poll-seconds: 1','poll-seconds: 0'));check('invalid hot config retains last valid settings',(await rc('mycli admin coach reload')).includes('invalid_configuration')&&(await rc('mycli admin coach audit')).includes('pollSeconds=1'));
 writeFileSync(settingsFile,settings.replace('先登记为冒险者','测试·登记向导'));check('valid title hot reload works without restart',(await rc('mycli admin coach reload')).includes('status=success')&&(await query(b)).title==='测试·登记向导');
 writeFileSync(settingsFile,settings);await rc('mycli admin coach reload');
 await query(b,'/mycli coach later','status');const muteCount=auto(b).length;await sleep(4500);check('pause blocks all automatic guidance while queries still work',auto(b).length===muteCount&&(await query(b)).step==='register');
 b.quit();await sleep(1000);const rejoined=await make('OnboardOther42');await sleep(3500);check('pause survives native reconnect and welcome is not repeated',auto(rejoined).length===muteCount);
 const resumed=await query(rejoined,'/mycli coach on','status');check('explicit on clears pause immediately',resumed.enabled&&resumed.onboarding.mutedUntil===0);
 await until(()=>auto(rejoined).length>muteCount,'resume reminder',15000);const resumeCount=auto(rejoined).length;await sleep(3500);check('same-stage reminder is throttled instead of each poll',auto(rejoined).length===resumeCount);
 await query(rejoined,'/mycli coach off','status');const offCount=auto(rejoined).length;rejoined.quit();await sleep(1000);const offAgain=await make('OnboardOther42');await sleep(9000);
 check('off persists after reconnect without auto reminders',auto(offAgain).length===offCount&&!(await query(offAgain,'/mycli coach status','status')).enabled);
 await rc('minecraft:tp '+ordinary.username+' -660 81 -478');await rc('minecraft:tp '+a.username+' -660 81 -478');await sleep(800);await rc('minecraft:damage '+a.username+' 1 minecraft:generic');
 writeFileSync(settingsFile,settings.replace('complete-reminder-seconds: 20','complete-reminder-seconds: 1'));await rc('mycli admin coach reload');
 const quietCount=auto(a).length;await sleep(3000);check('actual damage suppresses otherwise-due automatic messages during combat quiet period',auto(a).length===quietCount);await until(()=>auto(a).length>quietCount,'combat quiet expiry',6000);
 check('observer and unregistered player remain excluded after the full flow',auto(eye).every(x=>x.player===a.username)&&auto(ordinary).length===0);
 report.version=await rc('version AgentFriend');report.mspt=await rc('mspt');report.graduated={actor:a.username,uuid:a.player.uuid,spent:profile(a).points.spent};report.offActor=offAgain.username;
 check('actual runtime uses 0.4.2',report.version.includes('0.4.2'));report.passed=true;
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1}
finally{writeFileSync(settingsFile,settings);await rc('mycli admin coach reload').catch(()=>{});for(const b of bots)b.quit();writeFileSync(root+'/onboarding-test-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
