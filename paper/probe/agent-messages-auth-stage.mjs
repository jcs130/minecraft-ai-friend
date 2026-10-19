// Isolated real LibreLogin + NanoLimbo + LoginGuard + Paper handshake.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const stage='E:/MC/staging/agent-messages-20261020',root='E:/MC/ops/repairs/agent-messages-20261020';
assert.equal(fs.readFileSync(stage+'/auth-proxy/.owned-auth-fixture','utf8'),'agent-messages-20261020');
const credentials=JSON.parse(fs.readFileSync(root+'/auth-fixture-credentials.private.json','utf8'));
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mf=require('mineflayer'),report={checks:[],errors:[],version:process.env.MC_AUTH_PROBE_VERSION??'1.20.6'},bots=[];
let closing=false;const check=(name,ok,evidence)=>{report.checks.push({name,pass:!!ok,evidence});assert(ok,name);console.log('PASS '+name);};
const rc=q=>command(q,15000,{port:25979,properties:stage+'/server.properties'});
async function until(fn,label,ms=40000){for(const end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await sleep(100);}throw Error('Timeout '+label);}
async function connect(username){
 await rc('minecraft:whitelist add '+username);
 // This probe verifies authentication, not pre-auth movement. Start gameplay
 // only after the final marker; old Mineflayer otherwise writes motion as
 // configuration settings while leaving NanoLimbo on protocol 767.
 const b=mf.createBot({host:'127.0.0.1',port:25981,username,version:report.version,auth:'offline',physicsEnabled:false,checkTimeoutInterval:60000});b.physicsEnabled=false;bots.push(b);installRecipePacketBypass(b._client);b.lines=[];b.frames=[];
 b.on('messagestr',m=>b.lines.push(m));b.on('error',e=>{if(!closing)report.errors.push(e.message);});
 b._client.on('custom_payload',p=>{if(p.channel==='qiandengji:agent')b.frames.push(JSON.parse(p.data.toString('utf8')));});
 await until(()=>b.lines.some(s=>s.startsWith('[MC_AUTH_LOGIN]')),'login prompt');return b;
}
try{
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.47.8');}catch{return false;}},'Paper fixture readiness',120000);
 await until(()=>{try{return JSON.parse(fs.readFileSync(stage+'/auth-proxy/auth-heartbeat.json','utf8')).ready;}catch{return false;}},'isolated proxy readiness');
 const b=await connect('ag_PwMsg20');await sleep(2000);
 check('pending login is not automatically dumped as JSON',!b.lines.some(s=>s.startsWith('MC_AUTH_STATE ')),b.lines);
 b.chat('/mycli cast blink');await until(()=>b.lines.some(s=>s.startsWith('[MC_AUTH_DENIED]')),'pre-auth action rejection');
 check('unauthenticated custom actions remain blocked',!b.lines.some(s=>s.startsWith('[MC_AUTH_SUCCESS]')));
 b.chat('/authstatus');await until(()=>b.lines.some(s=>s.startsWith('MC_AUTH_STATE ')),'explicit pending observation');
 const pending=JSON.parse(b.lines.find(s=>s.startsWith('MC_AUTH_STATE ')).slice(14));
 check('explicit authstatus still returns accurate pending correlation',pending.status==='pending'&&pending.authorized===false&&pending.authSessionId);
 const before=b.lines.length;b.chat('/login '+credentials[b.username]);
 await until(()=>b.lines.some(s=>s==='[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。'),'final authorized Paper success');await sleep(2500);
 const final=b.lines.slice(before).filter(s=>s.startsWith('MC_AUTH_STATE ')).map(s=>JSON.parse(s.slice(14)));
 check('final authentication state emitted once',final.length===1&&final[0].authorized&&final[0].status==='authenticated',final);
 check('automatic auth chat omits changing IDs',!final[0].authSessionId&&!final[0].observedAt&&!final[0].playerUuid);
 check('automatic auth preserves password and next command',final[0].passwordSet===true&&final[0].nextCommand==='/mycli status');
 check('success marker remains stable and unique',b.lines.filter(s=>s==='[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。').length===1);
 b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:agent')});await sleep(200);
 b._client.write('custom_payload',{channel:'qiandengji:agent',data:Buffer.from('{"op":"hello","protocol":1,"transport":"payload"}')});
 await until(()=>b.frames.some(f=>f.type==='hello_ack'),'Paper handshake through auth proxy');
 const from=b.lines.length;b.chat('/authstatus');await until(()=>b.frames.some(f=>f.type==='MC_AUTH_STATE'),'private proxy observation payload');
 check('proxy honors negotiated transport for authstatus',b.frames.find(f=>f.type==='MC_AUTH_STATE').data.authSessionId&&!b.lines.slice(from).some(s=>s.startsWith('MC_AUTH_STATE ')));
 b.chat('/mycli status --json');await until(()=>b.frames.some(f=>f.type==='MC_STATUS'),'Paper payload through auth proxy');
 check('gameplay query passes after actual authentication',b.frames.find(f=>f.type==='MC_STATUS').data.name===b.username);
 check('no protocol errors',report.errors.length===0,report.errors);report.passed=true;
}catch(error){report.failure=String(error.stack);process.exitCode=1;}
finally{closing=true;for(const b of bots)try{b.quit('认证消息隔离验证完成');}catch{}await sleep(500);fs.writeFileSync(root+'/auth-native-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,errors:report.errors,failure:report.failure}));process.exit(process.exitCode??0);}
