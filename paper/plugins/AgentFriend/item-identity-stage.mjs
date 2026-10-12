// Real protocol regression; creates/changes synthetic QA inventories on loopback staging only.
// No custom-name patch is installed in Mineflayer: it must read ordinary server packets/messages.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
const stage=process.env.MC_STAGE_PAPER,ops=process.env.MC_TEST_OPS,root=process.env.MC_TEST_REPORT_DIR;
assert.ok(stage&&ops&&root);assert.ok(resolve(stage).toLowerCase().includes('staging'));
const props=readFileSync(join(stage,'server.properties'),'utf8');
const property=key=>props.split(/\r?\n/).find(l=>l.startsWith(key+'='))?.slice(key.length+1).trim();
assert.equal(property('server-ip'),'127.0.0.1');assert.ok(Number(property('server-port'))>=25600&&Number(property('rcon.port'))>=25600);
assert.deepEqual(readdirSync(join(stage,'plugins')).filter(n=>/^AgentFriend-[\d.]+\.jar$/.test(n)),['AgentFriend-0.4.25.jar']);
const mode=process.argv[2]||'java',label=process.argv[3]||'1';assert.ok(['java','bedrock'].includes(mode));assert.match(label,/^[a-z0-9-]{1,16}$/);
const username='YsmIQAItem'+(label.replace(/\D/g,'').slice(0,3)||'A');
const {command}=await import(pathToFileURL(join(ops,'rcon-client.mjs')));
const rcon=q=>command(q.replaceAll('YsmIQAItemsA',username),15000,{properties:join(stage,'server.properties'),port:Number(property('rcon.port'))});
const report={at:new Date().toISOString(),scope:'isolated synthetic QA only; no production inventory changes',mode,label,
 candidateSha256:createHash('sha256').update(readFileSync(join(stage,'plugins/AgentFriend-0.4.25.jar'))).digest('hex'),checks:[],errors:[],messages:[],wire:[]};
const check=(name,ok,data)=>{assert.ok(ok,name);report.checks.push({name,...(data?{data}:{})});};
async function until(fn,name,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Timeout: '+name);}
let finishing=false,close=()=>{},send,lines=report.messages;
async function query(q,prefix='MC_ITEM '){await sleep(350);const at=lines.length;send(q);await until(()=>lines.slice(at).some(s=>s.startsWith(prefix)),q);return JSON.parse(lines.slice(at).find(s=>s.startsWith(prefix)).slice(prefix.length));}
async function inventory(){await sleep(350);const at=lines.length;send('/mycli inventory');
 await until(()=>{const p=lines.slice(at).filter(s=>s.startsWith('MC_INVENTORY ')).map(s=>JSON.parse(s.slice(13)));return p.length&&p.length===p[0].pages;},'complete inventory pages');
 const messages=lines.slice(at).filter(s=>s.startsWith('MC_INVENTORY '));const pages=messages.map(s=>JSON.parse(s.slice(13)));
 check('inventory pages are complete bounded JSON',messages.every(s=>s.length<4096)&&new Set(pages.map(p=>p.page)).size===pages[0].pages);
 return pages.flatMap(p=>p.items);
}
try{
 await until(async()=>{try{return /0\.4\.25/.test(await rcon('version AgentFriend'));}catch{return false;}},'isolated candidate ready',90000);
 if(mode==='java'){
  const require=createRequire(process.env.MC_TEST_REQUIRE_FROM);
  const runtime=createRequire(require.resolve('mineflayer'));
  report.dependencies={mineflayer:require('mineflayer/package.json').version,prismarineItem:runtime('prismarine-item/package.json').version};
  const {installRecipePacketBypass}=await import(pathToFileURL(join(ops,'mineflayer-client-compat.mjs')));
  const {fix1206PotionProtocol}=await import(pathToFileURL(join(ops,'minecraft-1206-potion.mjs')));fix1206PotionProtocol(require);
  const bot=require('mineflayer').createBot({host:'127.0.0.1',port:Number(property('server-port')),username,version:'1.20.6',auth:'offline',physicsEnabled:false,defaultChatPatterns:false,logErrors:false});
  installRecipePacketBypass(bot._client);send=q=>bot.chat(q);close=()=>bot.quit();
  bot.on('messagestr',s=>lines.push(s));bot.on('error',e=>report.errors.push(e.message));bot.on('kicked',e=>{if(!finishing)report.errors.push('kicked '+JSON.stringify(e));});
  await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'native Java world');
  await until(()=>lines.some(s=>s.includes('【特色道具】')&&s.includes('大背包')),'automatic private feature explanation',15000);
  check('ordinary Java system chat explains real backpack and usage',lines.some(s=>s.includes('【特色道具】')&&s.includes('/minepacks:backpack open')));
  let rows=await inventory();const backpack=rows.find(r=>r.customId==='minepacks:backpack_shortcut');
  check('real Minepacks shortcut has truthful identity',backpack?.name==='大背包'&&backpack.id==='minecraft:player_head'&&backpack.baseId===backpack.id&&backpack.usage.includes('54格'));
  const raw=bot.inventory.slots[backpack.windowSlot];report.wire.push({name:raw.name,displayName:raw.displayName,customName:raw.customName,components:raw.components});
  check('unmodified Mineflayer receives native custom_name and texture',raw.name==='player_head'&&JSON.stringify(raw.customName).includes('大背包')&&raw.components.some(c=>c.type==='profile'));
  for(const id of ['agentfriend:skill_compass','agentfriend:status_book','agentfriend:spell_focus'])check('real starter item identified: '+id,rows.some(r=>r.customId===id&&r.usage.length>0));
  const one=await query('/mycli inventory item '+backpack.slot);check('single-item lookup explains all three distinct storage systems',one.name==='大背包'&&one.usage.includes('/questbag')&&one.usage.includes('/mycli arena stash'));
  await rcon('mycli admin givetome YsmIQAItemsA flight 4');await sleep(300);rows=await inventory();check('actual generated skill tome is identified',rows.some(r=>r.customId==='agentfriend:skill_tome'&&r.name.includes('技艺研习书')));
  await rcon('minecraft:item replace entity YsmIQAItemsA inventory.20 with minecraft:player_head');
  let ordinary=await query('/mycli inventory item 29');check('ordinary player head never becomes backpack',ordinary.kind==='vanilla'&&!ordinary.customId);
  await rcon('minecraft:item replace entity YsmIQAItemsA inventory.21 with minecraft:player_head[custom_name=\'{"text":"大背包"}\']');
  const fake=await query('/mycli inventory item 30');check('same-name head without genuine texture is not a server backpack',fake.name==='大背包'&&fake.kind==='named_item'&&!fake.customId&&!fake.usage);
  await rcon('minecraft:item replace entity YsmIQAItemsA inventory.22 with minecraft:diamond_sword[custom_name=\'{"text":"§d旅途「测试」剑"}\',lore=[\'{"text":"服务器真实说明"}\'],enchantments={levels:{"minecraft:sharpness":3}}]');
  const named=await query('/mycli inventory item 31');check('arbitrary renamed item retains Chinese name and lore',named.name==='旅途「测试」剑'&&named.kind==='named_item'&&named.lore.includes('服务器真实说明'));
  await rcon('minecraft:item replace entity YsmIQAItemsA inventory.23 with minecraft:stick[item_name=\'{"text":"营地信物"}\']');
  const itemName=await query('/mycli inventory item 32');check('item_name component is recognized without custom_name',itemName.name==='营地信物'&&itemName.kind==='named_item');
  await rcon('minecraft:item replace entity YsmIQAItemsA inventory.26 with minecraft:air');
  check('empty slot has explicit recovery advice',(await query('/mycli inventory item 35')).status==='empty');
  for(let slot=0;slot<36;slot++){
   const index=slot<9?36+slot:slot;if(bot.inventory.slots[index])continue;
   const target=slot<9?'hotbar.'+slot:'inventory.'+(slot-9);
   await rcon('minecraft:item replace entity YsmIQAItemsA '+target+' with minecraft:granite[custom_name=\''+JSON.stringify({text:'长名称「分页测试」'+slot+'景'.repeat(100)})+'\']');
  }
  await sleep(700);
  const fingerprint=()=>JSON.stringify(bot.inventory.slots.map(i=>i&&{name:i.name,count:i.count,components:i.components,nbt:i.nbt}));const before=fingerprint();
  rows=await inventory();check('all 36 occupied storage slots survive pagination',rows.length===36&&new Set(rows.map(r=>r.slot)).size===36);
  await query('/mycli inventory item '+backpack.slot);await sleep(300);check('identity reads preserve native stacks and metadata',fingerprint()===before);
  const at=lines.length;for(let n=0;n<6;n++){bot.setQuickBarSlot(n);await sleep(100);}await sleep(600);
  check('holding and reopening do not repeat already explained item types',!lines.slice(at).some(s=>s.includes('【特色道具】')));
  const other=require('mineflayer').createBot({host:'127.0.0.1',port:Number(property('server-port')),username:username+'B',version:'1.20.6',auth:'offline',physicsEnabled:false,defaultChatPatterns:false,logErrors:false});installRecipePacketBypass(other._client);
  const elsewhere=[];other.on('messagestr',s=>elsewhere.push(s));other.on('error',e=>report.errors.push('other: '+e.message));const originalClose=close;close=()=>{originalClose();other.quit();};
  await until(()=>other.entity,'second player');const mark=elsewhere.length;await query('/mycli inventory item '+backpack.slot);await inventory();await sleep(400);
  check('private item and inventory results do not leak to unrelated player',!elsewhere.slice(mark).some(s=>s.startsWith('MC_ITEM ')||s.startsWith('MC_INVENTORY ')||s.includes('【物品说明】')));
  const eye=require('mineflayer').createBot({host:'127.0.0.1',port:Number(property('server-port')),username:username+'eye',version:'1.20.6',auth:'offline',physicsEnabled:false,defaultChatPatterns:false,logErrors:false});installRecipePacketBypass(eye._client);
  const mirrored=[];eye.on('messagestr',s=>mirrored.push(s));eye.on('error',e=>report.errors.push('Eye: '+e.message));const closeBeforeEye=close;close=()=>{closeBeforeEye();eye.quit();};
  await until(()=>eye.entity,'paired Eye');await sleep(2200);const eyeMark=mirrored.length;
  await query('/mycli inventory item '+backpack.slot);await until(()=>mirrored.slice(eyeMark).some(s=>s.startsWith('MC_ITEM ')&&JSON.parse(s.slice(8)).owner===username),'actual attached Eye item description');
  check('actual attached Eye receives correct subject item identity',mirrored.slice(eyeMark).some(s=>s.startsWith('MC_ITEM ')&&JSON.parse(s.slice(8)).customId==='minepacks:backpack_shortcut'));
  if(bot.currentWindow)bot.closeWindow(bot.currentWindow);send('/minepacks:backpack open');await until(()=>bot.currentWindow&&bot.currentWindow.inventoryStart===54,'actual Minepacks native window');
  check('original 54-slot Minepacks opens with unchanged shortcut',JSON.stringify(bot.currentWindow.title).includes('大背包'));bot.closeWindow(bot.currentWindow);
 }else{
  const geyser=readFileSync(join(stage,'plugins/Geyser-Spigot/config.yml'),'utf8').split(/^remote:/m)[0];assert.match(geyser,/^ {2}address: 127\.0\.0\.1$/m);
  const port=Number(geyser.match(/^ {2}port: (\d+)$/m)?.[1]);assert.ok(port>=19150&&port!==19132);
  const be=createRequire(process.env.MC_TEST_BEDROCK_REQUIRE_FROM)('bedrock-protocol');
  const client=be.createClient({host:'127.0.0.1',port,version:'1.26.51',offline:true,username:'ItemBE01',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
  send=q=>client.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});close=()=>client.close();
  let spawned=false;client.on('session',p=>{p.xuid='9000000123457';});client.on('spawn',()=>spawned=true);
  client.on('text',p=>lines.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));client.on('inventory_content',p=>report.wire.push(p));client.on('inventory_slot',p=>report.wire.push(p));client.on('error',e=>report.errors.push(e.message));
  client.on('disconnect',p=>{if(!finishing)report.errors.push('disconnect '+JSON.stringify(p));});
  await until(()=>spawned,'Bedrock spawn',30000);await until(()=>lines.some(s=>s.includes('【特色道具】')&&s.includes('大背包')),'Bedrock ordinary private hint');
  check('Bedrock receives Chinese native system-chat explanation',lines.some(s=>s.includes('【特色道具】')&&s.includes('/minepacks:backpack open')));
  const rows=await inventory(),backpack=rows.find(r=>r.customId==='minepacks:backpack_shortcut');
  check('Bedrock receives same truthful named-item identity',backpack?.name==='大背包'&&backpack.baseId==='minecraft:player_head');
  const item=await query('/mycli inventory item '+backpack.slot);check('Bedrock can inspect exact item and storage instructions',item.customId==='minepacks:backpack_shortcut'&&item.usage.includes('54格'));
  await query('/mycli inventory refresh','MC_INVENTORY ');
  await until(()=>JSON.stringify(report.wire,(_,v)=>typeof v==='bigint'?v.toString():v).includes('大背包'),'native Bedrock item name');
  check('Geyser native inventory carries custom backpack name',true);
 }
 check('no protocol errors or unexpected disconnects',report.errors.length===0);
}catch(e){report.errors.push(e.stack||String(e));}
finally{finishing=true;close();report.success=report.errors.length===0;writeFileSync(join(root,'item-identity-'+mode+'-'+label+'.json'),JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{flag:'wx'});console.log(JSON.stringify({success:report.success,checks:report.checks.map(c=>c.name),errors:report.errors}));await sleep(400);process.exit(report.success?0:1);}
