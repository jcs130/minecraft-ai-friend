// Controlled native protocol verification on this disposable loopback copy only.
import {assert,readFileSync,writeFileSync,root,stage,suffix,bots,sleep,rc,report,X,Y,Z,Vec3,profile,check,until,json,join,chat,ask,result,state,refill,tp,setup,fly,stopFlying,route,cancel,walk} from './skill-certifications-fixture.mjs';
try {
 check('candidate catalog and atomic ledger ready',json(await rc('mycli admin professions audit')).skills===19);
 check('exam catalog ready',(await rc('mycli admin assessments audit')).includes('ledger=true'));
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule naturalRegeneration false');await rc('minecraft:weather clear');await rc('minecraft:time set day');
 // A small disposable flat course. No production terrain, player profile or certificate is edited.
 await rc(`minecraft:forceload add ${X-16} ${Z-16} ${X+80} ${Z+80}`);await sleep(1500);
 await rc(`minecraft:fill ${X-12} ${Y-1} ${Z-12} ${X+70} ${Y-1} ${Z+70} minecraft:stone`);
 await rc(`minecraft:fill ${X+3} ${Y+1} ${Z-1} ${X+5} ${Y+1} ${Z+1} minecraft:stone`);
 await rc(`minecraft:fill ${X+9} ${Y+3} ${Z-1} ${X+11} ${Y+3} ${Z+1} minecraft:stone`);
 const mage=await join('CertMage'+suffix),outsider=await join('CertOut'+suffix),legacy=await join('CertLegacy11');
 await setup(mage,'mage');await tp(outsider,X-6);await tp(legacy,X-8);
 const legacyState=await ask(legacy,'/mycli guild exam promotion');check('legacy platinum rank migrates to platinum III',legacyState.gradeIndex===12,legacyState);
 check('legacy fame and qualification retained',legacyState.fame===150&&profile(legacy).academy.migrationRank===4);
 await result(mage,'/mycli skills learn mage_soar');await result(mage,'/mycli skills learn flight');
 const beforePoints=profile(mage).points.spent;await result(mage,'/mycli skills upgrade mage_soar','certificate_required');check('failed certificate gate spends zero points',profile(mage).points.spent===beforePoints);
 check('mage has fourth starter without recreating profile',profile(mage).learned.mage_soar.level===1);
 const eye=await join(mage.name+'Eye');await until(()=>eye.bot.game.gameMode==='spectator'&&eye.cameras.at(-1)===mage.bot.entity.id,'native Eye attached');
 check('actual suffix Eye attaches to matching native entity',eye.cameras.at(-1)===mage.bot.entity.id);
 const first=await ask(mage,'/mycli guild exam start flight_basic');check('exam begins on surveyed platform',first.state==='active',first);
 const privateStart=outsider.lines.length;
 const manaBefore=await refill(mage);await result(mage,'/mycli cast mage_soar');await sleep(300);const lease=await state(mage);
 check('paid soar starts native survival flight',lease.mode==='SURVIVAL'&&lease.flying&&lease.allowFlight&&lease.recoveryMarker,lease);
 check('soar consumes bounded real Aura mana',manaBefore.mana-lease.mana>=6&&manaBefore.mana-lease.mana<=8.1,{before:manaBefore.mana,after:lease.mana});
 await chat(mage,'/mycli cast flight');await sleep(400);check('basic flight cannot nest inside soar',(await state(mage)).flying&&mage.lines.some(s=>s.includes('已有飞行时')));
 await route(mage);let exam=await ask(mage,'/mycli guild exam status');report.flight=exam;
 check('real native flight route verifies all spatial actions',exam.state==='ready',exam);
 await until(()=>eye.packets.some(p=>p.channel==='mcviewer:state'&&p.viewerSession?.playerUuid===mage.bot.player.uuid&&p.academy?.state==='ready'),'Eye sees actual subject academy');
 check('Eye receives private actual subject academy without changing Agent client',eye.lines.some(s=>s.startsWith('MC_GUILD_EXAM ')&&json(s).runId===exam.runId));
 check('unrelated player never receives private exam JSON',!outsider.lines.slice(privateStart).some(s=>s.startsWith('MC_GUILD_EXAM ')));
 await ask(mage,'/mycli guild exam submit');let cert=await ask(mage,'/mycli guild certificates','MC_GUILD_CERTIFICATES ');check('flight certificate delivered once',cert.certificates.some(c=>c.id==='flight_basic'));
 const history=profile(mage).academy.history.length;await ask(mage,'/mycli guild exam submit');check('repeated submit does not duplicate settlement',profile(mage).academy.history.length===history);
 await result(mage,'/mycli skills upgrade mage_soar');check('certificate unlocks second rank using points',profile(mage).learned.mage_soar.level===2);
 check('upgrade ends outstanding lease and clears recovery marker',!(await state(mage)).allowFlight&&!(await state(mage)).recoveryMarker);
 const book=json(await rc('academyqa book '+mage.name));check('destiny book includes grades and skill certificates',book.pages.some(p=>p.includes('冒险者认证'))&&book.pages.some(p=>p.includes('flight_basic')));
 await chat(mage,'/mycli guild menu');await until(()=>mage.bot.currentWindow,'guild menu');check('vanilla guild menu exposes exam button',mage.bot.currentWindow.slots[6]?.name==='writable_book');
 await mage.bot.clickWindow(6,0,0);await sleep(400);check('exam menu opens in native inventory protocol',JSON.stringify(mage.bot.currentWindow?.title).includes('训练与考试'));mage.bot.closeWindow(mage.bot.currentWindow);
 // Actual lifecycle interruptions: neither commands nor relocation award spatial evidence.
 await tp(mage);await ask(mage,'/mycli guild exam start flight_basic');await rc(`minecraft:tp ${mage.name} ${X+1} ${Y} ${Z}`);exam=await ask(mage,'/mycli guild exam status');check('native teleport interrupts current exam',exam.state==='interrupted'&&exam.reason==='teleport',exam);
 await tp(mage);await ask(mage,'/mycli guild exam start flight_basic');await rc('minecraft:gamemode creative '+mage.name);await sleep(500);exam=await ask(mage,'/mycli guild exam status');check('creative mode never completes exam',exam.state==='interrupted',exam);await rc('minecraft:gamemode survival '+mage.name);await cancel(mage);
 // A real leap uses client physics and a real server velocity, not flyTo or teleport.
 const warrior=await join('CertWar'+suffix);await setup(warrior,'warrior');await result(warrior,'/mycli skills learn warrior_sky_leap');
 await ask(warrior,'/mycli guild exam start leap_basic');await refill(warrior);let apex=Y;warrior.bot.on('move',()=>apex=Math.max(apex,warrior.bot.entity.position.y));
 await warrior.bot.lookAt(new Vec3(X+4,Y+1.6,Z),true);await result(warrior,'/mycli cast warrior_sky_leap');
 await walk(warrior,X+4,Y+2,Z,16000);await sleep(2600);exam=await ask(warrior,'/mycli guild exam status');report.leap={apex,exam,native:await state(warrior)};
 check('high leap has a real native apex',apex-Y>=6&&apex-Y<10,{apex});check('ordered platform landing completes basic leap',exam.state==='ready',report.leap);
 await ask(warrior,'/mycli guild exam submit');await result(warrior,'/mycli skills upgrade warrior_sky_leap');
 // Blessing only credits actual beneficiaries; stronger existing effects are preserved.
 const priest=await join('CertPriest'+suffix),allyA=await join('CertAllyA'+suffix),allyB=await join('CertAllyB'+suffix);
 await setup(priest,'priest');await tp(allyA,X,Y,Z+2);await tp(allyB,X,Y,Z+3);await tp(mage,X-8);await tp(warrior,X-9);await tp(outsider,X-10);await tp(legacy,X-11);
 await result(priest,'/mycli skills learn priest_blessing');await ask(priest,'/mycli guild exam start support_basic');
 await rc(`minecraft:effect give ${allyA.name} minecraft:resistance 60 1 true`);const before=await state(allyA);
 await refill(priest);await result(priest,'/mycli cast priest_blessing');await walk(allyA,X,Y,Z+7,5000);await sleep(500);exam=await ask(priest,'/mycli guild exam status');report.support=exam;
 check('blessing preserves stronger existing resistance',(await state(allyA)).effects.some(e=>e.id==='resistance'&&e.amplifier===1));
 check('support certificate requires another real moving player',exam.state==='ready'&&exam.measured.beneficiaries.some(a=>a.uuid===allyA.bot.player.uuid&&a.distance>=4),exam);
 await ask(priest,'/mycli guild exam submit');await result(priest,'/mycli skills upgrade priest_blessing');
 // Payload compatibility and bounded native state, with an explicit subject identity.
 await sleep(1500);check('unmodified Mineflayer receives additive academy state',mage.packets.some(p=>p.channel==='mcagent:state'&&p.schemaVersion===1&&p.academy));
 check('state budgets retained',bots.every(c=>c.packets.filter(p=>p.channel.endsWith(':state')).every(p=>p.bytes<=16384)));
 report.mspt=await rc('mspt');report.passed=true;
} catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{for(const c of bots)c.bot.quit();await sleep(400);writeFileSync(root+'/native-'+suffix+'.json',JSON.stringify(report,null,2));}
