/** Inspect real protocol packets, rather than treating absence in bot.entities
 * as proof that the server never disclosed coordinates. Loopback QA only. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const [stage, output, runtimePackage] = process.argv.slice(2);
assert(stage && output && runtimePackage, 'stage, evidence file and installed Mineflayer package.json required');
const properties=stage+'/server.properties', config=fs.readFileSync(properties,'utf8');
assert.match(config,/^server-ip=127\.0\.0\.1\r?$/m);
const port=Number(/^server-port=(\d+)\r?$/m.exec(config)?.[1]),rcon=Number(/^rcon.port=(\d+)\r?$/m.exec(config)?.[1]);
assert(port===25982&&rcon===25983||port===25928&&rcon===25929,'dedicated loopback QA ports only');
if(port===25928)assert.equal(fs.readFileSync(stage+'/.qa-only','utf8'),'VORTEX_TAKEOVER_QA_ONLY');
const rc=q=>command(q,15000,{properties,port:rcon});
const mf=createRequire(runtimePackage)('mineflayer');
const bots=[], report={passed:false,checks:[],packetCounts:{},scope:'isolated Paper 1.21.1, raw entity packets; sounds and tab identity deliberately retained'};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
async function until(fn,label,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Timeout: '+label);}
const entity=(bot,uuid)=>Object.values(bot.entities).find(e=>e.uuid?.toLowerCase()===uuid.toLowerCase());
const spatial=new Set(['spawn_entity','named_entity_spawn','spawn_entity_living','entity_metadata','entity_equipment','entity_teleport','rel_entity_move','entity_move_look','entity_look','entity_velocity','entity_head_rotation','entity_status','entity_effect','remove_entity_effect','entity_update_attributes']);
async function connect(username){
  const bot=mf.createBot({host:'127.0.0.1',port,username,version:'1.21.1',auth:'offline',defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});
  bots.push(bot);bot.raw=[];bot.failures=[];bot.ids=new Map();
  bot._client.on('packet',(data,meta)=>{
    if(!spatial.has(meta.name))return;
    const id=data.entityId??data.entityID;
    if(data.objectUUID||data.playerUUID)bot.ids.set((data.objectUUID??data.playerUUID).toLowerCase(),id);
    bot.raw.push({name:meta.name,id});
  });
  bot.on('error',e=>bot.failures.push(e.message));bot.on('kicked',e=>bot.failures.push(JSON.stringify(e)));
  installRecipePacketBypass(bot._client);
  await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'spawn '+username);
  await sleep(700);
  await rc('minecraft:tp '+username+' 100.5 81 100.5');await sleep(700);return bot;
}
async function wall(block){await rc('minecraft:fill 104 81 90 104 88 110 minecraft:'+block);await sleep(400);}
async function summon(type,at='108.5 81 100.5',extra=''){
  const uuid=randomUUID(),bytes=Buffer.from(uuid.replaceAll('-',''),'hex'),ints=[0,4,8,12].map(i=>bytes.readInt32BE(i));
  await rc(`minecraft:summon minecraft:${type} ${at} {UUID:[I;${ints.join(',')}],NoAI:1b,NoGravity:1b,Invulnerable:1b,PersistenceRequired:1b,Tags:["raw_vision_qa"]${extra}}`);
  return uuid;
}
const packets=(bot,ids,from=0)=>bot.raw.slice(from).filter(p=>ids.includes(p.id));
try{
 await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule doDaylightCycle false');await rc('minecraft:time set midnight');
 await rc('minecraft:gamerule sendCommandFeedback false');await rc('minecraft:forceload add 90 90 180 110');
 await rc('minecraft:kill @e[tag=raw_vision_qa]');await rc('minecraft:fill 90 80 90 180 80 110 minecraft:stone');
 await rc('minecraft:fill 90 81 90 180 89 110 minecraft:air');await wall('stone');
 const agent=await connect('ag_RawVision'),human=await connect('RawControl'),eye=await connect('ag_Raw_eye');
 await rc('minecraft:gamemode spectator ag_Raw_eye');await sleep(600);
 const zombie=await summon('zombie'),item=await summon('item','108.5 81.5 102.5',',Item:{id:"minecraft:diamond",count:1}');
 await until(()=>human.ids.has(zombie)&&human.ids.has(item),'control receives known entity IDs');await sleep(800);
 const ids=[human.ids.get(zombie),human.ids.get(item)];report.packetCounts.initialAgent=packets(agent,ids).length;
 check('opaque living entity never receives an initial spawn packet',!agent.ids.has(zombie));
 check('opaque dropped item never receives an initial spawn packet',!agent.ids.has(item));
 check('no initial metadata, equipment or movement leaks for either hidden ID',packets(agent,ids).length===0);
 check('human and observer retain native visible entities',!!entity(human,zombie)&&!!entity(eye,zombie));
 await rc(`minecraft:tp ${zombie} 109.5 81 100.5`);
 await rc(`minecraft:data merge entity ${zombie} {Health:17f,HandItems:[{id:"minecraft:iron_axe",count:1},{}]}`);await sleep(800);
 await rc(`minecraft:attribute ${zombie} minecraft:generic.max_health base set 30`);await sleep(250);
 check('mutating an initially hidden entity sends no spatial or equipment packets',packets(agent,ids).length===0);
 for(const block of ['glass','tinted_glass','oak_fence','iron_bars']){
   await wall(block);await until(()=>entity(agent,zombie),'see through '+block);
   check('raw spawn resumes through '+block,agent.raw.some(p=>p.id===ids[0]&&p.name==='spawn_entity'));
 }
 check('visible entity equipment is actually delivered',agent.raw.some(p=>p.id===ids[0]&&p.name==='entity_equipment'));
 check('visible entity attributes are actually delivered',agent.raw.some(p=>p.id===ids[0]&&p.name==='entity_update_attributes'));
 await wall('stone');await until(()=>!entity(agent,zombie)&&!entity(agent,item),'entity removal after full cover');await sleep(400);
 const afterHidden=agent.raw.length;
 await rc(`minecraft:tp ${zombie} 108.5 81 100.5`);
 await rc(`minecraft:data merge entity ${zombie} {Health:16f,HandItems:[{id:"minecraft:diamond_sword",count:1},{}]}`);await sleep(1000);
 await rc(`minecraft:attribute ${zombie} minecraft:generic.max_health base set 40`);await sleep(250);
 report.packetCounts.afterHidden=packets(agent,ids,afterHidden).length;
 check('previously visible entity stops all subsequent spatial/gear updates behind a wall',packets(agent,ids,afterHidden).length===0);
 await rc('minecraft:fill 104 81 90 104 81 110 minecraft:air');await sleep(700);
 check('a partly exposed body is restored',!!entity(agent,zombie));
 await wall('stone');await until(()=>!entity(agent,zombie),'full cover restored');
 await rc('minecraft:tp ag_RawVision 106.5 81 100.5');await until(()=>entity(agent,zombie),'observer rounds the wall');
 check('moving around cover re-enables native spawn and state',!!entity(agent,zombie));
 await rc('minecraft:tp ag_RawVision 100.5 81 100.5');await wall('air');
 // The ordinary control must remain inside vanilla's own tracking range.
 // This tests the Agent's 64-block filter, not Spigot's monster range.
 await rc('minecraft:tp RawControl 138.5 81 100.5');await sleep(700);
 await rc(`minecraft:tp ${zombie} 166.5 81 100.5`);await sleep(1500);
 check('range fixture chunk is loaded by both real clients',!!agent.world.getColumnAt({x:166,y:81,z:100})&&!!human.world.getColumnAt({x:166,y:81,z:100}));
 check('test control still tracks the same target beyond 64 blocks',!!entity(human,zombie));
 check('Agent no longer receives the distant target',!entity(agent,zombie));
 const farStart=agent.raw.length;await rc(`minecraft:tp ${zombie} 167.5 81 100.5`);await sleep(800);
 check('distant target movement is not forwarded',packets(agent,[ids[0]],farStart).length===0);
 const source=await connect('RawTabSource');await rc('minecraft:tp RawTabSource 108.5 81 103.5');await wall('stone');await sleep(1000);
 check('hidden player keeps vanilla UUID and online identity',!!agent.players.RawTabSource&&!entity(agent,source.player.uuid));
 check('all native protocol clients remain connected',bots.every(b=>!b._client.ended&&b.failures.length===0));
 const stats=await rc('agentvision status');report.stats=JSON.parse(stats.slice(stats.indexOf('{'),stats.lastIndexOf('}')+1));
 check('round-robin work remains within its count budget',report.stats.peakChecks<=report.stats.maxChecks&&report.stats.peakVisits<=512);
 report.passed=true;
}catch(error){report.error=error.stack;throw error;}
finally{
 for(const bot of bots)bot.quit('raw visibility QA finished');await sleep(600);
 fs.writeFileSync(output,JSON.stringify(report,null,2));
}
