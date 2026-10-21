// Real actor / unrelated player / attached Eye / live privacy regression.
// Requires a separately prepared, loopback-only 256xx Paper fixture. No production access.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
const stage=process.env.MC_STAGE_PAPER,output=process.env.MC_TEST_REPORT_DIR;
assert(stage&&output&&path.resolve(stage).toLowerCase().includes('staging'));
const props=fs.readFileSync(path.join(stage,'server.properties'),'utf8');
assert.match(props,/^server-ip=127\.0\.0\.1$/m);
const port=Number(props.match(/^server-port=(256\d\d)$/m)?.[1]);
const rconPort=Number(props.match(/^rcon.port=(256\d\d)$/m)?.[1]);assert(port&&rconPort&&port!==rconPort);
const legacy=process.env.MC_TEST_EXPECT_LEGACY==='1';
const version=process.env.MC_TEST_VERSION??'1.21.1';
assert(['1.20.6','1.21.1'].includes(version));
const ops=process.env.MC_TEST_OPS??'E:/MC/ops';
const {command}=await import(pathToFileURL(ops+'/rcon-client.mjs'));
const rc=q=>command(q,15000,{properties:path.join(stage,'server.properties'),port:rconPort});
const require=createRequire(process.env.MC_TEST_REQUIRE_FROM??'E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const {fix1206PotionProtocol}=await import(pathToFileURL(ops+'/minecraft-1206-potion.mjs'));
const {installRecipePacketBypass}=await import(pathToFileURL(ops+'/mineflayer-client-compat.mjs'));
fix1206PotionProtocol(require);
const {createBot}=require('mineflayer'),{Vec3}=require('vec3');
const report={at:new Date().toISOString(),scope:'isolated actual recipient connections',
 purpose:legacy?'reproduce old privacy leaks':'verify recipient privacy',legacy,version,checks:[],errors:[]};
const bots=[];let closing=false;
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);};
async function until(test,name,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(test())return;await sleep(100);}throw Error('Timeout: '+name);}
async function join(username){
 const b=createBot({host:'127.0.0.1',port,username,auth:'offline',version,viewDistance:'short',plugins:{physics:false}});bots.push(b);
 installRecipePacketBypass(b._client);b.lines=[];b.payloads=[];b.cameras=[];
 b.on('messagestr',s=>b.lines.push(s));b.on('error',e=>report.errors.push(username+': '+e.message));
 b.on('kicked',r=>{if(!closing)report.errors.push(username+': kicked '+JSON.stringify(r));});
 b._client.on('position',p=>{const at=p.position??p;if(b.entity&&[at.x,at.y,at.z].every(Number.isFinite))b.entity.position.set(at.x,at.y,at.z);
  if(b.supportFeature('teleportUsesOwnPacket'))b._client.write('teleport_confirm',{teleportId:p.teleportId});});
 b._client.on('camera',p=>b.cameras.push(p.cameraId));
 b._client.on('custom_payload',p=>{if(['mcagent:protection','qiandengji:agent'].includes(p.channel))b.payloads.push({channel:p.channel,data:JSON.parse(p.data.toString('utf8'))});});
 await new Promise((resolve,reject)=>{b.once('spawn',resolve);b.once('error',reject);setTimeout(()=>reject(Error('Spawn '+username)),20000).unref();});
 b.physicsEnabled=false;return b;
}
const starts=()=>new Map(bots.map(b=>[b,b.lines.length]));
const since=(b,mark)=>b.lines.slice(mark.get(b));
const protection=s=>/MC_(?:PROTECTION|LAND_ACCESS|GUILD_ACCESS)|【保护查询】|【保护范围】|【操作未执行】|【正确做法】|逐块结果|个目标：/.test(s);
function marketReceipt(lines){
 for(const line of lines)try{
  const data=JSON.parse(line.startsWith('MC_MARKET_CHECK ')?line.slice('MC_MARKET_CHECK '.length):line);
  if(data.type==='MC_MARKET_CHECK')return data;
 }catch{}
}
try{
 check('reviewed plugin versions loaded',(await rc('version AgentFriend')).includes(legacy?'0.4.47.9':'0.4.47.10')
  &&(await rc('version CortiEyeMirror')).includes(legacy?'0.1.16':'0.1.17'));
 const actor=await join('ag_AuditQA'),eye=await join('ag_AuditQA_eye'),other=await join('ag_OtherQA'),human=await join('AuditHuman'),live=await join('live');
 for(const b of [actor,other,human])await rc('minecraft:gamemode survival '+b.username);
 for(const b of [actor,other,human])await rc('minecraft:tp '+b.username+' -489.5 67 -500.5');
 await until(()=>eye.cameras.at(-1)===actor.entity.id,'named Eye attached');
 await rc('minecraft:spectate ag_AuditQA live');await until(()=>live.cameras.at(-1)===actor.entity.id,'live attached');
 check('real named Eye and live are spectators',eye.game.gameMode==='spectator'&&live.game.gameMode==='spectator');
 for(const q of ['/mycli protect break -489 66 -502 --json','/mycli protect batch break -489,66,-502 -488,66,-502 --json']){
  await sleep(1300);const mark=starts(),before=actor.payloads.length;actor.chat(q);
  await until(()=>actor.payloads.length>before,q);await sleep(600);
  report.lastQuery={command:q,lines:since(actor,mark),data:actor.payloads.at(-1)};
  check(q+' actor gets private receipt',since(actor,mark).some(s=>s.startsWith('MC_PROTECTION')));
  check(q+' other players receive no receipt or authorization guidance',[other,human].every(b=>!since(b,mark).some(protection)));
  const leaked=[eye,live].every(b=>since(b,mark).some(protection));
  check(q+(legacy?' reproduces old spectator guidance leak':' stays out of spectator chat'),legacy?leaked:[eye,live].every(b=>!since(b,mark).some(protection)));
 }
 if(!legacy){
  const feedback=s=>/^MC_/.test(s)||/【当前公会委托】|【生活委托】|\[生活挑战\]|\/mycli tasks list|\/mycli tasks info|委托按当前任务槽/.test(s);
  for(const q of ['/mycli tasks list','/mycli tasks status','/mycli challenge list']){
   await sleep(1300);const queryStart=starts();actor.chat(q);
   await until(()=>since(actor,queryStart).some(s=>/^MC_(?:TASKS|PAGE|CHALLENGE)/.test(s)),q);await sleep(500);
   check(q+' actor retains structured reply',since(actor,queryStart).some(s=>/^MC_/.test(s)));
   check(q+' not copied to other players',[other,human].every(b=>!since(b,queryStart).some(feedback)));
   check(q+' not copied to spectators',[eye,live].every(b=>!since(b,queryStart).some(feedback)));
  }
 }
 // Human-format feedback used to take the generic mirror path instead.
 await rc('minecraft:spectate AuditHuman live');await until(()=>live.cameras.at(-1)===human.entity.id,'live switches to human');
 await sleep(1300);let mark=starts();human.chat('/mycli protect break -489 66 -502');
 await until(()=>since(human,mark).some(protection),'human query');await sleep(600);
 report.humanQuery={lines:since(human,mark),data:human.payloads.at(-1),observer:since(live,mark)};
 check('human keeps denial, bounds and correct next step',since(human,mark).some(s=>s.includes('【保护范围】'))&&since(human,mark).some(s=>s.includes('【正确做法】')));
 check('human receipt is not sent to other players',[actor,other].every(b=>!since(b,mark).some(protection)));
 check('human query spectator copy follows privacy policy',legacy?since(live,mark).some(protection):!since(live,mark).some(protection));
 await rc('minecraft:spectate ag_AuditQA live');await until(()=>live.cameras.at(-1)===actor.entity.id,'live returns');
 for(const [index,text] of ['MC_CLI_NEXT /mycli list all 2','MC_COACH_ERROR command_unavailable','MC_PROTECTION {broken','§bMC_STATUS§r {}',
  '【委托未计数】需要使用弓','[生活挑战] 暂无记录'].entries()){
  const marker='[audience-probe-'+index+'-'+Date.now()+']';
  mark=starts();await rc('minecraft:tellraw '+actor.username+' '+JSON.stringify({text:text+' '+marker}));await sleep(500);
  const received=b=>since(b,mark).some(s=>s.includes(marker));
  check(text+' remains on body connection',received(actor));
  check(text+' is private from unrelated players',[other,human].every(b=>!received(b)));
  check(text+(legacy?' reproduces old observer leak':' is omitted from observer copy'),legacy?[eye,live].every(received):[eye,live].every(b=>!received(b)));
 }
 // Real cancelled digging, not just a preflight query. No permissions are granted.
 await sleep(1300);await rc('minecraft:gamemode creative '+actor.username);await sleep(250);mark=starts();
 const target=new Vec3(-489,66,-502);await until(()=>actor.blockAt(target),'protected block loaded');const block=actor.blockAt(target).name;
 check('protected target is a real non-air block',!block.endsWith('air'));
 actor._client.write('block_dig',{status:0,location:target,face:1,sequence:0});
 actor._client.write('block_dig',{status:2,location:target,face:1,sequence:1});
 await until(()=>since(actor,mark).some(s=>/MC_(?:PROTECTION|LAND_ACCESS|GUILD_ACCESS)/.test(s)),'actual denied operation');await sleep(500);
 check('cancelled operation reports owner and next step to actor',since(actor,mark).some(s=>/MC_(?:PROTECTION|LAND_ACCESS|GUILD_ACCESS)/.test(s)&&s.includes('nextAction')));
 check('cancelled operation never informs unrelated players',[other,human].every(b=>!since(b,mark).some(protection)));
 check(legacy?'cancelled operation reproduces old spectator spam':'cancelled operation does not spam spectators',legacy?[eye,live].every(b=>since(b,mark).some(protection)):[eye,live].every(b=>!since(b,mark).some(protection)));
 check('denied block remains on authoritative server',/Test passed|测试通过/i.test(await rc('minecraft:execute if block -489 66 -502 minecraft:'+block)));
 if(!legacy){
  // Only this isolated test character takes a disposable, incomplete contract;
  // no reward is claimed, no gear is granted, and production data is inaccessible.
  await rc('minecraft:gamemode survival '+actor.username);await sleep(1300);
  actor.chat('/mycli guild abandon');await sleep(1300);
  let queryStart=starts();actor.chat('/mycli guild accept tm_starter_archer');
  await until(()=>since(actor,queryStart).some(s=>s.includes('tm_starter_archer')||s.includes('弦上的星火')),'isolated starter contract');
  await sleep(1300);queryStart=starts();actor.chat('/mycli guild verify');
  await until(()=>marketReceipt(since(actor,queryStart)),'contract verification');await sleep(600);
  const receipt=marketReceipt(since(actor,queryStart));
  check('incomplete contract verification stays truthful',receipt.reason==='action_progress_incomplete'&&!!receipt.nextAction);
  const verification=s=>!!marketReceipt([s])||/^MC_MARKET_CHECK |【委托|【下一步】|尚缺|下一步：/.test(s);
  check('contract verification not copied to other players',[other,human].every(b=>!since(b,queryStart).some(verification)));
  check('contract verification not copied to spectators',[eye,live].every(b=>!since(b,queryStart).some(verification)));
  actor._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:agent')});
  actor._client.write('custom_payload',{channel:'qiandengji:agent',data:Buffer.from('{"op":"hello","protocol":1,"transport":"payload"}')});
  await until(()=>actor.payloads.some(p=>p.channel==='qiandengji:agent'&&p.data.type==='hello_ack'),'opt-in acknowledgement');
  check('existing opt-in protocol remains available',actor.payloads.some(p=>p.data.type==='hello_ack'));
  await sleep(1300);queryStart=starts();const payloadStart=actor.payloads.length;actor.chat('/mycli guild verify');
  await until(()=>actor.payloads.slice(payloadStart).some(p=>p.channel==='qiandengji:agent'&&p.data.type==='MC_MARKET_CHECK'),'bare market receipt in private channel');await sleep(500);
  const frame=actor.payloads.slice(payloadStart).find(p=>p.channel==='qiandengji:agent'&&p.data.type==='MC_MARKET_CHECK').data;
  check('opted-in bare market receipt keeps all guidance',frame.data.reason==='action_progress_incomplete'&&!!frame.data.nextAction);
  check('opted-in receipt is not repeated in actor chat',!marketReceipt(since(actor,queryStart)));
  check('opted-in receipt never reaches unrelated or spectator chat',[other,human,eye,live].every(b=>!since(b,queryStart).some(verification)));
  actor.chat('/mycli guild abandon');await sleep(1300);
 }
 const social='MC_STATUS {"example":"quoted player speech"}';mark=starts();other.chat(social);await until(()=>since(actor,mark).some(s=>s.includes('quoted player speech')),'normal public chat');await sleep(500);
 check('ordinary player chat quoting machine syntax is preserved',bots.every(b=>since(b,mark).some(s=>s.includes('quoted player speech'))));
 mark=starts();other.chat('/minecraft:msg '+actor.username+' MC_STATUS private words');await until(()=>since(actor,mark).some(s=>s.includes('private words')),'native whisper');await sleep(500);
 check('native private conversation stays visible to body and attached observers',[actor,eye,live].every(b=>since(b,mark).some(s=>s.includes('private words'))));
 check('whisper is not broadcast to an unrelated human',!since(human,mark).some(s=>s.includes('private words')));
 mark=starts();await rc('minecraft:tellraw @a '+JSON.stringify({text:'【世界公告·测试】旅人营地开放'}));await sleep(600);
 check('normal world announcement reaches everyone exactly once',bots.every(b=>since(b,mark).filter(s=>s.includes('【世界公告·测试】')).length===1));
 check('no bot errors or unexpected disconnects',report.errors.length===0);report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;throw e;}
finally{closing=true;for(const b of bots)b.quit();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,legacy?'baseline-audience.json':'candidate-audience.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,legacy,version,checks:report.checks.length,errors:report.errors,error:report.error}));}
