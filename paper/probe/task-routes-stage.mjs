// Loopback-only integration. Creates its own QA actors/entities; never connects to production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const root='E:/MC/research/paper-task-routes-20261015',stage=root+'/stage',attempt=process.argv[2]??'A';
assert.match(attempt,/^[A-Z][0-9]?$/);
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25840\r?$/m);
assert.match(props,/^rcon.port=25841\r?$/m);assert.match(props,/^motd=TASK_ROUTES_ISOLATED_20261015\r?$/m);
const output=root+'/task-routes-'+attempt+'.json';assert(!fs.existsSync(output));
const req=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json');
const mf=req('mineflayer'),{Vec3}=req('vec3'),yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const report={at:new Date().toISOString(),checks:[],errors:[],samples:{},productionModified:false,
  candidateSha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.42.jar')).digest('hex')};
let closing=false,forced=false,stockBackup=false,stockRestore='';const bots=[],publicForces=[];const routeFile=stage+'/plugins/AgentFriend/route-contracts.yml',original=fs.readFileSync(routeFile);
const rc=q=>command(q,15000,{port:25841,properties:stage+'/server.properties'});
const check=(name,value)=>{report.checks.push({name,pass:!!value});assert(value,name);console.log('PASS '+name)};
async function until(fn,label,timeout=15000){for(const end=Date.now()+timeout;Date.now()<end;){const value=await fn();if(value)return value;await sleep(100)}throw Error('Timeout: '+label)}
async function make(name,version='1.21.1'){
  const bot=mf.createBot({host:'127.0.0.1',port:25840,username:name,version,auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});
  installRecipePacketBypass(bot._client);bots.push(bot);bot.lines=[];bot.payloads=[];
  bot.on('messagestr',s=>bot.lines.push(s.replace(/§[0-9a-fk-or]/gi,'')));
  bot.on('error',e=>{if(!closing)report.errors.push(name+': '+e.message)});
  bot.on('kicked',e=>{if(!closing)report.errors.push(name+': '+JSON.stringify(e))});
  bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:tasks')bot.payloads.push(JSON.parse(p.data.toString()))});
  await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'spawn '+name,40000);return bot;
}
async function say(bot,line){await sleep(Math.max(0,1150-(Date.now()-(bot.lastChat??0))));bot.lastChat=Date.now();bot.chat(line)}
async function cli(bot,line,prefix='MC_TASKS',predicate=()=>true){const from=bot.lines.length;await say(bot,'/mycli '+line);const value=await until(()=>bot.lines.slice(from).filter(s=>s.startsWith(prefix+' ')).map(s=>JSON.parse(s.slice(prefix.length+1))).find(predicate),line);await sleep(120);return value}
async function text(bot,line){const from=bot.lines.length;await say(bot,'/mycli '+line);await sleep(750);return bot.lines.slice(from).join('\n')}
const status=bot=>cli(bot,'tasks status');
const progress=async bot=>(await status(bot)).adventure.progress??0;
async function accept(bot,id){check('accept '+id,(await text(bot,'guild accept '+id)).includes('已接公会委托'));return status(bot)}
async function submit(bot){const answer=await text(bot,'guild claim');return answer}
async function equip(bot,item){await until(()=>bot.inventory.items().find(i=>i.name===item),'inventory '+item);await bot.equip(bot.inventory.items().find(i=>i.name===item),'hand');await sleep(150)}
async function mob(bot,type,label,distance=2){
  const tag='route_'+attempt+'_'+label;
  await rc(`minecraft:summon minecraft:${type} ${bot.entity.position.x+distance} ${bot.entity.position.y} ${bot.entity.position.z} {Tags:["${tag}"],NoAI:1b,NoGravity:1b,Silent:1b,PersistenceRequired:1b,Health:2.0f,ArmorItems:[{},{},{},{id:"minecraft:leather_helmet",count:1}]}`);
  await rc(`minecraft:data merge entity @e[tag=${tag},limit=1] {Health:2.0f}`);
  report.samples[label]={clientPosition:bot.entity.position.clone(),nativePosition:await rc(`minecraft:data get entity @e[tag=${tag},limit=1] Pos`),health:await rc(`minecraft:data get entity @e[tag=${tag},limit=1] Health`)};
  const entity=await until(()=>Object.values(bot.entities).filter(e=>e.name===type&&e.position.distanceTo(bot.entity.position)<distance+1).sort((a,b)=>b.id-a.id)[0],'spawned '+type);
  return {entity,tag};
}
async function hit(bot,type,label,item){
  await rc(`minecraft:item replace entity ${bot.username} hotbar.6 with minecraft:${item}`);bot.setQuickBarSlot(6);await sleep(350);
  assert((await rc('minecraft:data get entity '+bot.username+' SelectedItem.id')).includes('minecraft:'+item),'authoritative attack weapon');
  const target=await mob(bot,type,label);await bot.lookAt(target.entity.position.offset(0,.5,0));bot.attack(target.entity);
  await until(async()=>(await rc(`minecraft:execute if entity @e[tag=${target.tag},limit=1]`)).includes('failed'),'native death '+label);await sleep(250);return target;
}
async function craft(bot,item){
  const table=bot.blockAt(new Vec3(2200,100,2199));assert.equal(table?.name,'crafting_table');
  const recipe=bot.recipesFor(bot.registry.itemsByName[item].id,null,1,table)[0];assert(recipe,'local recipe '+item);
  const before=bot.inventory.items().filter(i=>i.name===item).reduce((n,i)=>n+i.count,0),packets=[];
  const listen=p=>packets.push(p);bot._client.on('set_slot',listen);
  try {
    await bot.activateBlock(table);const w=await until(()=>bot.currentWindow?.type==='minecraft:crafting'&&bot.currentWindow,'real crafting window');
    for(let y=0;y<recipe.inShape.length;y++)for(let x=0;x<recipe.inShape[y].length;x++) {
      const part=recipe.inShape[y][x];if(part.id===-1)continue;
      const source=w.slots.findIndex((i,n)=>n>=w.inventoryStart&&i?.type===part.id);assert(source>=0,'actual ingredient slot');
      await bot.clickWindow(source,0,0);await sleep(80);
      await bot.clickWindow(1+x+3*y,1,0);await sleep(80);
      await bot.clickWindow(source,0,0);await sleep(80);
    }
    // Mineflayer craft() predicts slot 0; this fixture requires the real server's
    // output packet and only then clicks it once. It never replays a failed craft.
    await until(()=>packets.some(p=>p.windowId===w.id&&p.slot===0&&p.item?.itemId===bot.registry.itemsByName[item].id),'native crafting output '+item);
    await bot.clickWindow(0,0,1);await sleep(300);
    await until(()=>w.slots.slice(w.inventoryStart,w.inventoryEnd).filter(i=>i?.name===item).reduce((n,i)=>n+i.count,0)>=before+recipe.result.count&&!w.selectedItem,'confirmed crafted '+item);
    bot.closeWindow(w);await sleep(300);
  }finally{bot._client.off('set_slot',listen)}
}
try{
  check('exact candidate loaded',(await rc('version AgentFriend')).includes('0.4.42'));
  const name='ag_Route'+attempt,eyeName=name+'_eye';
  const pairsFile=stage+'/ops/eye-pairs.json',pairs=JSON.parse(fs.readFileSync(pairsFile));pairs.pairs.push({agent:name,eye:eyeName});fs.writeFileSync(pairsFile,JSON.stringify(pairs));
  const a=await make(name),b=await make('ag_Other'+attempt),human=await make('RouteHuman'+attempt),eye=await make(eyeName);
  await rc('minecraft:gamemode spectator '+eyeName);await sleep(1500);
  const initial=await status(a);check('query does not register or accept',!initial.adventure.joined&&!initial.adventure.activeId&&!initial.life.activeId);
  const outsiderFrom=b.lines.length,eyeFrom=eye.lines.length;
  const routes=await cli(a,'tasks list');report.samples.routes=routes;
  check('six routes with no forced farming',routes.items.length===6&&routes.items[0].id==='combat'&&routes.advice.includes('任选'));
  check('one compact private receipt',a.lines.filter(s=>s.startsWith('MC_TASKS ')&&JSON.parse(s.slice(9)).observedAt===routes.observedAt).length===1);
  check('other Agent receives no private result',!b.lines.slice(outsiderFrom).some(s=>s.startsWith('MC_TASKS ')));
  await until(()=>eye.lines.slice(eyeFrom).some(s=>s.includes('战斗讨伐')),'actual paired Eye readable route summary');
  check('Eye receives readable summary without machine payload',!eye.lines.slice(eyeFrom).some(s=>s.startsWith('MC_TASKS ')));
  const hfrom=human.lines.length;await text(human,'tasks list');
  check('ordinary Java receives Chinese with no raw JSON',human.lines.slice(hfrom).some(s=>s.includes('战斗讨伐'))&&!human.lines.slice(hfrom).some(s=>s.startsWith('MC_TASKS ')));
  const list=await cli(a,'tasks list combat');check('paged route has starter choices',list.items.length<=7&&list.items.some(t=>t.id==='tm_starter_blade')&&list.items.some(t=>t.id==='tm_starter_archer'));
  const detail=await cli(a,'tasks info tm_starter_blade --json');check('detail exposes exact monster weapon and attack rules',detail.steps[0].combat.mobs.includes('ZOMBIE')&&detail.steps[0].combat.weapons.includes('SWORD')&&detail.steps[0].combat.attack==='melee');
  check('unknown flag refuses before opening a window',(await cli(a,'tasks menu combat --wat')).status==='denied'&&!a.currentWindow);
  check('help has JSON contract',(await cli(a,'tasks info --help --json','MC_CLI_HELP')).jsonSupported===true);
  await text(a,'tasks menu --json');await until(()=>JSON.stringify(a.currentWindow?.title??'').includes('选择委托路线'),'route menu');
  check('menu browsing leaves task slot empty',!(await status(a)).adventure.activeId);
  await a.clickWindow(10,0,0);await until(()=>a.currentWindow?.inventoryStart===45,'combat menu');
  const menuId=a.currentWindow.id;await a.clickWindow(0,0,0);await until(()=>a.currentWindow?.id!==menuId,'detail menu');
  check('detail menu still has not accepted',!(await status(a)).adventure.activeId);
  a.closeWindow(a.currentWindow);
  await rc('minecraft:forceload add 2192 2192 2335 2223');forced=true;
  await until(async()=>(await rc('minecraft:execute if loaded 2325 99 2206')).includes('passed'),'loaded QA platform chunks');
  await rc('minecraft:fill 2196 99 2196 2325 99 2206 minecraft:stone');
  await rc('minecraft:fill 2196 100 2196 2325 106 2206 minecraft:air');
  await rc('minecraft:fill 2196 107 2196 2325 107 2206 minecraft:stone');
  await rc('minecraft:setblock 2200 100 2199 minecraft:crafting_table');
  check('fixture floor and roof really exist',(await rc('minecraft:execute if block 2213 99 2202 minecraft:stone')).includes('passed')&&(await rc('minecraft:execute if block 2213 107 2202 minecraft:stone')).includes('passed'));
  await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule doDaylightCycle false');await rc('minecraft:time set midnight');
  await rc('minecraft:tp '+name+' 2201.5 100 2202.5');await until(()=>a.entity.position.distanceTo(new Vec3(2201.5,100,2202.5))<1,'QA platform');
  await sleep(800);check('actor remains on actual QA floor',Math.abs(a.entity.position.y-100)<.1);
  await rc('minecraft:effect give '+name+' minecraft:resistance 600 4 true');
  await rc('minecraft:give '+name+' minecraft:stone_sword');await rc('minecraft:give '+name+' minecraft:stone_axe');
  await text(a,'guild join');await text(a,'world guide start');await text(a,'skills list common');
  await text(a,'skills learn fireworks');await text(a,'cast fireworks');
  const main=await cli(a,'status --json','MC_STATUS');report.samples.mainBefore=main;
  check('newbie next step chooses route instead of farming',main.mainStage==='route_choose'&&!main.mainlineGraduated);
  await accept(a,'tm_starter_blade');
  const config=yaml.load(original.toString());config.tasks.starter_blade.steps[0].combat.mobs=['SKELETON'];fs.writeFileSync(routeFile,yaml.dump(config));
  check('valid operator reload succeeds',(await rc('mycli admin market reload')).includes('已热加载'));
  check('accepted conditions remain frozen',(await cli(a,'tasks info tm_starter_blade')).steps[0].combat.mobs.includes('ZOMBIE'));
  check('new accept preview uses updated conditions',(await cli(b,'tasks info tm_starter_blade')).steps[0].combat.mobs[0]==='SKELETON');
  config.tasks.starter_blade.steps[0].combat.attack=true;fs.writeFileSync(routeFile,yaml.dump(config));
  check('malformed combat rejects whole reload',(await rc('mycli admin market reload')).includes('配置校验失败'));
  check('bad reload retains last valid market',(await cli(b,'tasks info tm_starter_blade')).steps[0].combat.mobs[0]==='SKELETON');
  config.tasks.starter_blade.steps[0].combat.attack='melee';config.tasks.starter_blade.steps[0].target='3';fs.writeFileSync(routeFile,yaml.dump(config));
  check('string kill count cannot silently become one kill',(await rc('mycli admin market reload')).includes('配置校验失败'));
  const longRules=yaml.load(original.toString());longRules.tasks.qa_long={title:'远行'.repeat(30),description:'走查'.repeat(90),icon:'COMPASS',reward:{fame:1,emeralds:1,bonus:'BREAD','bonus-count':1},steps:Array.from({length:8},(_,i)=>({title:String(i)+'路'.repeat(49),description:'真实行动'.repeat(45),goal:'dimension',dimension:'overworld',target:2,'zone-size':4,'min-distance':8,'min-seconds':5}))};
  fs.writeFileSync(routeFile,yaml.dump(longRules));check('valid long task definition loads',(await rc('mycli admin market reload')).includes('已热加载'));
  let page=await cli(a,'tasks info tm_qa_long --json','MC_PAGE'),parts=[];check('long details use the existing bounded page protocol',page.items[0].encoding==='summary'&&page.pages>1);
  while(page.nextCommand){page=await cli(a,page.nextCommand.replace('/mycli ',''),'MC_PAGE');for(const item of page.items)if(item.encoding==='json_fragment')parts.push(item.data)}
  const complete=JSON.parse(parts.join(''));check('all eight long stages reconstruct without truncation',complete.steps.length===8&&complete.steps.every(s=>s.condition.length===180));
  fs.writeFileSync(routeFile,original);await rc('mycli admin market reload');
  await hit(a,'zombie','wrong_weapon','stone_axe');check('wrong weapon does not count',await progress(a)===0);
  await hit(a,'skeleton','wrong_mob','stone_sword');check('wrong monster does not count',await progress(a)===0);
  const magic=await mob(a,'zombie','magic');await rc(`minecraft:damage @e[tag=${magic.tag},limit=1] 10 minecraft:magic by ${name}`);await sleep(500);
  check('server magic damage while holding sword is not physical sword credit',await progress(a)===0);
  for(let i=1;i<=3;i++){await hit(a,'zombie','sword_'+i,'stone_sword');check('actual distinct sword kill '+i,await progress(a)===i)}
  check('final submission succeeds',(await submit(a)).includes('委托交付成功'));
  const graduated=await cli(a,'status --json','MC_STATUS');check('combat route graduates with no life commission',graduated.mainlineGraduated&&!(await status(a)).life.activeId);
  check('completion ledger has only one final task',(await status(a)).adventure.completed===1);
  await text(a,'guild claim');check('repeated claim gives no extra completion',(await status(a)).adventure.completed===1);
  await accept(a,'tm_starter_archer');
  await rc('minecraft:kill @e[tag=route_arrow_debug]');
  await rc('minecraft:item replace entity '+name+' hotbar.6 with minecraft:stone_sword');
  await rc('minecraft:item replace entity '+name+' hotbar.7 with minecraft:bow');
  await rc('minecraft:item replace entity '+name+' hotbar.8 with minecraft:arrow 32');await sleep(400);
  a.setQuickBarSlot(7);await sleep(200);
  check('bow test has authoritative held bow',(await rc('minecraft:data get entity '+name+' SelectedItem.id')).includes('minecraft:bow'));
  const target=await mob(a,'skeleton','arrow',12);
  report.samples.archerHealth=await rc(`minecraft:data get entity @e[tag=${target.tag},limit=1] Health`);
  check('archer target is alive before firing',/\b2(?:\.0)?f\b/.test(report.samples.archerHealth));
  await a.lookAt(target.entity.position.offset(0,1.0,0));a.activateItem();await sleep(1100);a.deactivateItem();await sleep(50);a.setQuickBarSlot(6);
  await until(async()=>(await rc(`minecraft:execute if entity @e[tag=${target.tag},limit=1]`)).includes('failed'),'native arrow kills skeleton');
  check('bow shot credits its launch weapon after switching to sword',await progress(a)===1);
  await text(a,'guild abandon');
  await accept(a,'tm_starter_equipment');
  await rc('minecraft:give '+name+' minecraft:cobblestone 16');await rc('minecraft:give '+name+' minecraft:stick 16');
  await rc('minecraft:give '+name+' minecraft:oak_planks 32');await rc('minecraft:give '+name+' minecraft:iron_ingot 8');
  await craft(a,'stone_sword');check('actual craft completes first stage',(await status(a)).adventure.progress===1);
  await submit(a);check('partial stage grants no final reward',(await status(a)).adventure.completed===1);
  await craft(a,'shield');await submit(a);check('full manufacturing route completes',(await status(a)).adventure.completed===2);
  await accept(a,'tm_restock_light');await rc('minecraft:give '+name+' minecraft:coal 8');
  await craft(a,'torch');await submit(a);await rc('minecraft:give '+name+' minecraft:torch 12');await sleep(300);
  const beforeTorch=a.inventory.items().filter(i=>i.name==='torch').reduce((n,i)=>n+i.count,0);
  const audit=async()=>JSON.parse((await rc('mycli admin sharedstorage audit')).split('MC_GUILD_SHARED_AUDIT ')[1]);
  const publicStock=(await audit()).categories.find(c=>c.id==='supplies');
  const firstBox=publicStock.boxes[0];await rc(`minecraft:tp ${b.username} ${firstBox.x+2.5} ${firstBox.y+1} ${firstBox.z+.5}`);
  await until(async()=>(await rc(`minecraft:execute if loaded ${firstBox.x} ${firstBox.y} ${firstBox.z}`)).includes('passed'),'public stock loaded by actual QA player');
  const locations=new Set();
  for(const box of publicStock.boxes)for(const[dx,dz]of[[0,0],[1,0],[-1,0],[0,1],[0,-1]])locations.add(`${box.x+dx} ${box.y} ${box.z+dz}`);
  const publicChunks=new Set([...locations].map(p=>{const[x,,z]=p.split(' ').map(Number);return `${(x>>4)*16} ${(z>>4)*16}`}));
  for(const chunk of publicChunks){await rc('minecraft:forceload add '+chunk);publicForces.push(chunk)}
  await until(async()=>(await rc(`minecraft:execute if loaded ${firstBox.x} ${firstBox.y} ${firstBox.z}`)).includes('passed'),'stable public stock chunks');
  const stocks=[];for(const at of locations){const raw=await rc('minecraft:data get block '+at+' Items');
    if(raw.includes('[')&&raw.includes(']'))stocks.push({at,items:raw});
    else if((await rc('minecraft:execute if block '+at+' minecraft:chest')).includes('passed'))stocks.push({at,items:'[]'});
  }
  report.samples.stockHalves=stocks.map(s=>({at:s.at,characters:s.items.length}));
  check('all public stock halves are loaded',stocks.length===publicStock.boxes.length*2);
  const stockCount=async()=>{let total=0;for(const row of stocks){
    const answer=await rc(`minecraft:execute if items block ${row.at} container.* minecraft:torch`),match=answer.match(/count:\s*(\d+)/);
    if(match)total+=Number(match[1]);else assert(answer.includes('Test failed'),'native stock count available: '+answer);
  }return total};
  const stockBefore=await stockCount();
  const points=stocks.map(s=>s.at.split(' ').map(Number)),min=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...points.map(p=>p[i])));
  await rc('minecraft:forceload add 2400 2400');stockBackup=true;
  await until(async()=>(await rc('minecraft:execute if loaded 2400 100 2400')).includes('passed'),'private stock backup chunk');
  // Native clone preserves full ItemStack NBT. Never restore items from chat's
  // pretty-printed SNBT: long names, books and textures may be abbreviated.
  check('native complete stock backup succeeds',(await rc(`minecraft:clone ${min.join(' ')} ${max.join(' ')} 2400 100 2400 replace force`)).includes('cloned'));
  stockRestore=`minecraft:clone 2400 100 2400 ${2400+max[0]-min[0]} ${100+max[1]-min[1]} ${2400+max[2]-min[2]} ${min.join(' ')} replace force`;
  const full='['+Array.from({length:27},(_,i)=>`{Slot:${i}b,id:"minecraft:cobblestone",count:64}`).join(',')+']';
  for(const row of stocks)await rc(`minecraft:data merge block ${row.at} {Items:${full}}`);
  const fullState=(await audit()).categories.find(c=>c.id==='supplies');
  check('native stock really is full before attempting delivery',fullState.used===fullState.slots);
  report.samples.fullStockReply=await submit(a);check('full public stock refuses delivery',report.samples.fullStockReply.includes('公共仓库已满'));
  check('full stock keeps player items and active task',a.inventory.items().filter(i=>i.name==='torch').reduce((n,i)=>n+i.count,0)===beforeTorch&&(await status(a)).adventure.activeId==='tm_restock_light');
  check('native original stock restore succeeds',(await rc(stockRestore)).includes('cloned'));stockRestore='';
  check('actual restock final submit succeeds',(await submit(a)).includes('委托交付成功'));
  await until(()=>a.inventory.items().filter(i=>i.name==='torch').reduce((n,i)=>n+i.count,0)===beforeTorch-16,'restock inventory debit');
  check('restock debits exactly sixteen items',true);
  const stockAfter=await stockCount();report.samples.stockCount={before:stockBefore,after:stockAfter};
  check('exactly sixteen torches actually enter public stock',stockAfter===stockBefore+16);
  check('restock increases final completion once',(await status(a)).adventure.completed===3);
  await accept(a,'tm_starter_trail');
  await a.lookAt(new Vec3(2320,101.62,2202.5));a.setControlState('forward',true);await sleep(18000);a.setControlState('forward',false);
  const walked=await status(a);report.samples.walked=walked;
  check('actual movement satisfies route regions distance and moving time',walked.adventure.progress===3);
  check('exploration final submit succeeds',(await submit(a)).includes('委托交付成功'));
  await rc('minecraft:tp '+name+' 2201.5 100 2202.5');await sleep(1000);
  await accept(a,'tm_spider_patrol');await hit(a,'spider','persistent','stone_sword');
  const saved=await status(a);report.samples.saved=saved;report.resume={name,uuid:main.playerUuid,completed:saved.adventure.completed,activeId:saved.adventure.activeId,progress:saved.adventure.progress};
  await rc('minecraft:save-all flush');
  check('no unexpected client errors',report.errors.length===0);report.passed=true;
}catch(error){report.failure=error.stack;console.error(error.stack);process.exitCode=1}
finally{
  closing=true;fs.writeFileSync(routeFile,original);if(stockRestore)await rc(stockRestore);
  if(stockBackup)await rc('minecraft:forceload remove 2400 2400');
  for(const chunk of publicForces)await rc('minecraft:forceload remove '+chunk);
  if(forced)await rc('minecraft:forceload remove 2192 2192 2335 2223');
  for(const bot of bots){bot.clearControlStates();bot.quit()}
  await sleep(600);fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({passed:report.passed??false,checks:report.checks.length,failure:report.failure??null}));
  process.exit(process.exitCode??0);
}
