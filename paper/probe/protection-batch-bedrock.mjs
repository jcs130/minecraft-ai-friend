// Actual Geyser/Floodgate protocol check; does not substitute for phone/Xbox visual QA.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
const stage='E:/MC/staging/life-challenges-20261014/paper',output='E:/MC/ops/repairs/protection-batch-20261014';
const properties=stage+'/server.properties',props=fs.readFileSync(properties,'utf8');
assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/^server-port=25678\r?$/m);
assert.match(props,/^rcon.port=25679\r?$/m);assert.match(props,/^motd=Life challenges isolated check\r?$/m);
const report={at:new Date().toISOString(),protocol:2193,checks:[],errors:[],texts:[],sha256:createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.40.jar')).digest('hex')};
const rc=q=>command(q,15000,{port:25679,properties});let be,closing=false,spawned=false,last=0;
async function until(fn,label,ms=30000){for(const end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await sleep(80);}throw Error('Timeout '+label);}
function check(name,ok){report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);}
async function send(q){await sleep(Math.max(0,1100-(Date.now()-last)));last=Date.now();const at=report.texts.length;be.write('command_request',{command:'/mycli '+q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});return at;}
async function json(q,prefix){const at=await send(q);const line=await until(()=>report.texts.slice(at).find(t=>t.startsWith(prefix)),q);await sleep(150);return {data:JSON.parse(line.slice(prefix.length)),lines:report.texts.slice(at)};}
try{
 check('candidate running',(await rc('version AgentFriend')).includes('0.4.40'));assert.match(await rc('protectionqa setup'),/PROTECTION_QA_OK/);
 const bp=createRequire('E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json')('bedrock-protocol');
 const suffix=String(Date.now()).slice(-5),name='ProtBE'+suffix;
 be=bp.createClient({host:'127.0.0.1',port:19182,version:'1.26.51',offline:true,username:name,raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:20000});
 be.on('session',p=>{p.xuid='90000000000'+suffix;});be.on('spawn',()=>spawned=true);
 be.on('text',p=>report.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));
 be.on('error',e=>{if(!closing)report.errors.push(e.message);});
 await until(()=>spawned,'Bedrock world',45000);check('Bedrock connected through Geyser',(await rc('minecraft:list')).includes('.'+name));
 await rc('minecraft:tp .'+name+' 2003.5 101 2003.5');await sleep(1000);
 let at=await send('protect break 2002 100 2002');await until(()=>report.texts.slice(at).some(t=>t.includes('【保护查询】')),'Chinese single query');
 check('default single has Chinese without JSON',report.texts.slice(at).some(t=>t.includes('【保护范围】'))&&!report.texts.slice(at).some(t=>t.startsWith('MC_PROTECTION')));
 at=await send('protect batch break --box 2000 100 2000 2007 100 2007');await until(()=>report.texts.slice(at).some(t=>t.includes('共64个目标')),'Chinese batch');
 check('default batch is readable and bounded',report.texts.slice(at).filter(t=>t.includes('个目标')||t.includes('逐块结果')).length<=5&&!report.texts.slice(at).some(t=>t.startsWith('MC_PROTECTION')));
 let r=await json('protect batch break --box 2000 100 2000 2007 100 2007 --json','MC_PROTECTION_BATCH ');
 check('explicit batch returns one complete standard JSON',r.data.complete&&r.data.total===64&&r.data.counts.deny===32&&r.data.counts.allow_likely===32&&r.lines.filter(t=>t.startsWith('MC_PROTECTION_BATCH ')).length===1);
 check('JSON has no repeated human explanation',!r.lines.some(t=>/【保护查询】|逐块结果/.test(t)));
 r=await json('protect break 2002 100 2002 --verbose --json','MC_PROTECTION ');
 check('full rules available on demand',r.data.status==='deny'&&r.data.areas.length>0&&r.data.nextCommands.length>0);
 r=await json('protect batch --help --json','MC_CLI_HELP ');check('standard help advertises batch',r.data.actionReadOnly&&r.data.usage.includes('batch'));
 r=await json('protect batch break 2002,100,2002 2002,-100,2002 --json','MC_PROTECTION_BATCH ');
 check('unknown preserved distinctly on Bedrock',r.data.counts.unknown===1&&r.data.groups.find(g=>g.status==='unknown').allowed===null);
 check('no protocol errors',report.errors.length===0);report.passed=true;
}catch(error){report.failure=String(error.stack);process.exitCode=1;}
finally{try{await rc('protectionqa clear');}catch(error){report.errors.push('cleanup: '+error.message);}closing=true;be?.close();await sleep(300);const file=output+'/bedrock-'+Date.now()+'.json';fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,failure:report.failure,errors:report.errors,file}));process.exit(process.exitCode??0);}
