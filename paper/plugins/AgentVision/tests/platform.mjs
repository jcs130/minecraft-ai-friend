import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
const [stage,out,platform]=process.argv.slice(2);
assert(['vanilla-chunk-map','paper-moonrise'].includes(platform));
const properties=stage+'/server.properties',text=fs.readFileSync(properties,'utf8');
assert(/^server-ip=127\.0\.0\.1\r?$/m.test(text));
const port=Number(text.match(/^server-port=(\d+)/m)[1]),rcon=Number(text.match(/^rcon.port=(\d+)/m)[1]);
assert([29395,29397].includes(port));assert.equal(rcon,port+1);
const rc=q=>command(q,15000,{properties,port:rcon});
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const bots=[],result={checks:[],passed:false,platform};
const check=(name,value)=>{assert(value,name);result.checks.push(name);console.log('PASS '+name);};
async function until(fn,label){for(let n=0;n<100;n++){if(await fn())return;await sleep(100);}throw Error('Timeout: '+label);}
const entity=(bot,id)=>Object.values(bot.entities).find(e=>e.uuid===id);
const status=async()=>{const s=await rc('agentvision status');return JSON.parse(s.slice(s.indexOf('{'),s.lastIndexOf('}')+1));};
try{
 check('enabled with resolved native platform',(await status()).platform===platform);
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule keepInventory true');
 await rc('minecraft:forceload add 94 94 116 108');await rc('minecraft:fill 94 94 94 116 94 108 stone');
 await rc('minecraft:fill 94 95 94 116 100 108 air');
 for(const username of ['ag_VisionCheck','VisionHuman']){
  const bot=require('mineflayer').createBot({host:'127.0.0.1',port,username,version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});bots.push(bot);bot.physicsEnabled=false;bot.failures=[];bot.on('error',e=>bot.failures.push(e.message));
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);});
  await rc('minecraft:gamemode survival '+username);await rc('minecraft:tp '+username+' '+(username==='VisionHuman'?'108.5':'100.5')+' 95 100.5');
 }
 const [agent,human]=bots;let leaves=0,joins=0;agent.on('playerLeft',p=>{if(p.username===human.username)leaves++;});agent.on('playerJoined',p=>{if(p.username===human.username)joins++;});
 const pig=randomUUID(),bytes=Buffer.from(pig.replaceAll('-',''),'hex'),ints=[0,4,8,12].map(n=>bytes.readInt32BE(n));
 await rc('minecraft:summon pig 108.5 95 101.5 {UUID:[I;'+ints.join(',')+'],NoAI:1b,NoGravity:1b,Invulnerable:1b,Tags:["vision_platform_qa"]}');
 await until(()=>entity(agent,pig)&&entity(agent,human.player.uuid),'clear sight');check('visible real mob and player',true);
 for(let i=0;i<3;i++){
  await rc('minecraft:fill 104 95 94 104 100 106 stone');
  await until(()=>!entity(agent,pig)&&!entity(agent,human.player.uuid),'occluded');check('stone occludes mob and player '+i,true);
  check('spatial hide retains player-list identity '+i,!!agent.players.VisionHuman);
  await rc('minecraft:fill 104 95 94 104 100 106 glass');
  await until(()=>entity(agent,pig)&&entity(agent,human.player.uuid),'transparent reveal');check('glass resumes pairing '+i,true);
 }
 check('no synthetic join or quit events',leaves===0&&joins===0);
 await rc('minecraft:fill 104 95 94 104 100 106 oak_fence');await until(()=>entity(agent,pig),'partial shape sight');check('partial collision does not become full occlusion',true);
 await rc('minecraft:spawnpoint ag_VisionCheck 100 95 100');await rc('minecraft:kill ag_VisionCheck');await sleep(500);agent._client.write('client_command',{actionId:0});await sleep(1200);
 await rc('minecraft:tp ag_VisionCheck 100.5 95 100.5');await until(()=>entity(agent,pig),'respawn stream');check('death/respawn resumes real entity stream',true);
 const before=await status();await sleep(1200);const after=await status();
 check('round-robin actually advances',after.visits>before.visits&&after.enabled===true);check('configured work budget retained',after.maxChecks===128&&after.peakChecks<=128&&after.budgetMicros===2000);
 check('both actual clients remain connected',bots.every(b=>!b._client.ended&&b.failures.length===0));
 result.counters=after;result.passed=true;
}catch(error){result.error=String(error.stack);throw error;}
finally{for(const bot of bots)if(!bot._client.ended)bot.quit();await sleep(200);fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
