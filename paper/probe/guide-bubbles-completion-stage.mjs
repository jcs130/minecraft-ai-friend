// Real Paper/Mineflayer packets and the shared Web bridge. Fixture identities and
// configuration changes are restricted to the existing loopback laboratory.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {createViewerContentBridge} from 'file:///E:/mc-visual-console/packages/modern-viewer/renderer-src/host/viewer-content.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/ysm-release-20261011/paper',out=process.env.GUIDE_REPORT;
assert(out&&!existsSync(out),'Set GUIDE_REPORT to a fresh private result file');
const props=readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25644\r?$/m);assert.match(props,/^rcon.port=25645\r?$/m);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const {createBot}=req('mineflayer'),clients=[],report={startedAt:new Date().toISOString(),checks:[],errors:[],samples:{}};
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:25645});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let closing=false;
const check=(name,value,detail)=>{report.checks.push({name,pass:!!value,detail});assert.ok(value,name);console.log('PASS '+name);};
async function until(fn,label,ms=12000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(80);}throw Error('Timeout '+label);}
async function join(name){
 const bot=createBot({host:'127.0.0.1',port:25644,username:name,version:'1.20.6',auth:'offline',hideErrors:true});installRecipePacketBypass(bot._client);
 const c={bot,name,text:[],content:[],boss:[],particles:[],cameras:[]};clients.push(c);
 bot.on('messagestr',s=>c.text.push(s));bot.on('error',e=>{if(!closing)report.errors.push(name+': '+e.message);});
 bot._client.on('boss_bar',p=>c.boss.push(p));bot._client.on('camera',p=>c.cameras.push(p));
 bot._client.on('world_particles',p=>{if(p.longDistance&&p.particle.type==='end_rod')c.particles.push(p);});
 await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('spawn '+name)),30000);bot.once('spawn',()=>{clearTimeout(timer);res();});bot.once('error',rej);bot.once('kicked',rej);});
 bot.physicsEnabled=false;await sleep(1600);
 c.bridge=createViewerContentBridge(bot);c.bridge.subscribe((name,value)=>c.content.push({name,value}));return c;
}
async function tp(c,x=100.5,y=201,z=95.5){await rc(`minecraft:tp ${c.name} ${x} ${y} ${z}`);await sleep(400);}
async function ask(c,q){const i=c.text.length;c.bot.chat(q);await sleep(750);return c.text.slice(i);}
function bubble(c,text,from=0){return c.content.slice(from).filter(e=>e.name==='textDisplay'&&!e.value.delete).find(e=>e.value.runs.some(r=>r.text.includes(text)))?.value;}
const bubbleFile=stage+'/plugins/AgentFriend/text-bubbles.yml',courseFile=stage+'/plugins/AgentFriend/skill-assessments.yml';
const oldBubble=readFileSync(bubbleFile,'utf8'),oldCourse=readFileSync(courseFile,'utf8');let courseChanged=false;
try{
 check('candidate 0.4.28',(await rc('version AgentFriend')).includes('0.4.28'));
 const caster=await join('YsmReleaseQA'),peer=await join('GuideOther'),eye=await join('YsmReleaseQA_eye');
 await rc('minecraft:gamemode creative YsmReleaseQA');await rc('minecraft:gamemode creative GuideOther');await tp(caster);await tp(peer,100.5,201,94.5);
 report.samples.fixtureMana=await rc('skills manaability resetcooldown YsmReleaseQA replenish true');
 await until(()=>eye.cameras.some(p=>Object.values(p).includes(caster.bot.entity.id)),'real Eye attachment');check('actual Eye attached',true);
 const marker='白底气泡-准备出发';await ask(caster,'/mycli say '+marker);
 const display=await until(()=>bubble(peer,marker),'public bubble');report.samples.playerBubble=display;
 check('legacy configuration receives opaque white background',display.background===0xffffffff&&display.opacity===255);
 check('dark player text, separate pointer color and no shadow',display.runs.some(r=>r.text.includes(marker)&&r.color==='#1f2937')&&display.runs.some(r=>r.text==='\n▼'&&r.color==='#64748b')&&display.flags===0);
 check('native layout includes top and side padding',display.runs[0].text.startsWith('\n  ')&&display.runs[0].text.endsWith('  '));
 const eyeDisplay=await until(()=>bubble(eye,marker),'Eye palette');check('Eye receives the same actual display and palette',eyeDisplay.id===display.id&&eyeDisplay.background===display.background);
 const beforePrivate=peer.content.length;await ask(caster,'/msg GuideOther BUBBLE_PRIVATE_SECRET');
 check('private player messages never become overhead text',!bubble(peer,'BUBBLE_PRIVATE_SECRET',beforePrivate));
 const configured=oldBubble.replace(/^background-color:.*\r?\n?/gm,'').replace(/^player-text-color:.*\r?\n?/gm,'');
 writeFileSync(bubbleFile,configured+"\nbackground-color: '#ffffff'\nplayer-text-color: '#14532d'\n");
 check('valid palette hot reload accepted',(await rc('mycli admin bubbles reload')).includes('status=success'));
 await ask(caster,'/mycli say 自定义绿色气泡');const green=await until(()=>bubble(peer,'自定义绿色气泡'),'custom color');
 check('hot palette reaches native packets and Web unchanged',green.runs.some(r=>r.color==='#14532d')&&green.background===0xffffffff);
 writeFileSync(bubbleFile,configured+"\nbackground-color: 'transparent'\n");
 check('invalid palette rejects the entire reload',(await rc('mycli admin bubbles reload')).includes('status=rejected'));
 await ask(caster,'/mycli say 仍然保留绿色');const retained=await until(()=>bubble(peer,'仍然保留绿色'),'retained palette');check('invalid reload keeps the previous working appearance',retained.runs.some(r=>r.color==='#14532d'));
 writeFileSync(bubbleFile,oldBubble);await rc('mycli admin bubbles reload');
 // Interact with the real built-in receptionist, without using an AI backend or a fake NPC event.
 await tp(caster,-492.5,67,-498.5);await tp(peer,-493.5,67,-498.5);await sleep(900);
 const npc=Object.values(caster.bot.entities).find(e=>e.name==='villager'&&Math.abs(e.position.x+492.5)<2&&Math.abs(e.position.z+497.5)<2);
 check('real guild receptionist loaded',!!npc);const npcPeer=peer.content.length,npcCaster=caster.content.length;
 await caster.bot.activateEntity(npc);const npcDisplay=await until(()=>bubble(caster,'欢迎来到冒险者公会',npcCaster),'NPC bubble');report.samples.npcBubble=npcDisplay;
 check('NPC uses opaque white with high contrast blue text',npcDisplay.background===0xffffffff&&npcDisplay.runs.some(r=>r.color==='#1d4ed8'));
 check('private NPC caption absent from nearby unrelated player',!bubble(peer,'欢迎来到冒险者公会',npcPeer));
 check('private NPC caption reaches actual attached Eye',!!(await until(()=>bubble(eye,'欢迎来到冒险者公会'),'NPC Eye')));
 if(caster.bot.currentWindow)caster.bot.closeWindow(caster.bot.currentWindow);
 await tp(caster,100.5,201,100.5);await tp(peer,100.5,201,95.5);
 await rc('minecraft:summon minecraft:husk 120.5 201 100.5 {Tags:["guide_completion_enemy"],NoAI:1b,NoGravity:1b,PersistenceRequired:1b}');
 await ask(caster,'/mycli cast sense');
 for(const [yaw,expected] of [[0,'左 ←'],[720,'左 ←'],[-720,'左 ←'],[90,'后 ↓'],[810,'后 ↓'],[-630,'后 ↓'],[-90,'前 ↑'],[-810,'前 ↑']]){
  const start=caster.boss.length;caster.bot._client.write('look',{yaw,pitch:0,onGround:true});
  await until(()=>caster.boss.slice(start).some(p=>(JSON.stringify(p.title)??'').includes(expected)),'sense bearing '+yaw,2000);
  check('sense matches compass bearing at yaw '+yaw,true);
 }
 await rc('minecraft:kill @e[tag=guide_completion_enemy]');await sleep(1500);
 // A surveyed fixture in already loaded chunks verifies the fifth guide consumer.
 const catalog=JSON.parse(oldCourse.replace(/^#.*$/gm,'')),uid=readFileSync(stage+'/world/uid.dat').toString('hex');
 const world=uid.replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');
 catalog.courses.guide_fixture={ 'world-uuid':world,min:[96,200,94],max:[164,215,112],start:[100.5,201,100.5],landing:[140.5,201,105.5],checkpoints:[[112.5,205,100.5],[125.5,208,108.5],[140.5,201,105.5]]};
 catalog.assessments.flight_basic.enabled=true;catalog.assessments.flight_basic.course='guide_fixture';
 writeFileSync(courseFile,JSON.stringify(catalog,null,2));courseChanged=true;
 report.samples.examReload=await rc('mycli admin assessments reload');check('isolated course catalog accepted',report.samples.examReload.includes('考试与18阶目录已热加载'));
 await rc('minecraft:gamemode survival YsmReleaseQA');caster.bot._client.write('flying',{onGround:true});await sleep(500);await ask(caster,'/mycli guild join');
 report.samples.fixtureLearnFlight=await ask(caster,'/mycli skills learn flight');
 check('fixture flight qualification prepared explicitly',report.samples.fixtureLearnFlight.some(s=>s.includes('"success":true')||s.includes('"reason":"already_learned"')));
 const startResult=await ask(caster,'/mycli guild exam start flight_basic');report.samples.examStart=startResult;
 check('real assessment active',startResult.some(s=>s.includes('"state":"active"')));
 caster.particles.length=0;await sleep(1200);
 check('assessment line ends at the actual course start',caster.particles.some(p=>Math.abs(p.x-100.5)<1e-6&&Math.abs(p.y-201.1)<1e-6&&Math.abs(p.z-100.5)<1e-6));
 await ask(caster,'/mycli cast flight');await sleep(1000);
 check('casting switches the line to the first real checkpoint',caster.particles.some(p=>Math.abs(p.x-112.5)<1e-6&&Math.abs(p.y-205.1)<1e-6&&Math.abs(p.z-100.5)<1e-6));
 await ask(caster,'/mycli guild exam cancel');await sleep(2200);caster.particles.length=0;await sleep(600);
 check('cancelled assessment leaves no stale guide',caster.particles.length===0);
 check('no client transport errors',report.errors.length===0,report.errors);report.passed=report.checks.length;
}catch(e){report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{
 closing=true;writeFileSync(bubbleFile,oldBubble);if(courseChanged)writeFileSync(courseFile,oldCourse);
 try{await rc('mycli admin bubbles reload');if(courseChanged)await rc('mycli admin assessments reload');await rc('minecraft:kill @e[tag=guide_completion_enemy]');}catch(e){report.cleanupError=String(e);process.exitCode=1;}
 report.messages=Object.fromEntries(clients.map(c=>[c.name,c.text]));for(const c of clients){c.bridge?.dispose();c.bot.quit('completion test finished');}
 report.finishedAt=new Date().toISOString();writeFileSync(out,JSON.stringify(report,null,2)+'\n');await sleep(400);
}
