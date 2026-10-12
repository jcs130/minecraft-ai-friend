// Native Bedrock command and inventory translation through isolated Geyser.
// A self-signed Floodgate fixture cannot certify phone/Xbox rendering or input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../rcon-client.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&process.env.MC_TEST_BEDROCK_REQUIRE_FROM&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const geyser=fs.readFileSync(stage+'/plugins/Geyser-Spigot/config.yml','utf8').split(/^java:/m)[0];
assert.match(geyser,/^ {2}address: 127\.0\.0\.1$/m);const port=Number(geyser.match(/^ {2}port: (\d+)$/m)?.[1]);assert(port>=19150&&port!==19132);
const rcon=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(\d+)/m)?.[1])});
const require=createRequire(process.env.MC_TEST_BEDROCK_REQUIRE_FROM),be=require('bedrock-protocol');
const label=process.argv[2]??'1';assert.match(label,/^[a-z0-9]{1,8}$/);
const report={scope:'isolated self-signed Floodgate; no physical phone/Xbox acceptance',at:new Date().toISOString(),checks:[],texts:[],opens:[],contents:[],errors:[]};let client,spawned=false,finishing=false;
report.candidateSha256=createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.27.jar')).digest('hex');
function check(name,ok){report.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);}
async function until(fn,name,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(50);}throw Error('Timeout '+name);}
function send(q){client.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});}
async function ask(q,prefix,test=()=>true){await sleep(1100);const at=report.texts.length;send(q);await until(()=>report.texts.slice(at).some(s=>s.startsWith(prefix+' ')&&test(JSON.parse(s.slice(prefix.length+1)))),q);await sleep(150);return report.texts.slice(at).filter(s=>s.startsWith(prefix+' ')).map(s=>JSON.parse(s.slice(prefix.length+1))).filter(test);}
try {
  check('exact candidate is active on the isolated server',(await rcon('version AgentFriend')).includes('0.4.27'));
  client=be.createClient({host:'127.0.0.1',port,version:'1.26.51',offline:true,username:'EntryBE27',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
  client.on('session',p=>p.xuid='9000000987451');client.on('spawn',()=>spawned=true);
  client.on('error',e=>report.errors.push(e.message));client.on('disconnect',p=>{if(!finishing)report.errors.push(JSON.stringify(p));});
  client.on('text',p=>report.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));
  client.on('container_open',p=>report.opens.push(p));client.on('inventory_content',p=>report.contents.push(p));
  await until(()=>spawned,'Bedrock spawn');check('native Bedrock connects through Geyser',true);
  const intro=(await ask('/mycli','MC_INTRO'))[0];check('default mycli gives compact Chinese entry on Bedrock',intro.language==='zh-CN'&&intro.rulesCommand==='/mycli rules'&&intro.progressCommand==='/mycli progress'&&intro.readOnly);
  check('ordinary Bedrock has help and rules permissions',intro.normalHelpAllowed&&intro.normalRulesAllowed);
  const rules=(await ask('/mycli rules 2','MC_RULES'))[0];check('Bedrock reads complete final rules page',rules.readOnly&&rules.page===2&&rules.rules.length===4);
  const lessons=(await ask('/mycli coach lessons','MC_COACH',o=>o.type==='lessons'))[0];check('lesson query does not enroll a fresh Bedrock player',lessons.enrolled===false);
  const progress=await ask('/mycli progress','MC_PROGRESS');check('all progress rows survive Geyser translation',progress.length===progress[0].pages&&progress.every(r=>r.snapshotId===progress[0].snapshotId)&&new Set(progress.map(r=>r.progress.section)).size===3);
  const enroll=(await ask('/mycli coach enroll','MC_COACH',o=>o.type==='feature_enrollment'))[0];check('Bedrock enrollment returns actual success',enroll.status==='success'&&enroll.enrolled);
  const detail=(await ask('/mycli capabilities info coach.cancel','MC_CLI_DETAIL'))[0];check('Bedrock sees effect, permissions, costs and cancellation semantics',detail.discoveryReadOnly&&detail.semantics.operation==='cancel'&&detail.semantics.permission&&detail.semantics.consumption&&detail.semantics.resultQuery);
  const cancel=(await ask('/mycli coach cancel','MC_COACH',o=>o.type==='feature_enrollment'))[0];check('Bedrock explicit cancel retains independent progress',cancel.status==='success'&&cancel.enrolled===false);
  send('/mycli coach menu');await until(()=>report.opens.length&&report.contents.some(p=>p.window_id!==0&&p.input?.length>=27),'translated onboarding GUI');
  const contents=JSON.stringify(report.contents,(_k,v)=>typeof v==='bigint'?v.toString():v);check('native menu includes separate view, enrollment and cancellation buttons',contents.includes('查看特色实练')&&contents.includes('报名特色实练')&&contents.includes('取消特色实练报名'));
  check('structured responses are complete within chat limit',report.texts.filter(s=>/^MC_(INTRO|RULES|PROGRESS|CLI_)/.test(s)).every(s=>s.length<4000));check('no Bedrock protocol errors',report.errors.length===0);
}catch(e){report.errors.push(e.stack??String(e));}
finally{finishing=true;client?.close();await sleep(400);report.passed=report.errors.length===0&&report.checks.every(c=>c.pass);fs.writeFileSync(root+'/entry-bedrock-'+label+'.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));process.exit(report.passed?0:1);}
