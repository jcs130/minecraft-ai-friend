// Isolated Paper 25567 / RCON 25587 only. Never use these fixtures on production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const stage='E:/MC/staging/life-buildings-20261003',root='E:/MC/ops/repairs/land-ownership-20261008';
const roots=[root,'F:/MC-backups/repairs/land-ownership-20261008'];
const rcon=text=>command(text,15000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,checks:[],startedAt:new Date().toISOString(),candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.90.jar')).digest('hex').toUpperCase()};
const clients=[];
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name);console.log('PASS '+name);};
const until=async(test,label,timeout=10000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(test())return;await sleep(80);}throw new Error(label+' timed out');};
const json=text=>JSON.parse(text.slice(text.indexOf('{')));
const ids=JSON.parse(readFileSync(root+'/test-identities.json','utf8'));
const A=new Vec3(1204,150,1203),AC=new Vec3(1204,150,1204),B=new Vec3(1224,150,1203);
async function join(name){const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});const c={bot,name,messages:[],land:[],protection:[],windows:0,cameras:[]};clients.push(c);bot.on('messagestr',s=>c.messages.push(s));bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:land')c.land.push(JSON.parse(p.data.toString()));if(p.channel==='mcagent:protection')c.protection.push(JSON.parse(p.data.toString()));});bot._client.on('open_window',()=>c.windows++);bot._client.on('camera',p=>c.cameras.push(p));await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reason=>reject(new Error(name+': '+JSON.stringify(reason))));});return c;}
async function tp(c,x,y,z){await rcon(`minecraft:tp ${c.name} ${x} ${y} ${z}`);await until(()=>c.bot.entity.position.distanceTo(new Vec3(x,y,z))<2,'teleport');await sleep(500);}
async function ask(c,cmd,type){const start=c.land.length;c.bot.chat(cmd);await until(()=>c.land.slice(start).some(p=>p.type===type),cmd);return c.land.slice(start).find(p=>p.type===type);}
async function permissions(c,id){return ask(c,`/mycli land info ${id}`,'MC_LAND_PERMISSIONS');}
async function equip(c,name){const item=c.bot.inventory.items().find(i=>i.name===name);assert.ok(item,name+' exists');await c.bot.equip(item,'hand');await sleep(100);}
async function seed(pos,block){const result=await rcon(`minecraft:setblock ${pos.x} ${pos.y} ${pos.z} minecraft:${block}`);assert.ok(/Changed the block|Could not set the block/.test(result),'fixture block: '+result);await sleep(200);}
async function serverBlock(pos,block){return (await rcon(`minecraft:execute if block ${pos.x} ${pos.y} ${pos.z} minecraft:${block}`)).includes('Test passed');}
async function dig(c,pos){await equip(c,'iron_pickaxe');const block=c.bot.blockAt(pos);assert.ok(block&&!['air','cave_air'].includes(block.name));try{await Promise.race([c.bot.dig(block),sleep(6000)]);}catch{}await sleep(250);}
async function denied(c,pos,action,fn){const start=c.land.length,chat=c.messages.length;await fn();await until(()=>c.land.slice(start).some(p=>p.type==='MC_LAND_ACCESS'&&p.action===action),action+' rejection');const receipt=c.land.slice(start).find(p=>p.type==='MC_LAND_ACCESS'&&p.action===action);assert.equal(receipt.allowed,false);assert.equal(receipt.reason,'land_permission_denied');await until(()=>c.messages.slice(chat).some(s=>s.startsWith('MC_LAND_ACCESS ')),'chat denial');const line=c.messages.slice(chat).find(s=>s.startsWith('MC_LAND_ACCESS '));assert.ok(line.length<=400,'denial fits Agent chat history');assert.equal(JSON.parse(line.slice('MC_LAND_ACCESS '.length)).ownerUuid,receipt.ownerUuid);return receipt;}
async function scopedEdit(id,fn){let text=readFileSync(stage+'/plugins/AgentFriend/lands.yml','utf8');const re=new RegExp(String.raw`(  ${id}:\r?\n[\s\S]*?)(?=\r?\n  [a-z0-9_-]+:|$)`);assert.ok(re.test(text),'definition exists');text=text.replace(re,match=>fn(match));writeFileSync(stage+'/plugins/AgentFriend/lands.yml',text);const result=json(await rcon('mycli admin land reload'));return result;}
async function restoreSeed(c,pos){await seed(pos,'air');await seed(pos,'stone');await until(()=>c.bot.blockAt(pos)?.name==='stone','stone packet');}
let originalWall;
try{
  let version='';const readyDeadline=Date.now()+60000;
  while(Date.now()<readyDeadline){try{version=await rcon('version AgentFriend');if(/0\.3\.90/.test(version))break;}catch{}await sleep(1000);}
  assert.match(version,/0\.3\.90/);
  writeFileSync(stage+'/plugins/AgentFriend/lands.yml',readFileSync(root+'/stage-lands-initial.yml'));
  assert.equal(json(await rcon('mycli admin land reload')).status,'success');
  await rcon('minecraft:deop LandOther90');
  const audit=json(await rcon('mycli admin land audit'));check('three configured claims ready',audit.ready&&audit.count===3,audit);
  const owner=await join('LandOwner90'),other=await join('LandOther90'),member=await join('LandMember90'),eye=await join('LandEye90');
  await rcon('minecraft:gamemode spectator LandEye90');
  await rcon('minecraft:spectate LandOwner90 LandEye90');
  await rcon('minecraft:time set day');
  await rcon('minecraft:fill 1196 149 1196 1230 149 1212 minecraft:sea_lantern');
  for(const c of [owner,other,member]){await rcon(`minecraft:gamemode survival ${c.name}`);await rcon(`minecraft:clear ${c.name}`);await rcon(`minecraft:give ${c.name} minecraft:iron_pickaxe`);await rcon(`minecraft:give ${c.name} minecraft:cobblestone 8`);}
  await tp(owner,1202.5,150,1203.5);await tp(other,1222.5,150,1203.5);await tp(member,1210.5,150,1210.5);
  await sleep(1200);
  const op=await permissions(owner,'cottage_a'),gp=await permissions(other,'cottage_a'),bp=await permissions(other,'cottage_b');
  check('different owners get different rights',op.break&&op.container&&!gp.break&&!gp.container&&bp.break);
  check('query lines fit short Agent chat history',owner.messages.filter(s=>s.startsWith('MC_LAND_INFO ')||s.startsWith('MC_LAND_PERMISSIONS ')).every(s=>s.length<=400));
  await restoreSeed(owner,A);await dig(owner,A);check('owner actually breaks own block',await serverBlock(A,'air'));
  await equip(owner,'cobblestone');await owner.bot.placeBlock(owner.bot.blockAt(A.offset(0,-1,0)),new Vec3(0,1,0));await sleep(300);check('owner actually places in own land',await serverBlock(A,'cobblestone'));
  await restoreSeed(other,B);await dig(other,B);check('second owner builds independently',await serverBlock(B,'air'));await restoreSeed(owner,A);
  await tp(other,1202.5,150,1203.5);let receipt=await denied(other,A,'break',()=>dig(other,A));check('other owner cannot break first claim',await serverBlock(A,'stone')&&receipt.ownerUuid===ids.LandOwner90);
  await restoreSeed(other,A);await rcon('minecraft:op LandOther90');await sleep(250);await denied(other,A,'break',()=>dig(other,A));check('OP cannot bypass private land',await serverBlock(A,'stone'));await rcon('minecraft:deop LandOther90');
  await seed(AC,'chest');await until(()=>owner.bot.blockAt(AC)?.name==='chest','chest packet');await owner.bot.openContainer(owner.bot.blockAt(AC));owner.bot.closeWindow(owner.bot.currentWindow);check('owner opens own physical chest',true);
  const startWindows=other.windows;await denied(other,AC,'container',()=>other.bot.activateBlock(other.bot.blockAt(AC)));check('nonowner chest denied before GUI opens',other.windows===startWindows);
  const button=new Vec3(1204,150,1202);await seed(button,'stone_button[face=floor]');await denied(other,button,'use',()=>other.bot.activateBlock(other.bot.blockAt(button)));check('private buttons and workstations denied',!other.bot.blockAt(button).getProperties().powered);
  await tp(owner,-496.5,67,-502.5);await tp(other,-492.5,67,-503.5);await sleep(450);
  let wall;for(let y=67;y<=70&&!wall;y++){const p=new Vec3(-497,y,-502);const b=owner.bot.blockAt(p);if(b&&b.boundingBox==='block'&&b.name!=='bedrock')wall=p;}
  assert.ok(wall,'original guild wall found');originalWall={pos:wall,name:owner.bot.blockAt(wall).name};await dig(owner,wall);check('guild owner can modify former fixed fabric',await serverBlock(wall,'air'));await seed(wall,originalWall.name);originalWall=null;
  const privateBarrel=new Vec3(-494,67,-505);const windowsBefore=other.windows;other.bot.activateBlock(other.bot.blockAt(privateBarrel));await until(()=>other.messages.some(s=>s.startsWith('MC_GUILD_ACCESS ')),'legacy guild rejection');check('guild stock remains private',other.windows===windowsBefore);
  const craft=new Vec3(-491,67,-502);await seed(craft,'crafting_table');const craftWindows=other.windows;await other.bot.activateBlock(other.bot.blockAt(craft));await until(()=>other.windows>craftWindows,'public crafting');other.bot.closeWindow(other.bot.currentWindow);check('guild visitor may use public workstation',true);
  const beforeMenu=other.windows;other.bot.chat('/mycli guild menu');await until(()=>other.windows>beforeMenu,'quest menu');other.bot.closeWindow(other.bot.currentWindow);check('guild visitor can still browse quests',true);
  await tp(other,-474.5,67,-493.5);for(const z of [-495,-493,-491,-489]){if(z===-489)await tp(other,-474.5,67,-490.5);const w=await other.bot.openContainer(other.bot.blockAt(new Vec3(-473,67,z)));assert.equal(w.inventoryStart,54);other.bot.closeWindow(w);}check('all four public double chests remain accessible',true);
  const weed=new Vec3(-492,67,-504);await seed(weed.offset(0,-1,0),'grass_block');await seed(weed,'short_grass');await tp(other,-491.5,67,-504.5);const weedMessages=other.messages.length;try{await other.bot.dig(other.bot.blockAt(weed));}catch{}await sleep(450);check('shortcut weeding cannot bypass guild ownership',await serverBlock(weed,'short_grass')&&other.messages.slice(weedMessages).some(s=>s.startsWith('MC_GUILD_ACCESS ')));
  await tp(owner,-491.5,67,-504.5);try{await owner.bot.dig(owner.bot.blockAt(weed));}catch{}await sleep(300);check('owner may weed own land',await serverBlock(weed,'air'));
  const publicWeed=new Vec3(-479,67,-510);await seed(publicWeed.offset(0,-1,0),'grass_block');await seed(publicWeed,'short_grass');await tp(other,-478.5,67,-510.5);try{await other.bot.dig(other.bot.blockAt(publicWeed));}catch{}await sleep(350);check('public village weeding still works',await serverBlock(publicWeed,'air'));
  await tp(owner,1202.5,150,1203.5);await tp(other,1202.5,150,1205.5);
  const insideHopper=new Vec3(1207,150,1206),outsideChest=new Vec3(1208,150,1206);
  await seed(insideHopper,'hopper[facing=east]');await seed(outsideChest,'barrel');await rcon('minecraft:item replace block 1207 150 1206 container.0 with minecraft:diamond');await sleep(1000);const hopper=await rcon('minecraft:data get block 1207 150 1206 Items');const outside=await rcon('minecraft:data get block 1208 150 1206 Items');check('hopper cannot export across land boundary',hopper.includes('diamond')&&!outside.includes('diamond'));
  await seed(outsideChest,'air');await seed(insideHopper,'barrel');await seed(outsideChest,'hopper[facing=west]');const insert=await rcon('minecraft:item replace block 1208 150 1206 container.0 with minecraft:emerald');await sleep(1000);const insertSource=await rcon('minecraft:data get block 1208 150 1206 Items'),insertDest=await rcon('minecraft:data get block 1207 150 1206 Items');check('hopper cannot insert across land boundary',insertSource.includes('emerald')&&!insertDest.includes('emerald'),{insert,insertSource,insertDest});
  await seed(new Vec3(1205,150,1206),'hopper[facing=east]');await seed(new Vec3(1206,150,1206),'barrel');await rcon('minecraft:item replace block 1205 150 1206 container.0 with minecraft:iron_ingot');await sleep(1000);check('hoppers may move stock inside the same land',!(await rcon('minecraft:data get block 1205 150 1206 Items')).includes('iron_ingot')&&(await rcon('minecraft:data get block 1206 150 1206 Items')).includes('iron_ingot'));
  await tp(other,1207.5,150,1204.5);await seed(new Vec3(1207,150,1205),'chest[facing=north,type=left]');await seed(new Vec3(1208,150,1205),'chest[facing=north,type=right]');const mixedWindows=other.windows;await denied(other,new Vec3(1208,150,1205),'container',()=>other.bot.activateBlock(other.bot.blockAt(new Vec3(1208,150,1205))));check('outside half of mixed double chest is protected',other.windows===mixedWindows);
  await tp(owner,1202.5,150,1203.5);await owner.bot.openContainer(owner.bot.blockAt(AC));const transfer=await scopedEdit('cottage_a',s=>s.replace(ids.LandOwner90,ids.LandOther90));check('owner transfer reloads without restart',transfer.status==='success');await until(()=>!owner.bot.currentWindow,'old owner window closed');check('owner transfer revokes already open chest',!(await permissions(owner,'cottage_a')).container&&(await permissions(other,'cottage_a')).container);
  await tp(other,1202.5,150,1203.5);const newWindow=await other.bot.openContainer(other.bot.blockAt(AC));other.bot.closeWindow(newWindow);check('new owner can actually open inherited chest',true);
  const outsiderMessages=member.messages.length;const eyeMessages=eye.messages.length;await denied(owner,A,'break',()=>dig(owner,A));await until(()=>eye.messages.slice(eyeMessages).some(s=>s.includes('MC_LAND_ACCESS')),'Eye rejection mirror');check('denial reaches paired Eye and stays private',!member.messages.slice(outsiderMessages).some(s=>s.includes('MC_LAND_ACCESS'))&&eye.messages.slice(eyeMessages).some(s=>s.includes('无权操作')));
  check('paired Eye receives actual camera attachment',eye.cameras.some(p=>Object.values(p).includes(owner.bot.entity.id)),eye.cameras.slice(-3));
  const trusted=await scopedEdit('cottage_a',s=>s.replace('members: []',`members: ['${ids.LandMember90}']`));check('trusted player granted online',trusted.status==='success'&&(await permissions(member,'cottage_a')).container);await tp(member,1202.5,150,1203.5);await member.bot.openContainer(member.bot.blockAt(AC));await scopedEdit('cottage_a',s=>s.replace(`members: ['${ids.LandMember90}']`,'members: []'));await until(()=>!member.bot.currentWindow,'trust revocation closes chest');check('trust revocation removes active access',!(await permissions(member,'cottage_a')).container);
  const valid=readFileSync(stage+'/plugins/AgentFriend/lands.yml','utf8');writeFileSync(stage+'/plugins/AgentFriend/lands.yml',valid.replace('owner-uuid:', 'owner-uuid: not-a-uuid #'));
  const invalid=json(await rcon('mycli admin land reload'));check('invalid configuration retains prior protections',invalid.status==='denied'&&invalid.retainedPrevious&&(await permissions(other,'cottage_a')).container&&!(await permissions(owner,'cottage_a')).container);writeFileSync(stage+'/plugins/AgentFriend/lands.yml',valid);assert.equal(json(await rcon('mycli admin land reload')).status,'success');
  const overlap=await scopedEdit('cottage_a',s=>s.replace('min: [1200, 149, 1200]','min: [1220, 149, 1200]').replace('max: [1207, 160, 1207]','max: [1227, 160, 1207]'));check('overlapping claims are rejected atomically',overlap.status==='denied'&&overlap.retainedPrevious);writeFileSync(stage+'/plugins/AgentFriend/lands.yml',valid);assert.equal(json(await rcon('mycli admin land reload')).status,'success');
  const discover=owner.messages.length;owner.bot.chat('/mycli explain land.here');await until(()=>owner.messages.slice(discover).some(s=>s.startsWith('MC_CLI_DETAIL ')),'discoverability');check('Agent catalog exposes land commands',true);
  await ask(owner,'/mycli land here','MC_LAND_INFO');const menuBefore=owner.windows;owner.bot.chat('/mycli menu');await until(()=>owner.windows>menuBefore,'compass menu');await owner.bot.clickWindow(0,0,0);await until(()=>JSON.stringify(owner.bot.currentWindow?.title??'').includes('领地归属'),'land menu');check('vanilla compass opens land menu',owner.bot.currentWindow.inventoryStart===27);owner.bot.closeWindow(owner.bot.currentWindow);
  const adminStart=owner.messages.length;owner.bot.chat('/mycli admin land reload');await until(()=>owner.messages.slice(adminStart).some(s=>s.includes('只允许服务器控制台')),'admin gate');check('player cannot manage land configuration',true);
  const finalAudit=json(await rcon('mycli admin land audit'));check('final claims retain independent ownership',finalAudit.ready&&finalAudit.lands.find(l=>l.id==='adventurers_guild').ownerUuid===ids.LandOwner90&&finalAudit.lands.find(l=>l.id==='cottage_a').ownerUuid===ids.LandOther90);
  for(const dir of roots)writeFileSync(dir+'/stage-lands-final.yml',readFileSync(stage+'/plugins/AgentFriend/lands.yml'));
  report.passed=true;
}catch(error){report.error=error.stack;report.clients=clients.map(c=>({name:c.name,messages:c.messages.slice(-15),land:c.land.slice(-8)}));process.exitCode=1;}
finally{
  if(originalWall)try{await seed(originalWall.pos,originalWall.name);}catch{}
  try{await rcon('minecraft:deop LandOther90');}catch{}
  for(const c of clients)c.bot.quit();report.finishedAt=new Date().toISOString();
  for(const dir of roots){writeFileSync(dir+'/stage-result.'+Date.now()+'.json',JSON.stringify(report,null,2));writeFileSync(dir+'/stage-result.json',JSON.stringify(report,null,2));}
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));
  setTimeout(()=>process.exit(report.passed?0:1),300);
}
