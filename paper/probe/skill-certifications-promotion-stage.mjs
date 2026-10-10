// Actual native backpack roundtrip and door/ladder proof, followed by one-grade atomic promotion.
import {createRequire} from 'node:module';
import {assert,writeFileSync,root,stage,suffix,bots,sleep,rc,report,X,Y,Z,profile,check,until,json,join,chat,ask,state,tp,walk} from './skill-certifications-fixture.mjs';
const req=createRequire('E:/Cortico/package.json'),mfReq=createRequire(req.resolve('mineflayer')),data=mfReq('minecraft-data')('1.20.6'),{Vec3}=mfReq('vec3'),Item=mfReq('prismarine-item')('1.20.6');
const resume=process.argv.includes('--resume'),name='CertEntry'+suffix,T=X+30;
async function close(c){c.bot.closeWindow(c.bot.currentWindow);await sleep(500);}
async function bag(c){await chat(c,'/minepacks:backpack open');await until(()=>c.bot.currentWindow,'native Minepacks');return c.bot.currentWindow;}
try {
 const c=await join(name);
 if(resume){
  const s=await ask(c,'/mycli guild exam status');check('pending ready certificate survives normal cold restart',s.examId==='inventory_basic'&&s.state==='ready',s);
  const p=await ask(c,'/mycli guild exam promotion');check('new division and original fame survive cold restart',p.gradeIndex===1&&p.fame===4,p);
  const before=profile(c).points.spent;await ask(c,'/mycli guild exam submit');await ask(c,'/mycli guild exam submit');check('post-restart submission is idempotent and gives no skill points',profile(c).points.spent===before&&profile(c).academy.grade===1);
  const native=await state(c);check('normal cold startup leaves no temporary flight permission',!native.allowFlight&&!native.recoveryMarker,native);
 }else{
  // Build a disposable practice route before exam enrollment. Construction itself gives no proof.
  await tp(c,T+.5,Y,Z+1.5);await rc('minecraft:gamemode creative '+name);
  await rc(`minecraft:fill ${T-2} ${Y} ${Z-1} ${T+6} ${Y+8} ${Z+9} minecraft:air`);
  await rc(`minecraft:fill ${T+3} ${Y} ${Z+8} ${T+3} ${Y+6} ${Z+8} minecraft:stone`);
  await rc(`minecraft:fill ${T+3} ${Y} ${Z+7} ${T+3} ${Y+6} ${Z+7} minecraft:ladder[facing=north]`);
  await c.bot.creative.setInventorySlot(36,new Item(data.itemsByName.oak_door.id,1));c.bot.setQuickBarSlot(0);
  await c.bot.placeBlock(c.bot.blockAt(new Vec3(T,Y-1,Z+3)),new Vec3(0,1,0));await until(()=>c.bot.blockAt(new Vec3(T,Y,Z+3))?.name==='oak_door','actual two-half door');
  await rc(`minecraft:setblock ${T} ${Y} ${Z+3} minecraft:oak_door[half=lower,facing=south,open=false]`);
  await rc(`minecraft:setblock ${T} ${Y+1} ${Z+3} minecraft:oak_door[half=upper,facing=south,open=false]`);
  await until(()=>c.bot.blockAt(new Vec3(T,Y,Z+3))?.getProperties().facing==='south','aligned native fixture door');
  await rc('minecraft:clear '+name);await rc('minecraft:gamemode survival '+name);await chat(c,'/mycli guild join');await sleep(400);
  const initial=await ask(c,'/mycli guild exam promotion');check('new adventurer starts in bronze III',initial.gradeIndex===0&&initial.fame===0,initial);
  await chat(c,'/mycli guild exam start promotion inventory_basic');await sleep(400);check('fame below threshold cannot open promotion',!profile(c).academy.active);
  // Fame is a declared QA precondition, never described as earned reputation.
  await rc('academyqa fame '+name+' 4');const pointsBefore=JSON.stringify(profile(c).points);let s=await ask(c,'/mycli guild exam start promotion inventory_basic');check('eligible promotion opens active native practical',s.state==='active',s);
  await chat(c,'/mycli list');await chat(c,'/mycli explain skills');await chat(c,'/mycli status');await sleep(300);
  await rc('minecraft:give '+name+' paper 7');let w=await bag(c);check('exam opens ordinary 54-slot Minepacks, not reward bag',w.inventoryStart===54);
  let slot=w.slots.findIndex((i,n)=>n>=w.inventoryStart&&i?.name==='paper');assert.ok(slot>=0);await c.bot.clickWindow(slot,0,1);await close(c);
  s=await ask(c,'/mycli guild exam status');check('deposit alone cannot satisfy inventory exam',s.state==='active');
  w=await bag(c);slot=w.slots.findIndex((i,n)=>n<w.inventoryStart&&i?.name==='paper');assert.ok(slot>=0);await c.bot.clickWindow(slot,0,1);await close(c);
  check('backpack proof preserves seven original paper',profile(c).academy.active.proofs.backpack_retrieve&&c.bot.inventory.items().filter(i=>i.name==='paper').reduce((n,i)=>n+i.count,0)===7);
  const door=c.bot.blockAt(new Vec3(T,Y,Z+3));report.doorBefore=door.getProperties();await c.bot.activateBlock(door);await until(()=>c.bot.blockAt(door.position)?.getProperties().open,'native door opened');await walk(c,T+.5,Y,Z+5,5000);report.afterDoor=await state(c);
  check('actual door opening and crossing creates proof',!!profile(c).academy.active.proofs.door_passage);
  await walk(c,T+3.5,Y,Z+7.65,6000,.12);await sleep(800);report.beforeLadder=await state(c);await c.bot.look(Math.PI,0,true);c.bot.setControlState('forward',true);c.bot.setControlState('jump',true);
  await until(()=>c.bot.entity.position.y>=Y+3.2,'actual ladder ascent',10000);c.bot.clearControlStates();await sleep(400);s=await ask(c,'/mycli guild exam status');
  check('native ladder motion completes all practical requirements',s.state==='ready'&&profile(c).academy.active.proofs.ladder_ascent,s);
  await ask(c,'/mycli guild exam submit');s=await ask(c,'/mycli guild exam promotion');check('one atomic settlement advances exactly one division',s.gradeIndex===1&&s.fame===4,s);
  check('promotion does not grant or spend points',JSON.stringify(profile(c).points)===pointsBefore);
  const history=profile(c).academy.history.length;await ask(c,'/mycli guild exam submit');check('duplicate promotion submit does not advance again',profile(c).academy.grade===1&&profile(c).academy.history.length===history);
  await rc('academyqa fame '+name+' 550');s=await ask(c,'/mycli guild exam promotion');check('excess fame cannot skip fresh examinations or old major rights',s.gradeIndex===1&&profile(c).academy.grade===1,s);await rc('academyqa fame '+name+' 4');
  // Explicit reuse is limited to genuine retained native tutorial proofs.
  s=await ask(c,'/mycli guild exam start inventory_basic');check('real previous tutorial proofs can be retained for a new inventory certificate',s.state==='ready',s);
 }
 report.passed=true;
}catch(e){report.error=e.stack;report.nativeAtFailure=await Promise.all(bots.map(state));console.error(e.stack);process.exitCode=1;}
finally{for(const c of bots){c.bot.clearControlStates();if(c.bot.currentWindow)c.bot.closeWindow(c.bot.currentWindow);c.bot.quit();}await sleep(500);writeFileSync(root+'/promotion-'+suffix+(resume?'-restart':'')+'.json',JSON.stringify(report,null,2));}
