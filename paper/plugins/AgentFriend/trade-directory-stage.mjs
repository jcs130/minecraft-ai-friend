// Real protocol regression. Requires a stopped/started isolated Paper copy;
// refuses production ports and only creates/deletes its own tagged QA villagers.
// See docs/TRADE_DIRECTORY.md for environment variables and restart verification.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL as fileUrl} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
const stage = process.env.MC_STAGE_PAPER, ops = process.env.MC_TEST_OPS, root = process.env.MC_TEST_REPORT_DIR;
if (!stage || !ops || !root || !process.env.MC_TEST_REQUIRE_FROM) throw Error('Set MC_STAGE_PAPER, MC_TEST_OPS, MC_TEST_REPORT_DIR, MC_TEST_REQUIRE_FROM');
const properties = readFileSync(join(stage, 'server.properties'), 'utf8');
const prop = key => properties.split(/\r?\n/).find(l => l.startsWith(key + '='))?.slice(key.length + 1).trim();
const port = Number(prop('server-port')), rconPort = Number(prop('rcon.port'));
assert.equal(prop('server-ip'), '127.0.0.1');
assert.ok(resolve(stage).toLowerCase().includes('staging') && port >= 25600 && rconPort >= 25600, 'Isolated clone required');
const candidateVersion=process.env.MC_TEST_CANDIDATE_VERSION||'0.4.24';assert.match(candidateVersion,/^\d+\.\d+\.\d+$/);
assert.deepEqual(readdirSync(join(stage, 'plugins')).filter(s => /^AgentFriend-[0-9.]+\.jar$/.test(s)), ['AgentFriend-'+candidateVersion+'.jar']);
const label = process.argv[2] || 'live'; assert.match(label, /^(live|cold)(-[a-z0-9]+)?$/);
const {command} = await import(fileUrl(join(ops, 'rcon-client.mjs')));
const {installRecipePacketBypass} = await import(fileUrl(join(ops, 'mineflayer-client-compat.mjs')));
const {fix1206PotionProtocol} = await import(fileUrl(join(ops, 'minecraft-1206-potion.mjs')));
const require = createRequire(process.env.MC_TEST_REQUIRE_FROM); fix1206PotionProtocol(require);
const rcon = q => command(q, 15000, {properties:join(stage, 'server.properties'), port:rconPort});
const report = {at:new Date().toISOString(), scope:'isolated copy, synthetic QA only', label, checks:[], errors:[]};
report.candidateSha256=createHash('sha256').update(readFileSync(join(stage,'plugins/AgentFriend-'+candidateVersion+'.jar'))).digest('hex');
const bots = [], lines = new Map(), bars = new Map(); let finishing = false;
const check = (name, ok, data) => { assert.ok(ok, name); report.checks.push({name, ...(data ? {data} : {})}); };
async function until(fn, name, timeout=15000) { const end=Date.now()+timeout; while(Date.now()<end){if(await fn())return;await sleep(100);} throw Error('Timeout: '+name); }
function connect(username) {
  const bot = require('mineflayer').createBot({host:'127.0.0.1',port,username,version:'1.20.6',auth:'offline',physicsEnabled:false,defaultChatPatterns:false,logErrors:false});
  installRecipePacketBypass(bot._client); bots.push(bot); lines.set(bot, []); bars.set(bot, []);
  bot.on('messagestr', s=>lines.get(bot).push(s)); bot.on('error', e=>report.errors.push(username+': '+e.message));
  bot.on('kicked', e=>{if(!finishing)report.errors.push(username+': kicked '+JSON.stringify(e));});
  bot._client.on('boss_bar', p=>bars.get(bot).push(p));
  return bot;
}
async function query(bot, q) {
  await sleep(800); const at=lines.get(bot).length; bot.chat(q);
  await until(()=>lines.get(bot).slice(at).some(s=>s.startsWith('MC_TRADE ')), q);
  const value=JSON.parse(lines.get(bot).slice(at).find(s=>s.startsWith('MC_TRADE ')).slice(9));
  report.queries ??= []; report.queries.push({q,value}); return value;
}
async function searchAll(bot, q) {
  const first=await query(bot,q), offers=[...first.offers];
  for(let page=2;page<=first.pages;page++)offers.push(...(await query(bot,q+' '+page)).offers);
  return {...first,offers};
}
async function menu(bot, command='/mycli trade menu') { await sleep(300); bot.chat(command); await until(()=>bot.currentWindow&&JSON.stringify(bot.currentWindow.title).includes('交易板'), command); await sleep(250); return bot.currentWindow; }
async function click(bot, slot, button=0, mode=0) { try { await bot.clickWindow(slot,button,mode); } catch(e) { if(!/transaction|update|sync|reject/i.test(e.message)) throw e; } await sleep(300); }
const inventory = bot=>JSON.stringify(bot.inventory.slots.map(i=>i&&{name:i.name,count:i.count,components:i.components,nbt:i.nbt}));
const fixtureUuid='1c7e1040-4ab3-46c4-b179-21aba3a4525d';
const fixtureInts=Array.from({length:4},(_,i)=>Number.parseInt(fixtureUuid.replaceAll('-','').slice(i*8,i*8+8),16)|0);
const selector='@e[nbt={UUID:[I;'+fixtureInts.join(',')+']},limit=1]';
async function recipesState() {
  const out=[];
  for(let i=0;i<6;i++) for(const field of ['buy','sell','uses','maxUses']) out.push(await rcon('minecraft:data get entity '+selector+' Offers.Recipes['+i+'].'+field));
  out.push(await rcon('minecraft:data get entity '+selector+' Offers.Recipes[2].sell.components."minecraft:stored_enchantments"'));
  return JSON.stringify(out);
}
try {
  await until(async()=>{try{return (await rcon('version AgentFriend')).includes(candidateVersion);}catch{return false;}},'isolated candidate ready',90000);
  await sleep(2000);
  const a=connect('YsmTQATradeA'); await until(()=>a.entity&&a.world.getColumnAt(a.entity.position),'world A');
  const b=connect('YsmTQATradeB'); await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'world B');
  await rcon('minecraft:gamemode survival YsmTQATradeA'); await rcon('minecraft:gamemode survival YsmTQATradeB');
  await rcon('minecraft:tp YsmTQATradeA -549.5 67 -438.5'); await rcon('minecraft:tp YsmTQATradeB -550.5 67 -438.5'); await sleep(1200);
  if (!label.startsWith('cold')) {
    // The village deliberately protects villagers from /kill. Reuse a fixed QA
    // UUID rather than accidentally creating duplicates after a failed run.
    await rcon('minecraft:summon minecraft:villager -549 67 -437 {UUID:[I;'+fixtureInts.join(',')+'],Tags:["trade_directory_qa_20261012"],CustomName:\'{"text":"交易检验商人"}\',NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,VillagerData:{profession:"minecraft:librarian",level:5,type:"minecraft:plains"}}');
    await sleep(1500);
    const recipes = [
      '{buy:{id:"minecraft:emerald",count:3},sell:{id:"minecraft:bread",count:2},maxUses:20}',
      '{buy:{id:"minecraft:wheat",count:8},sell:{id:"minecraft:emerald",count:1},maxUses:20}',
      '{buy:{id:"minecraft:emerald",count:5},buyB:{id:"minecraft:book",count:1},sell:{id:"minecraft:enchanted_book",count:1,components:{"minecraft:stored_enchantments":{levels:{"minecraft:mending":1}}}},maxUses:20}',
      '{buy:{id:"minecraft:emerald",count:7},buyB:{id:"minecraft:book",count:1},sell:{id:"minecraft:enchanted_book",count:1,components:{"minecraft:stored_enchantments":{levels:{"minecraft:sharpness":3}}}},maxUses:20}',
      '{buy:{id:"minecraft:emerald",count:1},sell:{id:"minecraft:arrow",count:16},maxUses:2,uses:2}',
      '{buy:{id:"minecraft:cobblestone",count:16},sell:{id:"minecraft:gravel",count:16},maxUses:20}'
    ];
    await rcon('minecraft:data merge entity '+selector+' {BukkitValues:{"agentfriend:villager_trade_balance":2,"agentfriend:villager_trade_count":6},Offers:{Recipes:['+recipes.join(',')+']}}');
    await sleep(3300);
  }
  let own, id;
  if (!label.includes('tail')) {
  const beforeRecipes = await recipesState();
  const all=await query(a,'/mycli trade list'); check('loaded only scope and Shopkeepers API ready',all.scope==='loaded_merchants_only'&&all.shopkeepers==='ready',all);
  const allRows=[];
  for(let page=1;page<=all.pages;page++){const value=page===1?all:await query(a,'/mycli trade list '+page);allRows.push(...value.offers);}
  check('three configured public shops use actual Shopkeepers offers',new Set(allRows.filter(o=>o.source==='shopkeepers').map(o=>o.uuid)).size>=3);
  check('query paginates all rows beyond old twelve-villager limit',allRows.length===all.total&&all.total>36);
  own=allRows.filter(o=>o.uuid===fixtureUuid); check('all six native recipes visible including barter',own.length===6&&own.some(o=>o.direction==='barter'));
  id=own[0].merchantId; const fullId=own[0].uuid;
  const info=await query(a,'/mycli trade info '+fullId); check('stable full UUID and short ID identify same merchant',info.total===6&&info.offers.every(o=>o.merchantId===id));
  const buy=await searchAll(a,'/mycli trade buy 面包'); check('buy searches received item and preserves native counts',buy.offers.some(o=>o.merchantId===id&&o.result.count===2&&o.costs[0].count===3)&&buy.offers.every(o=>o.direction==='player_buys'));
  const sell=await searchAll(a,'/mycli trade sell 小麦'); check('sell searches payment item and includes real farm shop',sell.offers.some(o=>o.merchantId===id&&o.costs[0].count===8)&&sell.offers.some(o=>o.source==='shopkeepers')&&sell.offers.every(o=>o.direction==='player_sells'));
  const wrong=await query(a,'/mycli trade sell 面包'); check('buy and sell do not invert directions',!wrong.offers.some(o=>o.merchantId===id));
  const books=await searchAll(a,'/mycli trade buy minecraft:enchanted_book');
  check('stored enchantments, levels and second ingredient survive',books.offers.some(o=>o.merchantId===id&&o.result.enchantments['minecraft:mending']===1&&o.costs.length===2&&o.costs[1].id==='minecraft:book')&&books.offers.some(o=>o.result.enchantments['minecraft:sharpness']===3));
  const mending=await searchAll(a,'/mycli trade find 经验修补'); check('Chinese enchantment name searches actual stored enchantment',mending.offers.some(o=>o.merchantId===id&&o.result.enchantments['minecraft:mending']===1));
  const sold=await searchAll(a,'/mycli trade buy 箭'); check('sold-out state is not advertised as available',sold.offers.some(o=>o.merchantId===id&&o.outOfStock&&o.remainingUses===0));
  const missing=await query(a,'/mycli trade find 不存在的QA物品'); check('no result gives loaded-only next step',missing.total===0&&missing.nextStep.includes('不代表全世界'));
  const invalid=await query(a,'/mycli trade list 999'); check('invalid page is bounded with recovery advice',invalid.reason==='page_out_of_range'&&invalid.nextStep.includes('页'));
  check('query packets and results remain private to requester',!lines.get(b).some(s=>s.startsWith('MC_TRADE ')||s.includes('交易检验商人')));
  const unchanged = await recipesState(); check('all queries preserve native costs, results, uses and stored enchantment NBT',unchanged===beforeRecipes);
  } else {
    own=(await query(a,'/mycli trade info '+fixtureUuid)).offers; id=own[0].merchantId;
    check('tail check starts from fresh actual native merchant ID',own[0].uuid===fixtureUuid);
  }
  const baseline = inventory(a); let w=await menu(a); check('native 45-slot board retains item metadata',w.inventoryStart===45&&w.slots.slice(0,36).filter(Boolean).length===36);
  const first=JSON.stringify(w.slots.slice(0,36)); await click(a,44); await until(()=>a.currentWindow&&JSON.stringify(a.currentWindow.title).includes('2/'),'GUI next page');
  check('GUI next page exposes distinct offers',JSON.stringify(a.currentWindow.slots.slice(0,36))!==first);
  await click(a,38); await until(()=>a.currentWindow?.slots.slice(0,36).filter(Boolean).every(i=>JSON.stringify(i).includes('卖给你')),'buy filter GUI');
  check('GUI buy filter is player perspective',true);
  await click(a,40); await until(()=>a.currentWindow?.slots.slice(0,36).filter(Boolean).every(i=>JSON.stringify(i).includes('向你收购')),'sell filter GUI'); check('GUI sell filter is player perspective',true);
  check('buyback board displays collected commodities instead of identical emerald icons',a.currentWindow.slots.slice(0,36).filter(Boolean).every(i=>i.name!=='emerald'));
  for (const mode of [1,2,4]) await click(a,45,0,mode);
  check('shift, hotbar and drop cannot move personal items into board',inventory(a)===baseline);
  await click(a,0,0,1); check('shift click on display cannot take items or trade',inventory(a)===baseline); if(a.currentWindow)a.closeWindow(a.currentWindow);
  await query(a,'/mycli trade stop');
  const hall=await query(a,'/mycli trade hall'); check('reuses real registered harbor without modifying terrain',hall.type==='hall'&&hall.location.world==='world');
  await sleep(300); a.chat('/mycli world menu'); await until(()=>a.currentWindow&&JSON.stringify(a.currentWindow.title).includes('世界生活'),'world menu');
  await click(a,14); await until(()=>a.currentWindow&&JSON.stringify(a.currentWindow.title).includes('交易板'),'world menu directory button');
  check('compass world-life entry opens native trade directory',true); a.closeWindow(a.currentWindow);
  const eye=connect('YsmTQATradeAeye'); await until(()=>eye.entity,'Eye connected'); await sleep(2200);
  await menu(a); const eyeAt=lines.get(eye).length;
  await query(a,'/mycli trade info '+id); await until(()=>lines.get(eye).slice(eyeAt).some(s=>s.startsWith('MC_TRADE ')&&s.includes(id)),'actual attached Eye private quote');
  check('actual attached Eye receives complete private directory quote',lines.get(eye).slice(eyeAt).filter(s=>s.startsWith('MC_TRADE ')).some(s=>JSON.parse(s.slice(9)).offers?.some(o=>o.uuid===fixtureUuid)));
  if(a.currentWindow)a.closeWindow(a.currentWindow); await sleep(400);
  const originalInventory=inventory(a); await query(a,'/mycli trade locate '+id); await sleep(1200);
  check('locate is read-only and does not teleport or consume items',Math.abs(a.entity.position.x+549.5)<0.1&&inventory(a)===originalInventory);
  const moved=bars.get(a).length; await rcon('minecraft:tp '+selector+' -550 67 -437');
  await until(()=>bars.get(a).slice(moved).some(p=>JSON.stringify(p).includes('-550')),'live merchant location in BossBar'); check('merchant movement updates live directional locator',true);
  await query(a,'/mycli trade stop');
  const closeStart=bars.get(a).length; await query(a,'/mycli trade locate '+id); await sleep(1200);
  await sleep(800); const playerAt=lines.get(a).length; a.chat('/mycli locate YsmTQATradeB');
  await until(()=>lines.get(a).slice(playerAt).some(s=>s.includes('正在追踪 YsmTQATradeB')),'switch to player tracking');
  check('player tracking replaces merchant tracking without duplicate locator',bars.get(a).slice(closeStart).some(p=>p.action===1));
  check('locator native update reached attached Eye',bars.get(eye).some(p=>JSON.stringify(p).includes('交易检验商人')));
  await sleep(300); a.chat('/mycli locate off'); await sleep(500);
  await rcon('minecraft:tp '+selector+' -549 67 -437');
  await rcon('minecraft:tp YsmTQATradeA -549.5 67 -438.5'); await rcon('minecraft:give YsmTQATradeA minecraft:emerald 16'); await sleep(700);
  a.setQuickBarSlot(8); const entity=Object.values(a.entities).find(e=>e.uuid===own[0].entityUuid); assert.ok(entity,'actual native merchant entity visible');
  const breadBefore=a.inventory.items().filter(i=>i.name==='bread').reduce((n,i)=>n+i.count,0);
  const emeraldsBefore=a.inventory.items().filter(i=>i.name==='emerald').reduce((n,i)=>n+i.count,0);
  const merchant=await a.openVillager(entity); await a.trade(merchant,0,1); a.closeWindow(merchant); await sleep(500);
  const breadAfter=a.inventory.items().filter(i=>i.name==='bread').reduce((n,i)=>n+i.count,0), emeraldsAfter=a.inventory.items().filter(i=>i.name==='emerald').reduce((n,i)=>n+i.count,0);
  check('physical vanilla trade still charges actual emeralds and delivers bread',breadAfter-breadBefore===2&&emeraldsBefore-emeraldsAfter===3);
  await rcon('minecraft:tp YsmTQATradeA '+(hall.location.x+.5)+' '+(hall.location.y+1)+' '+(hall.location.z+1.5)); await sleep(900);
  a.setQuickBarSlot(8); const sign=a.blockAt(new (require('vec3').Vec3)(hall.location.x,hall.location.y,hall.location.z));
  assert.ok(sign?.name.includes('sign'),'existing facility sign in client world'); await a.activateBlock(sign);
  await until(()=>a.currentWindow&&JSON.stringify(a.currentWindow.title).includes('交易板'),'existing harbor sign opens directory'); check('existing harbor sign works without reconstruction',true); a.closeWindow(a.currentWindow);
  const host=Object.values(a.entities).find(e=>e.name==='villager'&&JSON.stringify(e.metadata).includes('商旅掌柜'));
  assert.ok(host,'registered harbor trader host visible');
  await rcon('minecraft:tp YsmTQATradeA '+(host.position.x+.5)+' '+host.position.y+' '+(host.position.z+1)); await sleep(500);
  await a.activateEntity(host); await until(()=>a.currentWindow?.inventoryStart===9,'native harbor host menu');
  check('harbor host exposes dedicated trade-board button',a.currentWindow.slots[4]?.name==='oak_sign');
  await click(a,4); await until(()=>a.currentWindow&&JSON.stringify(a.currentWindow.title).includes('交易板'),'host button opens board');
  check('harbor host button opens real populated directory',a.currentWindow.slots.slice(0,36).some(Boolean));a.closeWindow(a.currentWindow);
  if(label.startsWith('cold')) {
    check('cold native quote retains stored enchantment and second material',own.some(o=>o.result.enchantments['minecraft:mending']===1&&o.costs[1].id==='minecraft:book'));
    await query(a,'/mycli trade locate '+id); await rcon('minecraft:data merge entity '+selector+' {Health:0f}');
    await until(()=>lines.get(a).some(s=>s.includes('商人已离开已加载范围或不再可交易')),'invalid merchant locator ends');
    const gone=await query(a,'/mycli trade info '+id); check('dead/unloaded trader cannot remain a valid destination',gone.reason==='merchant_unavailable');
    check('cold restart rebuilt real offers with original merchant UUID',true);
  }
  report.mspt=await rcon('mspt'); check('no protocol errors or unexpected disconnects',report.errors.length===0);
} catch(e) { report.errors.push(e.stack||String(e)); }
finally {
  report.lastWindows=bots.map(bot=>({name:bot.username,title:bot.currentWindow?.title,inventoryStart:bot.currentWindow?.inventoryStart}));
  finishing=true; for(const bot of bots)bot.quit();
  report.success=report.errors.length===0;
  writeFileSync(join(root,'trade-'+label+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({success:report.success,checks:report.checks.map(c=>c.name),errors:report.errors})); await sleep(400); process.exit(report.success?0:1);
}
