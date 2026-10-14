// Native protocol verification against the guarded loopback Paper copy, never production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/life-challenges-20261014/paper',output='E:/MC/ops/repairs/cli-contract-20261014';
const properties=stage+'/server.properties',props=fs.readFileSync(properties,'utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25678\r?$/m);assert.match(props,/^rcon.port=25679\r?$/m);assert.match(props,/^motd=Life challenges isolated check\r?$/m);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');fix1206PotionProtocol(req);
const report={at:new Date().toISOString(),checks:[],errors:[],samples:{},sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.39.jar')).digest('hex')};
const bots=[];let closing=false;
async function until(fn,label,ms=30000){for(const end=Date.now()+ms;Date.now()<end;){const r=await fn();if(r)return r;await sleep(100);}throw Error('Timeout '+label);}
const rc=q=>command(q,15000,{port:25679,properties});
function check(name,ok){report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);}
async function join(username){
 await rc('minecraft:whitelist add '+username);
 const b=req('mineflayer').createBot({host:'127.0.0.1',port:25678,username,version:'1.20.6',auth:'offline',checkTimeoutInterval:60000});bots.push(b);installRecipePacketBypass(b._client);b.lines=[];b.camera=[];
 b.on('messagestr',s=>b.lines.push(s));b._client.on('camera',p=>b.camera.push(p.cameraId));b.on('error',e=>{if(!closing)report.errors.push(e.message);});
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),username+' world',45000);return b;
}
async function run(b,q,prefix='MC_CHALLENGE '){
 await sleep(Math.max(0,1150-(Date.now()-(b.lastChat??0))));const at=b.lines.length;b.lastChat=Date.now();b.chat(q);
 const value=await until(()=>b.lines.slice(at).find(s=>s.startsWith(prefix)),q);await sleep(250);
 return {data:JSON.parse(value.slice(prefix.length)),lines:b.lines.slice(at)};
}
const cli=(b,q)=>run(b,'/mycli challenge '+q);
const file=id=>stage+'/plugins/AgentFriend/challenge-runs/'+id+'.json';
const records=()=>fs.readdirSync(stage+'/plugins/AgentFriend/challenge-runs').filter(f=>f.endsWith('.json')).length;
try{
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.39');}catch{return false;}},'candidate readiness',90000);
 check('candidate running',(await rc('version AgentFriend')).includes('0.4.39'));
 const a=await join('ag_LifeA'),human=await join('LifeVisitor'),eye=await join('ag_LifeA_eye');
 await until(()=>eye.camera.at(-1)===a.entity.id&&eye.game.gameMode==='spectator','attached Eye');
 for(const bot of [a,human]){await rc('minecraft:gamemode survival '+bot.username);await rc('minecraft:tp '+bot.username+' 2001.5 101 2002.5');await cli(bot,'cancel --json');}
 await rc('minecraft:clear ag_LifeA minecraft:cobblestone');await rc('minecraft:give ag_LifeA minecraft:cobblestone 32');
 const before=records();
 let r=await run(a,'/mycli --help --json','MC_CLI_HELP ');
 check('root help is one bounded response',r.lines.filter(s=>s.startsWith('MC_CLI_')).length===1&&r.data.commands.length<=7&&JSON.stringify(r.data).length<2600);
 report.samples.rootHelp=r.data;
 check('help continuation retains output format',r.data.nextCommand.endsWith('--json'));
 r=await run(a,'/mycli challenge --help --json','MC_CLI_HELP ');
 check('group help exposes commands without rulebook',r.data.commands.some(c=>c.name==='create')&&!JSON.stringify(r.data).includes('missingConditions'));
 r=await run(a,'/mycli challenge create backpack_roundtrip --json --help','MC_CLI_HELP ');
 check('write help does not create a run',r.data.readOnly&&!r.data.actionReadOnly&&records()===before);
 r=await run(a,'/mycli cast heal --help --json','MC_CLI_HELP ');
 check('live spell catalog is discoverable',r.data.usage.includes('heal')&&r.data.consumption&&r.data.permission);
 r=await run(a,'/mycli challenge bogus --help --json','MC_CLI_HELP ');check('unknown command has explicit recoverable error',r.data.errorCode==='INVALID_ARGUMENT'&&r.data.nextCommand==='/mycli --help');
 r=await run(a,'/mycli','MC_CLI_HELP ');check('bare root reuses short standard help',r.data.readOnly&&r.data.commands.length<=7);
 r=await cli(a,'list --json');check('list is one summary array',r.lines.filter(s=>s.startsWith('MC_CHALLENGE ')).length===1&&r.data.items.length===3&&!r.data.items.some(x=>'steps' in x));report.samples.catalog=r.data;
 r=await cli(a,'create backpack_roundtrip --page 2 --json');check('bad flags cannot create',r.data.reason==='invalid_argument'&&records()===before);
 r=await cli(a,'create backpack_roundtrip --json');const id=r.data.runId;
 check('write emits one durable JSON receipt',r.data.state==='forming'&&r.data.durable&&!r.data.readOnly&&r.data.trigger==='create'&&r.lines.filter(s=>s.startsWith('MC_CHALLENGE ')).length===1&&!r.lines.some(s=>s.startsWith('[行囊有序]')));
 const original=fs.readFileSync(file(id),'utf8');r=await cli(a,'create backpack_roundtrip --json');check('repeat create reuses original run',r.data.runId===id&&fs.readFileSync(file(id),'utf8')===original);
 r=await cli(a,'create supply_chain --json');check('different active project is explicit conflict',r.data.reason==='active_challenge'&&fs.readFileSync(file(id),'utf8')===original);
 const small=(await cli(a,'status --json')).data,full=(await cli(a,'status --verbose --json')).data;
 check('default status is concise and details are opt-in',!small.members&&!small.missingConditions&&!small.rule&&full.members.length===1&&full.missingConditions.length===4&&JSON.stringify(small).length<JSON.stringify(full).length*.7);
 check('query and detail preserve durable record',fs.readFileSync(file(id),'utf8')===original);report.samples.status=small;report.samples.verbose=full;
 r=await run(a,'/mycli status --json','MC_STATUS ');check('common status discovers current challenge',r.data.challenge.nextCommand==='/mycli challenge status'&&r.data.challenge.state==='forming');
 r=await cli(a,'start --json');check('bare start actually starts the timer',r.data.state==='running'&&r.data.startedAt>0&&r.data.durable);
 const started=fs.readFileSync(file(id),'utf8');const startedAt=r.data.startedAt;r=await cli(a,'start --json');
 check('repeat start cannot reset timer or add evidence',r.data.startedAt===startedAt&&fs.readFileSync(file(id),'utf8')===started);
 r=await cli(a,'menu --json');await until(()=>a.currentWindow,'native menu');check('GUI action has JSON receipt and real window',r.data.status==='opened'&&!r.data.readOnly);a.closeWindow(a.currentWindow);await sleep(300);
 r=await cli(a,'cancel --json');check('cancel ends and persists current run',r.data.state==='cancelled'&&r.data.durable);const cancelled=fs.readFileSync(file(id),'utf8');
 r=await cli(a,'cancel --json');check('repeat cancel is safe',r.data.runId===id&&fs.readFileSync(file(id),'utf8')===cancelled);
 r=await cli(a,'result --json');check('result is one paged response with evidence',r.lines.filter(s=>s.startsWith('MC_CHALLENGE ')).length===1&&r.data.items.length>0&&r.data.page===1&&r.data.readOnly);
 r=await cli(a,'history --json');check('history is bounded and links selected records',r.data.items.length<=4&&r.data.items[0].nextCommand.includes('result')&&r.lines.filter(s=>s.startsWith('MC_CHALLENGE ')).length===1);
 r=await cli(a,'result --page 999 --json');check('out of range page fails without rewriting',r.data.errorCode==='invalid_argument'&&fs.readFileSync(file(id),'utf8')===cancelled);
 r=await cli(human,'result '+id+' --json');check('JSON cannot read foreign records',r.data.reason==='record_unavailable');
 r=await cli(human,'create backpack_roundtrip --json');check('ordinary Java gets JSON-only write when requested',r.data.state==='forming'&&!r.data.readOnly&&r.lines.filter(s=>s.startsWith('MC_CHALLENGE ')).length===1&&!r.lines.some(s=>s.includes('[行囊有序]')));
 await cli(human,'cancel --json');
 r=await run(human,'/mycli rules --json','MC_RULES ');check('rules JSON has no duplicated prose',r.data.rules.length>0&&!r.lines.some(s=>/^\d+\. /.test(s)));
 check('read-only inspection cannot mutate completed evidence',fs.readFileSync(file(id),'utf8')===cancelled);
 check('actual Eye sees readable concise progress only',eye.lines.some(s=>s.includes('行囊有序'))&&!eye.lines.some(s=>/^MC_CHALLENGE|^MC_CLI_HELP/.test(s)));
 check('unrelated player never sees Agent result',!human.lines.some(s=>s.includes(id))||human.lines.filter(s=>s.includes(id)).every(s=>s.startsWith('MC_CHALLENGE ')&&JSON.parse(s.slice(13)).reason==='record_unavailable'));
 check('no native protocol errors',report.errors.length===0);report.passed=true;
}catch(error){report.failure=String(error.stack);process.exitCode=1;}
finally{closing=true;for(const b of bots)try{b.quit('Isolated CLI contract check complete');}catch{}await sleep(300);const path=output+'/cli-native-'+Date.now()+'.json';fs.writeFileSync(path,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,failure:report.failure,errors:report.errors,path}));process.exit(process.exitCode??0);}
