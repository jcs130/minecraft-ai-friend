// Sixteen controlled native clients, not autonomous LLM agents or a long-duration capacity claim.
import {readFileSync,writeFileSync,root,stage,suffix,bots,sleep,rc,report,X,Y,Z,profile,check,until,join,chat,ask,result,refill,setup,fly} from './skill-certifications-fixture.mjs';
try {
 for(let i=0;i<16;i++){
  const c=await join('CertL'+suffix+String(i).padStart(2,'0'));await setup(c,'mage');await result(c,'/mycli skills learn mage_soar');c.bot.physicsEnabled=false;
 }
 for(const c of bots){const exam=await ask(c,'/mycli guild exam start flight_basic');c.subjectUuid=exam.subjectUuid;}
 for(const c of bots)await chat(c,'/mycli cast mage_soar');
 await until(()=>bots.every(c=>c.abilities.some(a=>(a.flags&6)===6)),'all sixteen paid native flight abilities');
 const before=await rc('mycli admin assessments audit');report.auditBefore=before;report.subjects=bots.map(c=>({name:c.name,uuid:c.bot.player.uuid,subjectUuid:c.subjectUuid}));check('sixteen simultaneous live assessment samplers',before.includes('active=16'),before);
 await sleep(10000);for(const c of bots)c.bot.physicsEnabled=true;
 await Promise.all(bots.map(c=>fly(c,X,Y+4,Z+8)));
 await until(()=>{const players=JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players;return bots.every(c=>players[c.subjectUuid]?.academy?.active?.measurements?.checkpoints>=1);},'sixteen real checkpoint writes');
 check('all sixteen real native routes persist an ordered checkpoint',true);
 const audit=await rc('mycli admin assessments audit');report.audit=audit;report.mspt=await rc('mspt');
 check('all sixteen exams remain active under bounded hover sampling',audit.includes('active=16'),audit);
 const cost=Number(/peakMs=([0-9.E-]+)/.exec(audit)?.[1]);check('entire native sampler including checkpoint writes stays below one tick budget',Number.isFinite(cost)&&cost<50,{peakMs:cost});
 check('existing state byte budgets hold for all controlled clients',bots.every(c=>c.packets.filter(p=>p.channel.endsWith(':state')).every(p=>p.bytes<=16384)));
 await until(()=>bots.every(c=>(c.abilities.at(-1)?.flags&6)===0),'all sixteen paid leases expire',25000);
 // Lease expiry intentionally retains eight seconds of safe-landing grace.
 await until(()=>{const players=JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players;return bots.every(c=>players[c.subjectUuid]?.academy?.active?.state==='interrupted');},'sixteen unfinished exams expire after landing grace',12000);
 const expired=await rc('mycli admin assessments audit');report.expiredAudit=expired;
 check('lease expiry and landing grace durably interrupt all sixteen unfinished exams',expired.includes('active=0'),expired);
 const expiryPeak=Number(/peakMs=([0-9.E-]+)/.exec(expired)?.[1]);check('native checkpoint and expiry write peaks remain below one tick',Number.isFinite(expiryPeak)&&expiryPeak<50,{peakMs:expiryPeak});
 report.passed=true;
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{for(const c of bots)c.bot.quit();await sleep(600);writeFileSync(root+'/load-'+suffix+'.json',JSON.stringify(report,null,2));}
