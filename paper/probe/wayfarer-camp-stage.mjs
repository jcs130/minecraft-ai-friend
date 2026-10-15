import fs from 'node:fs';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{setTimeout as sleep}from'node:timers/promises';import{command}from'file:///E:/MC/ops/rcon-client.mjs';
import{installRecipePacketBypass}from'file:///E:/MC/ops/mineflayer-client-compat.mjs';import{fix1206PotionProtocol}from'file:///E:/MC/ops/minecraft-1206-potion.mjs';
// Operates only on an explicitly marked loopback clone. Creates throwaway
// players, places/digs one test dirt block, and kills those test players.
const stage=process.env.MC_CAMP_STAGE??'E:/MC/ops/repairs/wayfarer-spawn-20261015/lab/paper';
const root=process.env.MC_CAMP_EVIDENCE??stage+'/..';
assert(fs.existsSync(stage+'/../.wayfarer-isolated'),'Mark and isolate the cloned lab first');
const properties=fs.readFileSync(stage+'/server.properties','utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(properties),'Only loopback servers');
const gamePort=Number(properties.match(/^server-port=(\d+)$/m)?.[1]);
const rconPort=Number(properties.match(/^rcon\.port=(\d+)$/m)?.[1]);
assert(gamePort>1024&&rconPort>1024&&gamePort!==25565&&rconPort!==25575,'Never test production ports');
const prefix='ag_W'+Date.now().toString(36).slice(-6),file=root+'/wayfarer-qa-'+Date.now()+'.json';
const req=createRequire(process.env.MC_CAMP_MINEFLAYER_PACKAGE??'E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const {Vec3}=req('vec3'),rc=q=>command(q.replaceAll('ag_Camp4',prefix),20000,{port:rconPort,properties:stage+'/server.properties'});
const out={at:new Date().toISOString(),checks:[],spawns:[],errors:[],privateGuide:[],otherMessages:[],productionChanged:false,physicalDevicesVerified:false};const bots=[];
function check(name,ok){assert(ok,name);out.checks.push(name);console.log('PASS '+name);}
async function until(fn,label,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Timeout '+label);}
async function connect(name,version='1.21.1'){
 name=name.replace('ag_Camp4',prefix);
 const bot=req('mineflayer').createBot({host:'127.0.0.1',port:gamePort,username:name,auth:'offline',version,defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});
 bots.push(bot);installRecipePacketBypass(bot._client);bot.on('error',e=>out.errors.push({name,message:e.message}));
 await until(()=>bot.entity&&bot.game.dimension==='overworld'&&bot.blockAt(bot.entity.position.offset(0,-1,0)),'spawn and real floor '+name,45000);await sleep(1500);return bot;
}
const block=(bot,x,y,z)=>bot.blockAt(new Vec3(x,y,z));
try{
 check('same deployed plugin version',(await rc('version AgentFriend')).includes('0.4.41'));
 const first=await connect('ag_Camp4A'),other=await connect('ag_Camp4B');
 first.on('messagestr',s=>out.privateGuide.push(s));other.on('messagestr',s=>out.otherMessages.push(s));
 for(const bot of[first,other])out.spawns.push({name:bot.username,position:bot.entity.position.clone()});
 for(let i=0;i<4;i++){const b=await connect('ag_Camp4'+String.fromCharCode(67+i),i%2?'1.21.1':'1.20.6');out.spawns.push({name:b.username,position:b.entity.position.clone()});b.quit();await sleep(300);}
 check('six independent newcomers land in the native random square',out.spawns.every(({position:p})=>p.x>=-1128&&p.x<-1103&&p.z>=-612&&p.z<-587&&p.y>=63.9&&p.y<=66.1));
 check('newcomers receive different actual random coordinates',new Set(out.spawns.map(s=>Math.floor(s.position.x)+','+Math.floor(s.position.z))).size>=3);
 let unsafe=[];for(let x=-1128;x<=-1104;x++)for(let z=-612;z<=-588;z++){
  let y=100;while(y>=58&&!['grass_block','dirt','dirt_path','coarse_dirt','granite','stone','andesite','diorite','iron_ore','coal_ore','copper_ore','terracotta','white_terracotta'].includes(block(first,x,y,z)?.name))y--;
  const floor=block(first,x,y,z),feet=block(first,x,y+1,z),head=block(first,x,y+2,z);
  const upper=[];for(let yy=y+1;yy<=100;yy++){const b=block(first,x,yy,z);if(b?.boundingBox==='block'||b?.name==='water'||b?.name==='lava')upper.push({y:yy,name:b?.name});}
  if(y<63||y>65||floor?.boundingBox!=='block'||feet?.boundingBox==='block'||head?.boundingBox==='block'||upper.length)unsafe.push({x,z,y,upper});
 }
 out.unsafe=unsafe;check('all 625 possible landing columns have solid safe floor and no roofs',unsafe.length===0);
 await rc('minecraft:tp ag_Camp4A -1115.5 64 -599.5');await sleep(700);
 first.chat('/mycli protect break -1116 63 -600 --json');await until(()=>out.privateGuide.some(s=>s.startsWith('MC_PROTECTION ')),'native ground protection receipt');
 const access=out.privateGuide.filter(s=>s.startsWith('MC_PROTECTION ')).at(-1);check('unprivileged newcomer can mine natural spawn ground',JSON.parse(access.slice(access.indexOf('{'))).allowed===true);
 // Exercise real inventory interaction and server acknowledgement, then restore
 // this isolated test block. No production player inventory is involved.
 await rc('minecraft:give ag_Camp4A minecraft:dirt 2');await until(()=>first.inventory.items().some(i=>i.name==='dirt'),'dirt sync');
 const target=new Vec3(-1115,64,-600),base=block(first,-1115,63,-600),before=base.name;
 await first.equip(first.inventory.items().find(i=>i.name==='dirt'),'hand');await first.placeBlock(base,new Vec3(0,1,0));await until(()=>first.blockAt(target)?.name==='dirt','placed block receipt');
 await first.dig(first.blockAt(target));await until(()=>first.blockAt(target)?.name==='air','dig receipt');check('real ordinary place and dig completes outside landmarks',true);
 await rc('minecraft:tp ag_Camp4A -1090.5 67 -630.5');await sleep(800);
 const from=out.privateGuide.length;first.chat('/mycli protect break -1088 67 -631 --json');await until(()=>out.privateGuide.slice(from).some(s=>s.startsWith('MC_PROTECTION ')),'tower denial');
 const denial=out.privateGuide.slice(from).find(s=>s.startsWith('MC_PROTECTION '));check('tower structure remains protected',JSON.parse(denial.slice(denial.indexOf('{'))).allowed===false);
 const door=block(first,-1089,67,-631);check('blueprint has a functional native entrance',door?.name==='oak_door');await first.activateBlock(door);await until(()=>block(first,-1089,67,-631)?.getProperties().open===true,'door opens');check('ordinary visitor opens protected tower door',true);
 check('twenty-one native ladder rungs remain continuous',Array.from({length:21},(_,i)=>block(first,-1086,67+i,-631)?.name).every(n=>n==='ladder'));
 await rc('minecraft:tp ag_Camp4A -1098.5 65 -598.4');await rc('minecraft:tp ag_Camp4B -1096.5 65 -598.4');await sleep(1300);
 const guide=Object.values(first.entities).find(e=>e.name==='villager'&&e.position.distanceTo(new Vec3(-1098.5,65,-600.5))<2);check('actual native villager NPC reaches ordinary client',!!guide);
 out.privateGuide.length=0;out.otherMessages.length=0;await first.activateEntity(guide);await until(()=>out.privateGuide.some(s=>s.includes('欢迎来到千灯纪旅人营地'))&&out.privateGuide.some(s=>s.startsWith('MC_INTRO ')),'NPC private intro');
 check('guide explains camp, town and personal backpack',out.privateGuide.some(s=>s.includes('主城在东偏南'))&&out.privateGuide.some(s=>s.includes('54格个人大背包')));
 check('guide opens the existing vanilla travel-guide menu',JSON.stringify(first.currentWindow?.title??'').includes('旅途'));
 check('NPC introduction and machine receipts do not reach bystander',!out.otherMessages.some(s=>/欢迎来到千灯纪旅人营地|MC_INTRO |54格个人大背包/.test(s)));
 if(first.currentWindow)first.closeWindow(first.currentWindow);
 // Actual night-time bed use keeps native bed priority over the world spawn.
 await rc('minecraft:time set night');await rc('minecraft:tp ag_Camp4A -1136.5 64 -573.5');await sleep(800);
 const bed=block(first,-1138,64,-574);check('tent contains a real usable bed',bed?.name==='white_bed');
 await first.sleep(bed);await sleep(500);if(first.isSleeping)await first.wake();await sleep(500);
 await rc('minecraft:kill ag_Camp4A');await until(()=>first.health>0&&Math.abs(first.entity.position.x+1138)<5&&Math.abs(first.entity.position.z+574)<5,'native bed respawn',20000);
 check('bed respawn retains priority over randomized camp spawn',true);
 await rc('minecraft:kill ag_Camp4B');await until(()=>other.health>0&&Math.abs(other.entity.position.x+1116)<=13&&Math.abs(other.entity.position.z+600)<=13,'no-bed respawn',20000);check('ordinary no-bed respawn follows the new safe spawn',true);
 await rc('minecraft:tp ag_Camp4B -1071.5 67 -607.5');await sleep(800);const returnPosition=other.entity.position.clone();other.quit();await sleep(1000);
 const rejoined=await connect('ag_Camp4B');check('returning player reconnects at saved location',rejoined.entity.position.distanceTo(returnPosition)<1.5);
 const nativeConfig=await rc('minecraft:gamerule spawnRadius');check('random radius is native persisted game rule',nativeConfig.includes('12'));
 check('no client transport errors',out.errors.length===0);out.passed=true;
}catch(e){out.error=e.stack;console.log(out.error);process.exitCode=1;}
finally{for(const b of bots)try{b.quit();}catch{};await sleep(500);fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({passed:out.passed,checks:out.checks.length,error:out.error}));process.exit(process.exitCode??0);}
