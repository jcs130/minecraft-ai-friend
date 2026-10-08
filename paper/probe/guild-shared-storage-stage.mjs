// Isolated native-client validation; never point this at the formal server.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const stage='E:/MC/staging/life-buildings-20261003',roots=['E:/MC/ops/repairs/guild-storage-20261008','F:/MC-backups/repairs/guild-storage-20261008'];
const phase=process.argv[2]??'pre',zs=[-495,-493,-491,-489];
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const parse=s=>JSON.parse(s.slice(s.indexOf('{'))),save=(name,value)=>{for(const root of roots)writeFileSync(root+'/'+name,JSON.stringify(value,null,2)+'\n');};
const report={phase,startedAt:new Date().toISOString(),passed:false,checks:[],sha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.94.jar')).digest('hex').toUpperCase()};
const clients=[];const check=(name,condition,detail)=>{report.checks.push({name,passed:!!condition,detail});assert.ok(condition,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
const until=async(fn,label)=>{for(let i=0;i<160;i++){if(fn())return;await sleep(80);}throw Error(label+' timeout');};
async function connect(name){await rcon('minecraft:whitelist add '+name);const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'}),c={name,bot,lines:[],last:0};bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>c.error=String(e));await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});clients.push(c);bot.setQuickBarSlot(8);await sleep(300);return c;}
async function ask(c,q,match){await sleep(Math.max(0,1200-(Date.now()-c.last)));const n=c.lines.length;c.last=Date.now();c.bot.chat(q);if(match)await until(()=>c.lines.slice(n).some(s=>typeof match==='string'?s.includes(match):match.test(s)),q);await sleep(120);return c.lines.slice(n);}
async function open(c,y,z=-489){await rcon(`minecraft:tp ${c.name} -474.5 67 ${z+.5}`);await sleep(200);const w=await c.bot.openContainer(c.bot.blockAt(new Vec3(-473,y,z)));assert.equal(w.inventoryStart,54);return w;}
const native=i=>i?{name:i.name,count:i.count,components:i.components,removedComponents:i.removedComponents,nbt:i.nbt}:null;
async function contents(c,y){const w=await open(c,y);const data=w.slots.slice(0,54).map(native);c.bot.closeWindow(w);await sleep(120);return data;}
async function snapshot(c){const result=[];for(const y of [67,69,71])result.push({y,items:await contents(c,y)});return result;}
const stock=s=>s.reduce((n,row)=>n+row.items.filter(i=>i?.name==='redstone').reduce((a,i)=>a+i.count,0),0);
const bag=c=>c.bot.inventory.items().filter(i=>i.name==='redstone').reduce((n,i)=>n+i.count,0);
const item=(slot,id,count=64,components='')=>`{Slot:${slot}b,id:"minecraft:${id}",count:${count}${components?',components:'+components:''}}`;
async function box(y,fill,redstone=0,marker=false){for(const x of [-473,-472]){let entries=[];if(fill)for(let i=0;i<27;i++)entries.push(item(i,'cobblestone'));if(x===-473&&redstone)entries=entries.filter(s=>!s.startsWith('{Slot:0b,')).concat(item(0,'redstone',redstone));if(x===-473&&marker)entries=entries.filter(s=>!s.startsWith('{Slot:10b,')).concat(item(10,'enchanted_book',1,'{"minecraft:stored_enchantments":{levels:{"minecraft:unbreaking":3}}}'));assert.match(await rcon(`minecraft:data merge block ${x} ${y} -489 {Items:[${entries.join(',')}]}`),/Modified block data|Nothing changed/);}}
async function prepareSplit(){await box(67,true,60,true);await box(69,true,62);await box(71,false);}
async function give(c){await rcon('minecraft:give '+c.name+' minecraft:redstone 12');await until(()=>bag(c)===12,'12 redstone in real bag');}
try{
 check('isolated candidate version',/0\.3\.94/.test(await rcon('version AgentFriend')));
 if(phase==='pre'){
  for(const y of [69,71])for(const z of zs)for(const [x,type] of [[-473,'left'],[-472,'right']]){
   const reply=await rcon(`minecraft:setblock ${x} ${y} ${z} minecraft:chest[facing=north,type=${type}]`);assert.match(reply,/Changed the block|Could not set the block/);
  }
  const cfg=JSON.parse(readFileSync(roots[0]+'/guild-shared-chests.json','utf8'));writeFileSync(stage+'/plugins/AgentFriend/guild-shared-chests.yml',JSON.stringify(cfg));
  check('hot registration of eight public overflow groups',parse(await rcon('mycli admin sharedstorage reload')).status==='success');
  const audit=parse(await rcon('mycli admin sharedstorage audit'));check('four public categories provide 648 native slots',audit.slots===648&&audit.categories.every(c=>c.available&&c.slots===162),audit);
  const nonce=Date.now().toString(36).slice(-4);
  const a=await connect('GS94A'+nonce),b=await connect('GS94B'+nonce),c=await connect('GS94C'+nonce),d=await connect('GS94D'+nonce),e=await connect('GS94E'+nonce);
  for(const y of [67,69,71])for(const z of zs){const w=await open(e,y,z);e.bot.closeWindow(w);}check('ordinary nonowner can open all twelve double chests from ground',true);
  await ask(e,'/mycli guild shared','MC_GUILD_SHARED_OVERFLOW');check('legacy four directions and eight overflow directions coexist',e.lines.filter(s=>s.startsWith('MC_GUILD_SHARED ')).length===4&&e.lines.filter(s=>s.startsWith('MC_GUILD_SHARED_OVERFLOW ')).length===8);
  const bad=structuredClone(cfg);bad.extras.misc.push([-472,69,-489]);writeFileSync(stage+'/plugins/AgentFriend/guild-shared-chests.yml',JSON.stringify(bad));
  const denied=parse(await rcon('mycli admin sharedstorage reload'));check('duplicate opposite chest half rejected and prior configuration retained',denied.status==='denied'&&denied.retainedPrevious===true&&parse(await rcon('mycli admin sharedstorage audit')).slots===648);
  writeFileSync(stage+'/plugins/AgentFriend/guild-shared-chests.yml',JSON.stringify(cfg));await rcon('mycli admin sharedstorage reload');
  for(const y of [67,69,71])await box(y,false);
  const initialBoard=await rcon('mycli admin board list'),boardIndex=initialBoard.match(/^(\d+) db_\d+_supply_engineering_redstone/m)?.[1];assert.ok(boardIndex,initialBoard);
  await rcon('mycli admin board replace '+boardIndex+' supply_engineering_redstone');const board=await rcon('mycli admin board list'),id=board.match(/db_\d+_supply_engineering_redstone/)?.[0];assert.ok(id,board);
  for(const x of [a,b,c,d]){await ask(x,'/mycli guild join','欢迎加入');await ask(x,'/mycli guild accept '+id,'已接公会委托');}
  await box(67,true);await box(69,false);await box(71,false);await give(a);await ask(a,'/mycli guild claim','MC_GUILD_DELIVERY');let after=await snapshot(e);
  check('full original chest delivers twelve real redstone into second group',bag(a)===0&&stock(after)===12&&after[0].items.every(i=>i?.name==='cobblestone'),after.map(r=>({y:r.y,redstone:stock([r])})));
  await prepareSplit();await give(b);await ask(b,'/mycli guild claim','MC_GUILD_DELIVERY');after=await snapshot(e);
  check('one delivery splits exactly across three partial groups',bag(b)===0&&after.map(r=>stock([r])).join(',')==='64,64,6',after.map(r=>({y:r.y,redstone:stock([r])})));
  await prepareSplit();const before=await snapshot(e);await give(c);assert.match(await rcon('guildstorageqa rewardfull '+c.name),/ok/);
  await ask(c,'/mycli guild claim','个人奖励箱数据异常');after=await snapshot(e);
  check('reward refusal restores every touched chest and the original backpack',bag(c)===12&&JSON.stringify(after)===JSON.stringify(before));
  check('rollback retains real stored enchantments',JSON.stringify(after).includes('stored_enchantments'));
  await rcon('guildstorageqa rewardreset '+c.name);await ask(c,'/mycli guild claim','委托交付成功');const once=await snapshot(e);await ask(c,'/mycli guild claim','当前没有可交付');
  check('retry after failure settles exactly once',bag(c)===0&&stock(once)===134&&JSON.stringify(await snapshot(e))===JSON.stringify(once));
  for(const y of [67,69,71])await box(y,true);await give(d);const full=await snapshot(e);const refusal=await ask(d,'/mycli guild claim','MC_GUILD_DELIVERY');
  check('all groups full explicitly refuses with zero debit',bag(d)===12&&refusal.some(s=>s.includes('"itemsDebited":false'))&&JSON.stringify(await snapshot(e))===JSON.stringify(full));
  const path=stage+'/plugins/AgentFriend/lands.yml',landText=readFileSync(path,'utf8'),land=JSON.parse(landText);land.lands.adventurers_guild_storage['public-containers']=land.lands.adventurers_guild_storage['public-containers'].filter(p=>p.join(',')!=='-472,69,-489');writeFileSync(path,JSON.stringify(land));await rcon('mycli admin land reload');
  for(const y of [67,69,71])await box(y,false);await ask(d,'/mycli guild claim','MC_GUILD_DELIVERY');
  check('removing public permission immediately blocks routing despite retained registration',bag(d)===12&&parse(await rcon('mycli admin sharedstorage audit')).categories[3].available===false);
  const privateReload=parse(await rcon('mycli admin sharedstorage reload'));check('private opposite half cannot be registered as public storage',privateReload.status==='denied'&&privateReload.retainedPrevious===true);
  writeFileSync(path,landText);await rcon('mycli admin land reload');await rcon('mycli admin sharedstorage reload');
  const guard=await ask(e,'/mycli protect break -473 69 -489','MC_PROTECTION ');check('ordinary user cannot dismantle public warehouse',guard.some(s=>s.includes('"allowed":false')));
  await box(67,true);await box(69,false,9,true);await box(71,false);
  assert.match(await rcon('guildstorageqa stashseed '+e.name),/ok/);const preview=await rcon('mycli admin sharetrial '+e.name);
  check('stash sharing preview includes overflow without changing stock',preview.includes('planned=1')&&stock(await snapshot(a))===9,preview);
  const applied=await rcon('mycli admin sharetrial '+e.name+' apply'),shared=await snapshot(a);check('existing stash-sharing path also routes into overflow',applied.includes('moved=1')&&stock(shared)===9&&shared.some(r=>r.y===69&&r.items.some(i=>i?.name==='copper_ingot'&&i.count===8)),applied);
  const f=await connect('GS94F'+nonce),task='qa_overflow_chain_'+nonce;
  appendFileSync(stage+'/plugins/AgentFriend/task-market.yml',`\n  ${task}:\n    scope: personal\n    title: 公共仓库分阶段备料\n    description: 隔离服验证实际交料和阶段结算。\n    beneficiary: 机关工坊\n    icon: REDSTONE\n    reward: {fame: 4, emeralds: 2, bonus: BREAD, bonus-count: 1}\n    steps:\n      - {title: 红石备料, description: 实交十二份红石。, goal: donate, item: REDSTONE, target: 12, chest: misc}\n      - {title: 石砖备料, description: 实交八块石砖。, goal: donate, item: STONE_BRICKS, target: 8, chest: misc}\n`);
  const market=await rcon('mycli admin market reload');assert.match(market,/success|已|加载/);
  await ask(f,'/mycli guild accept tm_'+task,/已接|已承/);await give(f);await ask(f,'/mycli guild claim','阶段已交付');
  check('multistage market supply uses overflow and advances after actual debit',bag(f)===0&&stock(await snapshot(a))===21);
  await rcon('minecraft:give '+f.name+' minecraft:stone_bricks 8');await ask(f,'/mycli guild claim','委托交付成功');
  const chain=await snapshot(a);check('last supply stage completes with exactly eight actual stone bricks',chain.some(r=>r.items.some(i=>i?.name==='stone_bricks'&&i.count===8)));
  // Publishing a fresh card sees all groups, while D keeps its accepted twelve-item snapshot.
  const stockCard=await rcon('mycli admin board replace '+boardIndex+' supply_engineering_redstone');check('dynamic request can be republished using grouped stock',stockCard.includes('替换')||stockCard.includes('更新'),stockCard);
  const currentBoard=await rcon('mycli admin board list');check('fresh shortage sees twenty-one upper-layer items and requests only eleven',currentBoard.split('\n').some(s=>s.includes(id)&&s.endsWith('x11')),currentBoard);
  const expected={sha256:report.sha256,misc:await snapshot(a),pendingPlayer:d.name,observer:e.name,redstoneBefore:21,card:id};save('restart-expected.json',expected);
 }else{
  const expected=JSON.parse(readFileSync(roots[0]+'/restart-expected.json','utf8')),d=await connect(expected.pendingPlayer),e=await connect(expected.observer);
  check('same candidate restored after normal JVM restart',expected.sha256===report.sha256);
  check('all 648 physical slots re-register after restart',parse(await rcon('mycli admin sharedstorage audit')).slots===648);
  check('physical items and stored enchantments persist byte for byte at client layer',JSON.stringify(await snapshot(e))===JSON.stringify(expected.misc));
  check('failed full-storage claimant retains twelve carried redstone after restart',bag(d)===12);
  await ask(d,'/mycli guild claim','委托交付成功');check('frozen twelve-item commission still completes into overflow',bag(d)===0&&stock(await snapshot(e))===expected.redstoneBefore+12);
  await ask(d,'/mycli guild claim','当前没有可交付');check('post-restart duplicate claim does not add items',stock(await snapshot(e))===expected.redstoneBefore+12);
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);report.messages=clients.map(c=>({name:c.name,lines:c.lines.slice(-12)}));process.exitCode=1;}
finally{
 for(const c of clients){if(c.bot.currentWindow)c.bot.closeWindow(c.bot.currentWindow);c.bot.quit();}await sleep(200);
 report.finishedAt=new Date().toISOString();save(phase+'-'+report.finishedAt.replaceAll(':','-')+'.json',report);console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));
}
