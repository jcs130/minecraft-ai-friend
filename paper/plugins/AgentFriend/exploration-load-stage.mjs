import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
const stage='E:/MC/staging/life-buildings-20261003';
const roots=['E:/MC/ops/repairs/exploration-contracts-20261007','F:/MC-backups/repairs/exploration-contracts-20261007'];
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const rcon=q=>command(q,20000,{port:25587,properties:stage+'/server.properties'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={candidateSha256:createHash('sha256').update(readFileSync(stage+'/plugins/AgentFriend-0.3.88.jar')).digest('hex').toUpperCase(),passed:false,checks:[],messages:{},packets:{},started:new Date().toISOString()},bots=[];
const check=(name,ok,detail='')=>{assert.ok(ok,name+': '+detail);report.checks.push(name);};
const make=async name=>{
 const b=mineflayer.createBot({host:'127.0.0.1',port:25567,username:name,version:'1.20.6',auth:'offline'});bots.push(b);
 report.messages[name]=[];report.packets[name]=[];
 b.on('messagestr',s=>report.messages[name].push(s));b.on('error',e=>{report.errors??=[];report.errors.push(String(e));});
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:market')report.packets[name].push(JSON.parse(p.data.toString()));});
 await new Promise((r,j)=>{b.once('spawn',r);b.once('error',j);b.once('kicked',j);});return b;
};
const ask=async(b,q,delay=1100)=>{const n=report.messages[b.username].length;b.chat(q);await sleep(delay);return report.messages[b.username].slice(n).join('\n');};
const tp=async(b,x,z)=>{
 b.clearControlStates();b.physicsEnabled=false;await rcon('surveyqa mana '+b.username);
 await rcon(`execute in minecraft:overworld run minecraft:tp ${b.username} ${x} 101 ${z}`);await sleep(300);
 await b.waitForChunksToLoad();b.entity.velocity.set(0,0,0);b.physicsEnabled=true;await sleep(400);
 const p=JSON.parse(await rcon('surveyqa position '+b.username));
 assert.ok(p.world==='world'&&Math.hypot(p.x-x,p.z-z)<2,'fixture placement must actually settle');
};
const entry=goal=>({scope:'personal',repeat:'once',title:'隔离并发探索',description:'只验证受控连接的服务器探索采样',icon:'MAP',reward:{fame:5,emeralds:2,bonus:'BREAD','bonus-count':1},steps:[
 {title:'走查',description:'实际移动获取证据',goal,dimension:'overworld',target:128,'zone-size':4,'min-distance':512,'min-seconds':120,
 ...(goal==='structure'?{structure:'minecraft:mansion'}:{})}
]});
try{
 check('isolated 0.3.88',/0\.3\.88/.test(await rcon('version AgentFriend')));
 report.beforeMobSpawning=await rcon('gamerule doMobSpawning');
 await rcon('gamerule doMobSpawning false');await rcon('minecraft:time set noon');
 for(const type of ['zombie','husk','drowned','skeleton','stray','spider','cave_spider','creeper','witch'])
  await rcon(`minecraft:kill @e[type=minecraft:${type},x=1390,y=85,z=990,dx=65,dy=30,dz=90]`);
 const cfg=JSON.parse(readFileSync(stage+'/plugins/AgentFriend/task-market.yml','utf8'));
 cfg.tasks.qa_load_structure=entry('structure');cfg.tasks.qa_load_walk=entry('dimension');cfg.tasks.qa_eye_survey=entry('dimension');
 Object.assign(cfg.tasks.qa_eye_survey.steps[0],{target:4,'min-distance':16,'min-seconds':5});
 writeFileSync(stage+'/plugins/AgentFriend/task-market.yml',JSON.stringify(cfg,null,2));
 check('concurrent templates hot loaded',/已热加载/.test(await rcon('mycli admin market reload')));
 const suffix=String(Date.now()).slice(-4),clients=await Promise.all(Array.from({length:16},(_,i)=>make('SvLoad'+suffix+String(i).padStart(2,'0'))));
 for(let i=0;i<clients.length;i++){
  await rcon('minecraft:effect give '+clients[i].username+' minecraft:resistance 600 4 true');
  await tp(clients[i],1401.5,1001.5+2*i);
 }
 report.settling=[];let stable=0,last='';
 for(let i=0;i<15;i++){
  const chunks=JSON.parse(await rcon('surveyqa chunks')),signature=JSON.stringify(chunks);report.settling.push(chunks);
  stable=signature===last?stable+1:0;last=signature;if(stable>=2)break;await sleep(2000);
 }
 check('background login view chunks settled',stable>=2,JSON.stringify(report.settling));
 const accepts=await Promise.all(clients.map(b=>ask(b,'/mycli guild accept tm_qa_load_structure',700)));
 check('16 independent active structure surveys',accepts.every(s=>s.includes('已接公会委托')));
 await sleep(5000);report.chunksBefore=JSON.parse(await rcon('surveyqa chunks'));await sleep(6000);
 report.chunksAfter=JSON.parse(await rcon('surveyqa chunks'));
 check('stationary structure checks load no new chunks',Object.keys(report.chunksBefore).every(w=>report.chunksAfter[w]<=report.chunksBefore[w]),JSON.stringify({before:report.chunksBefore,after:report.chunksAfter}));
 await Promise.all(clients.map(b=>ask(b,'/mycli guild verify',600)));
 check('16 fake structure locations refused',clients.every(b=>report.packets[b.username].findLast(p=>p.type==='MC_MARKET_CHECK')?.ready===false));
 await Promise.all(clients.map(b=>ask(b,'/mycli guild abandon',600)));
 await Promise.all(clients.map(b=>ask(b,'/mycli guild accept tm_qa_load_walk',700)));
 for(const b of clients){await b.lookAt(new Vec3(1439.5,102.62,b.entity.position.z),true);b.setControlState('forward',true);}
 await sleep(7000);for(const b of clients)b.setControlState('forward',false);await sleep(1500);
 report.mspt=await rcon('mspt');const numbers=report.mspt.replace(/§./g,'').match(/\d+\.\d+/g)?.map(Number)??[];
 check('steady sampler average below tick budget',numbers[0]<50,report.mspt);
 await Promise.all(clients.map(b=>ask(b,'/mycli guild verify',700)));
 const evidence=clients.map(b=>report.packets[b.username].findLast(p=>p.type==='MC_MARKET_CHECK')?.evidence);
 report.surveys=evidence;check('all 16 moving players receive new coverage',evidence.every(e=>e?.distinctZones>=2&&e.distance>4),JSON.stringify(evidence));
 for(const b of clients)b.quit();await sleep(1200);
 const actor=await make('CortiLan'),eye=await make('CortiEye');await sleep(2000);
 report.eyeStatus=await rcon('cortieye');check('real native Eye attached',/camera=online/.test(report.eyeStatus)&&/attached=true/.test(report.eyeStatus));
 await rcon('minecraft:gamemode survival CortiLan');
 await rcon('minecraft:effect give CortiLan minecraft:resistance 600 4 true');
 await tp(actor,1401.5,1001.5);await ask(actor,'/mycli guild abandon');
 check('registered actor accepts exploration',/已接公会委托/.test(await ask(actor,'/mycli guild accept tm_qa_eye_survey')));
 report.messages[eye.username].length=0;
 await actor.lookAt(new Vec3(1438.5,102.62,1001.5),true);actor.setControlState('forward',true);await sleep(6500);actor.setControlState('forward',false);await sleep(1600);
 check('Eye receives owner survey completion receipt',report.messages[eye.username].some(s=>s.includes('MC_MARKET_SURVEY')),report.messages[eye.username].join('\n'));
 check('Eye stays a spectator',eye.game.gameMode==='spectator');
 await ask(actor,'/mycli guild abandon');report.passed=true;
}catch(e){report.error=String(e.stack??e);process.exitCode=1;}
finally{
 for(const b of bots){b.clearControlStates();b.quit();}await sleep(250);report.finished=new Date().toISOString();
 if(report.beforeMobSpawning)await rcon('gamerule doMobSpawning '+(/true/.test(report.beforeMobSpawning)?'true':'false')).catch(()=>{});
 for(const root of roots){const p=root+'/exploration-load-result.json';if(existsSync(p))copyFileSync(p,p+'.attempt-'+Date.now());writeFileSync(p,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,mspt:report.mspt,chunksBefore:report.chunksBefore,chunksAfter:report.chunksAfter}));
}
