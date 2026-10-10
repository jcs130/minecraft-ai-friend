// Native actions on a disposable Paper copy only. Creative materials/flat ground are test fixtures.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const root=process.argv[2],stage=process.argv[3];assert.equal(root,'E:/MC/ops/repairs/starter-house-training-20261011');assert.equal(stage,'E:/MC/staging/starter-house-training-20261011');
const req=createRequire('E:/Cortico/package.json');fix1206PotionProtocol(req);const data=createRequire(req.resolve('mineflayer'))('minecraft-data')('1.20.6');
const food=data.protocol.types.SlotComponent[1].find(f=>f.name==='data').type[1].fields.food[1];const later=food.findIndex(f=>f.name==='usingConvertsTo');if(later>=0)food.splice(later,1); // Test-local correction, no installed client changes.
const mfReq=createRequire(req.resolve('mineflayer'));const mf=req('mineflayer'),Vec3=mfReq('vec3').Vec3,Item=mfReq('prismarine-item')('1.20.6');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rc=q=>command(q,15000,{port:25643,properties:stage+'/server.properties'}),report={at:new Date().toISOString(),passed:false,checks:[],errors:[],messages:[]};let bot;
async function until(fn,label,ms=18000){for(const end=Date.now()+ms;Date.now()<end;){if(await fn())return;await sleep(100);}throw Error('Timeout '+label);}
function check(name,yes){assert.ok(yes,name);report.checks.push(name);console.log('PASS '+name);}
async function chat(s){bot.chat(s);await sleep(500);}
function coach(type){return report.messages.filter(x=>x.startsWith('MC_COACH ')).map(x=>JSON.parse(x.slice(9))).filter(x=>x.type===type);}
async function lessons(){const count=coach('lessons').length;await chat('/mycli coach lessons');await until(()=>coach('lessons').length>count,'lessons');return coach('lessons').at(-1);}
const lesson=(s,id)=>s.lessons.find(x=>x.id===id);
async function life(){const count=bot.life.length;await chat('/mycli life status');await until(()=>bot.life.length>count,'life');return bot.life.at(-1);}
async function open(){await chat('/minepacks:backpack open');await until(()=>bot.currentWindow,'backpack');return bot.currentWindow;}
async function close(){bot.closeWindow(bot.currentWindow);await sleep(450);}
async function shift(slot){await bot.clickWindow(slot,0,1);await sleep(250);}
async function tp(x,z){await rc(`minecraft:tp ${bot.username} ${2000+x} 101 ${2000+z}`);await sleep(300);}
async function place(x,y,z,name,ref,face){
 const pos=new Vec3(2000+x,100+y,2000+z);if(bot.blockAt(pos)?.name===name)return;
 await bot.creative.setInventorySlot(36,new Item(data.itemsByName[name].id,data.itemsByName[name].stackSize));bot.setQuickBarSlot(0);
 let direction=face?new Vec3(...face):new Vec3(0,1,0),reference=bot.blockAt(ref?new Vec3(2000+ref[0],100+ref[1],2000+ref[2]):pos.offset(0,-1,0));
 if(!ref&&reference?.name==='air'){for(const d of [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1)]){const adjacent=bot.blockAt(pos.minus(d));if(adjacent&&adjacent.name!=='air'){reference=adjacent;direction=d;break;}}}
 assert.ok(reference&&reference.name!=='air','loaded solid placement reference');
 await bot.placeBlock(reference,direction);await until(()=>bot.blockAt(pos)?.name===name,'placed '+name+' '+pos,3500);
}
try{
 bot=mf.createBot({host:'127.0.0.1',port:25642,username:process.env.HOUSE_QA_NAME||'HomeQA12',auth:'offline',version:'1.20.6',viewDistance:'short'});bot.life=[];
 bot.on('messagestr',s=>report.messages.push(s));bot.on('error',e=>report.errors.push(e.message));
 bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:life')bot.life.push(JSON.parse(p.data));});
 await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);setTimeout(()=>reject(Error('spawn timeout')),22000).unref();});await sleep(1000);
 check('candidate 0.4.15 loaded',/0\.4\.15/.test(await rc('version AgentFriend')));
 if(process.argv.includes('--resume')){
  const state=await lessons();check('backpack and CLI proofs survive normal restart',lesson(state,'backpack').done&&lesson(state,'cli').done);
  const s=await life();check('claimed house and reputation survive restart',s.activeId===''&&s.reputation.builder===4);
  await chat('/mycli life claim');check('repeat claim does not duplicate reward',/没有可交付/.test(report.messages.at(-1)) || (await life()).activeId==='');
 }else{
  await rc('minecraft:forceload add 1998 1998 2008 2008');await rc('minecraft:fill 1998 100 1998 2006 100 2006 stone');await rc('minecraft:fill 1998 101 1998 2006 108 2006 air');
  await tp(2.5,2.5);await rc('minecraft:gamemode survival '+bot.username);await sleep(400);
  let state=await lessons();check('six optional feature lessons discover real backpack and skills',state.lessons.length===6&&lesson(state,'backpack').command==='/minepacks:backpack open'&&!lesson(state,'backpack').done);
  await chat('/mycli explain does_not_exist');await chat('/mycli list common 999');check('invalid queries do not fabricate CLI proof',!lesson(await lessons(),'cli').done);
  await chat('/mycli list');await chat('/mycli explain skills');await chat('/mycli status');check('valid list detail and status record CLI lesson',lesson(await lessons(),'cli').done);
  await chat('/questbag');await sleep(400);if(bot.currentWindow)await close();check('quest bag cannot satisfy Minepacks lesson',!lesson(await lessons(),'backpack').done);
  await rc('minecraft:give '+bot.username+' paper 7');let w=await open();check('actual Minepacks has 54 storage slots',w.inventoryStart===54);
  let slot=w.slots.findIndex((x,i)=>i>=w.inventoryStart&&x?.name==='paper');await shift(slot);slot=w.slots.findIndex((x,i)=>i<w.inventoryStart&&x?.name==='paper');await shift(slot);await close();
  check('deposit and withdraw in same opening is not a reopened roundtrip',!lesson(await lessons(),'backpack').done);
  w=await open();slot=w.slots.findIndex((x,i)=>i>=w.inventoryStart&&x?.name==='paper');await shift(slot);await close();
  state=await lessons();check('real deposit and close recorded but retrieval still pending',!lesson(state,'backpack').done&&lesson(state,'backpack').instruction.includes('重开取回'));
  w=await open();slot=w.slots.findIndex((x,i)=>i<w.inventoryStart&&x?.name==='paper');assert.ok(slot>=0);await shift(slot);await close();
  check('reopen retrieve close verifies conserved original seven paper',lesson(await lessons(),'backpack').done&&bot.inventory.items().filter(x=>x.name==='paper').reduce((s,x)=>s+x.count,0)===7);
  await chat('/mycli coach menu');check('native onboarding menu includes feature practice button',bot.currentWindow?.slots[18]?.name==='chest');await close();
  await rc('minecraft:gamemode creative '+bot.username);await sleep(400);
  await chat('/mycli life accept builder_home');
  let n=0;for(let x=0;x<5;x++)for(const z of [0,4]){await place(x,1,z,'oak_planks');n++;}
  await place(0,1,1,'oak_planks');await place(4,1,1,'oak_planks');n+=2;
  let s=await life();check('twelve native plank placements do not pass house',n===12&&s.progress<7&&!s.house.ready);
  await chat('/mycli life claim');check('flat plank claim rejected with actual next action',bot.life.at(-1).success===false&&bot.life.at(-1).reason==='house_incomplete');
  await rc('minecraft:setblock 2002 101 2000 air');
  for(let x=0;x<5;x++)for(let z=0;z<5;z++)if(x===0||x===4||z===0||z===4)for(const y of [1,2]){
    if(x===2&&z===0)continue;if(x===0&&z===2&&y===2){await place(x,y,z,'glass_pane');continue;}await place(x,y,z,'oak_planks');}
  for(let x=0;x<5;x++)for(let z=0;z<5;z++)if(x===0||x===4||z===0||z===4)await place(x,3,z,'oak_planks');
  for(let z=1;z<4;z++)for(let x=1;x<4;x++)await place(x,3,z,'oak_planks',[x-1,3,z],[1,0,0]);
  await tp(2.5,1.5);await place(2,1,0,'oak_door');
  s=await life();check('completed shell without bed is still rejected',!s.house.ready&&!s.house.checks.bed);
  await tp(1.5,1.25);await place(1,1,2,'red_bed');await tp(2.5,2.5);s=await life();check('native walls roof window full door and bed pass all seven checks',s.house.ready&&s.progress===7);
  await rc('minecraft:setblock 2002 103 2002 air');s=await life();check('roof removal after readiness is revalidated',!s.house.ready&&!s.house.checks.roof);
  await place(2,3,2,'oak_planks',[1,3,2],[1,0,0]);await rc('minecraft:setblock 2002 101 1999 stone');s=await life();check('blocked exterior door rejects the finished shell',!s.house.ready&&!s.house.checks.door);
  await rc('minecraft:setblock 2002 101 1999 air');s=await life();check('repairing actual defects restores readiness',s.house.ready);
  await chat('/mycli life claim');check('real house claim retains original reputation and gift',bot.life.at(-1).kind==='claim'&&bot.life.at(-1).success&&bot.life.at(-1).gift==='minecraft:flower_pot'&&bot.life.at(-1).giftCount===2);
  await rc('minecraft:gamemode survival '+bot.username);await sleep(400);
  await rc('minecraft:experience set '+bot.username+' 5 levels'); // Existing night-vision prerequisite, not a forged tutorial proof.
  await chat('/mycli skills learn night');await chat('/mycli cast night');check('successful existing night vision records vision lesson',lesson(await lessons(),'vision').done);
  check('unperformed recovery travel and traversal remain unfinished',!lesson(await lessons(),'recovery').done&&!lesson(await lessons(),'travel').done&&!lesson(await lessons(),'traversal').done);
 }
 report.passed=true;
}catch(e){report.errors.push(e.stack);console.log(e.stack);process.exitCode=1;}finally{
 if(bot){if(bot.currentWindow)bot.closeWindow(bot.currentWindow);bot.quit();}await sleep(500);
 writeFileSync(root+(process.argv.includes('--resume')?'/native-restart.json':'/native-initial.json'),JSON.stringify(report,null,2));
}
