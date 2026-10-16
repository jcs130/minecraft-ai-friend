import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
import path from 'node:path';
assert(process.env.MC_EXPLORATION_QA_ROOT,'Set MC_EXPLORATION_QA_ROOT to a freshly prepared private fixture');
const root=path.resolve(process.env.MC_EXPLORATION_QA_ROOT).replaceAll(String.fromCharCode(92),'/');
const stage=JSON.parse(fs.readFileSync(root+'/setup.json','utf8')).stage.replaceAll(String.fromCharCode(92),'/');
assert(path.resolve(stage).toLowerCase().startsWith(path.resolve('E:/MC/staging').toLowerCase()+path.sep),'Only explicit staging copies may be tested');
assert(fs.readFileSync(stage+'/.exploration-guidance-stage','utf8').trim()==='exploration-navigation');
const properties=fs.readFileSync(stage+'/server.properties','utf8');
assert(/^server-ip=127[.]0[.]0[.]1$/m.test(properties)&&/^server-port=25830$/m.test(properties)&&/^rcon[.]port=25831$/m.test(properties));
assert(!fs.existsSync(root+'/native-guidance.json'),'Preserve existing test evidence; prepare a fresh report root');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const setup=JSON.parse(fs.readFileSync(root+'/setup.json'));
const rcon=q=>command(q,20000,{properties:stage+'/server.properties',port:25831});
const cfg=()=>yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));
const frozen=()=>cfg()['guild-players'][setup.qaUuid].active.market.definition;
let before;const out={at:new Date().toISOString(),checks:[],observations:[],queries:[],formalModified:false,jarSha256:crypto.createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.45.jar')).digest('hex')};
const bots=[],messages=new Map(),packets=new Map();
const check=(name,passed)=>{out.checks.push({name,passed:!!passed});assert(passed,name);console.log('PASS '+name);};
async function make(name){const b=require('mineflayer').createBot({host:'127.0.0.1',port:25830,username:name,version:'1.21.1',auth:'offline',hideErrors:true,plugins:{physics:false}});installRecipePacketBypass(b._client);bots.push(b);messages.set(name,[]);packets.set(name,[]);b.on('messagestr',t=>messages.get(name).push(t));b._client.on('login',()=>b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:exam')}));b._client.on('custom_payload',p=>{if(p.channel==='mcagent:exam')packets.get(name).push({bytes:p.data.length,data:JSON.parse(p.data.toString('utf8'))});});await new Promise((res,rej)=>{b.once('spawn',res);b.once('error',rej);b.once('kicked',rej);setTimeout(()=>rej(Error('spawn timeout')),15000).unref();});await sleep(1000);return b;}
async function observe(name){await sleep(250);const q='mycli admin observe '+Buffer.from(JSON.stringify({op:'player',player:name})).toString('base64url');const raw=await rcon(q);assert(raw.startsWith('MC_OBSERVATION '));const data=JSON.parse(raw.slice(15));out.observations.push(data);return data;}
async function ask(bot,q){const n=messages.get(bot.username).length,k=packets.get(bot.username).length;bot.chat(q);await sleep(750);const row={query:q,messages:messages.get(bot.username).slice(n),packets:packets.get(bot.username).slice(k)};out.queries.push(row);return row;}
try{
 check('native candidate version',String(await rcon('version AgentFriend')).includes('0.4.45'));
 const qa=await make(setup.qaName),guest=await make('ag_GuideGuest16');
 if(!cfg()['guild-players'][setup.qaUuid].active)await ask(qa,'/mycli guild accept tm_desert_pyramid_archive');
 before=frozen();check('isolated actor accepts original desert objective through normal command',!!before);
 out.teleportNether=await rcon('minecraft:execute in minecraft:the_nether run minecraft:tp '+setup.qaName+' -58 100 -78');await sleep(750);
 const wrong=await observe(setup.qaName),nav=wrong.currentContract.navigation;
 check('current frozen contract identity is retained',wrong.currentContract.id==='tm_desert_pyramid_archive');
 check('actual Nether dimension cannot satisfy overworld objective',wrong.position.world==='minecraft:the_nether'&&nav.requiredDimension==='minecraft:overworld'&&nav.currentDimension==='minecraft:the_nether'&&nav.dimensionMatches===false&&nav.reason==='wrong_dimension');
 check('wrong dimension gives corrective action instead of walking toward a portal conversion point',nav.nextAction==='return_to_required_dimension');
 check('required native structure key is explicit',JSON.stringify(nav.requiredStructureKeys)==='["minecraft:desert_pyramid"]'&&nav.structureMatchStatus==='not_checked');
 const status=await ask(qa,'/mycli guild status');check('human status names required world and structure and corrects mismatch',status.messages.some(s=>s.includes('所需维度：主世界'))&&status.messages.some(s=>s.includes('当前维度不匹配'))&&status.messages.some(s=>s.includes('minecraft:desert_pyramid')));
 const exam=await ask(qa,'/mycli guild exam status --json');const self=exam.packets.at(-1)?.data;
 check('private exam JSON exposes the same current account navigation',self?.guide?.currentContract?.navigation?.reason==='wrong_dimension'&&self.guide.currentContract.id==='tm_desert_pyramid_archive');
 check('structured exam message remains under 16KiB',exam.packets.length>0&&exam.packets.every(p=>p.bytes<=16384));
 check('other player receives no exam status or Chinese task copy',packets.get(guest.username).length===0&&!messages.get(guest.username).some(s=>/所需维度|当前维度不匹配|MC_GUILD_EXAM/.test(s)));
 const other=await observe(guest.username);check('another account does not inherit the QA task',other.player===guest.username&&other.currentContract.available===false&&other.inventoryIncluded===false);
 out.teleportMain=await rcon('minecraft:execute in minecraft:overworld run minecraft:tp '+setup.qaName+' -550 72 -450');await sleep(750);const main=await observe(setup.qaName);
 check('return to main world updates match flag without claiming structure arrival',main.currentContract.navigation.dimensionMatches===true&&main.currentContract.navigation.nextAction==='check_structure_type_then_survey'&&main.currentContract.navigation.structureMatchStatus==='not_checked');
 await sleep(250);const raw=await rcon('mycli admin observe '+Buffer.from(JSON.stringify({op:'places',query:'desert_ruins'})).toString('base64url'));const places=JSON.parse(raw.slice(15));out.places=places;
 check('public mod ruin carries its real registry key instead of a vanilla temple identity',places.places.some(p=>p.id==='desert_ruins'&&p.structureKey==='nova_structures:desert_ruins'&&p.world==='minecraft:overworld'&&p.entranceVerified===false));
 check('all state queries preserve exact frozen task and rewards',frozen()===before);
}catch(error){out.error=error.stack;console.error(error.stack);process.exitCode=1;}
finally{for(const b of bots)b.quit('isolated guidance test complete');fs.writeFileSync(root+'/native-guidance.json',JSON.stringify(out,null,2),{flag:'wx'});await sleep(350);await rcon('stop');}
