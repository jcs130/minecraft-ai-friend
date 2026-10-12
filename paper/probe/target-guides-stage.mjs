// Real 1.20.6 particles and attached Eyes; this can only run on the loopback test world.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
const stage='E:/MC/staging/ysm-release-20261011/paper';
const properties=readFileSync(stage+'/server.properties','utf8');
assert.match(properties,/^server-ip=127\.0\.0\.1\r?$/m);
assert.match(properties,/^server-port=25644\r?$/m);
assert.match(properties,/^rcon.port=25645\r?$/m);
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
fix1206PotionProtocol(require);
const {createBot}=require('mineflayer');
const rcon=q=>command(q,15000,{properties:stage+'/server.properties',port:25645});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={at:new Date().toISOString(),checks:[],errors:[],samples:{}},clients=[];
const out=process.env.GUIDE_REPORT;
assert(out && !existsSync(out), 'Set GUIDE_REPORT to a fresh private evidence file');
const version=process.env.GUIDE_VERSION??'0.4.28';
let closing=false;
function check(name,ok,detail){report.checks.push({name,pass:!!ok,detail});assert.ok(ok,name);console.log('PASS',name);}
async function until(fn,name,ms=25000){const end=Date.now()+ms;while(Date.now()<end){const v=fn();if(v)return v;await sleep(75);}throw Error('Timeout '+name);}
async function join(name){
 const bot=createBot({host:'127.0.0.1',port:25644,username:name,version:'1.20.6',auth:'offline',hideErrors:true});
 installRecipePacketBypass(bot._client);const c={name,bot,lines:[],points:[],cameras:[]};clients.push(c);
 bot.on('messagestr',s=>{c.lines.push(s);if(c.lines.length>150)c.lines.shift();});
 bot.on('error',e=>{if(!closing)report.errors.push(name+': '+e.message);});
 bot.on('kicked',s=>{if(!closing)report.errors.push(name+' kicked: '+JSON.stringify(s));});
 bot._client.on('packet',(p,m)=>{
  if(m.name.includes('camera'))c.cameras.push(p);
  if(m.name==='world_particles'&&p.longDistance&&p.amount===1&&p.offsetX===0&&p.offsetY===0&&p.offsetZ===0&&p.velocityOffset===0)c.points.push({...p,at:Date.now()});
 });
 await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('spawn '+name)),30000);bot.once('spawn',()=>{clearTimeout(timer);bot.physicsEnabled=false;res();});bot.once('error',rej);bot.once('kicked',s=>rej(Error(JSON.stringify(s))));});
 // Mineflayer still sends its first forced-position reply just after spawn.
 // Do not teleport a new fixture while that old position is in flight.
 await sleep(1600);return c;
}
const pos=(x,y,z)=>({x,y,z});
const close=(p,q)=>Math.abs(p.x-q.x)<1e-6&&Math.abs(p.y-q.y)<1e-6&&Math.abs(p.z-q.z)<1e-6;
async function teleport(c,x=100.5,y=201,z=100.5){
 // Vanilla absolute integer X/Z arguments auto-center by +0.5. Preserve the requested coordinate explicitly.
 await rcon(`minecraft:tp ${c.name} ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
 try{await until(()=>c.bot.entity.position.distanceTo({x,y,z})<.2,'teleport '+c.name);}catch(e){report.teleportFailure={name:c.name,wanted:{x,y,z},client:c.bot.entity.position,server:await rcon('minecraft:data get entity '+c.name+' Pos')};throw e;}
}
async function ask(c,text){c.bot.chat(text);await sleep(1200);}
function clear(){for(const c of clients)c.points.length=0;}
function frame(c,start,end){const endIndex=c.points.findIndex(p=>close(p,end));if(endIndex<0)return null;let startIndex=endIndex;while(startIndex>=0&&!close(c.points[startIndex],start))startIndex--;return startIndex<0?null:c.points.slice(startIndex,endIndex+1);}
function fullFrame(name,c,start,end){const points=frame(c,start,end);check(name,points&&points.length>=2&&points.length<=64,{count:points?.length,start,end});
 const dx=end.x-start.x,dy=end.y-start.y,dz=end.z-start.z;
 check(name+' collinear',points.every((p,i)=>{const t=i/(points.length-1);return close(p,pos(start.x+dx*t,start.y+dy*t,start.z+dz*t));}));return points;}
try{
 check('candidate '+version,(await rcon('version AgentFriend')).includes(version));
 await rcon('minecraft:gamerule doMobSpawning false');await rcon('minecraft:forceload add 96 94 164 112');
 await rcon('minecraft:fill 96 200 94 164 200 112 minecraft:stone');
 await rcon('minecraft:fill 105 201 99 107 209 102 minecraft:stone');
 await rcon('minecraft:setblock 122 205 100 minecraft:diamond_ore');
 const caster=await join('YsmReleaseQA'),other=await join('GuideOther'),target=await join('GuideTarget'),eye=await join('YsmReleaseQA_eye');
 await sleep(1700);
 for(const c of [caster,other,target]){await rcon('minecraft:gamemode creative '+c.name);await rcon('minecraft:item replace entity '+c.name+' weapon.mainhand with minecraft:air');}
 await teleport(caster);await teleport(other,100.5,201,95.5);await teleport(target,150.5,201,105.5);
 await until(()=>eye.cameras.some(p=>Object.values(p).includes(caster.bot.entity.id)),'actual Eye attachment');
 check('Eye actually attached',true);
 await rcon('minecraft:gamemode survival '+caster.name);
 if(process.env.GUIDE_PHASE!=='load'){
 await ask(caster,'/mycli skills learn prospect');await ask(caster,'/mycli skills learn sense');
 clear();await ask(caster,'/mycli cast prospect diamond');await until(()=>caster.lines.some(s=>s.includes('探矿术找到钻石矿')),'prospect cast');await sleep(800);
 const ore=pos(122.5,205.5,100.5),start=pos(100.5,202.2,100.5);
 const oreFrame=fullFrame('ore caster complete bearing beyond wall and 10 blocks',caster,start,ore);
 fullFrame('ore Eye complete bearing',eye,start,ore);
 check('private ore line absent for stranger',other.points.length===0,other.points.length);
 check('ore packets continue behind the wall',oreFrame.some(p=>p.x>108&&p.x<122));
 clear();await teleport(caster,100.5,201,102.5);await sleep(1100);
 fullFrame('ore start follows caster movement',caster,pos(100.5,202.2,102.5),ore);
 await rcon('minecraft:setblock 122 205 100 minecraft:air');await sleep(900);clear();await sleep(900);
 check('removed ore stops line',caster.points.length===0,caster.points.length);
 await rcon('minecraft:summon minecraft:husk 120.5 201 106.5 {Tags:["guide_enemy_qa"],NoAI:1b,NoGravity:1b,PersistenceRequired:1b}');
 await sleep(350);clear();await ask(caster,'/mycli cast sense');await until(()=>caster.lines.some(s=>s.includes('探敌术发现附近')),'sense cast');await sleep(600);
 const mob=Object.values(caster.bot.entities).find(e=>e.name==='husk'&&e.position.y>200);check('real hostile loaded',!!mob);
 // getHeight() is the real server height; this target is a normal adult husk (1.95 blocks).
 const enemy=pos(120.5,202.17,106.5);fullFrame('enemy caster complete bearing',caster,pos(100.5,202.2,102.5),enemy);fullFrame('enemy Eye complete bearing',eye,pos(100.5,202.2,102.5),enemy);
 check('private enemy line absent for stranger',other.points.length===0,other.points.length);
 clear();await rcon('minecraft:tp @e[tag=guide_enemy_qa,limit=1] 118.5 204 108.5');await sleep(1000);
 fullFrame('enemy endpoint follows target movement',caster,pos(100.5,202.2,102.5),pos(118.5,205.17,108.5));
 await rcon('minecraft:kill @e[tag=guide_enemy_qa]');await sleep(1200);clear();await sleep(900);
 check('dead enemy stops line',caster.points.length===0,caster.points.length);
 await ask(caster,'/mycli locate GuideTarget');await sleep(500);fullFrame('player tracking uses complete bearing',caster,pos(100.5,202.2,102.5),pos(150.5,202.2,105.5));
 clear();await teleport(target,145.5,204,108.5);await sleep(1100);fullFrame('player tracking follows moving target',caster,pos(100.5,202.2,102.5),pos(145.5,205.2,108.5));
 await ask(caster,'/mycli locate off');await sleep(400);clear();await sleep(900);check('stop player tracking stops line',caster.points.length===0);
 await rcon('minecraft:summon minecraft:villager 117.5 201 96.5 {Tags:["guide_merchant_qa"],NoAI:1b,NoGravity:1b,VillagerData:{type:"minecraft:plains",profession:"minecraft:farmer",level:1},Offers:{Recipes:[{buy:{id:"minecraft:wheat",count:20},sell:{id:"minecraft:emerald",count:1},maxUses:16}]}}');
 await sleep(400);const trader=Object.values(caster.bot.entities).find(e=>e.name==='villager'&&e.position.y>200);check('real merchant loaded',!!trader);
 await sleep(3200);await ask(caster,'/mycli trade locate '+trader.uuid);await sleep(600);fullFrame('merchant tracking uses complete bearing',caster,pos(100.5,202.2,102.5),pos(117.5,202.2,96.5));
 await ask(caster,'/mycli trade stop');await sleep(400);clear();await sleep(900);check('stop merchant tracking stops line',caster.points.length===0);
 }
 if(process.env.GUIDE_PHASE!=='features') {
 const pairs=[{body:caster,eye}];
 for(let i=0;i<15;i++){
  const name='GuideQ'+String(i).padStart(2,'0'),body=await join(name),camera=await join(name+'_eye');
  // Give actual player bodies space; packing them 0.1 blocks apart tests collisions instead of guide geometry.
  await rcon('minecraft:gamemode creative '+name);await rcon('minecraft:item replace entity '+name+' weapon.mainhand with minecraft:air');await teleport(body,97.5,201,94.5+i*1.1);
  await until(()=>camera.cameras.some(p=>Object.values(p).includes(body.bot.entity.id)),'attached '+name);pairs.push({body,eye:camera});
 }
 await teleport(target,150.5,201,108.5);clear();
 for(const pair of pairs)pair.body.bot.chat('/mycli locate GuideTarget');await sleep(4000);
 for(const pair of pairs){const s=pos(pair.body.bot.entity.position.x,202.2,pair.body.bot.entity.position.z),e=pos(150.5,202.2,108.5);
  check('16-pair complete line '+pair.body.name,!!frame(pair.body,s,e)&&!!frame(pair.eye,s,e),{bodyPackets:pair.body.points.length,eyePackets:pair.eye.points.length});
 }
 check('stranger has no other players guide lines',other.points.length===0,other.points.length);
 }
 report.samples.particle=caster.points[0];report.samples.mspt=await rcon('mspt');
 report.samples.cortieye=await rcon('cortieye');check('no client transport errors',report.errors.length===0,report.errors);
 report.passed=report.checks.length;
}catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{closing=true;report.messages=Object.fromEntries(clients.map(c=>[c.name,c.lines]));for(const c of clients){c.bot.quit('guide test complete');}writeFileSync(out,JSON.stringify(report,null,2));await sleep(600);}
