// Requires a dedicated, cold-copied loopback fixture and separately built QA plugin.
// Never accepts a production address, RCON port or world root.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
assert(process.env.MC_TASK_GUIDANCE_QA_ROOT,'Set MC_TASK_GUIDANCE_QA_ROOT to the private fixture report root');
const root=path.resolve(process.env.MC_TASK_GUIDANCE_QA_ROOT).replaceAll('\\','/'),setup=JSON.parse(fs.readFileSync(root+'/setup.json','utf8'));
const stage=path.resolve(setup.stage).replaceAll('\\','/');
assert.equal(path.dirname(stage),'E:/MC/staging');assert.equal(fs.readFileSync(stage+'/.task-guidance-stage','utf8').trim(),'task-guidance-20261017');
const properties=fs.readFileSync(stage+'/server.properties','utf8');
for(const line of ['server-ip=127.0.0.1','server-port=25830','rcon.port=25831','motd=TASK_GUIDANCE_ISOLATED_20261017'])assert(properties.split(/\r?\n/).includes(line));
assert(!fs.existsSync(root+'/native-guidance.json'),'Retain the original report; use a fresh explicit report path for retries');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),mineflayer=require('mineflayer');
const yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const rcon=q=>command(q,15000,{properties:stage+'/server.properties',port:25831});
const cfg=()=>yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));
const observe=async p=>{const raw=await rcon('mycli admin observe '+Buffer.from(JSON.stringify({op:'player',player:p})).toString('base64url'));assert(raw.startsWith('MC_OBSERVATION '),raw);return JSON.parse(raw.slice(15));};
const out={at:new Date().toISOString(),checks:[],formalModified:false,jarSha256:crypto.createHash('sha256').update(fs.readFileSync(stage+'/plugins/'+setup.jar)).digest('hex')};
function check(name,value){out.checks.push({name,pass:!!value});assert(value,name);}
const bots=[],messages=new Map(),packets=new Map();
async function connect(username){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:25830,username,version:'1.21.1',auth:'offline',hideErrors:true});bots.push(bot);installRecipePacketBypass(bot._client,{enabled:true});
 messages.set(username,[]);packets.set(username,[]);bot.on('messagestr',s=>{messages.get(username).push(s);if(s.startsWith('MC_TASKS '))try{packets.get(username).push(JSON.parse(s.slice(9)));}catch{}});bot.on('error',e=>{out.clientErrors??=[];out.clientErrors.push({username,error:e.message});});
 bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:market')try{packets.get(username).push(JSON.parse(p.data.toString()));}catch{}});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout')),30000);bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('kicked',r=>{clearTimeout(timer);reject(Error(JSON.stringify(r)));});});return bot;
}
try{
 check('exact candidate is enabled',(await rcon('version AgentFriend')).includes('0.4.47.1'));
 await rcon('minecraft:gamerule doMobSpawning false');await rcon('minecraft:gamerule fallDamage false');
 const qa=await connect(setup.qaName),guest=await connect('ag_GuideGuest');await sleep(1500);
 out.home=await rcon('guidanceqa home');assert(out.home.startsWith('QA_GUIDANCE_POSITION home'),out.home);await sleep(350);
 messages.get(guest.username).length=0;packets.get(guest.username).length=0;
 let seen=await observe(qa.username),g=seen.currentContract.guidance;out.initial=seen;
 check('frozen original temple task is used',seen.currentContract.id===setup.task&&seen.currentContract.condition.includes('留意绊线'));
 check('not yet inside yields exact verified landmark',g.phase==='find_target'&&g.landmark.x===1607&&g.landmark.z===2357&&g.landmark.structureKey==='minecraft:jungle_pyramid');
 check('arrival is not claimed from coordinates',g.ready===false&&g.targetMatch===false&&g.landmark.entranceVerified===false&&!('y' in g.landmark));
 check('long journey and one missing arrival',g.landmark.horizontalDistance>3500&&g.missingConditions.length===1);
 qa.chat('/mycli tasks status --json');await sleep(500);
 check('Mineflayer receives actionable task status',packets.get(qa.username).some(p=>p.type==='status'&&p.adventure?.market?.guidance?.phase==='find_target'&&p.adventure.market.guidance.nextAction.includes('1607')));
 check('default status fits one compact reply',messages.get(qa.username).some(s=>s.startsWith('MC_TASKS ')&&s.length<3200));
 const readonly=await rcon('guidanceqa readonly');out.readonly=readonly;
 check('queries do not mutate config or load chunks',readonly.startsWith('QA_GUIDANCE_READONLY '));
 check('another player receives no task responses',packets.get(guest.username).length===0&&!messages.get(guest.username).some(s=>/藤蔓|1607|本阶段探索|同一座神庙/.test(s)));
 check('another player does not inherit the task',(await observe(guest.username)).currentContract.available===false);
 const catalogFile=stage+'/plugins/AgentFriend/exploration-landmarks.json',good=fs.readFileSync(catalogFile);fs.writeFileSync(catalogFile,'{broken');
 try{out.invalidReload=await rcon('mycli admin market reload');seen=await observe(qa.username);check('invalid reload retains last good catalog and task',seen.currentContract.guidance.landmark.x===1607&&seen.currentContract.id===setup.task);}
 finally{fs.writeFileSync(catalogFile,good);out.validReload=await rcon('mycli admin market reload');}
 await rcon('minecraft:execute in minecraft:the_nether run minecraft:setblock 0 169 0 minecraft:stone');
 out.nether=await rcon('guidanceqa nether');await sleep(350);seen=await observe(qa.username);out.wrongDimension=seen;
 check('wrong dimension gives return action first',seen.currentContract.guidance.phase==='return_to_required_dimension'&&!seen.currentContract.guidance.landmark);
 await rcon('guidanceqa home');await sleep(350);
 check('partial fixture retains original terms',(await rcon('guidanceqa partial')).startsWith('QA_GUIDANCE_FIXTURE partial'));
 seen=await observe(qa.username);g=seen.currentContract.guidance;
 check('partial survey resumes same structure without reset',g.phase==='resume_same_structure'&&g.resumePosition.x===1602&&!g.landmark&&g.nextAction.includes('不必放弃重接'));
 // Clear only the private copy's standing space inside the native temple bounds.
 // Registry identity remains the copied natural start; production geometry is never touched.
 await rcon('minecraft:execute in minecraft:overworld run minecraft:fill 1601 88 2355 1604 94 2358 minecraft:air');
 await rcon('minecraft:execute in minecraft:overworld run minecraft:setblock 1602 87 2356 minecraft:stone');
 await rcon('guidanceqa temple');await sleep(350);
 seen=await observe(qa.username);g=seen.currentContract.guidance;out.inside=seen;
 check('real loaded structure is recognized',g.phase==='survey'&&g.targetMatch===true);
 check('satisfied sections and biome are omitted',g.missingConditions.length===4&&!g.missingConditions.some(s=>s.startsWith('内部区段')||s.startsWith('群系')));
 check('height shortage directs upstairs and downstairs',g.nextAction.includes('上下通道')&&g.nextAction.includes('不是多座建筑'));
 check('queries inside temple remain read-only',(await rcon('guidanceqa readonly')).startsWith('QA_GUIDANCE_READONLY '));
 await rcon('guidanceqa home');await sleep(350);
 check('ready fixture installed only in QA',(await rcon('guidanceqa ready')).startsWith('QA_GUIDANCE_FIXTURE ready'));
 seen=await observe(qa.username);g=seen.currentContract.guidance;
 check('completed evidence survives return journey',g.phase==='ready_to_submit'&&g.ready===true&&g.nextCommand==='/mycli guild claim');
 await rcon('save-all flush');const saved=cfg()['guild-players'][setup.qaUuid];
 check('all queries preserve frozen definition exactly',saved.active.market.definition===setup.frozenDefinition);
 check('queries never claim or grant rewards',saved.active.id===setup.task&&saved.fame===setup.sourceFame&&saved.completed===setup.sourceCompleted);
 check('all packets are scoped privately and bounded',packets.get(guest.username).length===0&&packets.get(qa.username).every(p=>p.scope===undefined||p.scope==='self'));
}catch(error){out.error=error.stack;process.exitCode=1;}
finally{
 if(out.error){out.messages=Object.fromEntries(messages);out.packets=Object.fromEntries(packets);}
 for(const bot of bots)bot.quit('isolated guidance test complete');
 fs.writeFileSync(root+'/native-guidance.json',JSON.stringify(out,null,2),{flag:'wx'});
 await sleep(250);await rcon('stop');
 console.log(JSON.stringify({passed:out.checks.filter(c=>c.pass).length,failed:out.checks.filter(c=>!c.pass),error:out.error,report:root+'/native-guidance.json'}));
}
