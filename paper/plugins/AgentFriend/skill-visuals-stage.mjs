// Disposable native protocol fixture, hard confined to the isolation copy.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const stage=process.argv[2],root=process.argv[3];assert.equal(stage,'E:/MC/staging/skill-visuals-20261009');assert.equal(root,'E:/MC/ops/repairs/skill-visuals-20261009');
const req=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(req);const mf=req('mineflayer'),bots=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),rc=q=>command(q,15000,{port:25587,properties:stage+'/server.properties'});
const report={passed:false,checks:[],messages:{},particles:{},events:{},camera:[],costs:[],startedAt:new Date().toISOString()};
report.candidateSha256=createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.4.5.jar')).digest('hex').toUpperCase();
const check=(name,ok)=>{assert.ok(ok,name);if(!report.checks.includes(name))report.checks.push(name);console.log('PASS '+name)};
async function until(fn,label,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error(label+' timeout')}
const text=b=>report.messages[b.username],event=b=>report.events[b.username];
const data=b=>report.particles[b.username];const dust=b=>data(b).filter(p=>String(p.particle?.type??p.particleId).includes('dust'));
const profile=b=>JSON.parse(readFileSync(stage+'/plugins/AgentFriend/profession-ledger.json','utf8')).players[b.player.uuid];
const config=stage+'/plugins/AgentFriend/skill-visuals.yml',settings=readFileSync(config,'utf8');
const resumeWorld=process.argv.includes('--resume-world-change'),resumeFlow=process.argv.includes('--resume-flow')||resumeWorld;
const resumeGeometry=process.argv.includes('--resume-geometry')||resumeFlow?readdirSync(root).filter(n=>n.startsWith('visuals-test-')).sort().at(-1):null;
const prior=resumeGeometry?JSON.parse(readFileSync(root+'/'+resumeGeometry,'utf8')):null;
if(prior){assert.equal(prior.candidateSha256,report.candidateSha256);assert.ok(resumeWorld?prior.checks.length===55:resumeFlow?[46,47].includes(prior.checks.length):prior.checks.length===42);assert.ok(resumeWorld?/changing dimension cancels caster animation|native dimension change timeout/.test(prior.error):prior.error.includes(resumeFlow?(prior.checks.length===46?'professional learning retains two point price':'real sword strike keeps damage, mana, event and new choreography'):'new learning retains actual skill point costs'));report.geometryEvidence=resumeGeometry;report.costs=prior.costs;report.loadAudit=prior.loadAudit;report.msptBefore=prior.msptBefore;report.msptAfter=prior.msptAfter;}
async function make(username){const b=mf.createBot({host:'127.0.0.1',port:25567,username,version:'1.20.6',auth:'offline'});bots.push(b);
 report.messages[username]=[];report.particles[username]=[];report.events[username]=[];
 b.on('messagestr',s=>text(b).push(s));b.on('error',e=>report.connectionError=String(e));
 b._client.on('world_particles',p=>{data(b).push({...p,receivedAt:Date.now()})});b._client.on('camera',p=>report.camera.push({player:username,...p}));
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:event'){try{event(b).push(JSON.parse(p.data.toString('utf8')))}catch{}}});
 await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j)});return b;}
async function chat(b,q,ms=400){b.chat(q);await sleep(ms)}
async function tp(b,x=-543.5,y=67,z=-439.5){b.physicsEnabled=false;await rc(`minecraft:tp ${b.username} ${x} ${y} ${z}`);await sleep(550);b.entity.velocity.set(0,0,0);b.physicsEnabled=true;await sleep(100)}
const audit=async()=>JSON.parse((await rc('mycli admin visuals audit')).split('MC_VISUALS ')[1]);
const mana=async(b,value)=>JSON.parse(await rc('worldqa mana '+b.username+(value===undefined?'':' '+value))).mana;
async function preview(b,id){return rc('mycli admin visuals preview '+b.username+' '+id)}
let actor,eye;
try{
 await until(async()=>{try{return(await rc('version AgentFriend')).includes('0.4.5')}catch{return false}},'startup',150000);
 check('final candidate enabled',(await rc('version AgentFriend')).includes('0.4.5'));
 const first=await audit();check('36 validated visual profiles loaded',first.enabled&&first.profiles===36&&first.skills===36);
 actor=await make('VisualCheck45');eye=await make('VisualEye45');await rc('minecraft:gamemode survival VisualCheck45');await tp(actor);await rc('minecraft:gamemode spectator VisualEye45');
 await rc('minecraft:spectate VisualCheck45 VisualEye45');
 await until(()=>report.camera.some(p=>p.player===eye.username&&p.cameraId===actor.entity.id),'real paired spectator attachment');
 check('actual native Eye attached to Agent',report.camera.some(p=>p.player===eye.username&&p.cameraId===actor.entity.id));
 const far=await make('VisualFar45');await tp(far,-660,81,-478);
 const names=JSON.parse(readFileSync(root+'/profile-ids.json','utf8'));
 const fingerprints={};
 if(!prior){for(const id of names){const old=data(actor).length,oldEye=data(eye).length,before=await audit();await preview(actor,id);await sleep(2200);const after=await audit();const points=data(actor).slice(old).filter(p=>String(p.particle?.type??p.particleId).includes('dust'));
  fingerprints[id]=createHash('sha256').update(JSON.stringify(points.map(p=>({x:p.x,y:p.y,z:p.z,particle:p.particle})))).digest('hex');
  check('native geometry emits '+id,after.admitted===before.admitted+1&&after.packets>before.packets&&points.length>0&&data(eye).length>oldEye);
  if(id==='home')check('attached Eye gets one copy and packets respect client particle settings',data(eye).slice(oldEye).filter(p=>String(p.particle?.type).includes('dust')).length===points.length&&points.every(p=>!p.longDistance&&p.amount===1));
  if(id==='starlight'){report.studioSample=points[0];check('actual imported six-point-star transition is transmitted',points.some(p=>p.particle?.type==='dust_color_transition'));}
 }
 check('distinct skills produce distinct coordinate/color signatures',new Set(Object.values(fingerprints)).size===names.length);report.fingerprints=fingerprints;
 check('outside 24 blocks gets no new dust packets',dust(far).length===0);
 }else{report.checks.push(...prior.checks.slice(3));report.fingerprints=prior.fingerprints;report.studioSample=prior.studioSample;}
 let before,n,at,current;
 if(!resumeFlow){await rc('minecraft:experience set VisualCheck45 15 levels');
 await chat(actor,'/mycli skills learn night');await chat(actor,'/mycli skills learn fireworks');await chat(actor,'/mycli skills learn starlight');
 check('new learning retains actual skill point costs',profile(actor).points.spent===3&&['night','fireworks','starlight'].every(id=>profile(actor).basicLearned[id]));
 await mana(actor,20);before=await audit();n=event(actor).length;at=dust(actor).length;
 await chat(actor,'/mycli cast night',80);current=await mana(actor);report.costs.push({skill:'night',before:20,after:current});await sleep(1400);
 check('legal night cast charges original two mana and sends exactly one successful event',current<=18.05&&current>=17.95&&event(actor).slice(n).filter(x=>x.id==='night').length===1&&(await audit()).admitted===before.admitted+1&&dust(actor).length>at);
 before=await audit();n=event(actor).length;await chat(actor,'/mycli cast night');await sleep(1200);
 check('cooldown denial adds no animation or success event',(await audit()).admitted===before.admitted&&event(actor).length===n);
 await mana(actor,0);before=await audit();n=event(actor).length;await chat(actor,'/mycli cast fireworks');await sleep(1600);
 check('insufficient mana adds no animation or success event',(await audit()).admitted===before.admitted&&event(actor).length===n);}
 if(!resumeWorld){await mana(actor,20);await chat(actor,'/mycli profession choose warrior');await chat(actor,'/mycli skills learn sword_thrust');
 check('professional learning retains two point price',profile(actor).points.spent===5&&profile(actor).learned.sword_thrust.level===1&&profile(actor).learned.sword_thrust.pointsSpent===2);
 await rc('minecraft:give VisualCheck45 minecraft:iron_sword 1');await sleep(300);const sword=actor.inventory.items().find(i=>i.name==='iron_sword');await actor.equip(sword,'hand');
 await tp(actor,-660,81,-478);report.summon=await rc('minecraft:summon minecraft:husk -660 81 -476 {NoAI:1b,Silent:1b,Tags:["visuals_qa"],Health:20f}');
 await until(()=>Object.values(actor.entities).some(e=>e.name==='husk'),'native controlled hostile is actually present');
 const hostile=Object.values(actor.entities).find(e=>e.name==='husk');await actor.lookAt(hostile.position.offset(0,1.4,0));await sleep(250);
 before=await audit();n=event(actor).length;await chat(actor,'/mycli cast sword_thrust',100);current=await mana(actor);await sleep(1700);
 const enemyHealth=Number((await rc('minecraft:data get entity @e[tag=visuals_qa,limit=1] Health')).match(/([\d.]+)f\s*$/)?.[1]);report.enemyHealth=enemyHealth;
 check('real sword strike keeps damage, mana, event and new choreography',current>=15.95&&current<=16.55&&event(actor).slice(n).some(x=>x.id==='sword_thrust')&&(await audit()).admitted===before.admitted+1&&enemyHealth<20&&enemyHealth>=16);
 await rc('minecraft:kill @e[tag=visuals_qa]');
 const revision=await audit();writeFileSync(config,settings.replace('packets-per-tick: 256','packets-per-tick: 999999'));
 check('invalid hot reload rejected',(await rc('mycli admin visuals reload')).includes('status=rejected')&&(await audit()).packetsPerTick===revision.packetsPerTick);
 writeFileSync(config,settings.replace('packets-per-tick: 256','packets-per-tick: 128'));check('valid visual budget hot reload succeeds without restart',(await rc('mycli admin visuals reload')).includes('status=success')&&(await audit()).packetsPerTick===128);
 writeFileSync(config,settings);await rc('mycli admin visuals reload');
 before=await audit();n=event(actor).length;const mp=await mana(actor),paid=profile(actor).points.spent;
 for(let i=0;i<10;i++)await preview(actor,'flight');await sleep(2300);const saturated=await audit();
 check('per-caster burst is bounded and drops extra animations',saturated.admitted-before.admitted<=2&&saturated.dropped>before.dropped&&saturated.active===0);
 check('cosmetic preview has no skill events or point spending',event(actor).length===n&&profile(actor).points.spent===paid&&(await mana(actor))>=mp);
 await tp(actor);const peers=[actor];for(let i=1;i<16;i++){const b=await make('VisualLoad45'+i);await tp(b,-543.5+(i%4)*.3,67,-439.5+Math.floor(i/4)*.3);peers.push(b)}
 const loadStart=await audit();report.msptBefore=await rc('mspt');
 for(let round=0;round<4;round++){for(const b of peers)await preview(b,round%2?'healer_beacon':'starlight');await sleep(2000)}
 await sleep(2400);report.loadAudit=await audit();report.msptAfter=await rc('mspt');
 check('16 simultaneous controlled Agents and attached Eye receive effects',peers.length===16&&peers.every(b=>dust(b).length>0)&&dust(eye).length>0&&report.loadAudit.admitted-loadStart.admitted===64);
 check('global hard delivery budget never exceeded',report.loadAudit.peakTickPackets<=256&&report.loadAudit.throttled>loadStart.throttled&&report.loadAudit.active===0);
 check('real spectator remains attached during concurrent playback',report.camera.filter(p=>p.player===eye.username).at(-1).cameraId===actor.entity.id&&report.loadAudit.errors===0);}
 // Console-only cosmetic preview on a spectator fixture avoids treating nested execute/tp as a paid player spell.
 await rc('minecraft:gamemode spectator VisualCheck45');await preview(actor,'healer_beacon');await tp(actor,-543.5,80,-439.5);report.dimensionReply=await rc('minecraft:execute in minecraft:the_nether run minecraft:tp VisualCheck45 0 100 0');
 await until(()=>/nether/.test(actor.game.dimension),'native dimension change',10000);
 await until(async()=>(await audit()).active===0,'world-change animation cleanup',3000);
 check('changing dimension cancels caster animation',(await audit()).active===0);
 await rc('minecraft:execute in minecraft:overworld run minecraft:tp VisualCheck45 -543.5 67 -439.5');await until(()=>/overworld/.test(actor.game.dimension),'native return to overworld');await rc('minecraft:gamemode survival VisualCheck45');await sleep(500);
 const saved=profile(actor);report.persisted={actor:actor.username,uuid:actor.player.uuid,spent:saved.points.spent,learned:saved.learned,basicLearned:saved.basicLearned};
 report.configSha256=createHash('sha256').update(readFileSync(config)).digest('hex').toUpperCase();report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1}
finally{writeFileSync(config,settings);try{await rc('mycli admin visuals reload');await rc('minecraft:kill @e[tag=visuals_qa]')}catch{}for(const b of bots)b.quit();writeFileSync(root+'/visuals-test-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
process.exit(process.exitCode??0);
