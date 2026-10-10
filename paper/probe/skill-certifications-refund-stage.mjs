// A QA-only protector cancels potion application; verify native refunds and no solo support credit.
import {writeFileSync,root,suffix,bots,sleep,rc,report,profile,check,join,result,ask,state,refill,setup} from './skill-certifications-fixture.mjs';
try{
 const c=await join('CertZero'+suffix);await setup(c,'priest');await result(c,'/mycli skills learn priest_blessing');await ask(c,'/mycli guild exam start support_basic');await rc('minecraft:tag '+c.name+' add qa_block_blessing');
 const before=await refill(c);await result(c,'/mycli cast priest_blessing','protected_target');const after=await state(c);
 check('zero applied effects refund actual Aura mana',after.mana===before.mana,{before,after});check('zero applied effects remove only this cast cooldown',Number(profile(c).cooldowns.priest_blessing||0)<=Date.now());
 await rc('minecraft:tag '+c.name+' remove qa_block_blessing');await result(c,'/mycli cast priest_blessing');check('refunded cast can immediately retry successfully',(await state(c)).mana<before.mana);
 await sleep(500);const exam=await ask(c,'/mycli guild exam status');check('self-only blessing cannot earn a teamwork certificate',exam.state==='interrupted'&&!profile(c).academy.certificates?.support_basic,exam);report.passed=true;
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{for(const c of bots){try{await rc('minecraft:tag '+c.name+' remove qa_block_blessing');}catch{}c.bot.quit();}await sleep(400);writeFileSync(root+'/refund-'+suffix+'.json',JSON.stringify(report,null,2));}
