// Isolated real-client gameplay, funded contracts, paged storage and durable recovery.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,renameSync,mkdirSync,rmdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);const mineflayer=require('mineflayer');
const stage='E:/MC/staging/life-buildings-20261003',roots=['E:/MC/ops/repairs/player-contracts-20261008','F:/MC-backups/repairs/player-contracts-20261008'],phase=process.argv[2]??'pre';
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms)),parse=s=>JSON.parse(s.slice(s.indexOf('{')));
const report={phase,passed:false,startedAt:new Date().toISOString(),checks:[],candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.93.jar')).digest('hex').toUpperCase()};let clients=[];
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
async function until(f,label,timeout=16000){const end=Date.now()+timeout;while(Date.now()<end){if(await f())return;await sleep(60);}throw Error(label+' timeout');}
async function connect(name){await rcon('minecraft:whitelist add '+name);const b=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'}),c={name,bot:b,messages:[],last:0};b.on('messagestr',s=>c.messages.push(s));b.on('error',e=>c.error=String(e));await new Promise((r,j)=>{b.once('spawn',r);b.once('kicked',j);b.once('error',j);});clients.push(c);await sleep(500);return c;}
async function ask(c,q,prefix){const n=c.messages.length;await sleep(Math.max(0,1200-(Date.now()-c.last)));c.last=Date.now();c.bot.chat(q);if(prefix)await until(()=>c.messages.slice(n).some(s=>s.startsWith(prefix)),q);await sleep(150);return c.messages.slice(n);}
async function result(c,q,reason='success'){const j=parse((await ask(c,q,'MC_COMMISSION_RESULT ')).find(s=>s.startsWith('MC_COMMISSION_RESULT ')));check(q+' -> '+reason,j.reason===reason,j);return j;}
async function info(c,id){return parse((await ask(c,'/mycli commission info '+id,'MC_COMMISSION ')).find(s=>s.startsWith('MC_COMMISSION ')));}
async function wallet(c){return parse((await ask(c,'/mycli arena wallet','MC_ARENA ')).find(s=>s.startsWith('MC_ARENA ')));}
async function publish(c,suffix){return (await result(c,'/mycli commission publish '+suffix)).id;}
async function near(c,offset=0){await rcon('minecraft:tp '+c.name+' '+(-593+offset)+' 91 -312');await sleep(200);check('fixture position '+c.name,Math.abs(c.bot.entity.position.x-(-593+offset))<1&&Math.abs(c.bot.entity.position.z+312)<1,c.bot.entity.position);}
async function fight(c,offset=0){await rcon('minecraft:tp '+c.name+' '+(1700+offset)+' 150 1701');await sleep(250);}
async function contents(c,page=1){return await ask(c,'/mycli arena stash list '+page,'MC_STASH_SUMMARY ');}
async function open(c,page){await ask(c,'/mycli arena stash page '+page,'');await until(()=>c.bot.currentWindow,'stash page');return c.bot.currentWindow;}
try{
 check('runtime isolated candidate',/0\.3\.93/.test(await rcon('version AgentFriend')));await rcon('minecraft:gamerule doMobSpawning false');
 await rcon('minecraft:forceload add -608 -320 -544 -304');await sleep(1500);
 await rcon('minecraft:fill -598 90 -316 -589 90 -308 minecraft:stone');await rcon('minecraft:setblock -594 91 -313 minecraft:chest');
 const a=await connect('CommOwner93'),b=await connect('CommRunner93'),c=await connect('CommOther93');for(const x of clients){if(phase==='pre')await ask(x,'/mycli skills learn travel','MC_PROFESSION_RESULT ');await near(x);}
 if(phase==='pre'){
  for(const x of clients)await rcon('minecraft:clear '+x.name+' minecraft:copper_ingot');
  await rcon('minecraft:clear '+c.name+' minecraft:gold_ingot');
  for(const [x,funds] of [[a,1000],[b,0],[c,0]])check('fixture wallet '+x.name,(await rcon('contractqa fund '+x.name+' '+funds)).includes('ok'));
  // Fixtures seed full ordinary pages; all tested operations use the normal client/command paths.
  await rcon('contractqa seed '+a.name+' 54');await rcon('contractqa queue '+a.name);let win=await open(a,1);
  check('original double chest keeps all 54 old slots',win.slots.slice(0,54).every(i=>i?.name==='stone'&&i.count===64));a.bot.closeWindow(win);await sleep(300);
  win=await open(a,2);const book=win.slots[0];report.rewardBook=book?.components;
  check('overflow moves to second page with real stored enchant metadata',book?.name==='enchanted_book'&&JSON.stringify(book.components).includes('stored_enchantments'));a.bot.closeWindow(win);await sleep(300);
  check('page list uses stable global slot numbers',(await contents(a,2)).some(s=>s.startsWith('MC_STASH slot=55 ')));
  await ask(a,'/mycli arena stash take 55 1','MC_STASH_TAKE ');await until(()=>a.bot.inventory.items().some(i=>i.name==='enchanted_book'),'taken enchanted book');
  await ask(a,'/mycli arena stash put enchanted_book 1','MC_STASH_PUT ');check('old put automatically uses free later page',(await contents(a,2)).some(s=>s.includes('slot=55 ')&&s.includes('enchanted_book')));
  check('other UUID cannot see owners storage',!(await contents(b,1)).some(s=>s.startsWith('MC_STASH slot=')));
  await rcon('contractqa seed '+a.name+' 540');await rcon('minecraft:give '+a.name+' minecraft:diamond 1');const failed=await ask(a,'/mycli arena stash put diamond 1','MC_STASH_PUT ');check('all 540 full slots reject deposit without deleting bag item',failed.some(s=>s.includes('moved=0'))&&a.bot.inventory.items().some(i=>i.name==='diamond'));
  check('tenth page and last global slot are usable',(await contents(a,10)).some(s=>s.startsWith('MC_STASH slot=540 ')));await ask(a,'/mycli arena stash take 540 1','MC_STASH_TAKE ');
  await rcon('contractqa seed '+a.name+' 54');await rcon('contractqa queue '+a.name);win=await open(a,2);a.bot.closeWindow(win);await sleep(300);
  await ask(a,'/mycli arena stash pages','');await until(()=>a.bot.currentWindow,'page selector');check('native selector has ten pages',a.bot.currentWindow.slots.slice(0,10).every(i=>i?.name==='chest'));await a.bot.clickWindow(9,0,0);await until(()=>a.bot.currentWindow?.slots?.length>=90,'selected page');a.bot.closeWindow(a.bot.currentWindow);await sleep(300);
  await ask(a,'/mycli guild menu','');await until(()=>a.bot.currentWindow,'guild menu');check('all 37 guild cards and life menu survive',a.bot.currentWindow.slots[46]&&a.bot.currentWindow.slots[47]?.name==='sunflower'&&a.bot.currentWindow.slots[9]?.name==='writable_book');a.bot.closeWindow(a.bot.currentWindow);await sleep(300);
  let id=await publish(a,'delivery iron_ingot 16 25 铁匠急需铁锭');await result(a,'/mycli commission accept '+id,'self_contract');await result(b,'/mycli commission accept '+id);await result(c,'/mycli commission accept '+id,'not_open');await result(a,'/mycli commission cancel '+id,'accepted_contract_requires_abandon');await result(b,'/mycli commission claim '+id,'plain_items_missing');
  await rcon('minecraft:give '+b.name+' minecraft:iron_ingot 16');await result(b,'/mycli commission claim '+id);check('actual delivery completes with escrow reward',(await info(b,id)).state==='completed'&&(await info(b,id)).wallet===25);check('delivery actually removes the supplied inventory',!b.bot.inventory.items().some(i=>i.name==='iron_ingot'));
  await result(b,'/mycli commission claim '+id,'not_accepted');win=await open(a,2);check('issuer receives real goods on the enlarged personal chest',win.slots.slice(0,54).some(i=>i?.name==='iron_ingot'&&i.count===16));a.bot.closeWindow(win);await sleep(300);
  id=await publish(a,'delivery diamond 1 10 试验取消');await result(c,'/mycli commission cancel '+id,'owner_only');await result(a,'/mycli commission cancel '+id);await result(a,'/mycli commission cancel '+id,'accepted_contract_requires_abandon');check('cancel refunds once and no duplicate payout',(await info(a,id)).wallet===975);
  await rcon('minecraft:forceload add 1696 1696 1744 1744');await sleep(500);await rcon('minecraft:fill 1700 149 1700 1744 149 1720 minecraft:stone');await fight(a,1);await fight(b);
  id=await publish(a,'hunt zombie 2 15 结伴守夜');await result(b,'/mycli commission accept '+id);await result(b,'/mycli commission claim '+id,'objective_incomplete');await fight(a,40);
  async function kill(tag){check('native fixture spawn '+tag,(await rcon('minecraft:summon minecraft:zombie 1700 150 1703 {Tags:["'+tag+'"],NoAI:1b,PersistenceRequired:1b}')).includes('Summoned'));await rcon('minecraft:damage @e[tag='+tag+',limit=1] 100 minecraft:player_attack by '+b.name);await sleep(200);}
  await kill('qa_pc_far');check('distant publisher earns no companion kill progress',(await info(b,id)).progress===0);await fight(a,1);await kill('qa_pc_near1');await rcon('minecraft:summon minecraft:zombie 1700 150 1703 {Tags:["qa_pc_assist"],NoAI:1b,PersistenceRequired:1b}');await rcon('minecraft:damage @e[tag=qa_pc_assist,limit=1] 2 minecraft:player_attack by '+b.name);await sleep(600);await rcon('minecraft:damage @e[tag=qa_pc_assist,limit=1] 100 minecraft:player_attack by '+a.name);await sleep(200);check('real kills and actual assists with publisher nearby count',(await info(b,id)).progress===2);await result(b,'/mycli commission claim '+id);await near(a,1);await near(b);
  id=await publish(a,'explore nether 20 下界同行勘察');await result(b,'/mycli commission accept '+id);await result(b,'/mycli commission claim '+id,'objective_incomplete');
  await rcon('minecraft:execute in minecraft:the_nether run minecraft:forceload add -704 -704 -512 -688');await rcon('minecraft:execute in minecraft:the_nether run minecraft:fill -700 150 -700 -530 150 -696 minecraft:stone');
  for(const [x,z] of [[a,-697],[b,-699]])await rcon('minecraft:execute in minecraft:the_nether run minecraft:tp '+x.name+' -695 151 '+z);await sleep(500);await result(b,'/mycli commission claim '+id,'objective_incomplete');
  for(const x of [a,b]){await x.bot.look(-Math.PI/2,0,true);x.bot.setControlState('forward',true);}await sleep(25000);for(const x of [a,b])x.bot.clearControlStates();report.exploration=await info(b,id);
  check('real companion walking records zones distance and moving time',report.exploration.surveyReady,report.exploration);await result(b,'/mycli commission claim '+id,'objective_incomplete');await near(a,1);await near(b);await result(b,'/mycli commission claim '+id);
  id=await publish(a,'structure minecraft:mansion 10 林地府邸调查');await result(b,'/mycli commission accept '+id);check('structure contract requires actual sections and route',(await info(b,id)).exploration.minSections===2);await result(b,'/mycli commission claim '+id,'objective_incomplete');await result(b,'/mycli commission abandon '+id);await result(a,'/mycli commission cancel '+id);
  await result(a,'/mycli commission publish structure minecraft:buried_treasure 10 小结构不能假装走查','structure_not_supported');
  const cfg=stage+'/plugins/AgentFriend/config.yml';renameSync(cfg,cfg+'.write-test');mkdirSync(cfg);
  try{await result(a,'/mycli commission publish delivery dirt 1 10 写失败不扣款','data_unavailable');}finally{rmdirSync(cfg);renameSync(cfg+'.write-test',cfg);}
  check('failed publication preserves actual wallet',(await info(a,id)).wallet===940);
  const prepared=await publish(a,'delivery copper_ingot 8 30 重启恢复交付');await result(b,'/mycli commission accept '+prepared);await rcon('minecraft:give '+b.name+' minecraft:copper_ingot 8');check('real prepared journal fixture accepted',(await rcon('contractqa journal '+b.name+' before')).includes('ok'));
  const removed=await publish(a,'delivery gold_ingot 4 7 扣物后恢复交付');await result(c,'/mycli commission accept '+removed);await rcon('minecraft:give '+c.name+' minecraft:gold_ingot 4');check('actual removed-inventory journal fixture accepted',(await rcon('contractqa journal '+c.name+' after')).includes('ok'));
  const pending=await publish(a,'delivery gold_ingot 3 12 重启未接单');
  const expected={prepared,removed,pending,aWallet:891,bWallet:60};for(const dst of roots)writeFileSync(dst+'/restart-expected.json',JSON.stringify(expected,null,2));
 }else{
  const expected=JSON.parse(readFileSync(roots[0]+'/restart-expected.json','utf8'));check('prepared actual delivery recovered once after real JVM restart',(await info(b,expected.prepared)).state==='completed'&&(await info(b,expected.prepared)).wallet===90);check('prepared removal persisted without duplicating actual supplied copper',!b.bot.inventory.items().some(i=>i.name==='copper_ingot'));await result(b,'/mycli commission claim '+expected.prepared,'not_accepted');
  check('already removed goods recover once with correct payout',(await info(c,expected.removed)).state==='completed'&&(await info(c,expected.removed)).wallet===7&&!c.bot.inventory.items().some(i=>i.name==='gold_ingot'));await result(c,'/mycli commission claim '+expected.removed,'not_accepted');
  check('open contract and escrow survive restart',(await info(a,expected.pending)).state==='open'&&(await info(a,expected.pending)).wallet===891);await result(a,'/mycli commission cancel '+expected.pending);check('restart does not duplicate refund',(await info(a,expected.pending)).wallet===903);
  let win=await open(a,2);check('enchanted book and prior deliveries persist across JVM restart',win.slots.slice(0,54).some(i=>i?.name==='enchanted_book')&&win.slots.slice(0,54).some(i=>i?.name==='iron_ingot')&&win.slots.slice(0,54).some(i=>i?.name==='copper_ingot'));a.bot.closeWindow(win);
 }
 await ask(a,'/mycli commission menu','');await until(()=>a.bot.currentWindow,'contract menu');check('native player market exposes publication and storage',a.bot.currentWindow.slots[50]?.name==='writable_book'&&a.bot.currentWindow.slots[49]?.name==='chest');await a.bot.clickWindow(50,0,0);await until(()=>a.bot.currentWindow?.slots?.length===63,'publication wizard');check('native wizard requires explicit funded confirmation',a.bot.currentWindow.slots[14]?.name==='paper'&&a.bot.currentWindow.slots[15]?.name==='emerald'&&a.bot.currentWindow.slots[22]?.name==='lime_concrete');a.bot.closeWindow(a.bot.currentWindow);await sleep(250);
 report.mspt=await rcon('mspt');report.passed=true;
}catch(e){report.error=String(e.stack||e);console.error(e);process.exitCode=1;}
finally{report.messages=Object.fromEntries(clients.map(x=>[x.name,x.messages]));for(const x of clients){if(x.bot.currentWindow)x.bot.closeWindow(x.bot.currentWindow);x.bot.clearControlStates();x.bot.quit('isolation checks done');}await sleep(500);report.finishedAt=new Date().toISOString();for(const dst of roots)writeFileSync(dst+'/'+phase+'-'+new Date().toISOString().replaceAll(':','-')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,mspt:report.mspt}));}
