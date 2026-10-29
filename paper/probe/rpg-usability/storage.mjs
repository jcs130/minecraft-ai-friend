/** QA-only full inventory, remote transfer and real Vault recycling; never production. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/vortex-takeover-20261027',label=process.argv[2],cold=process.argv[3]==='cold',fault=process.argv[3]==='fault';assert(/^[a-z0-9]{1,6}$/.test(label));assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer'),bots=[],report={checks:[],receipts:[],productionChanged:false};let bot,last=0;
const check=(name,v)=>{assert(v,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(f,name)=>{for(let end=Date.now()+25000;Date.now()<end;){const v=await f();if(v)return v;await sleep(80);}throw Error('timeout '+name);};
const rc=async q=>{const text=await command(q,15000,{port:25929,properties:stage+'/server.properties'});report.receipts.push({q,text});return text;};
async function connect(suffix,x){const b=mf.createBot({host:'127.0.0.1',port:25928,username:'ag_RUS'+suffix+label,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.receipts.push({clientError:String(e)}));installRecipePacketBypass(b._client);await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'world');b.physicsEnabled=false;await rc(`minecraft:tp ${b.username} ${x}.5 81 2202.5`);await sleep(1200);for(const q of [`minecraft:fill ${x-4} 80 2198 ${x+4} 80 2206 stone`,`minecraft:fill ${x-4} 81 2198 ${x+4} 85 2206 air`])assert(!(await rc(q)).includes('not loaded'));await rc('minecraft:gamemode survival '+b.username);await sleep(3000);return b;}
async function ask(q,pattern=/MC_RPG |MC_INTRO |MC_ARENA_ECONOMY |MC_STASH|\[RPG\]/){await sleep(Math.max(0,1150-(Date.now()-last)));last=Date.now();const at=bot.messages.length;bot.chat(q);await until(()=>bot.messages.slice(at).some(s=>pattern.test(s)),q);await sleep(220);const text=bot.messages.slice(at).join('\n');report.receipts.push({player:bot.username,q,text});return text;}
async function json(q,prefix='MC_RPG'){const text=await ask(q,new RegExp(prefix+' '));return JSON.parse(text.split('\n').find(s=>s.startsWith(prefix+' ')).slice(prefix.length+1));}
const coin=async()=>json('/mycli trade wallet --json');const eco=q=>json(q,'MC_ARENA_ECONOMY');
const count=id=>bot.inventory.items().filter(i=>i.name===id).reduce((a,i)=>a+i.count,0);
const out=stage+'/../rpg-storage-'+label+'.json';
try{
 bot=await connect(fault?'f':'a',fault?4855:4825);
 if(fault){
  await rc('qduse emptybag '+bot.username);bot.setQuickBarSlot(8);await sleep(250);await rc('minecraft:give '+bot.username+' iron_sword');await until(()=>count('iron_sword')===1,'fault gear');
  const item=bot.inventory.items().find(i=>i.name==='iron_sword'),slot=item.slot>=36?item.slot-36:item.slot;
  const initial=await coin();const quote=await eco(`/mycli arena recycle quote bag ${slot} 1`);check('fault quote created without removing item',quote.success&&count('iron_sword')===1);
  await rc('qduse depositfail '+bot.username+' on');
  try{
   const failed=await eco('/mycli arena recycle sell '+quote.quoteId);
   check('failed native deposit never claims success',!failed.success&&failed.pending&&failed.reason==='recycle_unverified');
   check('unknown payout is not reported as earned coins',failed.earned===null&&failed.quantity===null);
   check('failed deposit does not invent a balance increase',Math.abs((await coin()).balance-initial.balance)<.001);
   const duplicate=await eco('/mycli arena recycle sell '+quote.quoteId);check('uncertain sale cannot be replayed',!duplicate.success&&Math.abs((await coin()).balance-initial.balance)<.001);
  }finally{await rc('qduse depositfail '+bot.username+' off');}
  const status=await eco('/mycli arena recycle status');check('unresolved receipt remains after provider recovery',status.pending);
  const owner=bot._client.uuid||bot.player?.uuid;assert(owner);
  const directory=stage+'/plugins/QiandengjiRpg/recycle-receipts/'+owner;const files=await fs.readdir(directory);const evidence=await fs.readFile(directory+'/'+files.find(f=>f.endsWith('.properties')),'utf8');
  check('escrow retains original full stack for reconciliation',evidence.includes('ESCROW')&&evidence.includes('originalStack')&&evidence.includes('ISSUING'));
  await rc('minecraft:give '+bot.username+' iron_sword');await until(()=>count('iron_sword')===1,'second uncertain gear');
  const q2=await eco(`/mycli arena recycle quote bag ${slot} 1`);const refused=await eco('/mycli arena recycle sell '+q2.quoteId);
  check('pending reconciliation blocks a new sale before item removal',!refused.success&&refused.reason==='recycle_pending'&&count('iron_sword')===1);
 }else if(cold){
  const prior=JSON.parse(await fs.readFile(out,'utf8'));const now=await coin();
  check('native coins survive normal cold restart',Math.abs(now.balance-prior.finalCoins)<.001);
  check('no unresolved recycling after successful cold restart',!(await eco('/mycli arena recycle status')).pending);
  const stash=await ask('/mycli arena stash list',/MC_STASH/);
  check('remotely deposited stone remains in personal box',/minecraft:stone/.test(stash)&&/64/.test(stash));
  check('wallet alias remains same gold after cold restart',(await eco('/mycli arena wallet')).balance===prior.oldWallet);
  check('no currency replay on status query',Math.abs((await coin()).balance-prior.finalCoins)<.001);
 }else{
  const other=await connect('b',4840);const otherAt=other.messages.length;
  await rc('qduse clearhostiles '+bot.username);await rc('qduse heal '+bot.username);await rc('qduse hunger '+bot.username+' 20');await rc('qduse mana '+bot.username+' 20');
  await rc('qduse fullbag '+bot.username);await sleep(300);
  const state=await json('/mycli status --json');
  check('full backpack is primary live guide blocker',state.guide.reason==='inventory_full');
  check('guide contains a concrete existing deposit command',/^\/mycli arena stash putslot \d+ 64$/.test(state.nextCommand));
  check('guide query did not move items',count('stone')===36*64);
  const at=bot.messages.length,tag='qa_storage_'+label;
  await rc(`minecraft:summon item 4825.5 81.2 2202.5 {Tags:["${tag}"],PickupDelay:0s,Item:{id:"minecraft:apple",count:1}}`);
  await until(()=>bot.messages.slice(at).some(s=>s.includes('inventory_full')),'private full pickup hint');
  check('blocked pickup gives direct remote box guidance',bot.messages.slice(at).some(s=>s.includes('putslot')&&s.includes('2魔力')));
  await rc(`minecraft:summon item 4825.5 81.2 2202.5 {Tags:["${tag}"],PickupDelay:0s,Item:{id:"minecraft:apple",count:1}}`);await sleep(1600);
  check('repeated full pickup hints are rate limited',bot.messages.slice(at).filter(s=>s.includes('inventory_full')).length===1);
  check('pickup hint is private',!other.messages.slice(otherAt).some(s=>s.includes('inventory_full')));
  check('server did not auto discard or sell full contents',count('stone')===36*64);
  await rc(`minecraft:kill @e[type=item,tag=${tag}]`);
  const moved=await ask(state.nextCommand,/MC_STASH_PUT/);await until(()=>count('stone')===35*64,'stone transferred');
  check('direct remote deposit actually moves one full stack',/moved=64/.test(moved));
  check('remote deposit has server mana receipt',moved.includes('MC_STORAGE_MAGIC')&&/2/.test(moved));
  check('deposit leaves cursor empty',!bot.inventory.selectedItem);
  const list=await ask('/mycli arena stash list',/MC_STASH/);check('deposited item is queryable',list.includes('minecraft:stone'));
  await ask('/mycli arena stash page 1',/MC_STORAGE_MAGIC/);await until(()=>bot.currentWindow,'remote original chest');
  check('remote GUI also sees the stored stone',bot.currentWindow.slots.slice(0,54).some(i=>i?.name==='stone'&&i.count===64));bot.closeWindow(bot.currentWindow);await sleep(300);
  await rc('qduse emptybag '+bot.username);bot.setQuickBarSlot(8);await sleep(250);await rc('minecraft:give '+bot.username+' iron_sword');await until(()=>count('iron_sword')===1,'gear');
  const slot=bot.inventory.items().find(i=>i.name==='iron_sword').slot;const bagSlot=slot>=36?slot-36:slot;const before=await coin(),old=await eco('/mycli arena wallet');
  const quote=await eco(`/mycli arena recycle quote bag ${bagSlot} 1`);check('existing quote now names RPG currency',quote.success&&quote.currency==='金币'&&quote.price>0);
  check('quote did not consume the equipment',count('iron_sword')===1);
  const sold=await eco('/mycli arena recycle sell '+quote.quoteId);check('native deposit is confirmed before success',sold.success&&sold.currency==='金币'&&!sold.pending);
  await until(()=>count('iron_sword')===0,'gear removed');const after=await coin();
  check('actual Vault balance increased by exact quote',Math.abs(after.balance-before.balance-quote.price)<.001);
  const duplicate=await eco('/mycli arena recycle sell '+quote.quoteId);check('same sale cannot replay',!duplicate.success&&Math.abs((await coin()).balance-after.balance)<.001);
  check('old wallet entry now aliases exact native gold',(await eco('/mycli arena wallet')).balance===after.balance);
  await rc('minecraft:give '+bot.username+' diamond_sword');await until(()=>count('diamond_sword')===1,'second gear');
  const second=bot.inventory.items().find(i=>i.name==='diamond_sword'),secondSlot=second.slot>=36?second.slot-36:second.slot;
  bot.setQuickBarSlot(secondSlot);await sleep(250);check('held weapon is protected',!(await eco(`/mycli arena recycle quote bag ${secondSlot} 1`)).success);bot.setQuickBarSlot(8);await sleep(250);
  const changed=await eco(`/mycli arena recycle quote bag ${secondSlot} 1`);await rc('minecraft:clear '+bot.username+' diamond_sword');await sleep(250);
  const refused=await eco('/mycli arena recycle sell '+changed.quoteId);check('changed source does not pay coins',!refused.success&&Math.abs((await coin()).balance-after.balance)<.001);
  check('recycling is point-to-point',!other.messages.slice(otherAt).some(s=>s.startsWith('MC_ARENA_ECONOMY')));
  report.finalCoins=after.balance;report.oldWallet=after.balance;
 }
 report.passed=true;
}finally{
 for(const b of bots)try{b.quit('storage QA complete');}catch{}await sleep(500);
 await fs.writeFile(cold?out.replace('.json','-cold.json'):fault?out.replace('.json','-fault.json'):out,JSON.stringify(report,null,2));
}
