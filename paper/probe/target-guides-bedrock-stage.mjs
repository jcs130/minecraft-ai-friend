// Actual loopback Geyser translation. Not a claim of phone/Xbox pixel or input testing.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
const stage='E:/MC/staging/ysm-release-20261011/paper';
const properties=readFileSync(stage+'/server.properties','utf8');
assert.match(properties,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(properties,/^rcon.port=25645\r?$/m);
assert.match(readFileSync(stage+'/plugins/Geyser-Spigot/config.yml','utf8'),/address: 127\.0\.0\.1\r?\n  port: 19155/);
const require=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json');
const be=require('bedrock-protocol');
// Verify the installed Geyser/Cloudburst 2193 codec, rather than trusting this diagnostic
// client's older particle name labels. Its label for wire ID 16432 says dragon breath,
// while the actual v2193 LEVEL_EVENTS map identifies that ID as END_ROD.
const mapEvidence=JSON.parse(readFileSync('E:/MC/ops/repairs/target-guides-20261012/bedrock-particle-map.json','utf8'));
assert.equal(mapEvidence.protocol,2193);
assert.equal(createHash('sha256').update(readFileSync(stage+'/plugins/Geyser-Spigot.jar')).digest('hex'),mapEvidence.geyserSha256);
const eventSchema=require('minecraft-data')('bedrock_1.26.51').protocol.types.packet_level_event;
const clientEventLabel=eventSchema[1].find(f=>f.name==='event').type[1].mappings[mapEvidence.endRodEvent];
assert.ok(clientEventLabel);
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:25645});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={at:new Date().toISOString(),scope:'isolated Bedrock 2193 wire, not phone/Xbox visuals',checks:[],errors:[],texts:[],samples:[],raw:[]};
const out=process.env.GUIDE_REPORT??'E:/MC/ops/repairs/target-guides-20261012/bedrock-1.json';
let client,spawned=false,closing=false;const points=[],name='.GuideBE01';
const close=(p,q)=>Math.abs(p.x-q.x)<1e-4&&Math.abs(p.y-q.y)<1e-4&&Math.abs(p.z-q.z)<1e-4;
function check(name,pass,detail){report.checks.push({name,pass:!!pass,detail});assert.ok(pass,name);console.log('PASS',name);}
async function until(fn,label,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(90);}throw Error('Timeout '+label);}
function send(q){client.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});}
async function ask(q){send(q);await sleep(1300);}
function complete(label,start,end){const last=points.findIndex(p=>close(p,end));let first=last;while(first>=0&&!close(points[first],start))first--;const frame=first<0?[]:points.slice(first,last+1);
 check(label,frame.length>=2&&frame.length<=64,{points:frame.length,start,end});
 check(label+' straight',frame.every((p,i)=>{const t=i/(frame.length-1);return close(p,{x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t,z:start.z+(end.z-start.z)*t});}));report.samples.push(frame);
}
try{
 check('candidate 0.4.26',(await rc('version AgentFriend')).includes('0.4.26'));
 await rc('minecraft:setblock 122 205 100 minecraft:diamond_ore');await rc('minecraft:kill @e[tag=guide_enemy_qa]');
 client=be.createClient({host:'127.0.0.1',port:19155,version:'1.26.51',offline:true,username:'GuideBE01',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
 client.on('session',p=>{p.xuid='9000000987654';}); // Self-signed identity only on this isolated listener.
 client.on('spawn',()=>spawned=true);client.on('error',e=>report.errors.push(e.message));client.on('disconnect',p=>{if(!closing)report.errors.push(JSON.stringify(p));});
 client.on('text',p=>report.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));
 report.codecMap={...mapEvidence,diagnosticClientLabel:clientEventLabel};
 client.on('level_event',p=>{if(report.raw.length<100)report.raw.push({kind:'level_event',...p});if(p.event===clientEventLabel)points.push(p.position);});
 client.on('spawn_particle_effect',p=>{if(report.raw.length<100)report.raw.push({kind:'spawn_particle_effect',...p});});
 await until(()=>spawned,'Bedrock spawn');await sleep(1700);
 check('Bedrock player actually on Paper',(await rc('minecraft:list')).includes(name));
 await rc('minecraft:gamemode survival '+name);await rc('minecraft:tp '+name+' 100.5 201 100.5');
 await ask('/mycli skills learn prospect');await ask('/mycli skills learn sense');points.length=0;
 await ask('/mycli cast prospect diamond');await until(()=>report.texts.some(s=>s.includes('探矿术找到钻石矿')),'Bedrock ore cast');await sleep(600);
 complete('Bedrock complete ore line from caster to target',{x:100.5,y:202.2,z:100.5},{x:122.5,y:205.5,z:100.5});
 points.length=0;await rc('minecraft:tp '+name+' 100.5 201 102.5');await sleep(1100);
 complete('Bedrock line follows caster',{x:100.5,y:202.2,z:102.5},{x:122.5,y:205.5,z:100.5});
 await rc('minecraft:setblock 122 205 100 minecraft:air');await sleep(1100);points.length=0;await sleep(900);check('Bedrock removed ore stops line',points.length===0,points.length);
 await rc('minecraft:summon minecraft:husk 120.5 201 106.5 {Tags:["guide_enemy_qa"],NoAI:1b,NoGravity:1b,PersistenceRequired:1b}');await sleep(400);points.length=0;
 await ask('/mycli cast sense');await until(()=>report.texts.some(s=>s.includes('探敌术发现附近')),'Bedrock sense cast');await sleep(600);
 complete('Bedrock complete enemy line',{x:100.5,y:202.2,z:102.5},{x:120.5,y:202.17,z:106.5});
 points.length=0;await rc('minecraft:tp @e[tag=guide_enemy_qa,limit=1] 118.5 204 108.5');await sleep(1100);
 complete('Bedrock line follows enemy',{x:100.5,y:202.2,z:102.5},{x:118.5,y:205.17,z:108.5});
 await rc('minecraft:kill @e[tag=guide_enemy_qa]');await sleep(1100);points.length=0;await sleep(900);check('Bedrock dead enemy stops line',points.length===0,points.length);
 check('no Bedrock transport errors',report.errors.length===0,report.errors);report.passed=report.checks.length;
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error);}
finally{closing=true;report.receivedPoints=points.slice(0,80);client?.close();writeFileSync(out,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));await sleep(500);}
