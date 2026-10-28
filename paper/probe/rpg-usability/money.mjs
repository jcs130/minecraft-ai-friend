/** Real native gold + existing shop/trial/player-contract flows, marked loopback QA only. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2],cold=process.argv[3]==='cold';assert(/^[a-z0-9]{1,6}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),bots=[],report={checks:[],receipts:[],productionChanged:false};let bot,last=0;
const check=(name,v)=>{assert(v,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(f,name)=>{for(let end=Date.now()+25000;Date.now()<end;){const v=await f();if(v)return v;await sleep(80);}throw Error('timeout '+name);};
const rc=async q=>{const text=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,text});return text;};
async function connect(suffix,x){const b=mf.createBot({host:'127.0.0.1',port:25928,username:'ag_RUM'+suffix+label,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.receipts.push({clientError:String(e)}));installRecipePacketBypass(b._client);await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'world');b.physicsEnabled=false;await rc(`minecraft:tp ${b.username} ${x}.5 81 2202.5`);await sleep(1200);for(const q of [`minecraft:fill ${x-4} 80 2198 ${x+4} 80 2206 stone`,`minecraft:fill ${x-4} 81 2198 ${x+4} 85 2206 air`])assert(!(await rc(q)).includes('not loaded'));await rc('minecraft:gamemode survival '+b.username);await sleep(3000);return b;}
async function ask(q,prefix='MC_ARENA_ECONOMY'){await sleep(Math.max(0,1150-(Date.now()-last)));last=Date.now();const at=bot.messages.length;bot.chat(q);await until(()=>bot.messages.slice(at).some(s=>s.startsWith(prefix+' ')),q);await sleep(220);const text=bot.messages.slice(at).join('\n');report.receipts.push({player:bot.username,q,text});return JSON.parse(text.split('\n').find(s=>s.startsWith(prefix+' ')).slice(prefix.length+1));}
const wallet=()=>ask('/mycli trade wallet --json','MC_RPG');const eco=q=>ask(q);const contract=q=>ask(q,'MC_COMMISSION_RESULT');
async function text(q,pattern){await sleep(Math.max(0,1150-(Date.now()-last)));last=Date.now();const at=bot.messages.length;bot.chat(q);await until(()=>bot.messages.slice(at).some(s=>pattern.test(s)),q);await sleep(200);const result=bot.messages.slice(at).join('\n');report.receipts.push({q,text:result});return result;}
const out=stage+'/../rpg-money-'+label+'.json';
try{
 bot=await connect('a',4870);
 if(cold){
  const old=JSON.parse(await fs.readFile(out,'utf8'));check('unified native gold survives cold restart',(await wallet()).balance===old.finalCoins);
  check('trial wallet alias still equals native wallet',(await eco('/mycli arena wallet')).balance===old.finalCoins);
  check('trial credit receipt suppresses restart replay',(await rc(`qduse trialcredit ${bot.username} 9`)).includes('trialCredit=0')&&(await wallet()).balance===old.finalCoins);
  check('gold transaction audit remains complete',!(await eco('/mycli arena recycle status')).pending);
  check('old study book remains after cold restart',bot.inventory.items().some(i=>i.name==='written_book'));
 }else{
  const main=bot,runner=await connect('b',4885),failure=await connect('f',4900);const startOther=runner.messages.length;
  for(const b of [main,runner,failure]){await rc('qduse emptybag '+b.username);await rc('qduse heal '+b.username);}
  await rc('qduse coins '+main.username+' 200.25');bot=main;const original=(await wallet()).balance;
  check('legacy wallet command aliases same native bank',(await eco('/mycli arena wallet')).balance===original);
  const listing=await eco('/mycli arena shop list');check('shop price list uses unified gold',listing.currency==='金币'&&listing.unitPrice>0);
  const bought=await eco('/mycli arena shop buy shield');check('old shop confirms real gold withdrawal',bought.success&&bought.spent===7&&(await wallet()).balance===original-7);
  await rc('qduse mana '+bot.username+' 20');await sleep(1200);bot.chat('/mycli arena stash page 1');await until(()=>bot.currentWindow,'bought shield in original box');
  check('paid shop item actually delivered to personal box',bot.currentWindow.slots.slice(0,54).some(i=>i?.name==='shield'));bot.closeWindow(bot.currentWindow);await sleep(300);
  const bonus=await rc('qduse trialcredit '+bot.username+' 9');check('old trial reward credits exact native gold',bonus.includes('trialCredit=9')&&(await wallet()).balance===original+2);
  check('same trial run and floor cannot pay twice',(await rc('qduse trialcredit '+bot.username+' 9')).includes('trialCredit=0')&&(await wallet()).balance===original+2);
  const publish=await contract('/mycli commission publish delivery dirt 3 10 QA-gold-delivery');check('player contract escrows actual gold',publish.success&&(await wallet()).balance===original-8);
  const info=await ask('/mycli commission info '+publish.id,'MC_COMMISSION');check('player contract reports exact native gold including decimals',info.currency==='金币'&&info.reward===10&&info.wallet===original-8);
  bot=runner;const poor=await eco('/mycli arena shop buy diamond_chestplate');check('insufficient native gold rejects shop purchase',!poor.success&&poor.reason==='insufficient_balance'&&(await wallet()).balance===0);
  await rc('minecraft:give '+runner.username+' dirt 3');await until(()=>runner.inventory.items().some(i=>i.name==='dirt'&&i.count===3),'delivery goods');
  check('other player can accept funded contract',(await contract('/mycli commission accept '+publish.id)).success);
  const claim=await contract('/mycli commission claim '+publish.id);check('contract completion credits native gold and consumes exact goods',claim.success&&(await wallet()).balance===10&&!runner.inventory.items().some(i=>i.name==='dirt'));
  check('repeated contract claim cannot mint gold',!(await contract('/mycli commission claim '+publish.id)).success&&(await wallet()).balance===10);
  bot=main;const cancel=await contract('/mycli commission publish delivery dirt 1 5 QA-gold-cancel');check('second contract escrows same bank',cancel.success&&(await wallet()).balance===original-13);
  check('contract cancel returns escrow as native gold',(await contract('/mycli commission cancel '+cancel.id)).success&&(await wallet()).balance===original-8);
  check('cancel cannot refund twice',!(await contract('/mycli commission cancel '+cancel.id)).success&&(await wallet()).balance===original-8);
  check('successful flows leave no pending audit',!(await eco('/mycli arena recycle status')).pending);
  check('finance receipts stay private',!runner.messages.slice(startOther).some(s=>s.startsWith('MC_ARENA_ECONOMY ')&&s.includes('shop_list')));
  report.finalCoins=(await wallet()).balance;
  const oldMastery=await fs.readFile(stage+'/plugins/AgentFriend/spell-mastery.yml','utf8').catch(()=>null);
  await rc('qduse legacytome '+main.username);await until(()=>main.inventory.items().some(i=>i.name==='written_book'),'old study book');
  check('legacy book command has a clear migration refusal',(await text('/mycli skillbook use 0',/legacy_progression_retired/)).includes('/mycli skills status'));
  check('legacy book is not consumed',main.inventory.items().some(i=>i.name==='written_book'&&i.count===1));
  check('old mastery grants are disabled',(await rc('qduse masteryproof '+main.username)).includes('oldMasteryGranted=0 rank=1'));
  check('old mastery query redirects to native skill state',(await text('/mycli mastery',/legacy_progression_retired/)).includes('Vortex'));
  check('new trial loot no longer creates obsolete skill books',(await rc('qduse newtome '+main.username)).includes('newTomeReplacement=EXPERIENCE_BOTTLE amount=8'));
  check('old mastery file stays byte-identical',await fs.readFile(stage+'/plugins/AgentFriend/spell-mastery.yml','utf8').catch(()=>null)===oldMastery);
  const levels=await rc('qduse corelevels '+main.username),parts=/nativeLevel=(\d+) miningLevel=(\d+) combatLevel=(\d+)/.exec(levels);
  check('basic spell mining and combat scaling use native RPG level',parts&&parts[1]===parts[2]&&parts[1]===parts[3]);
  const full=await ask('/mycli status full --json','MC_RPG');check('legacy full status also reads the native authority',full.level===Number(parts[1])&&full.guide&&full.maxMana>0);
  const prospect=await ask('/mycli skills info prospect --json','MC_RPG');
  check('basic skill guide no longer advertises old levels or mastery',prospect.scaling.includes('Vortex')&&!prospect.scaling.includes('熟练度提升'));
  check('namespaced AuraSkills cannot expose a second growth system',(await text('/auraskills:skills',/legacy_progression_retired/)).includes('/mycli skills list'));
  check('namespaced old magic cannot bypass native skill rules',(await text('/magicspells:ms help',/legacy_progression_retired/)).includes('/mycli status'));
  bot=failure;await rc('qduse coins '+failure.username+' 30');const beforeFailure=(await wallet()).balance;await rc('qduse withdrawfail '+failure.username+' on');
  try{
   const failed=await eco('/mycli arena shop buy shield');check('failed bank withdrawal never reports purchase success',!failed.success&&failed.pending&&failed.reason==='money_unverified');
   check('failed bank withdrawal does not deduct or give money',(await wallet()).balance===beforeFailure);
  }finally{await rc('qduse withdrawfail '+failure.username+' off');}
  await rc('qduse mana '+failure.username+' 20');await sleep(1200);bot.chat('/mycli arena stash page 1');await until(()=>bot.currentWindow,'failed purchase personal box');
  check('failed bank withdrawal never delivers a free item',!bot.currentWindow.slots.slice(0,54).some(i=>i?.name==='shield'));bot.closeWindow(bot.currentWindow);await sleep(200);
  check('unknown shop transaction blocks another withdrawal',!(await eco('/mycli arena shop buy shield')).success&&(await wallet()).balance===beforeFailure);
 }
 report.passed=true;
}finally{
 for(const b of bots)try{b.quit('money QA complete');}catch{}await sleep(500);
 await fs.writeFile(cold?out.replace('.json','-cold.json'):out,JSON.stringify(report,null,2));
}
