// Restart persistence, native owner naming, cross-dimension handover, and bounded 16-Agent queries.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const stage='E:/MC/staging/life-buildings-20261003',root='E:/MC/ops/repairs/project-landmarks-20261008';
const roots=[root,'F:/MC-backups/repairs/project-landmarks-20261008'];
const ids=JSON.parse(readFileSync(root+'/test-identities.json','utf8')),prior=JSON.parse(readFileSync(root+'/stage-result.json','utf8'));assert.ok(prior.passed);
const rcon=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={passed:false,startedAt:new Date().toISOString(),checks:[],messages:{},candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.91.jar')).digest('hex').toUpperCase()};assert.equal(report.candidateSha256,prior.candidateSha256);
const clients=[],json=s=>JSON.parse(s.slice(s.indexOf('{')));
const check=(name,ok,detail)=>{report.checks.push({name,ok:!!ok,detail});assert.ok(ok,name+': '+JSON.stringify(detail??''));console.log('PASS '+name);};
const until=async(f,label,timeout=18000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await f())return;await sleep(80);}throw new Error(label+' timeout');};
const java='E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe',cp=root+';E:/MC/server/libraries/org/yaml/snakeyaml/2.2/snakeyaml-2.2.jar;E:/MC/server/libraries/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar';
function yaml(rel){const out=root+'/restart-read-'+rel.replaceAll('/','_')+'.json';execFileSync(java,['-cp',cp,'YamlJson',stage+'/'+rel,out],{windowsHide:true});return JSON.parse(readFileSync(out,'utf8'));}
const config=()=>yaml('plugins/AgentFriend/config.yml');
async function join(name){const bot=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6'});const c={bot,name,lines:[],packets:[],windows:0};clients.push(c);report.messages[name]=c.lines;
 bot.on('messagestr',s=>c.lines.push(s));bot.on('error',e=>{report.errors??=[];report.errors.push(String(e));});bot._client.on('open_window',()=>c.windows++);
 bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:landmark'||p.channel==='mcagent:land')c.packets.push({channel:p.channel,...JSON.parse(p.data.toString())});});
 await new Promise((r,j)=>{bot.once('spawn',r);bot.once('error',j);bot.once('kicked',j);});await sleep(150);return c;}
async function chat(c,q){await sleep(Math.max(0,1150-(Date.now()-(c.lastChat??0))));c.lastChat=Date.now();c.bot.chat(q);}
async function ask(c,q,prefix='MC_LANDMARK_RESULT '){const n=c.lines.length;await chat(c,q);await until(()=>c.lines.slice(n).some(s=>(prefix.startsWith('MC_')?s.startsWith(prefix):s.includes(prefix))&&(!prefix.includes('RESULT')||json(s).status!=='pending')),q);await sleep(120);return c.lines.slice(n);}
async function tp(c,x,y,z,dim='overworld'){await rcon(`minecraft:execute in minecraft:${dim} run minecraft:tp ${c.name} ${x} ${y} ${z}`);await until(()=>c.bot.entity.position.distanceTo(new Vec3(x,y,z))<1,'tp');await sleep(350);}
const mana=async(c,value)=>json(await rcon('waypointqa mana '+c.name+(value===undefined?'':' '+value)));
const state=async c=>json(await rcon('waypointqa position '+c.name));
try{
 await until(async()=>{try{return /0\.3\.91/.test(await rcon('version AgentFriend'));}catch{return false;}},'startup',60000);
 let cfg=config(),audit=json(await rcon('mycli admin land audit'));
 check('pending disk-failure receipt recovered on normal restart',cfg['task-market'].projects.tm_qa_pending.handover.state==='applied'&&audit.lands.find(l=>l.id==='qa_pending')?.ownerUuid===ids.MarkPending91);
 check('restart recovery pays no extra reward',cfg['guild-players'][ids.MarkPending91].completed===prior.expectedRestart.pendingCompleted);
 check('legitimate owner transfer persists across restart',audit.lands.find(l=>l.id==='qa_view')?.ownerUuid===ids.MarkOther91);
 const owner=await join('MarkOwner91'),other=await join('MarkOther91'),pending=await join('MarkPending91'),eye=await join('MarkEye91');
 const list=await ask(owner,'/mycli landmark list','MC_LANDMARK_LIST ');
 check('public registry and new manager persist',list.some(s=>s.startsWith('MC_LANDMARK_ITEM ')&&json(s).name==='新主人观景台'&&json(s).ownerUuid===ids.MarkOther91));
 await tp(owner,1463.5,150,1406.5);await ask(owner,'/mycli guild claim','委托交付成功');cfg=config();
 check('accepted frozen project completes after restart and grants correct owner',cfg['task-market'].projects.tm_qa_resume.handover.state==='applied'&&cfg['guild-players'][ids.MarkOwner91].completed===prior.expectedRestart.ownerCompleted+1);
 await tp(owner,1463.5,151,1403.5);await chat(owner,'/mycli landmark menu');await until(()=>owner.bot.currentWindow?.slots[22]?.name==='grass_block','menu');await owner.bot.clickWindow(22,0,0);
 await until(()=>JSON.stringify(owner.bot.currentWindow?.title??'').includes('我管理的'),'own menu');
 const targetSlot=owner.bot.currentWindow.slots.findIndex(item=>item&&JSON.stringify(item).includes('qa_resume'));assert.ok(targetSlot>=0&&targetSlot<18,'resumed building in own menu');await owner.bot.clickWindow(targetSlot,0,0);
 await until(()=>owner.bot.currentWindow?.slots[10]?.name==='name_tag','owner detail');await owner.bot.clickWindow(10,0,0);await until(()=>!owner.bot.currentWindow,'closed for input');
 const outsiderN=other.lines.length;const published=await ask(owner,'重启后的平台');
 check('native owner menu private chat really publishes point',published.some(s=>s.startsWith('MC_LANDMARK_RESULT ')&&json(s).status==='success')&&!other.lines.slice(outsiderN).some(s=>s.includes('重启后的平台')));
 const infoN=owner.packets.length;await ask(owner,'/mycli landmark info qa_resume');
 check('full Agent info exposes builder UUID and project provenance',owner.packets.slice(infoN).some(p=>p.type==='MC_LANDMARK_INFO'&&p.builderUuid===ids.MarkOwner91&&p.projectTask==='tm_qa_resume'&&p.projectRun));
 // Public-container subregion must not strip the actual owner's build permission.
 await tp(other,1406.5,150,1403.5);await rcon('minecraft:give '+other.name+' minecraft:iron_pickaxe');await sleep(150);await other.bot.equip(other.bot.inventory.items().find(i=>i.name==='iron_pickaxe'),'hand');
 await other.bot.dig(other.bot.blockAt(new Vec3(1405,151,1403)));await sleep(200);
 check('current owner can remove explicitly public gift chest',(await rcon('minecraft:execute if block 1405 151 1403 minecraft:air')).includes('Test passed'));
 await rcon('minecraft:setblock 1405 151 1403 minecraft:chest');
 // Nether engineering and a public trip use the same owner and safety rules.
 const market=yaml('plugins/AgentFriend/task-market.yml');market.sites.qa_nether={world:'world_nether',min:[1480,90,1400],max:[1486,98,1406],'deck-y':90,materials:['STONE_BRICKS']};
 market.tasks.qa_nether={scope:'project',title:'下界观景台',description:'隔离下界建造与跨维度旅行。',icon:'STONE_BRICKS',reward:{fame:18,emeralds:7,bonus:'BREAD','bonus-count':2},handover:{'land-id':'qa_nether',site:'qa_nether',landmark:true},steps:[{title:'建造',description:'新增六格石砖。',goal:'build',site:'qa_nether',target:6}]};
 writeFileSync(stage+'/plugins/AgentFriend/task-market.yml',JSON.stringify(market));assert.match(await rcon('mycli admin market reload'),/已热加载/);
 await rcon('minecraft:execute in minecraft:the_nether run minecraft:forceload add 1472 1392 1503 1423');
 await rcon('minecraft:execute in minecraft:the_nether run minecraft:fill 1477 89 1397 1489 89 1409 minecraft:sea_lantern');
 await rcon('minecraft:execute in minecraft:the_nether run minecraft:fill 1477 90 1397 1489 98 1409 minecraft:air');
 await tp(pending,1483.5,90,1406.5,'the_nether');await rcon('mycli admin market register qa_nether');await until(async()=> (await rcon('mycli admin market list')).includes('site=qa_nether registered=true'),'nether register');
 await ask(pending,'/mycli guild accept tm_qa_nether','已接公会委托');await rcon('minecraft:give '+pending.name+' minecraft:stone_bricks 8');await sleep(150);await pending.bot.equip(pending.bot.inventory.items().find(i=>i.name==='stone_bricks'),'hand');
 for(let x=1482;x<=1484;x++)for(let z=1403;z<=1404;z++)await pending.bot.placeBlock(pending.bot.blockAt(new Vec3(x,89,z)),new Vec3(0,1,0));
 await ask(pending,'/mycli guild claim','委托交付成功');await tp(pending,1483.5,91,1403.5,'the_nether');await ask(pending,'/mycli landmark publish qa_nether 下界远眺');
 check('Nether BUILD completion grants a world-specific public landmark',json(await rcon('mycli admin land audit')).lands.find(l=>l.id==='qa_nether')?.world==='minecraft:the_nether');
 await mana(owner);const before=await state(owner);await ask(owner,'/mycli goto landmark:qa_nether');const after=await state(owner);
 check('public landmark teleports across dimensions for exactly six mana',after.world==='world_nether'&&Math.abs(after.x-1483.5)<.1&&Math.abs(before.mana-after.mana-6)<.6);
 await tp(owner,1463.5,151,1403.5);await tp(pending,1463.5,151,1404.5);await tp(other,1403.5,151,1403.5);await rcon('minecraft:gamemode spectator '+eye.name);await rcon('minecraft:spectate '+owner.name+' '+eye.name);
 const load=[];for(let i=0;i<13;i++)load.push(await join('MarkLoad'+String(i).padStart(2,'0')));
 const agents=[owner,other,pending,...load];assert.equal(agents.length,16);
 for(const c of load)await tp(c,1410.5,150,1408.5);
 report.chunkBefore=json(await rcon('waypointqa chunks'));report.msptBefore=await rcon('mspt');const started=Date.now();
 for(let round=0;round<4;round++)await Promise.all(agents.map(c=>ask(c,'/mycli landmark list','MC_LANDMARK_LIST ')));
 report.queryDurationMs=Date.now()-started;report.chunkAfter=json(await rcon('waypointqa chunks'));report.msptAfter=await rcon('mspt');
 check('16 Agent connections plus an Eye receive all 64 bounded catalogue replies',agents.every(c=>c.lines.filter(s=>s.startsWith('MC_LANDMARK_LIST ')).length>=4));
 check('catalogue queries generate no world chunks',report.chunkAfter.generated===report.chunkBefore.generated,{before:report.chunkBefore,after:report.chunkAfter});
 check('queries do not grow loaded chunk counts',Object.keys(report.chunkBefore).filter(k=>k!=='generated').every(k=>report.chunkAfter[k]<=report.chunkBefore[k]),{before:report.chunkBefore,after:report.chunkAfter});
 report.loadScope='16 controlled Java Agent connections plus one native paired Eye; 64 catalogue queries, not long-running LLM gameplay';
 await rcon('minecraft:save-all flush');report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{for(const c of clients)c.bot.quit();await sleep(200);report.finishedAt=new Date().toISOString();for(const dst of roots)writeFileSync(dst+'/restart-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,mspt:report.msptAfter,lastMessages:Object.fromEntries(clients.slice(0,4).map(c=>[c.name,c.lines.slice(-4)]))}));}
