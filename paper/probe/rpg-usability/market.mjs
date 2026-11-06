/** Real inventory, Vault and restart checks. Loopback, synthetic identities only. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const stage=process.env.SHOP_QA_STAGE||'E:/MC/staging/rpg-shop-guidance-20261106-r1';
assert.equal(await fs.readFile(stage+'/.shop-qa','utf8'),'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA');assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1\r?$/m.test(props)&&/^server-port=25928\r?$/m.test(props)&&/^rcon.port=25929\r?$/m.test(props));
const mode=process.argv[2]||'candidate',tag=process.argv[3]||'m1';assert(/^[a-z0-9]{1,4}$/.test(tag));
const mineflayer=createRequire(process.env.MINEFLAYER_PACKAGE||'E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const report={mode,checks:[],productionChanged:false,syntheticAccountsOnly:true},bots=[];
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(f,label,ms=15000)=>{for(let end=Date.now()+ms;Date.now()<end;){const value=await f();if(value)return value;await sleep(100);}throw Error('timeout '+label);};
const rc=q=>command(q,15000,{port:25929,properties:stage+'/server.properties'});
async function connect(suffix,clear=true){const b=mineflayer.createBot({host:'127.0.0.1',port:25928,username:'ag_RUMkt'+suffix+tag,version:'1.21.1',auth:'offline',hideErrors:true});bots.push(b);b.lines=[];b.last=0;b.on('messagestr',s=>b.lines.push(s));b.on('error',()=>{});installRecipePacketBypass(b._client);await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn',60000);b.physicsEnabled=false;await rc('minecraft:tp '+b.username+' 180.5 -59 180.5');await rc('minecraft:gamemode survival '+b.username);await sleep(2000);if(clear)await rc('qduse emptybag '+b.username);return b;}
async function ask(b,q){await sleep(Math.max(0,1100-(Date.now()-b.last)));b.last=Date.now();const at=b.lines.length;b.chat(q);await until(()=>b.lines.length>at,q);await sleep(300);return b.lines.slice(at).join('\n');}
async function j(b,q,prefix='MC_MARKET'){const s=await ask(b,q);const line=s.split('\n').find(l=>l.startsWith(prefix+' '));assert(line,'missing '+prefix+' : '+s);return JSON.parse(line.slice(prefix.length+1));}
const market=(b,q)=>j(b,'/mycli trade auction '+q+' --json');
const gold=b=>j(b,'/mycli trade wallet --json','MC_RPG').then(x=>Number(x.balance));
const fund=(b,n)=>rc('qduse coins '+b.username+' '+n);
const hand=(b,item)=>rc('minecraft:item replace entity '+b.username+' hotbar.0 with '+item);
async function sell(b,item,price){await hand(b,item);const q=await market(b,'sell '+price);assert(q.success,JSON.stringify(q));const r=await market(b,'confirm '+q.quoteId);assert(r.success,JSON.stringify(r));return q.quoteId;}
async function open(b,q,title){if(b.currentWindow)b.closeWindow(b.currentWindow);await sleep(Math.max(300,1100-(Date.now()-b.last)));b.last=Date.now();b.chat(q);return until(()=>b.currentWindow&&title.test(JSON.stringify(b.currentWindow.title))&&b.currentWindow,'window '+title);}
async function click(b,slot,title){const id=b.currentWindow.id;await b.clickWindow(slot,0,0);return until(()=>b.currentWindow&&b.currentWindow.id!==id&&title.test(JSON.stringify(b.currentWindow.title))&&b.currentWindow,'click '+slot);}
async function close(b){if(b.currentWindow)b.closeWindow(b.currentWindow);await sleep(200);}
try{
 const plugins=await rc('plugins');assert(['AgentFriend','QiandengjiRpg','VortexRPG'].every(n=>plugins.includes('§a'+n)),'actual RPG plugins enabled');
 const a=await connect('a',mode!=='cold');
 if(mode==='baseline'){const s=await ask(a,'/mycli trade auction list');report.response=s.slice(0,1800);check('player market exposes listing and sell guidance',s.includes('玩家交易行')&&s.includes('sell <总价>'));}
 else if(mode==='boundaries'){
  const g=await connect('g'),h=await connect('h');
  report.unlockedSetup=await rc('qduse marketitem '+a.username+' unlocked');const unlocked=await market(a,'sell 7');report.unlocked={result:unlocked,item:a.inventory.slots[36]};check('native Vortex unlocked equipment can be offered',unlocked.success);
  await rc('qduse marketitem '+a.username+' locked');check('native Vortex bound equipment cannot be offered',!(await market(a,'sell 7')).success);
  report.preparedSaved=await sell(g,'iron_shovel',6);await rc('qduse marketprepared '+g.username+' '+report.preparedSaved+' saved');g.quit();
  report.preparedBefore=await sell(h,'iron_hoe',6);await rc('qduse marketprepared '+h.username+' '+report.preparedBefore+' before');h.quit();await sleep(1200);
  const g2=await connect('g',false),h2=await connect('h',false);
  check('saved removal resumes OPEN without another removal',(await market(g2,'info '+report.preparedSaved)).state==='OPEN'&&!g2.inventory.slots.some(i=>i?.name==='iron_shovel'));
  check('pre-removal restart boundary aborts without duplicating original',(await market(h2,'info '+report.preparedBefore)).state==='ABORTED'&&h2.inventory.slots[36]?.name==='iron_hoe');
  const s=await connect('s');await hand(s,'diamond_axe');await rc('save-all flush');const quote=await market(s,'sell 15');
  const holder=spawn('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./hold-qa-player.ps1',import.meta.url)),'-Stage',stage,'-PlayerId',s.player.uuid],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';holder.stdout.on('data',d=>output+=d);holder.stderr.on('data',d=>output+=d);
  try{await until(()=>output.includes('held'),'actual Windows player-file lock');const at=s.lines.length;s.chat('/mycli trade auction confirm '+quote.quoteId);await until(()=>s.lines.slice(at).some(l=>l.includes('item_transfer_pending')),'failed save protected');check('real player-file save failure retains escrow and locks transfer',!s.inventory.slots[36]);
   await rc('minecraft:item replace entity '+s.username+' inventory.0 with cobblestone 3');const denied=await ask(s,'/mycli arena stash putslot 9 1');check('pending transfer blocks direct CLI item movement',denied.includes('item_transfer_pending')&&s.inventory.slots[9]?.count===3);
  }finally{holder.stdin.end('release\n');await until(()=>holder.exitCode!==null,'release Windows lock');}
  s.quit();await sleep(1400);const s2=await connect('s',false);check('reconnect after storage recovery completes listing once',(await market(s2,'info '+quote.quoteId)).state==='OPEN'&&!s2.inventory.slots.some(i=>i?.name==='diamond_axe'));report.saveFailureListing=quote.quoteId;
 }
 else if(mode==='cold'){
  const saved=JSON.parse(await fs.readFile(stage+'/market-candidate-'+tag+'.json','utf8'));
  check('seller earnings survive restart',await gold(a)===saved.sellerGold);
  const listed=await market(a,'info '+saved.restartListing);check('escrowed listing survives restart',listed.state==='OPEN'&&listed.quantity===16);
  const cancelled=await market(a,'cancel '+saved.restartListing);check('restart cancellation returns once',cancelled.success&&(await market(a,'cancel '+saved.restartListing)).reason==='already_returned');
  const b=await connect(saved.buyerSuffix,false);check('buyer balance survives restart',await gold(b)===saved.buyerGold);
  await rc('qduse mana '+b.username+' 20');const w=await open(b,'/mycli arena stash page 1',/个人|奖励|试炼/);check('purchased original sword survives restart',w.slots.slice(0,w.inventoryStart).filter(i=>i?.name==='diamond_sword').length===1);await close(b);
  const f=await connect('f',false);const pending=await market(f,'buy '+saved.failedListing);check('uncertain bank operation remains reserved after restart',!pending.success&&pending.reason==='money_pending'&&(await gold(f))===saved.failedGold);
  check('another buyer still cannot take reserved listing',!(await market(b,'buy '+saved.failedListing)).success);
 }else{
  const b=await connect('b'),c=await connect('c');await fund(b,200);await fund(c,200);const a0=await gold(a),b0=await gold(b),c0=await gold(c);
  const menu=await open(a,'/mycli trade shop menu',/金币商城/);check('gold shop exposes player market',menu.slots[43]?.name==='chest_minecart');await click(a,43,/玩家交易行/);check('market uses native container with listing controls',a.currentWindow.inventoryStart===45&&a.currentWindow.slots[38]?.name==='paper');await close(a);
  await hand(a,'diamond_sword[minecraft:custom_name=\'{"text":"QA market sword"}\',minecraft:enchantments={levels:{"minecraft:sharpness":3}},minecraft:damage=17]');
  const q=await market(a,'sell 25');check('sell produces confirmation without removing item',q.success&&a.inventory.slots[36]?.name==='diamond_sword');
  const originalComponents=JSON.stringify(a.inventory.slots[36].components);
  const cross=await market(b,'confirm '+q.quoteId);check('another account cannot confirm a seller quote',!cross.success);
  const listed=await market(a,'confirm '+q.quoteId);check('confirmed listing removes original item',listed.success&&!a.inventory.slots[36]);
  check('repeated confirmation never lists twice',!(await market(a,'confirm '+q.quoteId)).success);
  const info=await market(b,'info '+q.quoteId);check('listing describes full item identity',info.name==='QA market sword'&&info.details.includes('sharpness 3')&&info.details.includes('1544/1561'));
  check('seller cannot buy own listing',!(await market(a,'buy '+q.quoteId)).success);
  const purchases=await Promise.all([market(b,'buy '+q.quoteId),market(c,'buy '+q.quoteId)]);check('two simultaneous buyers have exactly one winner',purchases.filter(x=>x.success).length===1);
  const buyer=purchases[0].success?b:c,loser=buyer===b?c:b;report.buyerSuffix=buyer===b?'b':'c';
  check('winning buyer charged once, losing buyer unchanged',await gold(buyer)===(buyer===b?b0:c0)-25&&await gold(loser)===(loser===b?b0:c0));
  check('online seller credited actual Vault coins',await gold(a)===a0+25);
  check('repeated purchase and collect are idempotent',(await market(buyer,'buy '+q.quoteId)).reason==='already_bought'&&(await market(a,'collect '+q.quoteId)).reason==='already_paid'&&await gold(a)===a0+25);
  await rc('qduse mana '+buyer.username+' 20');const box=await open(buyer,'/mycli arena stash page 1',/个人|奖励|试炼/);const sword=box.slots.slice(0,box.inventoryStart).find(i=>i?.name==='diamond_sword');
  report.itemReceipt=sword;check('buyer receives original name, enchantments and durability',sword&&JSON.stringify(sword).includes('QA market sword')&&JSON.stringify(sword.components)===originalComponents&&sword.durabilityUsed===17);await close(buyer);
  const cancelId=await sell(a,'emerald 7',8);check('non-owner cannot cancel listing',!(await market(b,'cancel '+cancelId)).success);check('seller can cancel once',(await market(a,'cancel '+cancelId)).success&&(await market(a,'cancel '+cancelId)).reason==='already_returned');
  await rc('qduse mana '+a.username+' 20');const returns=await open(a,'/mycli arena stash page 1',/个人|奖励|试炼/);check('cancelled stack returned exactly once',returns.slots.slice(0,returns.inventoryStart).filter(i=>i?.name==='emerald').reduce((n,i)=>n+i.count,0)===7);await close(a);
  await hand(a,'iron_sword');const stale=await market(a,'sell 10');await hand(a,'iron_axe');check('changed hand cannot use old quote',!(await market(a,'confirm '+stale.quoteId)).success&&a.inventory.slots[36]?.name==='iron_axe');
  await hand(a,'diamond_sword[minecraft:custom_data={PublicBukkitValues:{"test:owner":"bound"}}]');check('unknown tagged item is protected',!(await market(a,'sell 5')).success);
  const poor=await connect('p');const poorId=await sell(a,'iron_sword',50);check('insufficient money leaves listing available',!(await market(poor,'buy '+poorId)).success&&(await market(a,'info '+poorId)).state==='OPEN');
  await hand(a,'iron_sword');await open(a,'/mycli trade auction menu',/玩家交易行/);await click(a,38,/设置整组总价/);await click(a,15,/设置整组总价/);await click(a,24,/确认上架/);const pre=await gold(a);await click(a,16,/玩家交易行/);check('human can set price and confirm without typing sell',!a.inventory.slots[36]&&await gold(a)===pre);await close(a);
  const d=await connect('d');const offline=await sell(d,'gold_ingot 3',9);const d0=await gold(d);d.quit();await until(()=>!d.player,'offline seller',2000).catch(()=>sleep(1200));
  await rc('qduse fullbag '+b.username);check('full bag purchase stores goods safely',(await market(b,'buy '+offline)).success);await rc('qduse emptybag '+b.username);
  const d2=await connect('d');check('offline proceeds retained until claim',await gold(d2)===d0&&(await market(d2,'collect '+offline)).success&&await gold(d2)===d0+9);
  const fail=await connect('f');await fund(fail,40);const failed=await sell(a,'iron_pickaxe',12);report.failedGold=await gold(fail);await rc('qduse withdrawfail '+fail.username+' on');
  const first=await market(fail,'buy '+failed);await rc('qduse withdrawfail '+fail.username+' off');
  check('bank failure never gives goods or releases listing',!first.success&&(await market(a,'info '+failed)).state==='RESERVED'&&await gold(fail)===report.failedGold);
  check('bank ambiguity cannot debit again',!(await market(fail,'buy '+failed)).success&&await gold(fail)===report.failedGold);report.failedListing=failed;
  // Console-only fixture marks the shared store unavailable before the listing commit.
  await hand(a,'iron_axe');const bad=await market(a,'sell 6');await rc('qduse marketstatefail '+a.username+' on');
  try{const rejected=await market(a,'confirm '+bad.quoteId);check('escrow write failure keeps original in hand',!rejected.success&&a.inventory.slots[36]?.name==='iron_axe');}finally{await rc('qduse marketstatefail '+a.username+' off');}
  report.restartListing=await sell(a,'torch 16',4);report.sellerGold=await gold(a);report.buyerGold=await gold(buyer);report.purchased=q.quoteId;
 }
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.error(report.error);}
finally{for(const b of bots)try{b.quit();}catch{}await sleep(500);await fs.writeFile(stage+'/market-'+mode+'-'+tag+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({mode,passed:report.checks.length,error:report.error?.split('\n')[0],productionChanged:false}));}
