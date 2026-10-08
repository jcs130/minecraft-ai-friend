// Isolated Paper 25567 / RCON 25587 only. This script mutates disposable engineering fixtures.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const stage='E:/MC/staging/life-buildings-20261003',root='E:/MC/ops/repairs/project-landmarks-20261008';
const roots=[root,'F:/MC-backups/repairs/project-landmarks-20261008'];
const ids=JSON.parse(readFileSync(root+'/test-identities.json','utf8'));
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,startedAt:new Date().toISOString(),candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.91.jar')).digest('hex').toUpperCase(),checks:[],messages:{},packets:{}};
const clients=[];
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
const until=async(f,label,timeout=14000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await f())return;await sleep(80);}throw new Error(label+' timed out');};
const json=s=>JSON.parse(s.slice(s.indexOf('{')));
const java='E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe';
const yamlClasspath=root+';E:/MC/server/libraries/org/yaml/snakeyaml/2.2/snakeyaml-2.2.jar;E:/MC/server/libraries/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar';
function yaml(rel){const out=root+'/stage-read-'+rel.replaceAll('/','_')+'.json';execFileSync(java,['-cp',yamlClasspath,'YamlJson',stage+'/'+rel,out],{windowsHide:true});return JSON.parse(readFileSync(out,'utf8'));}
const config=()=>yaml('plugins/AgentFriend/config.yml');
function saveLand(value){writeFileSync(stage+'/plugins/AgentFriend/lands.yml',JSON.stringify(value,null,2));}
async function join(name){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});
 const c={bot,name,lines:[],packets:[],effects:[],cameras:[],windows:0};clients.push(c);report.messages[name]=c.lines;report.packets[name]=c.packets;
 bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{report.errors??=[];report.errors.push(String(e));});
 bot._client.on('packet',(p,m)=>{if(m.name==='custom_payload'&&p.channel.startsWith('mcagent:')){try{c.packets.push({channel:p.channel,...JSON.parse(p.data.toString())});}catch{}}
 if(/title|sound|particle/.test(m.name))c.effects.push(m.name);if(m.name==='camera')c.cameras.push(p);if(m.name==='open_window')c.windows++;});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:state\0mcagent:landmark\0mcagent:market\0mcagent:land')});
 await sleep(350);return c;
}
async function chat(c,q){await sleep(Math.max(0,1150-(Date.now()-(c.lastChat??0))));c.lastChat=Date.now();c.bot.chat(q);}
async function ask(c,q,prefix='MC_LANDMARK_RESULT ',terminal=true){const n=c.lines.length;await chat(c,q);await until(()=>c.lines.slice(n).some(s=>(prefix.startsWith('MC_')?s.startsWith(prefix):s.includes(prefix))&&(!terminal||!prefix.includes('RESULT')||json(s).status!=='pending')),q);await sleep(150);return c.lines.slice(n);}
async function cmd(c,q,reason='ok'){const lines=await ask(c,'/mycli landmark '+q);const r=json(lines.findLast(s=>s.startsWith('MC_LANDMARK_RESULT ')&&json(s).status!=='pending'));assert.equal(r.reason,reason,q+': '+lines.join('\n'));return r;}
async function tp(c,x,y=150,z=1408.5){await rcon(`minecraft:tp ${c.name} ${x} ${y} ${z}`);await until(()=>c.bot.entity.position.distanceTo(new Vec3(x,y,z))<1,'position');await sleep(400);}
const state=async c=>json(await rcon('waypointqa position '+c.name));
const refill=async(c,n)=>json(await rcon(`waypointqa mana ${c.name}${n===undefined?'':' '+n}`));
async function build(c,x){await tp(c,x+3.5,150,1406.5);await rcon('minecraft:give '+c.name+' minecraft:stone_bricks 16');await sleep(150);await c.bot.equip(c.bot.inventory.items().find(i=>i.name==='stone_bricks'),'hand');
 for(let dx=2;dx<=4;dx++)for(let dz=3;dz<=4;dz++)await c.bot.placeBlock(c.bot.blockAt(new Vec3(x+dx,149,1400+dz)),new Vec3(0,1,0));await sleep(300);}
async function accept(c,id){check('accept '+id,/已接公会委托/.test((await ask(c,'/mycli guild accept tm_'+id,'已接公会委托',false)).join('\n')));}
async function claim(c){const lines=await ask(c,'/mycli guild claim','委托交付成功',false);return lines;}
async function travel(c,id,reason='ok'){
 await refill(c);const before=await state(c),n=c.effects.length,lines=await ask(c,'/mycli goto landmark:'+id);
 const r=json(lines.findLast(s=>s.startsWith('MC_LANDMARK_RESULT ')&&json(s).status!=='pending'));assert.equal(r.reason,reason,JSON.stringify({r,lines}));await sleep(100);const after=await state(c);
 if(reason==='ok'){assert.equal(r.spentMana,6);assert.ok(Math.abs(before.mana-after.mana-6)<.6);assert.ok(lines.some(s=>s.startsWith('MC_TRAVEL ')&&s.includes('mana=6')));}
 else{assert.equal(r.spentMana,0);assert.ok(after.mana>=before.mana-.1);assert.ok(Math.abs(after.x-before.x)<.2&&Math.abs(after.z-before.z)<.2);}
 return {r,before,after,effects:c.effects.slice(n)};
}
try{
 await until(async()=>{try{return /0\.3\.91/.test(await rcon('version AgentFriend'));}catch{return false;}},'stage startup',60000);
 await rcon('minecraft:forceload add 1392 1392 1471 1423');await rcon('minecraft:fill 1395 149 1395 1470 149 1410 minecraft:sea_lantern');
 await rcon('minecraft:fill 1395 150 1395 1470 158 1410 minecraft:air');await rcon('minecraft:time set day');
 const owner=await join('MarkOwner91'),other=await join('MarkOther91'),member=await join('MarkMember91'),eye=await join('MarkEye91'),pending=await join('MarkPending91');
 for(const c of [owner,other,member,pending]){await rcon('minecraft:gamemode survival '+c.name);await rcon('minecraft:effect give '+c.name+' minecraft:resistance 600 4 true');await rcon('minecraft:clear '+c.name);await tp(c,1408.5);}
 await rcon('minecraft:gamemode spectator '+eye.name);await rcon('minecraft:spectate '+owner.name+' '+eye.name);await sleep(1500);
 for(const id of ['qa_view','qa_pending','qa_legacy','qa_resume']){await rcon('mycli admin market register '+id);await until(async()=> (await rcon('mycli admin market list')).includes('site='+id+' registered=true'),'register '+id);}
 check('four isolated snapshots registered',true);
 const invalid=JSON.parse(readFileSync(root+'/stage-market-initial.json','utf8'));invalid.tasks.qa_view.handover.site='qa_pending';
 writeFileSync(stage+'/plugins/AgentFriend/task-market.yml',JSON.stringify(invalid));check('handover must refer to this task BUILD step',/校验失败/.test(await rcon('mycli admin market reload')));
 writeFileSync(stage+'/plugins/AgentFriend/task-market.yml',readFileSync(root+'/stage-market-initial.json'));assert.match(await rcon('mycli admin market reload'),/已热加载/);
 await accept(owner,'qa_view');
 const detailN=owner.packets.length;await ask(owner,'/mycli guild engineering tm_qa_view','完工交接',false);
 check('Agent task details expose ownership policy',owner.packets.slice(detailN).some(p=>p.type==='MC_MARKET_DETAIL'&&p.handover?.landId==='qa_view'));
 await ask(owner,'/mycli guild claim','验收未通过',false);check('incomplete work receives neither claim nor reward',!json(await rcon('mycli admin land audit')).lands.some(l=>l.id==='qa_view')&&!config()['task-market'].projects.tm_qa_view.completed);
 // Changing the offer does not rewrite the accepted responsibility/land ID.
 const changed=JSON.parse(readFileSync(root+'/stage-market-initial.json','utf8'));changed.tasks.qa_view.handover['land-id']='changed_after_accept';
 writeFileSync(stage+'/plugins/AgentFriend/task-market.yml',JSON.stringify(changed));await rcon('mycli admin market reload');
 await build(owner,1400);const completed=await claim(owner);
 let audit=json(await rcon('mycli admin land audit')),land=audit.lands.find(l=>l.id==='qa_view');
 check('actual six-block construction grants frozen land to contractor UUID',land?.ownerUuid===ids.MarkOwner91&&!audit.lands.some(l=>l.id==='changed_after_accept')&&completed.some(s=>s.startsWith('MC_PROJECT_HANDOVER ')&&json(s).status==='success'),land);
 let cfg=config(),completedCount=cfg['guild-players'][ids.MarkOwner91].completed;
 check('completed ledger and handover receipt persisted',cfg['task-market'].projects.tm_qa_view.handover.state==='applied'&&cfg['task-market'].projects.tm_qa_view['completed-by']===ids.MarkOwner91);
 await rcon('mycli admin market handover tm_qa_view');check('handover replay never pays rewards again',config()['guild-players'][ids.MarkOwner91].completed===completedCount);
 await ask(other,'/mycli guild accept tm_qa_view','project_completed',false);check('one project cannot be claimed twice',true);
 await tp(owner,1403.5,151,1403.5);await tp(other,1406.5,150,1405.5);
 await cmd(other,'publish qa_view 偷来的地标','not_land_owner');await rcon('minecraft:op '+other.name);await cmd(other,'publish qa_view OP也不能偷','not_land_owner');await rcon('minecraft:deop '+other.name);
 check('ordinary players and OP cannot register another owner land',true);
 await tp(owner,1410.5);await cmd(owner,'publish qa_view 远处的位置','outside_land');await tp(owner,1403.5,151,1403.5);
 await cmd(owner,'publish qa_view bad.name','invalid_name');check('publication requires valid name and actual arrival inside bounds',true);
 await rcon('minecraft:gamemode spectator '+owner.name);await cmd(owner,'publish qa_view 旁观者','survival_required');await rcon('minecraft:gamemode survival '+owner.name);await sleep(250);
 await cmd(owner,'publish qa_view 星河观景台');check('current owner publishes named safe landmark for free',true);
 await ask(owner,'/mycli waypoint add 私人营地','MC_WAYPOINT_RESULT ');const quota=await ask(owner,'/mycli waypoint add 另一个营地','MC_WAYPOINT_RESULT ');
 check('landmarks do not consume personal waypoint quota',quota.some(s=>s.startsWith('MC_WAYPOINT_RESULT ')&&json(s).reason==='limit_reached'));
 await tp(owner,1410.5);await refill(owner);const personalBefore=await state(owner);
 await ask(owner,'/mycli goto personal:私人营地','MC_WAYPOINT_RESULT ');const personalAfter=await state(owner);
 check('personal waypoint regression uses same paid travel engine',Math.abs(personalAfter.x-1403.5)<.1&&Math.abs(personalBefore.mana-personalAfter.mana-6)<.6);
 const share=json((await ask(owner,'/mycli waypoint share 私人营地','MC_WAYPOINT_RESULT ')).findLast(s=>s.startsWith('MC_WAYPOINT_RESULT ')));
 await refill(other);await ask(other,'/mycli goto shared:'+share.point.shareCode,'MC_WAYPOINT_RESULT ');
 check('shared waypoint regression still teleports other players',Math.abs((await state(other)).x-1403.5)<.1);
 await tp(other,1406.5,150,1405.5);
 const rows=await ask(other,'/mycli landmark list','MC_LANDMARK_LIST ',false);
 check('public catalogue exposes manager and stable teleport target',rows.some(s=>s.startsWith('MC_LANDMARK_ITEM ')&&json(s).id==='qa_view'&&json(s).ownerUuid===ids.MarkOwner91&&json(s).target==='landmark:qa_view'));
 check('Agent landmark chat records fit 400-character histories',owner.lines.concat(other.lines).filter(s=>s.startsWith('MC_LANDMARK_')).every(s=>s.length<=400));
 await tp(other,1410.5);const arrived=await travel(other,'qa_view');
 check('visitor reaches building and spends exactly six mana with native effects',Math.abs(arrived.after.x-1403.5)<.1&&Math.abs(arrived.after.y-151)<.1&&arrived.effects.some(s=>s.includes('title'))&&arrived.effects.some(s=>s.includes('sound'))&&arrived.effects.some(s=>s.includes('particle')),arrived);
 const permissions=await ask(other,'/mycli land here','MC_LAND_PERMISSIONS ',false);
 check('public teleport grants no building or private storage rights',permissions.some(s=>s.startsWith('MC_LAND_PERMISSIONS ')&&!json(s).break&&!json(s).container));
 await rcon('minecraft:give '+other.name+' minecraft:iron_pickaxe');await sleep(150);await other.bot.equip(other.bot.inventory.items().find(i=>i.name==='iron_pickaxe'),'hand');
 const n=other.packets.length;other.bot.dig(other.bot.blockAt(new Vec3(1402,150,1403))).catch(()=>{});
 await until(()=>other.packets.slice(n).some(p=>p.type==='MC_LAND_ACCESS'&&p.action==='break'),'actual visitor rejection');other.bot.stopDigging();
 check('visitor actual block break denied by server',(await rcon('minecraft:execute if block 1402 150 1403 minecraft:stone_bricks')).includes('Test passed'));
 await tp(other,1410.5);await refill(other,0);const insufficient=await ask(other,'/mycli goto landmark:qa_view');
 check('insufficient mana refuses without moving',insufficient.some(s=>s.startsWith('MC_LANDMARK_RESULT ')&&json(s).reason==='not_enough_mana')&&(await state(other)).x===1410.5);
 await rcon('minecraft:setblock 1403 151 1403 minecraft:stone');await travel(other,'qa_view','unsafe_landing');await rcon('minecraft:setblock 1403 151 1403 minecraft:air');
 check('blocked landing refuses without mana or terrain changes',true);
 await rcon('minecraft:gamemode spectator '+other.name);await travel(other,'qa_view','spectator_or_dead');await rcon('minecraft:gamemode survival '+other.name);
 check('Eye and other spectators cannot cast landmark travel',true);
 await cmd(owner,'unpublish qa_view');await travel(other,'qa_view','landmark_unavailable');await cmd(owner,'publish qa_view 星河观景台');
 check('unpublish immediately revokes stable target and can be republished',true);
 // Actual vanilla container packets test a private chest and an explicitly public gift chest.
 await rcon('minecraft:setblock 1405 151 1403 minecraft:chest');await rcon('minecraft:setblock 1405 151 1405 minecraft:barrel');await tp(other,1406.5,150,1404.5);await sleep(250);
 let win=other.windows,packetN=other.packets.length;await other.bot.activateBlock(other.bot.blockAt(new Vec3(1405,151,1403)));
 await until(()=>other.packets.slice(packetN).some(p=>p.type==='MC_LAND_ACCESS'&&p.action==='container'),'private chest rejection');check('private chest denies before opening',other.windows===win);
 let lands=yaml('plugins/AgentFriend/lands.yml');lands.lands.qa_view['public-containers']=[[1405,151,1403]];lands.lands.qa_view.members=[ids.MarkMember91];saveLand(lands);assert.equal(json(await rcon('mycli admin land reload')).status,'success');
 await other.bot.openContainer(other.bot.blockAt(new Vec3(1405,151,1403)));other.bot.closeWindow(other.bot.currentWindow);check('explicit gift chest stays public inside managed landmark',true);
 packetN=other.packets.length;await other.bot.activateBlock(other.bot.blockAt(new Vec3(1405,151,1405)));await until(()=>other.packets.slice(packetN).some(p=>p.type==='MC_LAND_ACCESS'&&p.action==='container'),'private barrel');check('public gift chest does not expose other storage',true);
 await tp(member,1403.5,151,1404.5);await cmd(member,'publish qa_view 合作者不能代管','not_land_owner');check('trusted builders cannot take over public destination management',true);
 // Turn off eligibility and restore it online; public points must disappear synchronously.
 lands.lands.qa_view['landmark-enabled']=false;saveLand(lands);await rcon('mycli admin land reload');await tp(other,1410.5);await travel(other,'qa_view','landmark_unavailable');
 lands.lands.qa_view['landmark-enabled']=true;saveLand(lands);await rcon('mycli admin land reload');check('landmark eligibility hot reload disables existing point',true);
 const eyeN=eye.lines.length,memberN=member.lines.length;await cmd(owner,'publish qa_view 私有回执镜像');
 await until(()=>eye.lines.slice(eyeN).some(s=>s.startsWith('MC_LANDMARK_RESULT ')),'paired Eye message');
 check('native paired Eye receives owner receipt and outsiders do not',eye.lines.slice(eyeN).some(s=>s.includes('公共地标已登记'))&&!member.lines.slice(memberN).some(s=>s.startsWith('MC_LANDMARK_RESULT '))&&eye.cameras.some(p=>Object.values(p).includes(owner.bot.entity.id)));
 const opening=other.windows;await chat(other,'/mycli landmark menu');await until(()=>other.windows>opening,'public menu');check('native public landmark menu opens',JSON.stringify(other.bot.currentWindow?.title??'').includes('公共地标'));await other.bot.clickWindow(0,0,0);await until(()=>other.bot.currentWindow?.slots[13]?.name==='ender_pearl','landmark detail');await refill(other);await other.bot.clickWindow(13,0,0);await until(()=>Math.abs(other.bot.entity.position.x-1403.5)<.2,'menu travel');check('native menu click really teleports visitor',true);
 // Old completed projects adopt only their original verified contractor, without reward mutation.
 await accept(owner,'qa_legacy');await build(owner,1440);await claim(owner);
 check('projects without handover keep original public behavior',!json(await rcon('mycli admin land audit')).lands.some(l=>l.id==='qa_legacy'));
 const legacyCfg=config(),legacyCount=legacyCfg['guild-players'][ids.MarkOwner91].completed;
 const legacy=JSON.parse(readFileSync(root+'/stage-market-initial.json','utf8'));legacy.tasks.qa_legacy.handover={'land-id':'qa_legacy',site:'qa_legacy',landmark:true};writeFileSync(stage+'/plugins/AgentFriend/task-market.yml',JSON.stringify(legacy));await rcon('mycli admin market reload');
 check('uncompleted project cannot be adopted',/completed_project_with_handover_required/.test(await rcon('mycli admin market handover tm_qa_resume')));
 const adopted=json(await rcon('mycli admin market handover tm_qa_legacy'));
 check('legacy adoption checks completed history and original builder UUID',adopted.status==='success'&&adopted.ownerUuid===ids.MarkOwner91&&config()['guild-players'][ids.MarkOwner91].completed===legacyCount);
 // A real write failure leaves a durable receipt, recovered after a normal restart.
 await accept(pending,'qa_pending');await build(pending,1420);
 const pendingTmp=stage+'/plugins/AgentFriend/lands.yml.project.tmp';assert.ok(!existsSync(pendingTmp));mkdirSync(pendingTmp);
 const pendingLines=await claim(pending);cfg=config();
 check('disk failure preserves a pending completion receipt',cfg['task-market'].projects.tm_qa_pending.handover.state==='pending'&&pendingLines.some(s=>s.startsWith('MC_PROJECT_HANDOVER ')&&json(s).status==='pending')&&!json(await rcon('mycli admin land audit')).lands.some(l=>l.id==='qa_pending'));
 renameSync(pendingTmp,root+'/simulated-write-failure-directory');
 // Leave an accepted completed construction for the restart check, but do not claim it yet.
 await tp(owner,1463.5);await accept(owner,'qa_resume');await build(owner,1460);
 // Transfer does not let the old owner or a replay move the land back.
 lands=yaml('plugins/AgentFriend/lands.yml');lands.lands.qa_view['owner-uuid']=ids.MarkOther91;saveLand(lands);await rcon('mycli admin land reload');
 await cmd(owner,'unpublish qa_view','not_land_owner');await travel(owner,'qa_view','landmark_unavailable');
 await rcon('mycli admin market handover tm_qa_view');check('replayed receipt preserves later legitimate owner transfer',json(await rcon('mycli admin land audit')).lands.find(l=>l.id==='qa_view').ownerUuid===ids.MarkOther91);
 await tp(other,1403.5,151,1403.5);await cmd(other,'publish qa_view 新主人观景台');check('new owner must explicitly publish a fresh landing',true);
 await rcon('minecraft:save-all flush');report.expectedRestart={legacyCount,ownerCompleted:config()['guild-players'][ids.MarkOwner91].completed,pendingCompleted:config()['guild-players'][ids.MarkPending91].completed};
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{for(const c of clients)c.bot.quit();await sleep(200);report.finishedAt=new Date().toISOString();for(const dst of roots)writeFileSync(dst+'/stage-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,lastMessages:Object.fromEntries(clients.map(c=>[c.name,c.lines.slice(-5)]))}));}
