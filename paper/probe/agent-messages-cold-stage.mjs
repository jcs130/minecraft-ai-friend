import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';import {command} from '../ops/rcon-client.mjs';
const stage='E:/MC/staging/agent-messages-20261020',root='E:/MC/ops/repairs/agent-messages-20261020';
assert.equal(fs.readFileSync(stage+'/.agent-message-stage','utf8').trim(),'agent-messages-20261020');
const r={checks:[],errors:[]},bots=[],mf=createRequire('E:/MC/probe/package.json')('mineflayer');
const check=(name,pass,evidence)=>{r.checks.push({name,pass:!!pass,evidence});assert(pass,name);console.log('PASS '+name);};
const rc=q=>command(q,15000,{port:25979,properties:stage+'/server.properties'});
async function until(fn,label,ms=30000){for(const end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await sleep(100);}throw Error('Timeout '+label);}
let closing=false;
try{
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.47.8');}catch{return false;}},'cold startup',120000);
 const reportFiles=fs.readdirSync(root).filter(s=>/^native-\d+\.json$/.test(s)).sort().reverse();
 const previous=reportFiles.map(s=>JSON.parse(fs.readFileSync(root+'/'+s,'utf8'))).find(v=>v.passed);
 assert(previous,'successful initial run required');
 const lines=previous.checks.find(c=>c.name==='human first join has one short introduction').evidence;
 const visitor=lines.join('\n').match(/\b(MsgV\d+)\b/)[1];
 async function join(name){await rc('minecraft:whitelist add '+name);const b=mf.createBot({host:'127.0.0.1',port:25978,username:name,version:'1.21.1',auth:'offline',checkTimeoutInterval:60000});bots.push(b);b.lines=[];b.frames=[];b.numen=[];b.on('messagestr',s=>b.lines.push(s));b.on('error',e=>{if(!closing)r.errors.push(e.message)});b._client.on('custom_payload',p=>{if(p.channel==='qiandengji:agent')b.frames.push(JSON.parse(p.data.toString('utf8')));else if(p.channel==='numen_api:hello_ack')b.numen.push(p.data.toString('hex'));});await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),'chunks');return b;}
 const h=await join(visitor),a=await join('ag_MsgProbe20');await sleep(11000);
 check('human introduction remains deduplicated after JVM restart',!h.lines.some(s=>s.includes('新手说明与玩法按需查看')));
 check('Agent cold join has no automatic state/guide dump',!a.lines.some(s=>/^MC_(STATUS|GUIDE|GUIDE_NEXT) /.test(s)));
 a.chat('/mycli status');await until(()=>a.lines.some(s=>s.startsWith('MC_STATUS ')),'cold private fallback');
 check('payload selection cannot leak across connections/restarts',!a.frames.length&&a.lines.some(s=>s.startsWith('MC_STATUS ')));
 a._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:agent')});await sleep(200);
 a._client.write('custom_payload',{channel:'qiandengji:agent',data:Buffer.from('{"op":"hello","protocol":1,"transport":"payload"}')});await until(()=>a.frames.some(f=>f.type==='hello_ack'),'cold channel acknowledgement');
 await sleep(1200);a.chat('/mycli status --json');await until(()=>a.frames.some(f=>f.type==='MC_STATUS'),'cold payload');
 check('cold payload retains complete correlation',a.frames.find(f=>f.type==='MC_STATUS').data.sessionId);
 h._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('numen_api:hello\0numen_api:hello_ack\0numen_api:companion_list')});await sleep(200);
 h._client.write('custom_payload',{channel:'numen_api:hello',data:Buffer.from([3])});await until(()=>h.numen.length,'Numen handshake');
 check('Numen native channel returns protocol 3 non-admin handshake',h.numen[0]==='0300');
 h.chat('/numen player summon nu_msg20');await until(()=>h.players.nu_msg20?.entity,'real Numen companion');await sleep(3000);
 check('non-OP player summons visible real Numen companion',h.players.nu_msg20.uuid&&h.players.nu_msg20.entity.id,{uuid:h.players.nu_msg20.uuid,entityId:h.players.nu_msg20.entity.id});
 check('Numen and player were not granted OP',JSON.parse(fs.readFileSync(stage+'/ops.json','utf8')).length===0);
 h.chat('/numen player despawn nu_msg20');await until(()=>!h.players.nu_msg20,'owned test companion retirement');
 check('owner can retire own test companion through original command',!h.players.nu_msg20);
 check('cold Numen Bedrock adapter remains enabled',/0\.1\.0/.test(await rc('version NumenBedrock')));
 check('no native protocol errors',r.errors.length===0,r.errors);r.passed=true;
}catch(error){r.failure=String(error.stack);process.exitCode=1;}
finally{closing=true;for(const b of bots)try{b.quit('冷启动验证完成');}catch{}await sleep(400);fs.writeFileSync(root+'/cold-'+Date.now()+'.json',JSON.stringify(r,null,2));console.log(JSON.stringify({passed:!!r.passed,checks:r.checks.length,errors:r.errors,failure:r.failure}));process.exit(process.exitCode??0);}
