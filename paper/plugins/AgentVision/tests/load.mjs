import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
const [stage,output]=process.argv.slice(2);
assert(stage&&output);
const properties=stage+'/server.properties', cfg=fs.readFileSync(properties,'utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(cfg));
const port=Number(cfg.match(/^server-port=(\d+)/m)[1]),rcon=Number(cfg.match(/^rcon.port=(\d+)/m)[1]);
assert(port!==25565&&rcon!==25575);
const rc=q=>command(q,20000,{properties,port:rcon});
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const bots=[],checks=[];
const result={checks,passed:false,clients:16,scope:'protocol and visibility load, no LLM workload'};
const check=(s,v)=>{assert(v,s);checks.push(s);console.log('PASS '+s);};
async function stats(){const s=await rc('agentvision status');return JSON.parse(s.slice(s.indexOf('{'),s.lastIndexOf('}')+1));}
try{
 await rc('minecraft:forceload add 94 94 116 108');
 await rc('minecraft:fill 94 80 94 116 80 108 minecraft:stone');
 await rc('minecraft:fill 104 81 94 104 86 106 minecraft:stone');
 await rc('minecraft:kill @e[tag=vision_qa]');
 for(let i=0;i<16;i++){
  const bot=req('mineflayer').createBot({host:'127.0.0.1',port,username:'ag_VLoad'+String(i).padStart(2,'0'),version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});
  bot.physicsEnabled=false;bot.errors=[];bots.push(bot);
  installRecipePacketBypass(bot._client);
  bot.on('error',e=>bot.errors.push(e.message));bot.on('kicked',r=>bot.errors.push(JSON.stringify(r)));
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);});
  await rc(`minecraft:tp ${bot.username} 100.5 81 ${98.5+(i%4)}`);
 }
 for(let i=0;i<32;i++)await rc(`minecraft:summon minecraft:pig 108.5 81 ${98.5+(i%4)} {NoAI:1b,NoGravity:1b,PersistenceRequired:1b,Tags:["vision_qa"]}`);
 await sleep(3500);
 const start=await stats();result.before=start;
 check('16 network Agents managed',start.viewers===16);
 check('512 hidden target relationships tracked',start.targets>=512);
 const samples=[];
 for(let i=0;i<8;i++){await sleep(1000);samples.push(await stats());}
 result.samples=samples;result.mspt=await rc('mspt');result.tps=await rc('tps');
 const end=samples.at(-1);
 check('steady hidden entities do not flap hide/show',end.shows-start.shows<=16);
 check('bounded work continues for all clients',end.checks>start.checks);
 check('per-tick check count obeys configured bound',end.peakChecks<=end.maxChecks);
 // A validated shared hint skips the whole query, so its savings do not increment per-ray shapeSkips.
 // Each such proof avoids at least one full-world ray; the uncached implementation keeps its original assertion.
 const avoided=(end.shapeSkips-start.shapeSkips)+(end.hintHits??0)-(start.hintHits??0);
 check('verified occluder reuse reduces full-world ray traversals',avoided>(end.worldRays-start.worldRays));
 check('all 16 clients remain connected',bots.every(b=>b._client.state==='play'&&b.errors.length===0));
 if('hintHits' in end){
  check('shared terrain hints eliminate repeated world traversals',end.hintHits-start.hintHits>(end.checks-start.checks)/3);
  check('terrain hint storage remains bounded',end.hintEntries<=1024);
  check('queue visit work respects its configured cap',end.peakVisits<=512);
 }
 if(process.env.VISION_BENCH==='1'){
  const reply=await rc('agentvisionbench');
  assert(reply.includes('MC_VISION_BENCH'),'test-only benchmark plugin missing');
  result.hiddenBenchmark=JSON.parse(reply.slice(reply.indexOf('{'),reply.lastIndexOf('}')+1));
  check('read-only benchmark sees all pairs hidden',result.hiddenBenchmark.visiblePairs===0);
 }
 await rc('minecraft:fill 104 81 94 104 86 106 minecraft:glass');
 await sleep(2200);
 check('all 16 clients regain exposed targets',bots.every(b=>Object.values(b.entities).filter(e=>e.name==='pig').length>=32));
 if(process.env.VISION_BENCH==='1'){
  const reply=await rc('agentvisionbench');
  result.openBenchmark=JSON.parse(reply.slice(reply.indexOf('{'),reply.lastIndexOf('}')+1));
  check('read-only benchmark sees all exposed pairs',result.openBenchmark.visiblePairs===512);
 }
 result.after=await stats();
 if('queuedViewers' in result.after){
  bots.forEach(b=>b.quit());await sleep(750);
  result.afterDisconnect=await stats();
  check('disconnect releases all 16 viewer queues',result.afterDisconnect.viewers===0&&result.afterDisconnect.queuedViewers===0);
 }
 result.passed=true;
}catch(e){result.error=String(e.stack??e);throw e;}
finally{bots.forEach(b=>b.quit());await sleep(500);fs.writeFileSync(output,JSON.stringify(result,null,2));}
