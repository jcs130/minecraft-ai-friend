// Real native packets on an isolated copied world; never run production combat.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage=process.env.MC_RESCUE_STAGE??'E:/MC/staging/trial-rescue-feedback-20261013/paper';
const output=process.env.MC_TEST_REPORT_DIR??'E:/MC/ops/repairs/trial-rescue-feedback-20261013';
assert(stage.toLowerCase().includes('/staging/'));
const props=fs.readFileSync(stage+'/server.properties','utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25662\r?$/m);assert.match(props,/^rcon.port=25663\r?$/m);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const report={at:new Date().toISOString(),checks:[],errors:[],samples:{},fixtures:[],sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.35.jar')).digest('hex')};
const bots=[],bePackets=[],beTexts=[];let bedrock,closing=false;
const rc=async q=>{const answer=await command(q,15000,{port:25663,properties:stage+'/server.properties'});report.fixtures.push({q,answer});return answer;};
function check(name,ok){report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);}
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(100);}throw Error('Timeout '+label);}
async function join(username){
 await rc('minecraft:whitelist add '+username);
 const b=req('mineflayer').createBot({host:'127.0.0.1',port:25662,username,auth:'offline',version:'1.20.6',checkTimeoutInterval:60000});
 bots.push(b);installRecipePacketBypass(b._client);b.lines=[];b.bars=[];b.particles=[];b.sounds=[];b.cameras=[];b.deaths=0;
 b.on('messagestr',s=>b.lines.push(s));b.on('death',()=>b.deaths++);
 b.on('error',e=>{if(!closing)report.errors.push(username+': '+e.message);});
 b.on('kicked',e=>{if(!closing)report.errors.push(username+': '+JSON.stringify(e));});
 b._client.on('boss_bar',p=>b.bars.push(p));b._client.on('world_particles',p=>b.particles.push(p));b._client.on('sound_effect',p=>b.sounds.push(p));b._client.on('camera',p=>b.cameras.push(p.cameraId));
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),username+' decoded world',45000);return b;
}
async function chat(b,q){await sleep(Math.max(0,1100-(Date.now()-(b.lastChat??0))));b.lastChat=Date.now();b.chat(q);}
async function state(b){const s=await rc('trialrescueqa state '+b.username);assert(s.startsWith('TRIAL_QA_STATE '),s);return JSON.parse(s.slice('TRIAL_QA_STATE '.length));}
async function tp(b,x,y,z){const name=typeof b==='string'?b:b.username;await rc(`minecraft:tp ${name} ${x} ${y} ${z}`);if(typeof b!=='string')await until(()=>b.entity.position.distanceTo({x,y,z})<1.1,'teleport '+name);await sleep(200);}
const matching=(b,id)=>b.bars.filter(p=>p.entityUUID===id);
async function down(b){await rc('minecraft:damage '+b.username+' 1000 minecraft:generic_kill');await until(async()=>(await state(b)).downed,'lethal damage downs player');return (await state(b)).downedTeammates.find(t=>t.uuid===b.player.uuid);}
try{
 check('candidate enabled',(await rc('version AgentFriend')).includes('0.4.35'));
 const a=await join('ag_Rev35A'),b=await join('ag_Rev35B'),other=await join('ag_Rev35C'),eye=await join('ag_Rev35A_eye');
 await until(()=>eye.game.gameMode==='spectator'&&eye.cameras.at(-1)===a.entity.id,'real Eye attachment');check('real attached Eye',true);
 const beReq=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json');
 bedrock=beReq('bedrock-protocol').createClient({host:'127.0.0.1',port:19172,version:'1.26.51',offline:true,username:'RescueBE35',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:20000});
 let beSpawn=false;bedrock.on('session',p=>{p.xuid='9000000987435';});bedrock.on('spawn',()=>beSpawn=true);
 bedrock.on('text',p=>beTexts.push(p));for(const type of ['boss_event','level_event','level_event_generic','spawn_particle_effect','play_sound'])bedrock.on(type,p=>bePackets.push({type,data:p}));
 bedrock.on('error',e=>{if(!closing)report.errors.push('Bedrock '+e.message);});await until(()=>beSpawn,'Bedrock spawn',45000);check('real Bedrock protocol connected',true);
 await rc('trialrescueqa reset');await rc('minecraft:gamerule naturalRegeneration false');
 for(const name of [a.username,b.username,'.RescueBE35']){await rc('minecraft:gamemode survival '+name);await rc('minecraft:effect give '+name+' minecraft:resistance 99999 4 true');await tp(name,-593.5,91,-312.5);}
 await rc('minecraft:gamemode spectator '+other.username);
 await chat(a,'/mycli arena difficulty normal');await chat(a,'/mycli arena start');
 await until(async()=>(await rc('mycli admin dungeonaudit')).includes('MC_DUNGEON_MOB floor=1'),'normal trial starts');
 await rc('minecraft:execute as @e[tag=afu_dungeon_mob] run data merge entity @s {NoAI:1b}');await sleep(800);
 const pos=a.entity.position.clone();await tp(b,pos.x+8,pos.y,pos.z);await tp('.RescueBE35',pos.x+9,pos.y,pos.z);await tp(other,pos.x,pos.y,pos.z);
 const before=a.bars.length,otherParticles=other.particles.length;
 const anchor=await down(a);await sleep(1400);
 const bar=a.bars.slice(before).find(p=>p.action===0&&JSON.stringify(p.title).includes('倒地'));
 report.samples.initialBars=a.bars.slice(before);assert(bar,'downed bar exists');const id=bar.entityUUID;
 check('lethal damage has no death and retains one HP',a.deaths===0&&a.health===1);
 check('waiting status identifies zero progress and full remaining time',anchor.phase==='waiting'&&anchor.progress===0&&anchor.remainingMs===10000);
 check('all teammates see the waiting bar',matching(b,id).some(p=>p.action===0));
 check('nonparticipant spectator gets no rescue bar',!matching(other,id).length);
 check('private gold radius particles exist',a.particles.some(p=>JSON.stringify(p.particle).includes('dust')));
 check('outsider receives no rescue marker particles',!other.particles.slice(otherParticles).some(p=>JSON.stringify(p.particle).includes('dust')));
 check('waiting bar is stable, without repeated remove/add',matching(a,id).filter(p=>p.action===0).length===1&&!matching(a,id).some(p=>p.action===1));
 await tp(b,anchor.x+3,anchor.y,anchor.z);await sleep(2600);
 let s=(await state(a)).downedTeammates[0];report.samples.progress=s;
 check('live machine progress includes rescuer and remaining milliseconds',s.phase==='rescuing'&&s.progress>.15&&s.progress<.6&&s.remainingMs===10000-s.progressMs&&s.rescuerName===b.username);
 check('native bar shows percentage and remaining seconds',matching(a,id).some(p=>p.action===3&&JSON.stringify(p.title).includes('%')&&JSON.stringify(p.title).includes('剩余')));
 check('native progress advances smoothly on same bar',matching(a,id).filter(p=>p.action===2&&p.health>0&&p.health<1).length>=5);
 check('Eye receives same native rescue bar',matching(eye,id).some(p=>p.action===0)&&matching(eye,id).some(p=>p.action===2&&p.health>0));
 const beBar=bePackets.find(p=>p.type==='boss_event'&&p.data.type==='show_bar'&&p.data.title?.includes(a.username));
 check('Bedrock receives native rescue title and progress',beBar&&bePackets.some(p=>p.type==='boss_event'&&p.data.target_entity_id===beBar.data.target_entity_id&&p.data.progress>0&&p.data.progress<1));
 // Diagnostic minecraft-data labels are older than Cloudburst 2193. Verify
 // actual packed RGB and coordinates, not its misleading particle name string.
 check('Bedrock receives gold four-block rescue circle',bePackets.some(p=>p.type==='level_event'&&(p.data.data&0xffffff)===0xffbe41&&Math.abs(Math.hypot(p.data.position.x-anchor.x,p.data.position.z-anchor.z)-4)<.002));
 check('Bedrock receives green progress colour',bePackets.some(p=>p.type==='level_event'&&(p.data.data&0xffffff)===0x41e687));
 const interrupts=a.lines.length;await tp(b,anchor.x+8,anchor.y,anchor.z);await sleep(600);s=(await state(a)).downedTeammates[0];
 check('leaving range resets progress and reports interruption',s.phase==='waiting'&&s.progressMs===0&&a.lines.slice(interrupts).some(l=>l.includes('status=interrupted')));
 await sleep(1300);check('interruption does not repeat-spam',a.lines.slice(interrupts).filter(l=>l.includes('status=interrupted')).length===1);
 await tp(b,anchor.x+3,anchor.y,anchor.z);await sleep(2000);check('previous elapsed time is not reused',(await state(a)).downed&&a.health===1);
 const reviveParticles=a.particles.length,reviveSounds=a.sounds.length;
 await until(async()=>!(await state(a)).downed,'ten-second rescue',14000);await sleep(400);
 check('nearby rescue restores health once without death',a.deaths===0&&a.health===10&&a.lines.filter(l=>l.includes('status=revived reason=nearby_teammate')).length===1);
 check('completed rescue removes bar once',matching(a,id).filter(p=>p.action===1).length===1&&matching(a,id).filter(p=>p.action===0).length===1);
 check('revival emits heart and light particles',a.particles.slice(reviveParticles).some(p=>JSON.stringify(p.particle).includes('heart'))&&a.particles.slice(reviveParticles).some(p=>JSON.stringify(p.particle).includes('end_rod')));
 check('revival sound delivered',a.sounds.length>reviveSounds);
 await tp(b,anchor.x+8,anchor.y,anchor.z);await down(a);await rc('trialrescueqa clear');
 await until(async()=>!(await state(a)).downed,'floor-clear resurrection',9000);
 check('clearing the floor still revives teammates',a.lines.some(l=>l.includes('status=revived reason=room_cleared'))&&a.deaths===0);
 check('Bedrock removes completed rescue bar',bePackets.some(p=>p.type==='boss_event'&&p.data.target_entity_id===beBar.data.target_entity_id&&p.data.type==='hide_bar'));
 check('Bedrock receives revival sound',bePackets.some(p=>p.type==='play_sound'&&p.data.name==='beacon.activate'));
 const log=fs.readFileSync(stage+'/logs/latest.log','utf8');check('rescue lifecycle has durable diagnostic reasons',['status=downed','status=rescuing','status=interrupted','status=revived','reason=room_cleared','reason=nearby_teammate'].every(v=>log.includes(v)));
 report.samples.bedrock=bePackets;report.samples.particleKinds=[...new Set(a.particles.map(p=>JSON.stringify(p.particle)))].slice(0,15);
 check('no protocol errors',report.errors.length===0);report.passed=true;
}catch(e){report.failure=String(e.stack);process.exitCode=1;}
finally{
 closing=true;try{await rc('trialrescueqa reset');}catch(e){report.cleanup=String(e);process.exitCode=1;}
 bedrock?.close();for(const b of bots)b.quit('isolated rescue feedback QA complete');await sleep(300);
 report.bots=bots.map(b=>({name:b.username,deaths:b.deaths,messages:b.lines.slice(-18),bars:b.bars,particleSample:b.particles.slice(-6)}));report.bedrock=bePackets;
 const file=output+'/feedback-'+Date.now()+'.json';fs.writeFileSync(file,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));
 console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,failure:report.failure,errors:report.errors,file}));process.exit(process.exitCode??0);
}
