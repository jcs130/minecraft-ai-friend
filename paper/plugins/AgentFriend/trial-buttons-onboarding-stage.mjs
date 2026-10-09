// Native, disposable isolation only. Never run this fixture on the live server.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const stage=process.argv[2], root=process.argv[3];
assert.equal(stage,'E:/MC/staging/trial-buttons-onboarding-20261009');
assert.equal(root,'E:/MC/ops/repairs/trial-buttons-onboarding-20261009');
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);
const mf=req('mineflayer'),{Vec3}=req('vec3');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rc=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'});
const suffix=String(Date.now()).slice(-6), bots=[];
const report={passed:false,checks:[],messages:{},camera:[],suffix,startedAt:new Date().toISOString()};
report.candidateSha256=createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.4.jar')).digest('hex').toUpperCase();
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name)};
async function until(fn,label,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error(label+' timeout')}
const lines=b=>report.messages[b.username]??[];
const packets=(b,prefix='MC_COACH ')=>(lines(b)).filter(s=>s.startsWith(prefix)).map(s=>JSON.parse(s.slice(prefix.length)));
const welcomes=b=>packets(b).filter(x=>x.reason==='onboarding'&&x.type==='welcome'&&x.player===b.username);
async function make(name){
 const b=mf.createBot({host:'127.0.0.1',port:25567,username:name,version:'1.20.6',auth:'offline'});
 bots.push(b);report.messages[name]??=[];b.on('messagestr',s=>lines(b).push(s));b.on('error',e=>report.connectionError=String(e));
 b._client.on('camera',p=>report.camera.push({player:name,...p}));
 await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j)});b.spawnAt=Date.now();return b;
}
async function chat(b,q,delay=550){b.chat(q);await sleep(delay)}
async function tp(b,x,y,z){b.physicsEnabled=false;await rc(`minecraft:tp ${b.username} ${x} ${y} ${z}`);await sleep(750);b.entity.velocity.set(0,0,0);b.physicsEnabled=true;await sleep(250)}
async function query(b,q='/mycli coach next',type='next'){
 const at=packets(b).length;await chat(b,q);await until(()=>packets(b).slice(at).some(x=>x.type===type),q);
 return packets(b).slice(at).findLast(x=>x.type===type);
}
const title=b=>JSON.stringify(b.currentWindow?.title??'');
const profile=b=>JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players[b.player.uuid];
const onboarding=stage+'/plugins/AgentFriend/onboarding.yml',settings=readFileSync(onboarding,'utf8');
try {
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.4')}catch{await sleep(1000);return false}},'isolation startup',120000);
 check('final candidate is 0.4.4',(await rc('version AgentFriend')).includes('0.4.4'));
 const site=await make('Site44'+suffix);await tp(site,-590.5,91,-315.5);
 check('original single button surveyed without changing world',(await rc('mycli admin trialbuttons survey')).includes('status=survey_ready'));
 check('native isolation conflict fixture is actually placed',(await rc('minecraft:setblock -597 92 -310 minecraft:barrel')).includes('Changed the block'));
 const conflict=await rc('mycli admin trialbuttons build');report.conflict=conflict;
 check('container conflict rejects construction before any button changes',conflict.includes('reason=block_conflict'));
 check('conflict did not install extra buttons',site.blockAt(new Vec3(-596,92,-310))?.name==='air');
 await rc('minecraft:setblock -597 92 -310 minecraft:air');
 const build=await rc('mycli admin trialbuttons build');report.build=build;
 check('explicit build installs three difficulty controls',build.includes('status=success')&&build.includes('difficultyButtons=3'));
 check('repeat build is a read-only no-op',(await rc('mycli admin trialbuttons build')).includes('status=already_ready changedBlocks=0'));
 for(const [id,label,z] of [['normal','普通',-313],['adventure','冒险',-310],['apocalypse','末日',-307]]){
  const front=await rc(`minecraft:data get block -597 92 ${z} front_text.messages[0]`);
  const back=await rc(`minecraft:data get block -597 92 ${z} back_text.messages[0]`);
  const wax=await rc(`minecraft:data get block -597 92 ${z} is_waxed`);
  check(label+' sign has native text on both sides and is waxed',front.includes(label)&&back.includes(label)&&wax.endsWith('1b'));
 }
 const newcomer=await make('Fresh44'+suffix),unrelated=await make('Other44'+suffix);
 await until(()=>welcomes(newcomer).length&&welcomes(unrelated).length,'unknown new players get welcome',7000);
 report.newLoginDelayMs=Date.now()-newcomer.spawnAt;
 const welcome=welcomes(newcomer)[0];
 check('unknown new Agent gets prompt welcome without identity registration',report.newLoginDelayMs<7000&&welcome.automaticTarget&&welcome.step==='register'&&welcome.nextCommand==='/mycli guild join');
 check('login explains help, skills, task boards and hand-in',lines(newcomer).some(s=>s.includes('[系统·迎新]')&&s.includes('/mycli help'))&&lines(newcomer).some(s=>s.includes('/mycli skills list common'))&&lines(newcomer).some(s=>s.includes('/mycli guild board')&&s.includes('/mycli life board')&&s.includes('claim')));
 check('machine-readable welcome exposes compatible entry points',welcome.schemaVersion===1&&welcome.helpCommand==='/mycli help'&&welcome.listCommand==='/mycli list'&&welcome.taskCommands.adventureBoard==='/mycli guild board'&&welcome.taskCommands.lifeBoard==='/mycli life board');
 const initial=await query(newcomer,'/mycli coach status','status');
 check('automatic welcome does not register, enroll, accept or spend',!initial.onboarding.guild.joined&&!initial.onboarding.guide.started&&!initial.onboarding.guild.activeId&&!initial.onboarding.life.activeId&&(profile(newcomer)?.points.spent??0)===0);
 await chat(newcomer,'/mycli help');check('suggested help is an actual working command',lines(newcomer).some(s=>s.includes('/mycli list')&&s.includes('/mycli explain')));
 await chat(newcomer,'/mycli list arena');check('Agent catalog discovers physical entrance query',packets(newcomer,'MC_CLI_ITEM ').some(x=>x.id==='arena.entrance'));
 await chat(newcomer,'/mycli arena entrance');
 const entrance=packets(newcomer,'MC_TRIAL_BUTTONS ').at(-1);
 check('entrance receipt reports exactly three real coordinates',entrance.ready&&entrance.confirmationRequired&&entrance.buttons.length===3&&entrance.buttons.every(x=>x.x===-596&&x.y===92));
 await tp(site,-543.5,67,-439.5);site.quit();
 const menuBot=await make('Menu44'+suffix);await chat(menuBot,'/mycli coach menu',350);
 check('fresh player can open native introduction menu',title(menuBot).includes('新手入门'));
 await sleep(3500);check('welcome stays quiet while a menu is open',welcomes(menuBot).length===0);
 menuBot.closeWindow(menuBot.currentWindow);const closedAt=Date.now();await until(()=>welcomes(menuBot).length,'welcome follows closed menu',3500);
 report.menuCloseDelayMs=Date.now()-closedAt;
 check('closing first menu receives welcome within three seconds rather than a minute',report.menuCloseDelayMs<3000);
 const quiet=await make('Quiet44'+suffix);await chat(quiet,'/mycli coach off',300);await sleep(3500);
 check('personal off suppresses new login welcome',welcomes(quiet).length===0);
 await chat(quiet,'/mycli coach on');await chat(quiet,'/mycli coach guide');
 check('personal off/on preserves voluntary read-only guide',packets(quiet).some(x=>x.type==='guide'&&x.helpCommand==='/mycli help'));
 await chat(quiet,'/mycli coach later');const paused=await query(quiet,'/mycli coach status','status');
 check('personal pause remains stored with actual future deadline',paused.onboarding.mutedUntil>Date.now());
 const a=await make('TrialCheck44'),eye=await make('TrialEye44');
 await rc('minecraft:gamemode spectator '+eye.username);await rc('minecraft:spectate '+a.username+' '+eye.username);
 await until(()=>report.camera.some(x=>x.player===eye.username&&x.cameraId===a.entity.id),'actual paired Eye attaches');
 const atOther=packets(unrelated).filter(x=>x.type==='next').length,atEye=packets(eye).filter(x=>x.type==='next'&&x.player===a.username).length;
 await query(a);await until(()=>packets(eye).filter(x=>x.type==='next'&&x.player===a.username).length>atEye,'paired Eye receives only owner guidance');
 check('private guide is mirrored to attached owner Eye and not unrelated players',packets(unrelated).filter(x=>x.type==='next').length===atOther);
 check('observer has no tutorial of its own',welcomes(eye).length===0);
 await chat(newcomer,'/mycli admin trialbuttons build');check('ordinary player cannot construct controls',lines(newcomer).some(s=>s.includes('只允许服务器控制台维护试炼入口')));
 await tp(a,-593.5,91,-311.5);if(a.currentWindow)a.closeWindow(a.currentWindow);a.setQuickBarSlot(8);await sleep(150);
 for(const [id,label,z] of [['normal','普通',-313],['adventure','冒险',-310],['apocalypse','末日',-307]]){
  await tp(a,-594.5,91,z+.5);if(a.currentWindow)a.closeWindow(a.currentWindow);
  const b=a.blockAt(new Vec3(-596,92,z));check(label+' button actually exists as native stone_button',b?.name==='stone_button');
  const at=lines(a).length;a.activateBlock(b);
  await until(()=>title(a).includes('试炼难度')&&a.currentWindow?.slots[16]?.name==='lime_concrete',label+' confirmation menu');
  check(label+' physical button selects that difficulty without starting',lines(a).slice(at).some(s=>s.includes('MC_DUNGEON_DIFFICULTY selected='+id))&&JSON.stringify(a.currentWindow.slots[16]).includes(label)&&a.entity.position.y>80);
  a.closeWindow(a.currentWindow);
  await chat(a,`/mycli protect break -596 92 ${z}`);
  check(label+' control retains existing building protection',packets(a,'MC_PROTECTION ').at(-1)?.allowed===false);
 }
 await chat(a,'/mycli arena difficulty normal');
 // Test the native button while holding the actual Minepacks backpack item.
 const backpackSlot=a.inventory.items().find(i=>i.name==='player_head'&&i.slot>=36&&i.slot<=44)?.slot;
 if(backpackSlot!==undefined){a.setQuickBarSlot(backpackSlot-36);await tp(a,-594.5,91,-309.5);a.activateBlock(a.blockAt(new Vec3(-596,92,-310)));await until(()=>title(a).includes('试炼难度'),'button wins over held backpack');check('difficulty menu also works with native backpack item held',true);a.closeWindow(a.currentWindow)}
 a.setQuickBarSlot(8);await tp(a,-594.5,91,-309.5);await tp(newcomer,-591.5,91,-311.5);await rc('worldqa mana '+a.username+' 20');await rc('worldqa mana '+newcomer.username+' 20');
 await chat(newcomer,'/mycli arena difficulty normal');a.activateBlock(a.blockAt(new Vec3(-596,92,-310)));
 await until(()=>title(a).includes('试炼难度'),'adventure confirmation');await a.clickWindow(16,0,0);
 await until(()=>lines(a).some(s=>s.includes('MC_DUNGEON_START difficulty=adventure'))&&lines(newcomer).some(s=>s.includes('MC_DUNGEON_START difficulty=adventure')),'actual party enters chosen adventure');
 check('confirming start uses starter button difficulty for nearby party',a.entity.position.y<80&&newcomer.entity.position.y<80);
 await chat(a,'/mycli arena leave');await chat(newcomer,'/mycli arena leave');
 check('party exits cleanly without changing trial balance',(await rc('mycli admin dungeonaudit')).includes('active=false'));
 await chat(newcomer,'/mycli guild join');check('voluntary adventurer registration advances correct next step',(await query(newcomer)).step==='guide_start');
 await chat(newcomer,'/mycli world guide start');check('voluntary enrollment uses original tutorial ledger',(await query(newcomer)).step==='catalog');
 await chat(newcomer,'/mycli skills list common');check('actual skill catalog reading advances tutorial',(await query(newcomer)).step==='cast');
 const spent=profile(newcomer)?.points.spent??0;await query(newcomer,'/mycli coach guide','guide');
 check('guidance does not purchase suggested skill',(profile(newcomer)?.points.spent??0)===spent);
 await chat(newcomer,'/mycli skills learn fireworks');await rc('worldqa mana '+newcomer.username+' 0');await chat(newcomer,'/mycli cast fireworks');
 check('failed real spell does not complete tutorial',(await query(newcomer)).step==='cast');
 await rc('worldqa mana '+newcomer.username+' 20');await chat(newcomer,'/mycli cast fireworks');
 check('successful native spell advances to life board',(await query(newcomer)).step==='life_accept');
 await chat(newcomer,'/mycli life accept author_story');
 check('next step respects actually accepted life task',(await query(newcomer)).step==='life_progress');
 writeFileSync(onboarding,settings.replace('welcome-delay-seconds: 2','welcome-delay-seconds: 0'));
 check('invalid welcome timing retains last valid settings',(await rc('mycli admin coach reload')).includes('status=invalid_configuration'));
 writeFileSync(onboarding,settings);await rc('mycli admin coach reload');
 await chat(quiet,'/mycli coach off');report.persist={newcomer:newcomer.username,quiet:quiet.username,choice:a.username};
 report.passed=true;
} catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{
 writeFileSync(onboarding,settings);await rc('mycli admin coach reload').catch(()=>{});
 for(const b of bots)b.quit();
 writeFileSync(root+'/trial-buttons-test-'+Date.now()+'.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));
}
process.exit(process.exitCode??0);
