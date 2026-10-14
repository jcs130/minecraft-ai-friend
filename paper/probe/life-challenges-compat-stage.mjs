// Real Geyser/native menus and rejected inventory actions in the loopback QA copy.
// This does not claim physical phone/Xbox input or autonomous LLM performance.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/life-challenges-20261014/paper',output='E:/MC/ops/repairs/life-challenges-20261014';
const properties=stage+'/server.properties',props=fs.readFileSync(properties,'utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25678\r?$/m);assert.match(props,/^rcon.port=25679\r?$/m);assert.match(props,/^motd=Life challenges isolated check\r?$/m);
const report={at:new Date().toISOString(),checks:[],errors:[],fixtures:[],samples:{},sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.38.jar')).digest('hex')};
const config=stage+'/plugins/AgentFriend/life-challenges.yml',original=fs.readFileSync(config);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
let bot,be,closing=false,configChanged=false;
const rc=async q=>{const answer=await command(q,15000,{port:25679,properties});report.fixtures.push({q,answer});return answer;};
function check(name,ok){report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);}
async function until(fn,label,ms=25000){for(const end=Date.now()+ms;Date.now()<end;){const result=await fn();if(result)return result;await sleep(100);}throw Error('Timeout '+label);}
async function chat(q){await sleep(Math.max(0,1150-(Date.now()-(bot.lastChat??0))));bot.lastChat=Date.now();bot.chat(q);}
async function cli(q,predicate=()=>true){const at=bot.lines.length;await chat('/mycli challenge '+q);return until(()=>bot.lines.slice(at).filter(l=>l.startsWith('MC_CHALLENGE ')).map(l=>JSON.parse(l.slice(13))).find(predicate),q);}
async function close(){if(bot.currentWindow)bot.closeWindow(bot.currentWindow);await sleep(500);}
async function bag(){await chat('/minepacks:backpack open');await until(()=>bot.currentWindow?.inventoryStart===54,'Minepacks');return bot.currentWindow;}
const amount=()=>bot.inventory.items().filter(i=>i.name==='cobblestone').reduce((sum,i)=>sum+i.count,0);
try{
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.38');}catch{return false;}},'QA server',90000);
 await rc('minecraft:whitelist add ag_LifeA');
 bot=req('mineflayer').createBot({host:'127.0.0.1',port:25678,username:'ag_LifeA',version:'1.20.6',auth:'offline',checkTimeoutInterval:60000});installRecipePacketBypass(bot._client);bot.lines=[];
 bot.on('messagestr',s=>bot.lines.push(s));bot.on('error',e=>{if(!closing)report.errors.push('Java '+e.message);});
 await until(()=>bot.entity&&bot.world.getColumnAt(bot.entity.position),'Java world',45000);
 await cli('cancel');await close();await rc('minecraft:gamemode survival ag_LifeA');await rc('minecraft:tp ag_LifeA 2001.5 101 2002.5');await sleep(800);
 await rc('minecraft:clear ag_LifeA minecraft:cobblestone');await rc('minecraft:give ag_LifeA minecraft:cobblestone 32');await sleep(400);
 const detail=await cli('info backpack_roundtrip',o=>o.type==='detail');const forming=await cli('start backpack_roundtrip',o=>o.type==='status');
 configChanged=true;fs.writeFileSync(config,original.toString('utf8').replace('行囊有序','行囊有序新版'));
 check('valid rules reload succeeds',(await rc('mycli admin challenges reload')).includes('true'));
 const updated=await cli('info backpack_roundtrip',o=>o.type==='detail');check('new catalog gets new rule version',updated.title==='行囊有序新版'&&updated.ruleVersion!==detail.ruleVersion);
 const same=await cli('status',o=>o.type==='status');check('existing attempt keeps frozen rules',same.ruleVersion===forming.ruleVersion&&same.title===forming.title);
 fs.writeFileSync(config,'schema-version: 2\nchallenges: {}\n');check('invalid config is rejected',(await rc('mycli admin challenges reload')).includes('false'));
 check('invalid reload preserves last valid catalog',(await cli('info backpack_roundtrip',o=>o.type==='detail')).ruleVersion===updated.ruleVersion);
 fs.writeFileSync(config,original);await rc('mycli admin challenges reload');configChanged=false;
 await cli('begin',o=>o.state==='running');const w=await bag();await until(()=>bot.lines.some(l=>l.includes('bag_deposit')),'open recorded');
 const slot=w.slots.findIndex((i,n)=>n>=54&&i?.name==='cobblestone');assert(slot>=0);await rc('lifeqa deny ag_LifeA');
 await bot.clickWindow(slot,0,1);await sleep(500);await close();const rejected=await cli('status',o=>o.type==='status');
 check('cancelled native inventory move cannot advance challenge',rejected.completedSteps===1&&!rejected.success&&amount()===32&&!bot.inventory.selectedItem);
 const cancelled=await cli('cancel',o=>o.state==='cancelled');check('cancel receipt names the write command',cancelled.trigger==='cancel'&&!cancelled.readOnly);
 await until(()=>{const saved=JSON.parse(fs.readFileSync(stage+'/plugins/AgentFriend/challenge-runs/'+forming.runId+'.json'));return saved.state==='cancelled'?saved:false;},'cancel persisted');
 const saved=JSON.parse(fs.readFileSync(stage+'/plugins/AgentFriend/challenge-runs/'+forming.runId+'.json'));
 check('cancellation evidence names the actual participant',saved.events.at(-1).actorUuid===bot.player.uuid);report.samples.cancelled=saved;

 const bp=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json')('bedrock-protocol');
 const suffix=String(Date.now()).slice(-5),name='LifeBE'+suffix,texts=[],opens=[],contents=[];let spawned=false;
 report.samples.bedrock={protocol:2193,texts,opens,contents};
 be=bp.createClient({host:'127.0.0.1',port:19182,version:'1.26.51',offline:true,username:name,raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:20000});
 be.on('session',p=>{p.xuid='90000000000'+suffix;});be.on('spawn',()=>spawned=true);be.on('error',e=>{if(!closing)report.errors.push('Bedrock '+e.message);});
 be.on('text',p=>texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));be.on('container_open',p=>opens.push(p));be.on('inventory_content',p=>contents.push({window:p.window_id,slots:p.input?.length,items:p.input?.filter(i=>i.network_id!==0).length}));
 let beLast=0;async function send(q){await sleep(Math.max(0,1150-(Date.now()-beLast)));beLast=Date.now();be.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});}
 await until(()=>spawned,'Bedrock spawn',45000);check('Bedrock joins Geyser world',(await rc('minecraft:list')).includes('.'+name));
 await rc('minecraft:tp .'+name+' 2008.5 101 2002.5');await sleep(1500);
 await send('/mycli challenge list');await until(()=>texts.filter(t=>t.includes('[生活挑战]')).length>=3,'Bedrock catalog');check('ordinary Bedrock gets Chinese catalog without JSON',texts.some(t=>t.includes('行囊有序'))&&!texts.some(t=>t.startsWith('MC_CHALLENGE ')));
 await send('/mycli challenge menu');await until(()=>opens.length&&contents.some(c=>c.window!==0&&c.slots>=45&&c.items>=4),'Bedrock challenge menu');check('Bedrock receives translated challenge menu and real items',true);
 const window=opens.at(-1);be.write('container_close',{window_id:window.window_id,window_type:window.window_type,server:false});await sleep(500);
 let at=texts.length;await send('/mycli challenge info backpack_roundtrip --json');const machine=await until(()=>texts.slice(at).find(t=>t.startsWith('MC_CHALLENGE ')),'explicit JSON');
 check('Bedrock explicit query returns same read-only schema',JSON.parse(machine.slice(13)).readOnly===true&&JSON.parse(machine.slice(13)).trigger==='info');
 at=texts.length;await send('/mycli challenge start backpack_roundtrip --json');const denied=await until(()=>texts.slice(at).find(t=>t.startsWith('MC_CHALLENGE ')),'JSON-only write rejected');check('JSON read path cannot enrol ordinary player',JSON.parse(denied.slice(13)).reason==='query_only');
 at=texts.length;await send('/mycli challenge start backpack_roundtrip');await until(()=>texts.slice(at).some(t=>t.includes('分工：')&&t.includes('齐备后')),'Bedrock signup');
 at=texts.length;await send('/mycli challenge status --json');const beState=JSON.parse((await until(()=>texts.slice(at).find(t=>t.startsWith('MC_CHALLENGE ')),'Bedrock state')).slice(13));check('Bedrock self-enrolment stays forming until begin',beState.state==='forming'&&beState.startedAt===0);
 await send('/mycli challenge cancel');await until(()=>texts.some(t=>t.includes('成员主动取消')),'Bedrock cancel');
 report.samples.bedrock={protocol:2193,texts,opens,contents,runId:beState.runId};
 check('no unexpected protocol errors',report.errors.length===0);report.passed=true;
}catch(error){report.failure=String(error.stack);process.exitCode=1;}
finally{
 if(configChanged){fs.writeFileSync(config,original);try{await rc('mycli admin challenges reload');}catch(error){report.errors.push('restore reload: '+error.message);}}
 closing=true;be?.close();if(bot)try{bot.quit('Isolated compatibility check complete');}catch{}
 await sleep(400);const file=output+'/compat-'+Date.now()+'.json';fs.writeFileSync(file,JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2));console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,failure:report.failure,errors:report.errors,file}));process.exit(process.exitCode??0);
}
