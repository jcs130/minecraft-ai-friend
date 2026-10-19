// Real packet tests. Only the explicitly marked loopback fixture is allowed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';
import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
import {latestChatTypes,componentUuid} from './verify-native-chat-capture.mjs';
const stage='E:/MC/staging/agent-messages-20261020',root='E:/MC/ops/repairs/agent-messages-20261020';
assert.equal(fs.readFileSync(stage+'/.agent-message-stage','utf8').trim(),'agent-messages-20261020');
assert.match(fs.readFileSync(stage+'/server.properties','utf8'),/^server-ip=127\.0\.0\.1\r?$/m);
const require=createRequire('E:/MC/probe/package.json'),mineflayer=require('mineflayer');
fix1206PotionProtocol(require);
const report={checks:[],errors:[],mineflayer:require('mineflayer/package.json').version},bots=[];
let closing=false;
const check=(name,ok,evidence)=>{report.checks.push({name,pass:!!ok,evidence});assert(ok,name);console.log('PASS '+name);};
const rc=q=>command(q,15000,{port:25979,properties:stage+'/server.properties'});
async function until(fn,label,ms=30000){for(const end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await sleep(100);}throw Error('Timeout '+label);}
async function join(username,version='1.21.1'){
 await rc('minecraft:whitelist add '+username);
 const b=mineflayer.createBot({host:'127.0.0.1',port:25978,username,version,auth:'offline',checkTimeoutInterval:60000});bots.push(b);
 installRecipePacketBypass(b._client);b.lines=[];b.frames=[];b.packets=[];b.cameras=[];b.registries=[];
 b.on('messagestr',m=>b.lines.push(m));b.on('error',e=>{if(!closing)report.errors.push(e.message);});
 b._client.on('packet',(data,meta)=>{if(['profileless_chat','player_chat','system_chat','boss_bar'].includes(meta.name))b.packets.push({name:meta.name,data});});
 b._client.on('camera',p=>b.cameras.push(p.cameraId));
 b._client.on('registry_data',p=>{if(p.id==='minecraft:chat_type')b.registries.push(p);});
 b._client.on('custom_payload',p=>{if(p.channel==='qiandengji:agent'){try{b.frames.push(JSON.parse(p.data.toString('utf8')));}catch(e){report.errors.push('Invalid agent frame');}}});
 await until(()=>b.entity&&b.world.getColumnAt(b.entity.position),username+' chunks',60000);return b;
}
async function chat(b,text){await sleep(Math.max(0,1150-(Date.now()-(b.lastChat??0))));b.lastChat=Date.now();b.chat(text);}
async function query(b,text,prefix,channel=false){const at=channel?b.frames.length:b.lines.length;await chat(b,text);return until(()=>channel?b.frames.slice(at).find(f=>f.type===prefix)?.data:b.lines.slice(at).find(s=>s.startsWith(prefix+' ')),'query '+text);}
const hello=async b=>{
 b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:agent')});await sleep(200);
 b._client.write('custom_payload',{channel:'qiandengji:agent',data:Buffer.from('{"op":"hello","protocol":1,"transport":"payload"}')});
};
const close=async b=>{b.quit('消息隔离验证完成');await until(()=>b._client.ended,b.username+' closed',5000);};
try{
 await until(async()=>{try{return (await rc('version AgentFriend')).includes('0.4.47.8');}catch{return false;}},'candidate startup',120000);
 const visitor='MsgV'+Date.now().toString().slice(-8);
 const a=await join('ag_MsgProbe20'),h=await join(visitor),e=await join('ag_MsgProbe_eye');
 await sleep(11000);
 check('Agent join has no GUIDE/STATUS/NEXT dump',!a.lines.some(s=>/^MC_(GUIDE|STATUS|GUIDE_NEXT) /.test(s)),a.lines);
 check('no automatic skill/photo/life discovery spam',!a.lines.some(s=>/系统·技能目录|\[照片\]|\[村庄生活季\]/.test(s)));
 check('human first join has one short introduction',h.lines.filter(s=>s.includes('新手说明与玩法按需查看')).length===1,h.lines);
 check('human no long onboarding JSON',!h.lines.some(s=>/^MC_(GUIDE|INTRO|STATUS|GUIDE_NEXT) /.test(s)));
 let response=JSON.parse((await query(a,'/mycli status','MC_STATUS')).slice('MC_STATUS '.length));
 check('legacy Agent private status remains usable',response.name===a.username&&response.nextCommand);
 check('legacy default status drops only volatile metadata',!response.sessionId&&!response.observedAt&&!response.playerUuid&&!response.authentication.authSessionId,response);
 response=JSON.parse((await query(a,'/mycli status --json','MC_STATUS')).slice('MC_STATUS '.length));
 check('explicit JSON preserves full protocol correlation',response.sessionId&&response.observedAt&&response.playerUuid,response);
 const beforeHuman=h.lines.length;await chat(h,'/mycli status');await sleep(700);
 check('ordinary human status is readable without JSON',h.lines.slice(beforeHuman).some(s=>s.includes('当前状态'))&&!h.lines.slice(beforeHuman).some(s=>s.startsWith('MC_STATUS ')));
 a._client.write('custom_payload',{channel:'qiandengji:agent',data:Buffer.from('{"op":"hello","protocol":1,"transport":"payload"}')});await sleep(250);
 check('unregistered hello cannot disable chat fallback',!a.frames.some(f=>f.type==='hello_ack'));
 await sleep(3100);response=JSON.parse((await query(a,'/mycli status','MC_STATUS')).slice('MC_STATUS '.length));
 check('missing channel registration still returns actual status',response.name===a.username);
 await hello(h);await sleep(400);check('human cannot enable machine payload channel',!h.frames.some(f=>f.type==='hello_ack'));
 a._client.write('custom_payload',{channel:'qiandengji:agent',data:Buffer.from('{"op":"hello","protocol":1,"transport":"payload","authorized":true}')});await sleep(400);
 check('untrusted extra authorization claim rejected',!a.frames.some(f=>f.type==='hello_ack'));
 await hello(a);await until(()=>a.frames.some(f=>f.type==='hello_ack'),'payload acknowledgement');
 const at=a.lines.length;response=await query(a,'/mycli status --json','MC_STATUS',true);
 check('negotiated payload carries full private status',response.name===a.username&&response.sessionId&&response.observedAt);
 check('payload replaces chat instead of duplicating it',!a.lines.slice(at).some(s=>s.startsWith('MC_STATUS ')));
 response=await query(a,'/mycli coach next','MC_COACH',true);
 check('existing command receipts also use payload',response.onboarding||response.nextCommand,response);
 check('protection bounds and NPC guidance retained',JSON.stringify(response).includes('X=-1146..-1078')&&JSON.stringify(response).includes('-1099'),response);
 const incoming=a.packets.length,outgoing=h.packets.length,stranger=e.lines.length;
 await chat(h,'/msg '+a.username+' 私聊协议验收');
 await until(()=>a.packets.slice(incoming).some(p=>p.name==='profileless_chat'||p.name==='player_chat'),'native private chat');
 const inPackets=a.packets.slice(incoming).filter(p=>p.name==='profileless_chat'||p.name==='player_chat');
 const outPackets=h.packets.slice(outgoing).filter(p=>p.name==='profileless_chat'||p.name==='player_chat');
 check('msg uses native incoming/outgoing chat packets',inPackets.length===1&&outPackets.length===1,{inPackets,outPackets});
 const types=latestChatTypes(a.registries),type=p=>types[typeof p.data.type==='number'?p.data.type:p.data.type.chatType]?.key;
 check('native whisper types come from final registry',type(inPackets[0])==='minecraft:msg_command_incoming'&&type(outPackets[0])==='minecraft:msg_command_outgoing');
 check('private sender UUID is preserved',componentUuid(inPackets[0].data.name)===h.player.uuid);
 check('private chat not sent as system JSON/text',!a.packets.slice(incoming).some(p=>p.name==='system_chat'&&JSON.stringify(p.data).includes('私聊协议验收')));
 check('Eye never receives body machine receipts',!e.lines.some(s=>/^MC_(STATUS|COACH) /.test(s)));
 check('unrelated human never receives Agent status',!h.lines.some(s=>s.startsWith('MC_STATUS ')));
 for(const alias of ['tell','w','minecraft:msg']){
  const offset=a.packets.length;await chat(h,'/'+alias+' '+a.username+' 原版别名-'+alias);await sleep(300);
  const received=a.packets.slice(offset).filter(p=>p.name==='profileless_chat'||p.name==='player_chat');
  check(alias+' is one native incoming whisper',received.length===1&&type(received[0])==='minecraft:msg_command_incoming');
 }
 await rc('minecraft:damage '+a.username+' 1');await sleep(400);check('damage still reaches normal entity state',a.health<20);
 const bars=a.packets.length,warnings=a.lines.length;
 const eventReceipt=await rc('wevent start qd-clear-sight');report.eventReceipt=eventReceipt;
 await until(()=>a.packets.slice(bars).some(p=>p.name==='boss_bar'),'actual village event bar');
 await sleep(47000);
 const eventPackets=a.packets.slice(bars).filter(p=>p.name==='boss_bar');
 check('actual event bar is bounded, not per second',eventPackets.length<=10&&eventPackets.some(p=>p.data.action===0)&&eventPackets.some(p=>p.data.action===1),eventPackets);
 const warningsSeen=a.lines.slice(warnings).filter(s=>s.includes('秒结束'));
 check('only one 30-second countdown warning',warningsSeen.length===1&&warningsSeen[0].includes('30'),warningsSeen);
 await rc('minecraft:bossbar add minecraft:msgtest "突袭战斗进度"');await rc('minecraft:bossbar set minecraft:msgtest players '+a.username);
 const combatAt=a.packets.length;await rc('minecraft:bossbar set minecraft:msgtest value 97');await rc('minecraft:bossbar set minecraft:msgtest value 96');await rc('minecraft:bossbar set minecraft:msgtest value 95');await sleep(200);
 check('combat-style bar is not throttled',a.packets.slice(combatAt).filter(p=>p.name==='boss_bar'&&p.data.action===2).length===3);
 await rc('minecraft:bossbar remove minecraft:msgtest');
 await close(h);const again=await join(visitor);await sleep(10000);
 check('human introduction persists across reconnect',!again.lines.some(s=>s.includes('新手说明与玩法按需查看')));
 await close(a);const legacy=await join('ag_MsgProbe20','1.20.6');await sleep(3500);
 check('Agent reconnect is quiet',!legacy.lines.some(s=>/^MC_(GUIDE|STATUS|GUIDE_NEXT) /.test(s)));
 const old=JSON.parse((await query(legacy,'/mycli status','MC_STATUS')).slice('MC_STATUS '.length));
 check('1.20.6 translated client retains private fallback',old.name===legacy.username&&!old.sessionId);
 await hello(legacy);await until(()=>legacy.frames.some(f=>f.type==='hello_ack'),'translated payload ack');
 response=await query(legacy,'/mycli status --json','MC_STATUS',true);
 check('1.20.6 translated payload works',response.name===legacy.username&&response.sessionId);
 check('Numen and Bedrock adapter remain enabled',/0\.1\.4/.test(await rc('version numen'))&&/0\.1\.0/.test(await rc('version NumenBedrock')));
 check('no client protocol errors',report.errors.length===0,report.errors);report.passed=true;
}catch(error){report.failure=String(error.stack);process.exitCode=1;}
finally{
 closing=true;for(const b of bots)if(!b._client.ended)try{b.quit('消息隔离验证完成');}catch{}
 await sleep(500);fs.writeFileSync(root+'/native-'+Date.now()+'.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:!!report.passed,checks:report.checks.length,errors:report.errors,failure:report.failure}));process.exit(process.exitCode??0);
}
