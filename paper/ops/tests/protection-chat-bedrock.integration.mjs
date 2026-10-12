// Real Bedrock protocol through an isolated loopback Geyser, using the existing
// self-signed Floodgate test fixture. This is not phone/Xbox pixel acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1$/m);
assert.match(props,/^server-port=256\d\d$/m);
const geyser=fs.readFileSync(stage+'/plugins/Geyser-Spigot/config.yml','utf8').split(/^remote:/m)[0];
assert.match(geyser,/^ {2}address: 127\.0\.0\.1$/m);
const port=Number(geyser.match(/^ {2}port: (\d+)$/m)?.[1]);assert(port>=19150&&port!==19132);
const {command}=await import(pathToFileURL((process.env.MC_TEST_OPS??'E:/MC/ops')+'/rcon-client.mjs'));
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(256\d\d)$/m)?.[1])});
const require=createRequire(process.env.MC_TEST_BEDROCK_REQUIRE_FROM??'E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json');
const be=require('bedrock-protocol');
const report={at:new Date().toISOString(),scope:'isolated self-signed Floodgate; no physical device rendering claim',checks:[],texts:[],errors:[]};
let client,spawned=false,finishing=false;
const check=(label,ok)=>{assert(ok,label);report.checks.push(label);};
async function until(fn,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(100);}throw Error('Timeout: '+label);}
function send(q){client.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});}
try{
 check('exact candidate version loaded',(await rc('version AgentFriend')).includes('0.4.32'));
 client=be.createClient({host:'127.0.0.1',port,version:'1.26.51',offline:true,username:'ProtectBE32',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
 client.on('session',p=>{p.xuid='9000000987432';});client.on('spawn',()=>{spawned=true;});
 client.on('error',e=>report.errors.push(e.message));client.on('disconnect',p=>{if(!finishing)report.errors.push(JSON.stringify(p));});
 client.on('text',p=>report.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));
 await until(()=>spawned,'Bedrock connects');check('ordinary Bedrock logs in through Geyser',true);
 await rc('minecraft:gamemode survival .ProtectBE32');await rc('minecraft:tp .ProtectBE32 -502.5 68 -437.5');await sleep(1500);
 let at=report.texts.length;send('/mycli protect break -504 68 -437');await until(()=>report.texts.slice(at).some(s=>s.includes('【正确做法】')),'Chinese protection query');await sleep(300);
 let lines=report.texts.slice(at);
 check('default protection query is Chinese without raw JSON',lines.some(s=>s.includes('【操作未执行】'))&&lines.some(s=>s.includes('【保护范围】'))&&!lines.some(s=>s.startsWith('MC_PROTECTION ')));
 check('real protected boundary survives Bedrock translation',lines.some(s=>s.includes('-513,66,-437')&&s.includes('-500,113,-423')));
 check('human next steps explain original doors and ladders',lines.some(s=>s.includes('铁门找按钮')&&s.includes('梯')));
 at=report.texts.length;send('/mycli protect break -504 68 -437 --json');await until(()=>report.texts.slice(at).some(s=>s.startsWith('MC_PROTECTION ')),'explicit JSON');
 const data=JSON.parse(report.texts.slice(at).find(s=>s.startsWith('MC_PROTECTION ')).slice(14));
 check('explicit --json remains available on Bedrock',data.schemaVersion===1&&data.reason==='village_structure'&&data.allowed===false&&data.areas.length>0&&data.nextCommands.length>0);
 await rc('minecraft:tp .ProtectBE32 -502.5 121 -437.5');await sleep(1200);at=report.texts.length;
 send('/mycli protect break -504 121 -437');await until(()=>report.texts.slice(at).some(s=>s.includes('【保护查询】')),'allowed human query result');
 check('allowed query still gives visible feedback',report.texts.slice(at).some(s=>s.includes('可尝试操作')&&s.includes('实际操作结果')));
 check('no Bedrock protocol errors',report.errors.length===0);
}catch(e){report.errors.push(e.stack??String(e));}
finally{
 finishing=true;client?.close();await sleep(500);report.success=report.errors.length===0;
 const run=process.env.MC_TEST_RUN_LABEL??'1';assert.match(run,/^[a-z0-9-]{1,16}$/);
 fs.writeFileSync(path.join(root,'protection-bedrock-'+run+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({success:report.success,checks:report.checks,errors:report.errors}));process.exit(report.success?0:1);
}
