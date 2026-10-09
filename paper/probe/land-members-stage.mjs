// Fixed disposable Paper copy only: never connects to production or an Agent client.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,rmdirSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';
import {command} from '../ops/rcon-client.mjs';import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const stage='E:/MC/staging/structure-practice-20261009',root='E:/MC/ops/repairs/land-members-20261009',req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);
const {Vec3}=req('vec3'),bots=[],ids=JSON.parse(readFileSync(root+'/identities.json','utf8'));
const rc=q=>command(q,15000,{port:25591,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,checks:[],messages:{},camera:[],jarSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.7.jar')).digest('hex').toUpperCase()};
const file=stage+'/plugins/AgentFriend/lands.yml',tmp=stage+'/plugins/AgentFriend/lands.yml.project.tmp';
const hash=()=>createHash('sha256').update(readFileSync(file)).digest('hex');
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
async function until(fn,label,ms=10000){for(const end=Date.now()+ms;Date.now()<end;){if(await fn())return;await sleep(100);}throw Error(label+' timeout');}
async function make(username){await rc('minecraft:whitelist add '+username);const b=req('mineflayer').createBot({host:'127.0.0.1',port:25590,username,version:'1.20.6',auth:'offline'});bots.push(b);report.messages[username]??=[];b.on('messagestr',s=>report.messages[username].push(s));b._client.on('camera',p=>report.camera.push({player:username,...p}));b.on('error',e=>report.connectionError=String(e));await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j);});await sleep(200);if(b.currentWindow)b.closeWindow(b.currentWindow);await b.unequip('hand');return b;}
async function query(b,q,prefix){const n=report.messages[b.username].length;b.chat(q);let line;await until(()=>line=report.messages[b.username].slice(n).find(s=>s.startsWith(prefix+' ')),'response '+q);return JSON.parse(line.slice(prefix.length+1));}
const change=async(b,action,id,target)=>{await sleep(1100);return query(b,`/mycli land ${action} ${id} ${target}`,'MC_LAND_MEMBER_RESULT');};
const members=(b,id='member_test47')=>query(b,'/mycli land members '+id,'MC_LAND_MEMBERS');
const jsonRcon=async q=>{const s=await rc(q);return JSON.parse(s.slice(s.indexOf('{')));};
async function tp(b,x,y,z){b.clearControlStates();b.physicsEnabled=false;await rc(`minecraft:tp ${b.username} ${x} ${y} ${z}`);await until(()=>b.blockAt(new Vec3(x,y,z))!==null,'chunk');await sleep(400);b.entity.velocity.set(0,0,0);b.physicsEnabled=true;}
async function menu(b,q){b.chat(q);await until(()=>b.currentWindow,'menu '+q);return b.currentWindow;}
async function click(b,slot){const old=b.currentWindow;await b.clickWindow(slot,0,0);await until(()=>b.currentWindow&&b.currentWindow!==old,'next menu');return b.currentWindow;}
function editOwner(id,owner){const source=readFileSync(file,'utf8'),start=source.indexOf('\n  '+id+':');assert.ok(start>=0,'fixture YAML');const next=/\n  [a-z0-9_]+:/g;next.lastIndex=start+4;const end=next.exec(source)?.index??source.length;const part=source.slice(start,end);assert.match(part,/owner-uuid: /);writeFileSync(file,source.slice(0,start)+part.replace(/owner-uuid: [^\r\n]+/,'owner-uuid: '+owner)+source.slice(end));}
try{
 await until(async()=>{try{return(await rc('version AgentFriend')).includes('0.4.7');}catch{return false;}},'startup',150000);
 const fixture=JSON.parse(readFileSync(root+'/stage-lands-before.yml','utf8'));
 for(const [id,who,x] of [['member_test47','CortiLan',1200],['other_test47','LandOther47',1220]])fixture.lands[id]={title:x===1200?'共建测试':'其他玩家测试',world:'world',source:'bounds',min:[x,149,1200],max:[x+7,160,1207],'owner-uuid':ids[who],members:[],'visitor-use':false};
 writeFileSync(file,JSON.stringify(fixture,null,2));assert.equal((await jsonRcon('mycli admin land reload')).status,'success');
 const owner=await make('CortiLan');let guest=await make('LandGuest47');const other=await make('LandOther47'),eye=await make('CortiEye');eye.physicsEnabled=false;
 await rc('minecraft:gamemode spectator CortiEye');await rc('minecraft:tp CortiEye CortiLan');await rc('minecraft:spectate CortiLan CortiEye');await until(async()=> (await rc('cortieye')).includes('attached=true'),'actual paired Eye');
 check('real native Eye camera is attached',report.camera.some(x=>x.player==='CortiEye'&&x.cameraId===owner.entity.id));
 await query(owner,'/mycli land info member_test47','MC_LAND_INFO');await until(()=>report.messages.CortiLan.some(s=>s.startsWith('MC_LAND_GUIDE ')),'owner guide');
 check('owner gets private actionable contextual instructions',report.messages.CortiLan.some(s=>s.startsWith('MC_LAND_GUIDE ')&&s.includes('land trust')));
 const intro=await query(owner,'/mycli explain land.trust','MC_CLI_DETAIL');check('stable CLI explains current-owner scope',JSON.stringify(intro).includes('成员不能')||JSON.stringify(intro).includes('转授权'));
 await rc('minecraft:fill 1198 149 1198 1229 149 1209 minecraft:stone');await rc('minecraft:setblock 1204 150 1204 minecraft:barrel');await rc('minecraft:setblock 1204 150 1203 minecraft:stone');
 await tp(owner,1202.5,150,1204.5);await tp(guest,1202.5,150,1204.5);await rc('mycli admin land reload');
 const initial=await members(guest);check('visitor can read authoritative owner and collaborator list',initial.ownerUuid===ids.CortiLan&&initial.count===0&&!initial.canManageMembers);
 let before=hash();check('visitor cannot delegate', (await change(guest,'trust','member_test47','LandOther47')).reason==='not_land_owner'&&hash()===before);
 check('owner cannot authorize someone else land',(await change(owner,'trust','other_test47','LandGuest47')).reason==='not_land_owner');
 await rc('minecraft:op LandOther47');check('game OP has no ownership bypass',(await change(other,'trust','member_test47','LandGuest47')).reason==='not_land_owner');await rc('minecraft:deop LandOther47');
 check('unknown identity is rejected without guessing UUID',(await change(owner,'trust','member_test47','Unknown47xyz')).reason==='unknown_player'&&hash()===before);
 check('partial account name is not accepted',(await change(owner,'trust','member_test47','LandGuest')).reason==='unknown_player');
 check('owner cannot be removed as a member',(await change(owner,'untrust','member_test47','CortiLan')).reason==='target_is_owner');
 check('observer is not accepted for construction',(await change(owner,'trust','member_test47','CortiEye')).reason==='observer_target');
 await rc('minecraft:gamemode spectator CortiLan');check('observer owner cannot modify membership',(await change(owner,'trust','member_test47','LandGuest47')).reason==='observer_cannot_manage');await rc('minecraft:gamemode survival CortiLan');
 check('Goddess MCP mutation refuses when the verified actor is offline',(await jsonRcon('mycli admin land member trust other_test47 LandGuest47')).reason==='goddess_unavailable');
 await rc('minecraft:op Goddess');const goddess=await make('Goddess');await until(()=>goddess.game.gameMode==='spectator','protected Goddess observer');
 const godInfo=await members(goddess,'other_test47');check('verified spectator Goddess has cross-land administrator authority',godInfo.canManageMembers&&godInfo.administrator&&godInfo.ownerUuid===ids.LandOther47);
 const godAdd=await change(goddess,'trust','other_test47','LandGuest47');check('Goddess can grant without changing the owner',godAdd.status==='success'&&godAdd.authority==='administrator'&&godAdd.actorUuid===goddess.player.uuid&&(await members(goddess,'other_test47')).ownerUuid===ids.LandOther47);
 await sleep(1100);const godRemove=await jsonRcon('mycli admin land member untrust other_test47 LandGuest47');check('console MCP adapter uses the same verified Goddess transaction',godRemove.status==='success'&&godRemove.actorUuid===goddess.player.uuid&&(await members(goddess,'other_test47')).count===0);
 await menu(goddess,'/mycli land manage other_test47');check('spectator Goddess receives native management controls',goddess.currentWindow.slots[20]?.name==='lime_dye');goddess.closeWindow(goddess.currentWindow);
 await rc('minecraft:deop Goddess');check('Goddess must retain the trusted OP role',(await change(goddess,'trust','other_test47','LandGuest47')).reason==='observer_cannot_manage'&&(await jsonRcon('mycli admin land member trust other_test47 LandGuest47')).reason==='goddess_unavailable');await rc('minecraft:op Goddess');
 const adminStart=report.messages.CortiLan.length;owner.chat('/mycli admin land member trust other_test47 LandGuest47');await until(()=>report.messages.CortiLan.slice(adminStart).some(s=>s.includes('只允许服务器控制台')),'console adapter is not a player bypass');check('owner cannot impersonate Goddess through the console adapter',(await members(owner,'other_test47')).count===0);
 await rc('lp user LandOther47 permission set agentfriend.land.admin true');await rc('minecraft:gamemode spectator LandOther47');
 await until(async()=>(await members(other)).administrator,'explicit permission propagation');
 check('explicit permission grants a spectator administrator cross-land management',(await change(other,'trust','member_test47','LandGuest47')).status==='success');await change(other,'untrust','member_test47','LandGuest47');
 await menu(other,'/mycli land manage member_test47');await click(other,20);await click(other,9);await rc('lp user LandOther47 permission unset agentfriend.land.admin');
 await until(async()=>!(await members(other)).administrator,'explicit permission revoked');const staleAdmin=report.messages.LandOther47.length;await other.clickWindow(15,0,0);await sleep(400);
 check('revoked administrator permission invalidates an already open confirmation',report.messages.LandOther47.slice(staleAdmin).some(s=>s.includes('observer_cannot_manage'))&&(await members(owner)).count===0);if(other.currentWindow)other.closeWindow(other.currentWindow);await rc('minecraft:gamemode survival LandOther47');
 const barrel=new Vec3(1204,150,1204),wall=new Vec3(1204,150,1203);await tp(guest,1203.5,150,1205.5);report.nativeAttempt={client:guest.entity.position.clone(),server:await rc('minecraft:data get entity LandGuest47 Pos'),target:guest.blockAt(barrel)?.name};let n=report.messages.LandGuest47.length;await guest.activateBlock(guest.blockAt(barrel));await until(()=>report.messages.LandGuest47.slice(n).some(s=>s.includes('MC_LAND_ACCESS')),'actual barrel rejection');report.nativeAttempt.window=guest.currentWindow?{id:guest.currentWindow.id,title:guest.currentWindow.title}:null;
 check('visitor native private barrel open is denied',!guest.currentWindow&&report.messages.LandGuest47.slice(n).some(s=>s.includes('MC_LAND_ACCESS')));
 const outsider=report.messages.LandOther47.length,eyestart=report.messages.CortiEye.length;
 const add=await change(owner,'trust','member_test47','landguest47');check('owner can trust exact case-insensitive logged-in account',add.status==='success'&&add.targetUuid===ids.LandGuest47&&add.changed);
 await sleep(300);check('membership receipt is private and mirrored to actual Eye',report.messages.CortiEye.slice(eyestart).some(s=>s.includes('MC_LAND_MEMBER_RESULT'))&&!report.messages.LandOther47.slice(outsider).some(s=>s.includes('MC_LAND_MEMBER_RESULT')));
 before=hash();check('duplicate grant is idempotent without rewriting',(await change(owner,'trust','member_test47',ids.LandGuest47)).status==='unchanged'&&hash()===before);
 check('member has no delegation rights',(await change(guest,'trust','member_test47','LandOther47')).reason==='not_land_owner');
 check('trust does not modify another plot',(await query(guest,'/mycli land info other_test47','MC_LAND_INFO')).role==='visitor');
 await guest.openContainer(guest.blockAt(barrel));check('member actually opens native private barrel',guest.currentWindow?.inventoryStart===27);guest.closeWindow(guest.currentWindow);
 await rc('minecraft:give LandGuest47 minecraft:diamond_pickaxe');await sleep(250);await guest.equip(guest.inventory.items().find(x=>x.name==='diamond_pickaxe'),'hand');await guest.dig(guest.blockAt(wall));
 await until(async()=>(await rc('structureqa block 1204 150 1203')).includes('minecraft:air'),'server acknowledges actual member block break');check('member actually breaks allowed plot block',true);
 await guest.openContainer(guest.blockAt(barrel));const removed=await change(owner,'untrust','member_test47','LandGuest47');await until(()=>!guest.currentWindow,'revocation closes actual inventory');
 check('revocation immediately closes already open private barrel',removed.status==='success'&&(await members(guest)).count===0);
 await sleep(1100);await guest.unequip('hand');n=report.messages.LandGuest47.length;await guest.activateBlock(guest.blockAt(barrel));await until(()=>report.messages.LandGuest47.slice(n).some(s=>s.includes('MC_LAND_ACCESS')||s.includes('保护区')),'actual post-revocation rejection');
 const revoked=await query(guest,'/mycli protect container 1204 150 1204','MC_PROTECTION');check('revoked player cannot reopen private barrel',!guest.currentWindow&&!revoked.allowed&&revoked.reason==='land_permission_denied');
 before=hash();check('duplicate revocation is idempotent',(await change(owner,'untrust','member_test47','LandGuest47')).reason==='not_member'&&hash()===before);
 const valid=readFileSync(file);writeFileSync(file,Buffer.concat([valid,Buffer.from('\n# unreviewed administrator edit\n')]));const pending=hash();
 check('pending administrator edit is not overwritten',(await change(owner,'trust','member_test47','LandGuest47')).reason==='land_config_pending_reload'&&hash()===pending);writeFileSync(file,valid);
 assert.ok(!existsSync(tmp));mkdirSync(tmp);before=hash();const failed=await change(owner,'trust','member_test47','LandGuest47');rmdirSync(tmp);
 check('storage failure denies grant and retains effective membership',failed.reason==='land_save_failed'&&hash()===before&&(await members(owner)).count===0);
 await menu(owner,'/mycli land manage member_test47');await click(owner,20);await click(owner,9);check('GUI exposes scope before permission changes',(await members(guest)).count===0&&owner.currentWindow.slots[13]?.name==='paper');await sleep(1100);await click(owner,15);
 check('native menu confirmation grants the selected UUID',(await members(guest)).count===1);owner.closeWindow(owner.currentWindow);
 await change(owner,'untrust','member_test47','LandGuest47');await menu(owner,'/mycli land manage member_test47');await click(owner,20);await click(owner,9);
 editOwner('member_test47',ids.LandOther47);assert.equal((await jsonRcon('mycli admin land reload')).status,'success');n=report.messages.CortiLan.length;await owner.clickWindow(15,0,0);await sleep(400);
 check('stale GUI cannot grant after owner transfer',report.messages.CortiLan.slice(n).some(s=>s.includes('not_land_owner'))&&(await members(other)).count===0);if(owner.currentWindow)owner.closeWindow(owner.currentWindow);
 editOwner('member_test47',ids.CortiLan);assert.equal((await jsonRcon('mycli admin land reload')).status,'success');
 guest.quit();await sleep(700);check('previously joined offline account can be granted',(await change(owner,'trust','member_test47','LandGuest47')).status==='success');check('offline member can be revoked by stable UUID',(await change(owner,'untrust','member_test47',ids.LandGuest47)).status==='success');
 guest=await make('LandGuest47');await tp(guest,1202.5,150,1204.5);await change(owner,'trust','member_test47','LandGuest47');
 const board=await query(guest,'/mycli land board member_test47','MC_LAND_BOARD');report.board=board;check('plot has a real reachable announcement sign',board.status==='ready');
 const point=new Vec3(board.x,board.y,board.z);await tp(guest,board.x+.5,board.y,board.z+1.5);await until(()=>guest.blockAt(point)?.name==='oak_sign','sign block');
 const sign=report.sign={};for(const path of ['front_text.messages[2]','back_text.messages[2]','front_text.messages[3]','back_text.messages[3]','is_waxed'])sign[path]=await rc(`minecraft:data get block ${board.x} ${board.y} ${board.z} ${path}`);
 check('both native sign sides display owner and updated member count',sign['front_text.messages[2]'].includes('CortiLan')&&sign['back_text.messages[2]'].includes('CortiLan')&&sign['front_text.messages[3]'].includes('协作 1')&&sign['back_text.messages[3]'].includes('协作 1')&&/\b1b?\b/.test(sign.is_waxed));
 await tp(other,board.x+.5,board.y,board.z+1.5);await other.unequip('hand');await other.activateBlock(other.blockAt(point));await until(()=>other.currentWindow,'board opens actual native menu');check('visitor can view full collaborator list on 27-slot page',other.currentWindow.inventoryStart===27&&other.currentWindow.slots[9]?.name==='paper'&&!other.currentWindow.slots[20]);other.closeWindow(other.currentWindow);
 const protectedBoard=await query(owner,`/mycli protect break ${board.x} ${board.y} ${board.z}`,'MC_PROTECTION');check('board protection is visible to Agent preflight',protectedBoard.reason==='land_notice_board'&&!protectedBoard.allowed);
 await tp(owner,board.x+.5,board.y,board.z+1.5);await Promise.race([owner.dig(owner.blockAt(point)).catch(()=>{}),sleep(1800)]);owner.stopDigging();check('even owner cannot accidentally destroy announcement sign',(await rc(`structureqa block ${board.x} ${board.y} ${board.z}`)).includes('minecraft:oak_sign'));
 await change(owner,'untrust','member_test47','LandGuest47');const changedSign=await rc(`minecraft:data get block ${board.x} ${board.y} ${board.z} front_text.messages[3]`);check('physical notice immediately follows revocation',changedSign.includes('协作 0'));
 await tp(other,-489.5,67,-501.5);await until(async()=>{report.boards=await jsonRcon('mycli admin land boards');return ['adventurers_guild','sky_view_tower','adventurers_guild_storage'].every(id=>report.boards.boards.find(b=>b.landId===id)?.status==='ready');},'original plots loaded and signed');check('existing guild and tower lands also get announcements',true);
 const synthetic=Array.from({length:64},(_,i)=>'00000000-0000-3000-8000-'+String(i+1).padStart(12,'0'));
 fixture.lands.member_test47.members=synthetic.slice(0,10);writeFileSync(file,JSON.stringify(fixture,null,2));assert.equal((await jsonRcon('mycli admin land reload')).status,'success');
 const secondPage=await query(guest,'/mycli land members member_test47 2','MC_LAND_MEMBERS');check('public member list paginates beyond nine collaborators',secondPage.count===10&&secondPage.page===2&&secondPage.pages===2);
 await menu(owner,'/mycli land manage member_test47');await click(owner,25);check('native collaborator menu has a working second page',owner.currentWindow.slots[9]?.name==='paper'&&!owner.currentWindow.slots[10]);owner.closeWindow(owner.currentWindow);
 fixture.lands.member_test47.members=synthetic;writeFileSync(file,JSON.stringify(fixture,null,2));assert.equal((await jsonRcon('mycli admin land reload')).status,'success');before=hash();
 check('64 collaborator limit rejects an additional member without rewriting',(await change(owner,'trust','member_test47','LandGuest47')).reason==='member_limit_reached'&&hash()===before);
 fixture.lands.member_test47.members=[];writeFileSync(file,JSON.stringify(fixture,null,2));assert.equal((await jsonRcon('mycli admin land reload')).status,'success');
 await change(owner,'trust','member_test47','LandGuest47');before=hash();const fast=await query(owner,'/mycli land untrust member_test47 LandGuest47','MC_LAND_MEMBER_RESULT');
 check('rapid actual permission changes are bounded and explain retry timing',fast.reason==='change_rate_limited'&&hash()===before);
 report.finalMembers=await members(owner);report.passed=true;
}catch(error){report.error=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{if(existsSync(tmp))try{rmdirSync(tmp);}catch{};await rc('lp user LandOther47 permission unset agentfriend.land.admin').catch(()=>{});await rc('minecraft:deop LandOther47').catch(()=>{});for(const b of bots){b.clearControlStates();b.quit();}writeFileSync(root+'/stage-test-'+Date.now()+'.json',JSON.stringify(report,null,2));}
