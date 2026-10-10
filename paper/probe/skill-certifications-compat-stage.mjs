// Native progression, frozen market terms and interruption QA. Disposable loopback server only.
import {assert,readFileSync,writeFileSync,root,stage,suffix,bots,sleep,rc,report,X,Y,Z,profile,check,until,json,join,chat,ask,result,state,refill,tp,fly,stopFlying,route,cancel,walk} from './skill-certifications-fixture.mjs';
async function cooldown(c,id){for(let end=Date.now()+100000;Date.now()<end;){const left=Number(profile(c).cooldowns[id]||0)-Date.now();if(left<=0)return;await sleep(Math.min(2000,left+100));}throw Error('cooldown '+id);}
async function basicFlight(c){for(let i=0;i<4;i++){await chat(c,'/mycli cast flight');await sleep(400);if((await state(c)).flying)return;await sleep(1250);}throw Error('basic flight denied after cooldown retry');}
const configPath=stage+'/plugins/AgentFriend/skill-assessments.yml',original=readFileSync(configPath,'utf8'),marketPath=stage+'/plugins/AgentFriend/task-market.yml',originalMarket=readFileSync(marketPath,'utf8');
try {
 const mage=await join('CertMage'+suffix),warrior=await join('CertWar'+suffix),priest=await join('CertPriest'+suffix),a=await join('CertAllyA'+suffix),b=await join('CertAllyB'+suffix);
 check('uses genuinely earned basic certificates',profile(mage).academy.certificates.flight_basic&&profile(warrior).academy.certificates.leap_basic&&profile(priest).academy.certificates.support_basic);
 await tp(mage);await cancel(mage);await ask(mage,'/mycli guild exam start flight_advanced');await cooldown(mage,'mage_soar');await refill(mage);await result(mage,'/mycli cast mage_soar');
 await fly(mage,X,Y+6,Z+12);await fly(mage,X+16,Y+6,Z+12);await fly(mage,X+16,Y+9,Z+28);await fly(mage,X,Y+6,Z+28);
 await mage.bot.look(Math.PI,0,true);await fly(mage,X,Y+6,Z+21);await fly(mage,X,Y,Z+24);await stopFlying(mage);await sleep(2500);
 let exam=await ask(mage,'/mycli guild exam status');report.advancedFlight=exam;check('long native air route certifies advanced spatial skill',exam.state==='ready',exam);
 await ask(mage,'/mycli guild exam submit');await result(mage,'/mycli skills upgrade mage_soar');check('third flight rank consumes points with advanced certificate',profile(mage).learned.mage_soar.level===3);
 // A successful paid cast plus vertical travel still cannot satisfy horizontal checkpoints.
 await tp(mage);await ask(mage,'/mycli guild exam start flight_basic');await refill(mage);await basicFlight(mage);
 await fly(mage,X,Y+9,Z);await fly(mage,X,Y,Z);await stopFlying(mage);await sleep(2300);exam=await ask(mage,'/mycli guild exam status');
 check('native vertical flight cannot earn a spatial certificate',exam.state==='active'&&exam.measured.horizontalDistance<.1&&exam.measured.checkpoints===0,exam);await cancel(mage);await tp(mage,X-10);
 // Two independently paid jumps, with ordinary client steering and actual platform landings.
 await tp(warrior);await ask(warrior,'/mycli guild exam start leap_advanced');await cooldown(warrior,'warrior_sky_leap');await refill(warrior);await result(warrior,'/mycli cast warrior_sky_leap');await walk(warrior,X+4,Y+2,Z,16000);
 await until(()=>profile(warrior).academy.active.measurements.landedJumps===1,'first real jump stabilizes for two seconds');
 exam=await ask(warrior,'/mycli guild exam status');check('first native jump does not complete two-jump certificate',exam.state==='active'&&exam.measured.landedJumps===1,exam);
 await cooldown(warrior,'warrior_sky_leap');await refill(warrior);await result(warrior,'/mycli cast warrior_sky_leap');await walk(warrior,X+10,Y+4,Z,16000);
 await until(()=>profile(warrior).academy.active.state==='ready','second real jump stabilizes for two seconds');
 exam=await ask(warrior,'/mycli guild exam status');report.advancedLeap=exam;check('two native jumps retain distinct stable platform proofs',exam.state==='ready'&&exam.measured.landedJumps===2,exam);
 await ask(warrior,'/mycli guild exam submit');await result(warrior,'/mycli skills upgrade warrior_sky_leap');await tp(warrior,X-11);
 // Stronger preexisting Resistance II must not count as the caster's mitigation.
 await tp(priest);await tp(a,X,Y,Z+2);await tp(b,X,Y,Z+3);await cooldown(priest,'priest_blessing');await refill(priest);await ask(priest,'/mycli guild exam start support_advanced');
 await rc(`minecraft:effect give ${a.name} minecraft:resistance 120 1 true`);await result(priest,'/mycli cast priest_blessing');
 await walk(a,X,Y,Z+7);await walk(b,X+5,Y,Z+3);await sleep(300);
 exam=await ask(priest,'/mycli guild exam status');check('moving allies alone cannot complete combat support',exam.state==='active'&&exam.measured.combatSupport===0,exam);
 await rc(`minecraft:summon minecraft:zombie ${X+15} ${Y} ${Z+15} {Tags:["cert_enemy"],NoAI:1b,Silent:1b,PersistenceRequired:1b}`);
 await rc(`academyqa hit ${a.name} cert_enemy 4`);exam=await ask(priest,'/mycli guild exam status');check('preexisting stronger resistance is not credited to blessing',exam.state==='active'&&exam.measured.combatSupport===0,exam);
 await rc(`academyqa hit ${b.name} cert_enemy 4`);await sleep(400);exam=await ask(priest,'/mycli guild exam status');report.advancedSupport=exam;
 check('native own resistance mitigation completes advanced support',exam.state==='ready'&&exam.measured.combatSupport>0,exam);await ask(priest,'/mycli guild exam submit');await result(priest,'/mycli skills upgrade priest_blessing');
 // The market takes one immutable exam definition. A hot edit applies to new acceptances.
 await tp(mage);await cancel(mage);const fameBefore=(await ask(mage,'/mycli guild exam promotion')).fame;
 await chat(mage,'/mycli guild accept tm_qa_flight_exam');await sleep(700);exam=await ask(mage,'/mycli guild exam status');const oldVersion=exam.version;check('market starts its own accepted assessment',exam.state==='active'&&exam.requirements.horizontal===24,exam);
 const changed=JSON.parse(original.slice(original.indexOf('{')));changed.assessments.flight_basic['horizontal-distance']=30;writeFileSync(configPath,JSON.stringify(changed,null,2));
 check('valid assessment and market catalogs hot reload together',(await rc('mycli admin assessments reload')).includes('已热加载'));
 const fresh=await ask(mage,'/mycli guild exam info flight_basic');exam=await ask(mage,'/mycli guild exam status');check('inflight accepted market terms remain frozen across reload',fresh.horizontal===30&&exam.requirements.horizontal===24&&exam.version===oldVersion,{fresh,exam});
 const badMarket=JSON.parse(originalMarket);badMarket.tasks.qa_flight_exam.steps[0].assessment='missing_assessment';writeFileSync(marketPath,JSON.stringify(badMarket));
 const newConfig=JSON.parse(JSON.stringify(changed));newConfig.assessments.flight_basic['horizontal-distance']=31;writeFileSync(configPath,JSON.stringify(newConfig));
 check('bad market reference rejects the joint reload',(await rc('mycli admin assessments reload')).includes('配置错误'));
 check('market failure also rolls back candidate assessment catalog',(await ask(mage,'/mycli guild exam info flight_basic')).horizontal===30);writeFileSync(marketPath,originalMarket);
 const invalid=JSON.parse(JSON.stringify(changed));invalid.assessments.flight_basic.primitive='native_lesson';writeFileSync(configPath,JSON.stringify(invalid));
 check('invalid upgrade certificate definition rejects entire reload',(await rc('mycli admin assessments reload')).includes('配置错误'));check('last valid catalog survives rejected reload',(await ask(mage,'/mycli guild exam info flight_basic')).horizontal===30);
 writeFileSync(configPath,original);await rc('mycli admin assessments reload');await cooldown(mage,'mage_soar');await refill(mage);await result(mage,'/mycli cast mage_soar');await route(mage);
 exam=await ask(mage,'/mycli guild exam status');check('market skill stage completes only after real route',exam.state==='ready',exam);
 await chat(mage,'/mycli guild exam submit');await sleep(300);check('market stage cannot be independently settled',profile(mage).academy.active.state==='ready');
 await chat(mage,'/mycli guild claim');await sleep(500);const fameAfter=(await ask(mage,'/mycli guild exam promotion')).fame;
 check('market reward settles once through original guild claim',fameAfter===fameBefore+1,{fameBefore,fameAfter});await chat(mage,'/mycli guild claim');await sleep(300);check('repeat market claim adds no reward',(await ask(mage,'/mycli guild exam promotion')).fame===fameAfter);
 // Logout clears owned native flight and refuses continuation of an unfinished route.
 await tp(mage);await ask(mage,'/mycli guild exam start flight_basic');await refill(mage);await basicFlight(mage);
 const mageUuid=mage.bot.player.uuid;mage.bot.quit();await sleep(800);check('logout persisted interruption',JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players[mageUuid].academy.active.state==='interrupted');
 const back=await join(mage.name);const native=await state(back);check('relogin revokes temporary flight and recovery marker',!native.allowFlight&&!native.flying&&!native.recoveryMarker,native);
 exam=await ask(back,'/mycli guild exam status');check('relogin retains earned certs and interrupts unfinished movement',exam.state==='interrupted'&&profile(back).academy.certificates.flight_advanced,exam);
 report.mspt=await rc('mspt');report.passed=true;
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{writeFileSync(configPath,original);writeFileSync(marketPath,originalMarket);try{await rc('mycli admin assessments reload');await rc('minecraft:kill @e[tag=cert_enemy]');}catch{}for(const c of bots)c.bot.quit();await sleep(400);writeFileSync(root+'/compat-'+suffix+'.json',JSON.stringify(report,null,2));}
