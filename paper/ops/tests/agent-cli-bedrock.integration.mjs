// Native Bedrock through the isolated Geyser/Floodgate fixture, not phone/Xbox QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../rcon-client.mjs';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(stage+'/server.properties','utf8');assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);
const geyser=fs.readFileSync(stage+'/plugins/Geyser-Spigot/config.yml','utf8').split(/^java:/m)[0];assert.match(geyser,/^ {2}address: 127\.0\.0\.1$/m);
const port=Number(geyser.match(/^ {2}port: (\d+)$/m)?.[1]);assert.equal(port,19182);
const require=createRequire(process.env.MC_TEST_BEDROCK_REQUIRE_FROM??'E:/MC/research/bedrock-ysm-20261010/protocol-client/package.json');const be=require('bedrock-protocol');
const rcon=q=>command(q,15000,{properties:stage+'/server.properties',port:Number(props.match(/^rcon.port=(\d+)/m)?.[1])});
const report={at:new Date().toISOString(),scope:'native Bedrock isolated protocol; no physical device acceptance',checks:[],texts:[],errors:[]};let client,spawned=false,closing=false;
report.candidateSha256=createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.29.jar')).digest('hex');
const check=(name,value)=>{report.checks.push({name,pass:!!value});assert(value,name);console.log('PASS '+name);};
async function until(fn,name,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const v=fn();if(v)return v;await sleep(50);}throw Error('Timeout '+name);}
async function ask(q,prefix){await sleep(1100);const at=report.texts.length;client.write('command_request',{command:q,origin:{type:'player',uuid:randomUUID(),request_id:'',player_entity_id:0n},internal:false,version:'52'});
  return until(()=>report.texts.slice(at).filter(s=>s.startsWith(prefix+' ')).map(s=>JSON.parse(s.slice(prefix.length+1))).find(Boolean),q);}
try{
  check('isolated candidate is active',(await rcon('version AgentFriend')).includes('0.4.29'));
  client=be.createClient({host:'127.0.0.1',port,version:'1.26.51',offline:true,username:'CliBE29',raknetBackend:'raknet-native',useRaknetWorkers:false,connectTimeout:15000});
  client.on('session',p=>p.xuid='9000000987459');client.on('spawn',()=>spawned=true);client.on('error',e=>report.errors.push(e.message));client.on('disconnect',p=>{if(!closing)report.errors.push(JSON.stringify(p));});
  client.on('text',p=>report.texts.push(p.message.replace(/§[0-9a-fk-or]/gi,'')));await until(()=>spawned,'Bedrock spawn');
  const state=await ask('/mycli status --json','MC_STATUS');check('Bedrock reads universal read-only status',state.readOnly&&state.sessionId&&state.authentication.authorized===null&&state.skillsCommand==='/mycli skills status');
  const help=await ask('/mycli skills learn fireworks --help','MC_CLI_DETAIL');check('standard help is translated without performing learning',help.id==='skills.learn'&&help.discoveryReadOnly);
  const skill=await ask('/mycli skills status fireworks','MC_PAGE');check('skill eligibility survives Bedrock text translation',skill.items[0].id==='fireworks'&&skill.items[0].supported&&skill.items[0].learned===false&&skill.items[0].canUseNow===false);
  let page=await ask('/mycli progress main 1','MC_PAGE');const initial=page;const fragments=[];let overview;
  while(true){for(const row of page.items){if(row.encoding==='summary')overview=row;if(row.encoding==='json_fragment')fragments.push(row.data);}
    if(!page.nextCommand)break;page=await ask(page.nextCommand,'MC_PAGE');assert.equal(page.snapshotId,initial.snapshotId);}
  const main=fragments.length?JSON.parse(fragments.join('')):initial.items[0];check('full mainline detail remains lossless over Geyser',main.section==='main'&&!main.graduated&&main.nextCommand==='/mycli guild join'&&(!overview||overview.stage===main.stage));
  const invalid=await ask('/mycli page '+randomUUID()+' 1','MC_QUERY_ERROR');check('Bedrock receives actionable stable paging failure',invalid.errorCode==='SNAPSHOT_EXPIRED'&&invalid.nextCommand==='/mycli status'&&invalid.retryPolicy);
  check('all new machine messages fit chat limit',report.texts.filter(s=>/^MC_(STATUS|PAGE|QUERY_ERROR|CLI_)/.test(s)).every(s=>s.length<4000));check('no Bedrock protocol errors',report.errors.length===0);
}catch(error){report.errors.push(error.stack??String(error));}
finally{closing=true;client?.close();await sleep(400);report.passed=report.errors.length===0&&report.checks.every(r=>r.pass);fs.writeFileSync(root+'/observations-bedrock.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));process.exit(report.passed?0:1);}
