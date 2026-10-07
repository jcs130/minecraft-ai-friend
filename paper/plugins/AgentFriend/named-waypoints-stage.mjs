// Survival protocol integration tests. Mutations are restricted to isolated Paper 25567 / RCON 25587.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer');
const stage='E:/MC/staging/life-buildings-20261003';
const roots=['E:/MC/ops/repairs/named-waypoints-20261007','F:/MC-backups/repairs/named-waypoints-20261007'];
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const candidateSha256=createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.89.jar')).digest('hex').toUpperCase();
const resume=process.argv[2]==='resume';
const report={passed:false,started:new Date().toISOString(),candidateSha256,checks:[],messages:{},effects:{}};
const clients=[];
const check=(label,ok=true)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
const until=async(f,label,timeout=14000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(f())return;await sleep(60);}throw new Error('Timeout '+label);};
async function chat(c,q){await sleep(Math.max(0,1100-(Date.now()-(c.lastChat??0))));c.lastChat=Date.now();c.bot.chat(q);}
async function join(username){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username,auth:'offline',version:'1.20.6'});
 const c={bot,username,lines:[],effects:[],states:[]};clients.push(c);report.messages[username]=c.lines;report.effects[username]=c.effects;
 bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{report.errors??=[];report.errors.push(String(e));});
 bot.on('kicked',s=>{report.errors??=[];report.errors.push('kicked '+username+': '+JSON.stringify(s));});
 bot._client.on('packet',(p,m)=>{
  if(/title|sound|particle/.test(m.name))c.effects.push({name:m.name,text:JSON.stringify(p)});
  if(m.name==='custom_payload'&&p.channel==='mcagent:state')c.states.push(JSON.parse(p.data.toString()));
 });
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state')});
 await sleep(700);return c;
}
async function ask(c,q,prefix='MC_WAYPOINT_RESULT '){
 const start=c.lines.length;await chat(c,q);
 await until(()=>c.lines.slice(start).some(s=>s.startsWith(prefix)&&(!prefix.includes('RESULT')||JSON.parse(s.slice(prefix.length)).status!=='pending')),q);
 await sleep(90);return c.lines.slice(start);
}
const result=lines=>JSON.parse(lines.findLast(s=>s.startsWith('MC_WAYPOINT_RESULT ')&&JSON.parse(s.slice(19)).status!=='pending').slice(19));
const list=async(c,scope='list')=>JSON.parse((await ask(c,'/mycli waypoint '+scope,'MC_WAYPOINT_LIST ')).find(s=>s.startsWith('MC_WAYPOINT_LIST ')).slice(17));
const pointCommand=async(c,q,reason='ok')=>{const r=result(await ask(c,'/mycli waypoint '+q));assert.equal(r.reason,reason,q);return r;};
const state=async c=>JSON.parse(await rcon('waypointqa position '+c.username));
const refill=c=>rcon('waypointqa mana '+c.username);
async function attach(owner,eye){
 await rcon('minecraft:gamemode spectator '+eye.username);await rcon('minecraft:tp '+eye.username+' '+owner.username);
 await rcon('minecraft:spectate '+owner.username+' '+eye.username);await sleep(600);
}
async function tp(c,dim,x=1212.5,y=150,z=1220.5){
 await refill(c);await rcon(`execute in minecraft:${dim} run minecraft:tp ${c.username} ${x} ${y} ${z}`);await sleep(450);
 const s=await state(c);assert.equal(s.world,dim==='overworld'?'world':dim==='the_nether'?'world_nether':'world_the_end');
 assert.ok(Math.abs(s.x-x)<.1&&Math.abs(s.z-z)<.1);return s;
}
async function platform(dim,y){
 await rcon(`execute in minecraft:${dim} run minecraft:forceload add 1184 1184 1231 1231`);
 await rcon(`execute in minecraft:${dim} run minecraft:fill 1200 ${y-1} 1200 1228 ${y-1} 1228 minecraft:stone`);
 await rcon(`execute in minecraft:${dim} run minecraft:fill 1200 ${y} 1200 1228 ${y+3} 1228 minecraft:air`);
 await rcon(`execute in minecraft:${dim} run minecraft:fill 1200 ${y+4} 1200 1228 ${y+4} 1228 minecraft:glass`);
}
async function travel(c,target,expected,reason='ok'){
 await refill(c);const before=await state(c),n=c.effects.length,t=c.lines.filter(s=>s.startsWith('MC_TRAVEL ')).length;
 const r=result(await ask(c,'/mycli goto '+target));assert.equal(r.reason,reason,target);await sleep(250);
 const after=await state(c),effects=c.effects.slice(n);
 if(reason==='ok'){
  assert.equal(r.spentMana,6);assert.ok(Math.abs(before.mana-after.mana-6)<.51,JSON.stringify({before,after}));
  assert.equal(after.world,expected.world);assert.ok(Math.abs(after.x-expected.x)<.1&&Math.abs(after.y-expected.y)<.1&&Math.abs(after.z-expected.z)<.1);
  assert.equal(c.lines.filter(s=>s.startsWith('MC_TRAVEL ')).length,t+1);
  for(const kind of ['title','sound','particle'])assert.ok(effects.some(p=>p.name.includes(kind)),target+' '+kind);
 }else{
  assert.equal(r.spentMana,0);assert.ok(after.mana>=before.mana-.01);assert.ok(Math.abs(after.x-before.x)<.1&&Math.abs(after.z-before.z)<.1);assert.equal(after.world,before.world);
  assert.equal(c.lines.filter(s=>s.startsWith('MC_TRAVEL ')).length,t);assert.ok(!effects.some(p=>p.name.includes('title')));
 }
 return r;
}
async function menu(c,command,slot){
 if(c.bot.currentWindow)c.bot.closeWindow(c.bot.currentWindow);
 await chat(c,command);await until(()=>c.bot.currentWindow,command);const w=c.bot.currentWindow;
 if(slot!==undefined){await c.bot.clickWindow(slot,0,0);await sleep(250);}return w;
}
try{
 assert.match(await rcon('version AgentFriend'),/0\.3\.89/);
 const a=await join('WpOwner89'),b=await join('WpGuest89'),eye=await join('WpEye89');
 await rcon('minecraft:gamemode survival '+a.username);await rcon('minecraft:gamemode survival '+b.username);
 await rcon('minecraft:effect give '+a.username+' minecraft:resistance 9999 4 true');
 await rcon('minecraft:effect give '+b.username+' minecraft:resistance 9999 4 true');
 if(resume){
  const old=JSON.parse(readFileSync(roots[0]+'/stage-result.json','utf8'));
  const items=await list(a);check('restart retains Chinese names and UUID ownership',items.points.some(p=>p.name==='下界营地'&&p.owner===old.owner));
  const shared=await list(b,'shared');check('restart retains exact share code',shared.points.some(p=>p.shareCode===old.persistedShare));
  await tp(b,'overworld');await travel(b,'shared:'+old.persistedShare,old.nether);check('shared cross-dimension teleport works after normal restart');
  const legacy=await ask(a,'/mycli waypoint','MC_WAYPOINT_LIST ');check('legacy home still listed after restart',legacy.some(s=>s.includes('id=personal:legacy89 ')));
  report.passed=true;
 }else{
  for(const c of [a,b]){const current=await list(c);for(const p of current.points)await pointCommand(c,'remove '+p.name);}
  await attach(a,eye);
  const eyeStart=eye.lines.length;await list(a);await until(()=>eye.lines.slice(eyeStart).some(s=>s.startsWith('MC_WAYPOINT_LIST ')),'native Eye attached');check('registered native Eye actually attached before private tests');
  await platform('overworld',150);await platform('the_nether',90);await platform('the_end',80);
  report.owner=a.bot.player.uuid;
  report.overworld=await tp(a,'overworld');
  let r=await pointCommand(a,'add 村外营地');check('Chinese name records actual current location for free',r.spentMana===0&&r.point.world&&r.point.shared===false);
  await tp(a,'overworld',1218.5);await pointCommand(a,'add 村外营地','name_exists');check('duplicate add refuses to overwrite', (await list(a)).points[0].x===report.overworld.x);
  await pointCommand(a,'add bad.name','invalid_name');await pointCommand(a,'add '+ '长'.repeat(25),'invalid_name');check('invalid names rejected');
  await tp(b,'overworld',1216.5);check('private points absent from other owner list',(await list(b)).points.length===0);
  check('private point absent from shared list',!(await list(b,'shared')).points.some(p=>p.owner===report.owner));
  await travel(b,'personal:村外营地',null,'not_found');await pointCommand(b,'remove 村外营地','not_found');await pointCommand(b,'share 村外营地','not_found');check('other player cannot use or change a private point');
  await pointCommand(b,'add 村外营地');check('names scoped per owner',(await list(b)).points[0].owner!==report.owner);
  report.nether=await tp(a,'the_nether',1212.5,90);await pointCommand(a,'add 下界营地');
  report.end=await tp(a,'the_end',1212.5,80);await pointCommand(a,'add 末地驿站');check('Nether and End can be recorded');
  await travel(a,'personal:村外营地',report.overworld);await travel(a,'personal:下界营地',report.nether);await travel(a,'personal:末地驿站',report.end);check('all three dimensions teleport with exact 6 mana and cast effects');
  r=await pointCommand(a,'share 下界营地');let code=r.point.shareCode;
  check('share returns stable usable target',r.point.target==='shared:'+code&&(await pointCommand(a,'share 下界营地')).point.shareCode===code);
  check('shared list contains discoverer and location',(await list(b,'shared')).points.some(p=>p.shareCode===code&&p.ownerName===a.username&&p.dimension==='minecraft:the_nether'));
  await travel(b,'shared:'+code,report.nether);check('another owner can use explicitly shared point across dimensions');
  await pointCommand(b,'rename 下界营地 偷走了','not_found');await pointCommand(b,'update 下界营地','not_found');check('share grants no edit rights');
  await pointCommand(a,'rename 下界营地 下界补给站');check('rename retains sharing code',(await list(b,'shared')).points.some(p=>p.shareCode===code&&p.name==='下界补给站'));
  await pointCommand(a,'unshare 下界补给站');await travel(b,'shared:'+code,null,'share_unavailable');check('revocation immediately disables old code');
  r=await pointCommand(a,'share 下界补给站');check('reshare rotates code',r.point.shareCode!==code);code=r.point.shareCode;
  await pointCommand(a,'rename 下界补给站 下界营地');report.persistedShare=code;
  await tp(a,'overworld',1218.5);await pointCommand(a,'update 村外营地');report.overworld=await state(a);
  await tp(a,'the_end',1212.5,80);await travel(a,'personal:村外营地',report.overworld);check('explicit update changes destination');
  await rcon('minecraft:setblock 1218 151 1220 minecraft:stone');await tp(a,'overworld',1212.5);
  await travel(a,'personal:村外营地',null,'unsafe_landing');check('blocked headroom rejects without mana, relocation or success effects');
  await rcon('minecraft:setblock 1218 151 1220 minecraft:air');await rcon('minecraft:setblock 1218 149 1220 minecraft:magma_block');
  await travel(a,'personal:村外营地',null,'unsafe_landing');await rcon('minecraft:setblock 1218 149 1220 minecraft:stone');check('hazardous floor rejects without fee');
  await rcon('waypointqa mana '+a.username+' 0');r=result(await ask(a,'/mycli goto personal:下界营地'));check('low mana rejects before movement',r.reason==='not_enough_mana'&&r.spentMana===0);
  await rcon('minecraft:gamemode spectator '+a.username);await pointCommand(a,'add 旁观者地点','spectator_or_dead');await travel(a,'personal:下界营地',null,'spectator_or_dead');await rcon('minecraft:gamemode survival '+a.username);await attach(a,eye);check('spectator cannot record or cast');
  await rcon('execute in minecraft:the_nether run minecraft:fill 1210 129 1218 1214 129 1222 minecraft:stone');
  await tp(a,'the_nether',1212.5,130);await pointCommand(a,'add 下界顶层','unsafe_height');check('Nether roof cannot become a waypoint');
  await tp(a,'overworld');
  await rcon('waypointqa protect on');await travel(a,'personal:村外营地',null,'protected_entry');await rcon('waypointqa protect off');check('WorldGuard entry denial is honored without fee');
  const guiStart=b.lines.length;
  await menu(a,'/mycli menu',16);await until(()=>a.bot.currentWindow?.slots[14]?.name==='name_tag','places page');
  await a.bot.clickWindow(14,0,0);await sleep(250);check('compass creates a naming prompt',a.bot.currentWindow===null&&a.lines.some(s=>s.includes('此条输入不会发到公屏')));
  await chat(a,'秘密中文营地');await until(()=>a.lines.some(s=>s.startsWith('MC_WAYPOINT_RESULT ')&&s.includes('秘密中文营地')),'GUI private name');
  await sleep(250);check('GUI chat input never reaches public chat',!b.lines.slice(guiStart).some(s=>s.includes('秘密中文营地')));
  await menu(a,'/mycli waypoint menu');check('owner native inventory contains named points',a.bot.currentWindow.slots.slice(0,36).filter(Boolean).length===4);
  const own=(await list(a)).points;const slot=own.map(p=>p.name).sort().indexOf('秘密中文营地');
  await a.bot.clickWindow(slot,0,0);await until(()=>a.bot.currentWindow?.slots[10]?.name==='name_tag','detail');
  await a.bot.clickWindow(10,0,0);await sleep(150);await chat(a,'菜单改名');await until(()=>a.lines.some(s=>s.startsWith('MC_WAYPOINT_RESULT ')&&s.includes('菜单改名')),'GUI rename');check('GUI rename works privately');
  await pointCommand(a,'remove 菜单改名');
  await menu(a,'/mycli waypoint menu',45);await sleep(100);await chat(a,'取消');await until(()=>a.lines.some(s=>s.startsWith('MC_WAYPOINT_RESULT ')&&s.includes('"action":"cancel"')),'cancel');check('naming prompt can be canceled');
  const guide=await ask(a,'/mycli spells explain travel','MC_SPELL_DETAIL ');const g=JSON.parse(guide.find(s=>s.startsWith('MC_SPELL_DETAIL ')).slice(16));check('skill guide publishes actual cost and entry',g.id==='travel'&&g.mana===6&&g.command==='/mycli waypoint menu');
  const catalog=await ask(a,'/mycli explain waypoint.share','MC_CLI_DETAIL ');check('Agent stable catalog includes sharing',catalog.some(s=>s.includes('waypoint.share')&&s.includes('shareCode')));
  await until(()=>a.states.some(s=>s.abilities?.some(v=>v.id==='mycli:travel')),'Agent ability state');check('Agent ability state includes travel skill');
  const chunkBefore=JSON.parse(await rcon('waypointqa chunks')),sBefore=await state(a);
  for(let i=0;i<4;i++){await list(a);await list(b,'shared');await ask(a,'/mycli waypoint','MC_WAYPOINT_LIST ');}
  const chunkAfter=JSON.parse(await rcon('waypointqa chunks')),sAfter=await state(a);
  check('list and discovery never generate chunks',chunkAfter.generated===chunkBefore.generated);
  check('read-only queries do not teleport or spend mana',sBefore.world===sAfter.world&&Math.abs(sBefore.x-sAfter.x)<.1&&sAfter.mana>=sBefore.mana);
  await refill(a);await chat(a,'/sethome legacy89');await sleep(500);
  const legacy=await ask(a,'/mycli waypoint','MC_WAYPOINT_LIST ');check('old Essentials homes remain discoverable',legacy.some(s=>s.includes('id=personal:legacy89 ')));
  const legacyAt=await state(a);await tp(a,'the_end',1212.5,80);await refill(a);
  const oldMana=(await state(a)).mana;await ask(a,'/mycli goto personal:legacy89','MC_TRAVEL ');check('legacy home still teleports at 6 mana',Math.abs(oldMana-(await state(a)).mana-6)<.51&&(await state(a)).world===legacyAt.world);
  await pointCommand(a,'add 可删除');const deleted=(await pointCommand(a,'share 可删除')).point.shareCode;await pointCommand(a,'remove 可删除');await travel(b,'shared:'+deleted,null,'share_unavailable');check('deletion revokes shared access');
  await sleep(1000);check('attached Eye receives owner waypoint receipts',eye.lines.some(s=>s.startsWith('MC_WAYPOINT_RESULT ')&&s.includes('下界营地')));
  check('unrelated player never receives private owner metadata',!b.lines.some(s=>s.startsWith('MC_WAYPOINT_RESULT ')&&s.includes('秘密中文营地')));
  report.passed=true;
 }
}catch(error){report.error=String(error.stack??error);console.error(report.error);process.exitCode=1;}
finally{
 for(const c of clients){if(c.bot.currentWindow)c.bot.closeWindow(c.bot.currentWindow);c.bot.quit();}
 report.finished=new Date().toISOString();
 const file=resume?'restart-result':'stage-result';
 for(const root of roots){writeFileSync(root+'/'+file+'.json',JSON.stringify(report,null,2)+'\n');writeFileSync(root+'/'+file+'.'+Date.now()+'.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,candidateSha256,error:report.error}));
}
