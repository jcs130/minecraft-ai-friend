// Isolated native-protocol regression. No production player or world changes.
// Set MC_STAGE_PAPER, MC_TEST_REPORT_DIR; optionally MC_TEST_REQUIRE_FROM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
const stage=process.env.MC_STAGE_PAPER,root=process.env.MC_TEST_REPORT_DIR;
assert(stage&&root&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(path.join(stage,'server.properties'),'utf8');
assert.match(props,/^server-ip=127\.0\.0\.1$/m);
const port=Number(props.match(/^server-port=(256\d\d)$/m)?.[1]);assert(port);
const rconPort=Number(props.match(/^rcon.port=(256\d\d)$/m)?.[1]);assert(rconPort&&rconPort!==port);
const {command}=await import(pathToFileURL((process.env.MC_TEST_OPS??'E:/MC/ops')+'/rcon-client.mjs'));
const rc=q=>command(q,15000,{properties:path.join(stage,'server.properties'),port:rconPort});
const require=createRequire(process.env.MC_TEST_REQUIRE_FROM??'E:/MC/research/mineflayer-client-fixes-20261011/package.json');
// Reuse the tested client-only 1.20.6 compatibility helpers; no dependency or
// server schema is changed by this test.
const {fix1206PotionProtocol}=await import(pathToFileURL((process.env.MC_TEST_OPS??'E:/MC/ops')+'/minecraft-1206-potion.mjs'));
const {installRecipePacketBypass}=await import(pathToFileURL((process.env.MC_TEST_OPS??'E:/MC/ops')+'/mineflayer-client-compat.mjs'));
fix1206PotionProtocol(require);
const mf=require('mineflayer'),{Vec3}=require('vec3');
const report={at:new Date().toISOString(),scope:'isolated Java/Mineflayer and real spectator connections',mineflayer:require('mineflayer/package.json').version,checks:[],errors:[]};
const bots=[];let finishing=false;
const check=(label,value)=>{assert(value,label);report.checks.push(label);};
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(100);}throw Error('Timeout: '+label);}
async function join(username){
 const b=mf.createBot({host:'127.0.0.1',port,username,auth:'offline',version:'1.20.6',viewDistance:'short',plugins:{physics:false}});bots.push(b);
 installRecipePacketBypass(b._client);
 b._client.on('position',p=>{const at=p.position||p;if(b.entity&&[at.x,at.y,at.z].every(Number.isFinite))b.entity.position.set(at.x,at.y,at.z);if(b.supportFeature('teleportUsesOwnPacket'))b._client.write('teleport_confirm',{teleportId:p.teleportId});});
 b.lines=[];b.payloads=[];b.cameras=[];
 b.on('messagestr',s=>b.lines.push(s));b.on('error',e=>report.errors.push(username+': '+e.message));
 b.on('kicked',r=>{if(!finishing)report.errors.push(username+': kicked '+JSON.stringify(r));});
 b._client.on('custom_payload',p=>{if(p.channel==='mcagent:protection')b.payloads.push(JSON.parse(p.data.toString('utf8')));});
 b._client.on('camera',p=>b.cameras.push(p.cameraId));
 await new Promise((resolve,reject)=>{b.once('spawn',resolve);b.once('error',reject);setTimeout(()=>reject(Error('Spawn '+username)),20000).unref();});
 b.physicsEnabled=false;return b;
}
const matches=(b,prefix)=>b.lines.filter(s=>s.startsWith(prefix+' '));
async function query(b,suffix=''){
 await sleep(200);const n=b.payloads.length;b.chat('/mycli protect break -504 68 -437'+suffix);
 await until(()=>b.payloads.length>n,'protection query '+b.username);await sleep(350);return b.payloads.at(-1);
}
async function tell(b,text){await rc('minecraft:tellraw '+b.username+' '+JSON.stringify({text}));await sleep(400);}
try{
 check('candidate versions loaded',(await rc('version AgentFriend')).includes('0.4.32')&&(await rc('version CortiEyeMirror')).includes('0.1.14'));
 const agent=await join('ag_ProtectQA'),eye=await join('ag_ProtectQA_eye'),human=await join('ProtectHuman');
 const legacy=await join('CortiLan'),legacyEye=await join('CortiEye'),live=await join('live'),stranger=await join('ProtectOther');
 for(const b of [agent,human,legacy,stranger])await rc('minecraft:gamemode survival '+b.username);
 for(const b of [agent,human,legacy])await rc('minecraft:tp '+b.username+' -502.5 68 -437.5');
 await until(()=>eye.cameras.at(-1)===agent.entity.id&&legacyEye.cameras.at(-1)===legacy.entity.id,'both real Eye attachments');
 await rc('minecraft:spectate ag_ProtectQA live');await until(()=>live.cameras.at(-1)===agent.entity.id,'live target attachment');
 check('named and live Eyes attach',eye.game.gameMode==='spectator'&&legacyEye.game.gameMode==='spectator'&&live.game.gameMode==='spectator');
 for(const b of bots){b.lines=[];b.payloads=[];}
 agent.chat('/mycli help protect');await until(()=>agent.lines.some(s=>s.includes('--json')),'updated protection help');await sleep(300);
 check('help documents explicit JSON without performing protection query',agent.payloads.length===0&&agent.lines.some(s=>s.includes('--json')));
 check('help machine receipt is not copied to Eye',!eye.lines.some(s=>/^MC_CLI_/.test(s))&&!live.lines.some(s=>/^MC_CLI_/.test(s)));
 const data=await query(agent);
 check('Agent retains complete chat-only JSON',matches(agent,'MC_PROTECTION').some(s=>JSON.parse(s.slice(14)).reason===data.reason));
 check('unregistered Agent still receives complete private payload',data.schemaVersion===1&&data.status==='deny'&&data.reason==='village_structure'&&data.areas.length>0&&data.nextCommands.length>0);
 check('private result contains original world and target',data.world==='minecraft:overworld'&&data.x===-504&&data.y===68&&data.z===-437);
 check('Eye/live do not receive protection JSON',matches(eye,'MC_PROTECTION').length===0&&matches(live,'MC_PROTECTION').length===0);
 check('other players receive no private result',stranger.payloads.length===0&&!matches(stranger,'MC_PROTECTION').length&&human.payloads.length===0&&!matches(human,'MC_PROTECTION').length
  &&!stranger.lines.some(s=>s.includes('【保护范围】'))&&!human.lines.some(s=>s.includes('【保护范围】')));
 const hd=await query(human);
 check('human still receives full private payload',hd.reason===data.reason&&JSON.stringify(hd.areas)===JSON.stringify(data.areas));
 check('human sees Chinese explanation without JSON',matches(human,'MC_PROTECTION').length===0&&human.lines.some(s=>s.includes('【保护范围】'))&&human.lines.some(s=>s.includes('【正确做法】')));
 const detailAt=human.lines.length;await query(human,' --json');
 check('explicit --json works without losing full explanation',matches(human,'MC_PROTECTION').length===1&&human.lines.slice(detailAt).some(s=>s.includes('铁门找按钮')));
 await query(legacy);
 check('legacy registered Agent keeps chat JSON',matches(legacy,'MC_PROTECTION').length===1&&matches(legacyEye,'MC_PROTECTION').length===0);
 // Trigger a real cancelled block action, not only a preflight command.
 await sleep(1600);await rc('minecraft:gamemode creative '+agent.username);await sleep(200);for(const b of bots)b.lines=[];
 const target=new Vec3(-504,68,-437);await until(()=>agent.blockAt(target)!=null,'loaded protected block');
 const before=agent.blockAt(target).stateId;report.protectedBlock=agent.blockAt(target).name;
 agent._client.write('block_dig',{status:0,location:target,face:1,sequence:0});
 await until(()=>matches(agent,'MC_PROTECTION').length===1,'actual protection rejection');await sleep(400);
 const notices=agent.lines.filter(s=>s.includes('【操作未执行】')||s.includes('【保护范围】')||s.includes('【正确做法】'));
 check('actual denial has at most three useful Chinese notices',notices.length>=2&&notices.length<=3&&notices.some(s=>s.includes('/mycli protect break -504 68 -437')));
 check('short notice preserves exact boundary and next step',notices.some(s=>s.includes('-513,66,-437')&&s.includes('-500,113,-423'))&&notices.some(s=>s.includes('门、楼梯或梯子')));
 check('observer keeps human-readable denial only',eye.lines.some(s=>s.includes('【操作未执行】'))&&live.lines.some(s=>s.includes('【正确做法】'))&&!matches(eye,'MC_PROTECTION').length&&!matches(live,'MC_PROTECTION').length);
 check('rejected block stays unchanged',agent.blockAt(target).stateId===before);
 for(let i=0;i<3;i++)agent._client.write('block_dig',{status:0,location:target,face:1,sequence:i+1});await sleep(500);
 check('repeated failed actions remain throttled',matches(agent,'MC_PROTECTION').length===1&&agent.lines.filter(s=>s.includes('【操作未执行】')).length===1);
 await rc('minecraft:gamemode creative '+human.username);human.lines=[];
 human._client.write('block_dig',{status:0,location:target,face:1,sequence:0});
 await until(()=>human.lines.some(s=>s.includes('【正确做法】')),'actual human denial');
 check('actual human denial stays short and hides JSON',human.lines.filter(s=>s.includes('【')).length<=3&&!matches(human,'MC_PROTECTION').length&&human.lines.some(s=>s.includes('【保护范围】')));
 // SYSTEM_CHAT filtering must not delete ordinary player chat, private replies,
 // malformed lookalikes, or the original Agent receipt. Larger bodies are also
 // checked by the pure matcher test without exceeding command transport limits.
 for(const prefix of ['MC_PROTECTION','MC_GUILD_ACCESS','MC_LAND_ACCESS','MC_PHOTO','MC_STATUS']){
  const text=prefix+' '+JSON.stringify({schemaVersion:1,reason:'qa',large:prefix==='MC_STATUS'?'x'.repeat(500):''});
  const ae=eye.lines.length,le=live.lines.length,ab=agent.lines.length;await tell(agent,text);
  check(prefix+' JSON reaches body but no spectator copy',agent.lines.slice(ab).includes(text)&&!eye.lines.slice(ae).includes(text)&&!live.lines.slice(le).includes(text));
 }
 for(const text of ['普通私有提示：请沿门和梯子通行。','MC_PROTECTION {broken','MC_PROTECTION 这是一句普通说明','引用 MC_PROTECTION {"allowed":false}']){
  await tell(agent,text);check('ordinary or invalid text preserved: '+text.slice(0,28),eye.lines.includes(text)&&live.lines.includes(text));
 }
 await rc('minecraft:msg ag_ProtectQA 保护聊天私信测试');await sleep(500);
 check('real private chat still mirrors',eye.lines.some(s=>s.includes('保护聊天私信测试'))&&live.lines.some(s=>s.includes('保护聊天私信测试')));
 human.chat('MC_PROTECTION {"allowed":false}');await sleep(500);
 check('player-authored MC text remains ordinary public chat',agent.lines.some(s=>s.includes('ProtectHuman')&&s.includes('MC_PROTECTION'))&&eye.lines.some(s=>s.includes('ProtectHuman')&&s.includes('MC_PROTECTION')));
 check('all connections have no protocol errors',report.errors.length===0);
}catch(e){report.errors.push(e.stack??String(e));}
finally{
 finishing=true;for(const b of bots)b.quit('isolated protection presentation QA complete');await sleep(500);
 const run=process.env.MC_TEST_RUN_LABEL??'1';assert.match(run,/^[a-z0-9-]{1,16}$/);
 report.success=report.errors.length===0;fs.writeFileSync(path.join(root,'protection-native-'+run+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({success:report.success,checks:report.checks,errors:report.errors}));process.exitCode=report.success?0:1;
}
