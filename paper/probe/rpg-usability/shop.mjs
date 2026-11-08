/** Isolated native-container + real Vault settlement tests. Never targets production. */
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../../ops/mineflayer-client-compat.mjs';
const stage=process.env.SHOP_QA_STAGE||'E:/MC/staging/rpg-shop-guidance-20261106-r1';
assert.equal(await fs.readFile(stage+'/.shop-qa','utf8'),'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA');
assert.equal(await fs.readFile(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const properties=await fs.readFile(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1\r?$/m.test(properties)&&/^server-port=25928\r?$/m.test(properties)&&/^rcon.port=25929\r?$/m.test(properties));
const mode=process.argv[2]||'candidate',tag=process.argv[3]||'a1';assert(/^[a-z0-9]{1,4}$/.test(tag));
const mineflayer=createRequire(process.env.MINEFLAYER_PACKAGE||'E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const report={checks:[],mode,productionChanged:false,syntheticAccountsOnly:true},bots=[];let bot,last=0;
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
const until=async(f,label,timeout=20000)=>{for(const end=Date.now()+timeout;Date.now()<end;){const v=await f();if(v)return v;await sleep(100);}throw Error('timeout '+label);};
const rc=q=>command(q,15000,{port:25929,properties:stage+'/server.properties'});
const ask=async q=>{await sleep(Math.max(0,1100-(Date.now()-last)));last=Date.now();const at=bot.lines.length;bot.chat(q);await until(()=>bot.lines.length>at,q);await sleep(350);return bot.lines.slice(at).join('\n');};
const json=async(q,prefix='MC_ARENA_ECONOMY')=>{const s=await ask(q);const line=s.split('\n').find(v=>v.startsWith(prefix+' '));assert(line,'missing '+prefix+' for '+q+' : '+s);return JSON.parse(line.slice(prefix.length+1));};
const wallet=async()=>Number((await json('/mycli trade wallet --json','MC_RPG')).balance);
async function connect(suffix){
 const b=mineflayer.createBot({host:'127.0.0.1',port:25928,username:'ag_RUShop'+suffix+tag,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(b);b.lines=[];
 b.on('messagestr',s=>b.lines.push(s));b.on('error',e=>{report.clientError=String(e);});installRecipePacketBypass(b._client);
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'spawn',60000);b.physicsEnabled=false;
 await rc('minecraft:tp '+b.username+' 180.5 -59 180.5');await rc('minecraft:gamemode survival '+b.username);await sleep(2200);await rc('qduse emptybag '+b.username);return b;
}
const open=async(q,title)=>{if(bot.currentWindow)bot.closeWindow(bot.currentWindow);await sleep(Math.max(300,1100-(Date.now()-last)));last=Date.now();bot.chat(q);return until(()=>bot.currentWindow&&title.test(JSON.stringify(bot.currentWindow.title))&&bot.currentWindow,'window '+title);};
const click=async(slot,title)=>{const id=bot.currentWindow.id;await bot.clickWindow(slot,0,0);return until(()=>bot.currentWindow&&bot.currentWindow.id!==id&&title.test(JSON.stringify(bot.currentWindow.title))&&bot.currentWindow,'click '+slot);};
const close=async()=>{if(bot.currentWindow)bot.closeWindow(bot.currentWindow);await sleep(300);};
const bagItem=slot=>bot.currentWindow?bot.currentWindow.slots[slot<9?bot.currentWindow.inventoryEnd-9+slot:bot.currentWindow.inventoryStart+slot-9]:bot.inventory.slots[slot<9?36+slot:slot];
async function pricesCannotFundCraftedGear(){
 const lines=await ask('/mycli arena shop list');
 const offers=lines.split('\n').filter(l=>l.startsWith('MC_ARENA_ECONOMY ')).map(l=>JSON.parse(l.slice(17)));
 const each=id=>{const row=offers.find(o=>o.offerId===id);assert(row?.success);return row.unitPrice/row.item.quantity;};
 const wood=each('planks'),stone=each('cobblestone');report.craftedGearPrices=[];
 // Vanilla sticks: two planks yield four sticks. Fractional input costs are conservative;
 // whole shop packs/recipes can only cost more. Query actual server resale quotes, never sell.
 for(const [id,planks,rocks] of [['wooden_sword',2.5,0],['wooden_axe',4,0],['wooden_pickaxe',4,0],['stone_sword',.5,2],['stone_axe',1,3],['stone_pickaxe',1,3]]){
  await rc('minecraft:item replace entity '+bot.username+' inventory.0 with '+id);
  const q=await json('/mycli trade recycle quote bag 9 1 --json');assert(q.success);
  const cost=planks*wood+rocks*stone;report.craftedGearPrices.push({id,minimumMaterialCost:cost,recycleCredit:q.price});
  check('buy-craft-recycle cannot create gold: '+id,cost>=q.price);
 }
 await rc('qduse emptybag '+bot.username);
}
try{
 const plugins=await rc('plugins');assert(plugins.includes('§aAgentFriend')&&plugins.includes('§aQiandengjiRpg')&&plugins.includes('§aVortexRPG'),'all three real RPG plugins must be enabled before testing');
 bot=await connect('a');
 if(mode==='baseline'){
   const s=await ask('/mycli trade shop list');
   report.baselineResponse=s.slice(0,2000);
   check('recommended shop command exists and returns concise priced text',s.includes('金币商城')&&s.includes('torches')&&!s.includes('serializedItemBase64'));
 }else if(mode==='pricing'){
   await pricesCannotFundCraftedGear();
 }else if(mode==='cold'){
   const old=JSON.parse(await fs.readFile(path.join(stage,'shop-candidate-'+tag+'.json'),'utf8'));
   check('bank survives normal restart',await wallet()===old.finalBalance);
   const status=await json('/mycli trade recycle status --json');check('no pending settlement after restart',!status.pending);
   await rc('qduse mana '+bot.username+' 20');const w=await open('/mycli arena stash page 1',/个人|奖励|试炼/);
   check('purchased supplies survive restart',w.slots.slice(0,w.inventoryStart).some(i=>i?.name==='torch'&&i.count===32));await close();
 }else{
   await pricesCannotFundCraftedGear();
   await rc('qduse coins '+bot.username+' 200.25');const before=await wallet();check('synthetic fixture funds the real Vault bank',before>=200.25);
   const alias=await json('/mycli arena wallet --json');check('legacy arena wallet accepts explicit JSON',Number(alias.balance)===before);
   const format=await json('/mycli arena start --json','MC_QUERY_ERROR');check('unsupported trial format gives exact nonexecuted alternative',format.errorCode==='UNSUPPORTED_FORMAT'&&format.nextCommand==='/mycli arena start');
   const s=await ask('/mycli trade shop list');check('concise Chinese shop exposes supplies and executable next step',s.includes('火把')&&s.includes('torches')&&s.includes('trade shop buy')&&!s.includes('serializedItemBase64')&&!s.includes('MC_ARENA_ECONOMY'));
   check('browsing never spends money',await wallet()===before);
   const old=await json('/mycli arena shop list');check('legacy arena JSON remains compatible',old.action==='shop_list'&&old.item.serializedItemBase64&&old.currency==='金币');
   const help=await ask('/mycli trade recycle quote --help');check('help documents source slots and 30 second quote',help.includes('quote')&&help.includes('30秒'));
   await open('/mycli menu',/罗盘|技能/);check('compass has a direct gold shop button',bot.currentWindow.slots[30]?.name==='gold_ingot');
   await click(30,/金币商城/);check('shop uses a native 45 slot inventory',bot.currentWindow.inventoryStart===45);
   const itemSlot=bot.currentWindow.slots.findIndex(i=>i?.name==='torch');assert(itemSlot>=0&&itemSlot<27);
   await click(itemSlot,/确认购买/);check('selecting an item opens confirmation without spending',await wallet()===before);
   await click(10,/金币商城/);check('canceling purchase preserves money',await wallet()===before);
   await click(itemSlot,/确认购买/);const at=bot.lines.length;
   const originalWrite=bot._client.write;let confirmationPackets=0;
   bot._client.write=function(name,packet){
     if(name==='window_click'&&packet.slot===16&&confirmationPackets===0){confirmationPackets=2;originalWrite.call(this,name,packet);return originalWrite.call(this,name,packet);}
     return originalWrite.call(this,name,packet);
   };
   try{await click(16,/金币商城/);}finally{bot._client.write=originalWrite;}
   await until(()=>bot.lines.slice(at).some(s=>s.includes('购买成功')),'confirmed purchase');
   check('duplicate native confirmation packets deduct gold only once',confirmationPackets===2&&await wallet()===before-4);
   check('purchase explains delivery to personal box',bot.lines.slice(at).some(s=>s.includes('stash page 1')));
   await close();await rc('qduse mana '+bot.username+' 20');const chest=await open('/mycli arena stash page 1',/个人|奖励|试炼/);
   check('purchased goods are real items in personal storage',chest.slots.slice(0,chest.inventoryStart).some(i=>i?.name==='torch'&&i.count===32));await close();
   await rc('minecraft:item replace entity '+bot.username+' hotbar.0 with diamond_sword');
   await rc('minecraft:item replace entity '+bot.username+' inventory.0 with iron_sword');
   await rc('qduse armor '+bot.username);await sleep(500);
   const held=await json('/mycli trade recycle quote bag 0 --json');check('currently held weapon cannot be sold',!held.success&&held.reason==='not_recyclable_or_protected');
   const list=await ask('/mycli trade recycle list');check('recycle listing gives real source slot and quote command',list.includes('bag 槽9')&&list.includes('trade recycle quote bag 9 1')&&!list.includes('serializedItemBase64'));
   const other=await connect('b');const main=bot;bot=other;
   const poor=await json('/mycli trade shop buy diamond_chestplate --json');check('insufficient balance rejects purchase',!poor.success&&poor.reason==='insufficient_balance');bot=main;
   const quote=await json('/mycli trade recycle quote bag 9 1 --json');assert(quote.success);
   await rc('minecraft:item replace entity '+bot.username+' inventory.1 with iron_axe');
   const second=await json('/mycli arena recycle quote bag 10 1 --json');
   check('independent quotes expose five minute expiry and exact confirmation',second.success&&second.quoteId!==quote.quoteId&&second.validForSeconds===300&&second.confirmCommand.endsWith(second.quoteId));
   await sleep(31000);
   bot=other;const cross=await json('/mycli trade recycle sell '+quote.quoteId+' --json');check('quotes cannot be used by another account',!cross.success);bot=main;
   const creditBefore=await wallet();const sold=await ask('/mycli trade recycle sell '+quote.quoteId);
   await until(()=>bot.lines.some(s=>s.includes('回收成功')),'async recycle');
   check('recycle removes exact item and credits real bank',await wallet()===creditBefore+quote.price&&!bot.inventory.slots[9]);
   check('sale receipt points to buying supplies',sold.includes('trade shop list')||bot.lines.slice(-10).some(s=>s.includes('回收成功')&&s.includes('trade shop list')));
   const repeat=await json('/mycli trade recycle sell '+quote.quoteId+' --json');check('consumed quote cannot credit again',!repeat.success&&await wallet()===creditBefore+quote.price);
   await rc('minecraft:item replace entity '+bot.username+' inventory.0 with iron_sword');
   const changed=await json('/mycli trade recycle quote bag 9 1 --json');await rc('minecraft:item replace entity '+bot.username+' inventory.0 with diamond_sword');
   const rejected=await json('/mycli trade recycle sell '+changed.quoteId+' --json');check('changed components reject old quote without removing gear',!rejected.success&&rejected.reason==='item_changed'&&bot.inventory.slots[9]?.name==='diamond_sword');
   await open('/mycli trade recycle menu',/装备回收/);const menuBefore=await wallet();
   await rc('minecraft:item replace entity '+bot.username+' inventory.0 with iron_axe');
   const changedAt=bot.lines.length;await click(0,/装备回收/);
   check('stale recycling menu cannot quote a replacement item',bot.lines.slice(changedAt).some(s=>s.includes('item_changed'))&&await wallet()===menuBefore&&bagItem(9)?.name==='iron_axe');
   await click(0,/确认回收/);await click(11,/装备回收/);check('recycle menu cancel keeps original equipment',bagItem(9)?.name==='iron_axe'&&await wallet()===menuBefore);
   await click(0,/确认回收/);const confirmedAt=bot.lines.length;await click(15,/装备回收/);
   await until(()=>bot.lines.slice(confirmedAt).some(s=>s.includes('回收成功')),'GUI sale confirmation');
   check('native recycling confirmation shares real bank settlement',!bagItem(9)&&await wallet()>menuBefore);await close();
   await rc('qduse fullbag '+bot.username);const full=await ask('/mycli inventory');
   check('full bag feedback explains safe deposit and sell-to-buy loop',full.includes('putslot')&&full.includes('trade recycle list')&&full.includes('trade shop list')&&full.includes('不会自动丢弃'));
   const fullBalance=await wallet();const fullBuy=await json('/mycli trade shop buy chest --json');
   const fullAfter=await wallet();report.fullPurchase={success:fullBuy.success,reason:fullBuy.reason,pending:fullBuy.pending,pendingCount:fullBuy.pendingCount,spent:fullBuy.spent,before:fullBalance,after:fullAfter};
   check('full inventory purchase is queued and charged exactly once',fullBuy.success&&fullBuy.pendingCount>0&&fullBuy.spent===3&&fullAfter===fullBalance-3);
   await rc('qduse emptybag '+bot.username);await rc('qduse mana '+bot.username+' 20');const stored=await open('/mycli arena stash page 1',/个人|奖励|试炼/);
   check('full bag purchase does not drop or lose goods',stored.slots.slice(0,stored.inventoryStart).some(i=>i?.name==='chest'));await close();
   const invalid=await ask('/mycli trade shop buy invented_item');check('bad item name returns a corrective command',invalid.includes('trade shop list')&&invalid.includes('未购买'));
   const text=await ask('/mycli trade recycle status');check('status reports bank rather than forcing a transaction',text.includes('金币')&&!text.includes('MC_ARENA_ECONOMY'));
   const persistent=bot;bot=await connect('f');await rc('qduse coins '+bot.username+' 30');
   await rc('qduse withdrawfail '+bot.username+' on');const failureBefore=await wallet();
   try{const failure=await ask('/mycli trade shop buy chest');check('bank failure gives pending advice, not false success',failure.includes('待对账')&&failure.includes('不重复')&&!failure.includes('购买成功'));}
   finally{await rc('qduse withdrawfail '+bot.username+' off');}
   check('failed withdrawal keeps balance unchanged',await wallet()===failureBefore);
   const replay=await ask('/mycli trade shop buy chest');check('uncertain purchase blocks replay',replay.includes('待对账')&&!replay.includes('购买成功'));
   bot=persistent;
   // Preserve the separate failed account's receipts for inspection.
   report.finalBalance=await wallet();
 }
 report.passed=true;
}catch(e){report.error=String(e);throw e;}
finally{for(const b of bots)try{b.quit('isolated shop QA complete');}catch{}await sleep(200);await fs.writeFile(path.join(stage,'shop-'+mode+'-'+tag+'.json'),JSON.stringify(report,null,2));}
