import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { command } from '../../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../../ops/mineflayer-client-compat.mjs';

const [stage, output, mode] = process.argv.slice(2);
const properties=stage+'/server.properties', text=fs.readFileSync(properties,'utf8');
assert.match(text,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(text,/^server-port=25982\r?$/m);assert.match(text,/^rcon.port=25983\r?$/m);
assert(['baseline','candidate'].includes(mode));
const rc=q=>command(q,15000,{properties,port:25983});
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const bots=[],report={mode,checks:[],passed:false};
const check=(name,pass)=>{assert.ok(pass,name);report.checks.push(name);console.log('PASS '+name);};
async function until(fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Lifecycle condition timed out');}
try {
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule keepInventory true');
 await rc('minecraft:fill 94 80 94 116 80 108 minecraft:stone');await rc('minecraft:fill 104 81 94 104 86 106 minecraft:stone');
 for(const username of ['ag_VisionLife','VisionLifeHuman']) {
  const bot=req('mineflayer').createBot({host:'127.0.0.1',port:25982,username,auth:'offline',version:'1.21.1',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});
  bots.push(bot);bot.physicsEnabled=false;bot.errors=[];bot.on('error',e=>bot.errors.push(e.message));installRecipePacketBypass(bot._client);
  await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position));
  await rc('minecraft:tp '+username+' 100.5 81 100.5');await rc('minecraft:gamemode survival '+username);
 }
 await rc('minecraft:kill @e[tag=vision_qa]');
 const pigUuid=randomUUID(),uuidBytes=Buffer.from(pigUuid.replaceAll('-',''),'hex'),uuidInts=[0,4,8,12].map(i=>uuidBytes.readInt32BE(i));
 await rc('minecraft:summon pig 108.5 81 100.5 {UUID:[I;'+uuidInts.join(',')+'],NoAI:1b,NoGravity:1b,Invulnerable:1b,PersistenceRequired:1b,Tags:["vision_qa"]}');await sleep(1000);
 const raw=await rc('agentvisionlifecycle ag_VisionLife');const value=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));report.fixture=value;
 check('transient loader safely restored even in old failure',value.loaderRestored);
 check('test exercised real pending targets',value.queuedBefore>0&&value.trackedBefore>0);
 check(mode==='baseline'?'old production bytecode reproduces exact NPE':'candidate defers detached chunk stream',value.npe===(mode==='baseline'));
 if(mode==='candidate') {
  check('detached stream retains queue and visibility',value.queueRetained);
  check('round robin retains viewer',value.otherViewersStillQueued);
  for(let i=0;i<3;i++) {
   await rc('minecraft:spawnpoint ag_VisionLife 100 81 100');
   await rc('minecraft:kill ag_VisionLife');await sleep(400);
   bots[0]._client.write('client_command',{actionId:0});
   await until(async()=>/20\.0f/.test(await rc('minecraft:data get entity ag_VisionLife Health')));
   check('real death and respawn cycle '+(i+1),true);
  }
  await rc('minecraft:tp ag_VisionLife 100.5 81 100.5');
  await rc('minecraft:fill 104 81 94 104 86 106 minecraft:glass');
  await until(()=>Object.values(bots[0].entities).some(e=>e.uuid===pigUuid));
  check('real respawn resumes actual network target visibility',true);
  await rc('minecraft:fill 104 81 94 104 86 106 minecraft:stone');
  await until(()=>!Object.values(bots[0].entities).some(e=>e.uuid===pigUuid));
  check('respawn does not leave permanent reveals or frozen queues',true);
  await rc('minecraft:execute in minecraft:the_nether run minecraft:tp ag_VisionLife 100.5 110 100.5');await sleep(500);
  await rc('minecraft:execute in minecraft:overworld run minecraft:tp ag_VisionLife 100.5 81 100.5');await sleep(1000);
  const status=await rc('agentvision status');check('filter runs after world transfer',status.includes('"enabled":true'));
  check('protocol clients retain connection',bots.every(b=>!b._client.ended&&b.errors.length===0));
 }
 report.passed=true;
} catch(error){report.error=error.stack;throw error;}
finally {for(const bot of bots)bot.quit();await sleep(500);fs.writeFileSync(output,JSON.stringify(report,null,2));}
