// Isolated native adapter integration. Only the marked loopback fixture is accepted.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const [root,reportPath,dependencyPackage,rconModule,mode='initial']=process.argv.slice(2);
assert.ok([root,reportPath,dependencyPackage,rconModule].every(value=>value&&path.isAbsolute(value)));
assert.ok(['initial','readback'].includes(mode));
const lab=path.join(root,'youer-native-probe');
assert.match(await fs.readFile(path.join(lab,'.qa-only'),'utf8'),/^isolated-youer-native-ysm-20261031/);
assert.match(await fs.readFile(path.join(lab,'server.properties'),'utf8'),/^server-port=29440$/m);
const {command}=await import(pathToFileURL(rconModule));
const mf=createRequire(dependencyPackage)('mineflayer');
const rcon=text=>command(text,10000,{port:29441,properties:path.join(lab,'server.properties')});
const report={mode,started:new Date().toISOString(),productionWrites:false,checks:[]};
const bots=[],chunks=new Map();
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
async function until(predicate,label,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const value=await predicate();if(value)return value;await delay(100);}throw Error(label+' timed out');}
async function connect(name){
 const bot=mf.createBot({host:'127.0.0.1',port:29440,username:name,version:'1.21.1',auth:'offline',hideErrors:true});bots.push(bot);bot.states=[];bot.messages=[];
 bot.on('error',error=>{bot.failure=error.message;});bot.on('message',value=>bot.messages.push(value.toString()));
 bot._client.on('custom_payload',packet=>{try{
  if(packet.channel==='mcagent:appearance')bot.states.push(JSON.parse(packet.data));
  if(packet.channel==='mcagent:ysm_asset'){const row=JSON.parse(packet.data);const list=chunks.get(row.requestId)??[];list.push(row);chunks.set(row.requestId,list);}
 }catch{}});
 await until(()=>bot.entity,'fixture spawn');
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:appearance\0mcagent:ysm_asset')});return bot;
}
const own=bot=>bot.states.filter(row=>row.playerName===bot.username&&row.available===true).at(-1);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const quit=bot=>{bot.end('native fixture complete');bot._client?.socket?.destroy();};
try{
 await until(async()=>{try{await rcon('list');return true;}catch{return false;}},'native server ready',120000);
 await rcon('difficulty peaceful');await rcon('gamerule doMobSpawning false');
 const active=[];for(const name of ['ag_ModelJ31','ag_ModelK31','ag_ModelL31'])active.push(await connect(name));
 await until(()=>active.every(bot=>own(bot)?.modelId&&own(bot).modelId!=='default'),'actual native initial models');
 check('metadata identifies the actual native artifact and unchanged channel schema',active.every(bot=>own(bot).source==='ysm_native_backend'&&own(bot).ysmVersion==='2.6.5'&&own(bot).protocolVersion==='2.6.0'&&own(bot).jarSha256==='b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb'));
 if(mode==='initial'){
  check('three fresh ordinary bodies choose three unused public models',new Set(active.map(bot=>own(bot).modelId)).size===3&&active.every(bot=>own(bot).modelId!=='qd_lappland'));
  check('automatic choices retain ordinary native selection ability',active.every(bot=>own(bot).mandatory===false&&own(bot).webAvailable===true));
  const bot=active[0],state=own(bot),requestId=crypto.randomBytes(16).toString('hex');
  bot._client.write('custom_payload',{channel:'mcagent:ysm_asset',data:Buffer.from(JSON.stringify({type:'get',modelId:state.modelId,sha256:state.assetSha256,requestId}))});
  const parts=await until(()=>{const found=chunks.get(requestId);return found?.length&&found.length===found[0].count?found.sort((a,b)=>a.index-b.index):null;},'actual native bundle');
  const bytes=Buffer.concat(parts.map(part=>Buffer.from(part.data,'base64'))),bundle=JSON.parse(gunzipSync(bytes));
  check('native source delivers hash-verified original assets',sha(bytes)===state.assetSha256&&bundle.modelId===state.modelId&&bundle.ysmVersion==='2.6.5');
  const other=own(active[1]);bot.chat('/appearance admin set '+active[1].username+' qd_ryza default');await delay(1300);
  check('an ordinary player cannot select another body',own(active[1]).modelId===other.modelId&&own(active[1]).texture===other.texture);
  const restored=await connect('ag_RestoreYsm5');await until(()=>own(restored)?.modelId==='qd_lappland','prior appearance restoration');
  check('an explicitly seeded old choice is restored without a reroll',own(restored).texture==='texture'&&own(restored).mandatory===false);quit(restored);await delay(400);
  const observer=await connect('ag_MigrateEye5');await rcon('gamemode spectator ag_MigrateEye5');
  await until(()=>own(observer)?.modelId==='qd_observer_drone','observer migrated drone');
  const spectatorReply=await rcon('data get entity ag_MigrateEye5 playerGameType');
  report.spectatorReply=spectatorReply;
  check('a trusted observer migration restores its drone while retaining spectator mode',/(?:data:|数据[：:])\s*3\s*$/u.test(spectatorReply));quit(observer);await delay(400);
  const eye=await connect('ag_NativeEye5');await rcon('gamemode spectator ag_NativeEye5');
  await until(()=>own(eye)?.modelId==='default','fresh observer state');await delay(6500);
  check('an unassigned observer stays outside the ordinary appearance pool',own(eye).modelId==='default'&&!eye.messages.some(text=>text.includes('正在分配')));quit(eye);await delay(400);
  const fish=await connect('ag_RestoreFish5');await until(()=>own(fish)?.modelId==='大肥鱼_1.1.ysm','original fish restoration');
  check('the original encrypted model uses the exact native model and texture',own(fish).texture==='white'&&own(fish).mandatory===false);
  check('encrypted geometry is not misreported as a public browser asset',own(fish).webAvailable===false&&own(fish).webReason==='YSM_ENCRYPTED_SOURCE_REQUIRED');quit(fish);await delay(400);
  const before=own(bot),inventory=await rcon('data get entity '+bot.username+' Inventory');
  await delay(18000);bot.chat('/appearance set 大肥鱼_1.1.ysm white');
  await until(()=>own(bot)?.modelId==='大肥鱼_1.1.ysm','ordinary self choice');
  check('ordinary CLI selection applies the original model to the same body',own(bot).entityId===before.entityId&&own(bot).playerUuid===before.playerUuid&&own(bot).mandatory===false);
  check('model operations preserve the fixture inventory',await rcon('data get entity '+bot.username+' Inventory')===inventory);
  const expected=Object.fromEntries(active.map(bot=>[bot.username,{uuid:own(bot).playerUuid,model:own(bot).modelId,texture:own(bot).texture}]));
  await fs.writeFile(path.join(root,'native-expected-readback.json'),JSON.stringify(expected,null,2));
 }else{
  const expected=JSON.parse(await fs.readFile(path.join(root,'native-expected-readback.json'),'utf8'));
  check('all choices survive a normal native-server cold restart',active.every(bot=>own(bot).playerUuid===expected[bot.username].uuid&&own(bot).modelId===expected[bot.username].model&&own(bot).texture===expected[bot.username].texture));
  await delay(6000);check('cold restart does not replay initial appearance setup',active.every(bot=>!bot.messages.some(text=>text.includes('正在分配初始'))));
 }
 report.passed=true;
}catch(error){report.error=error.message;report.messages=Object.fromEntries(bots.map(bot=>[bot.username,bot.messages.slice(-8)]));report.states=Object.fromEntries(bots.map(bot=>[bot.username,bot.states.filter(row=>row.playerName===bot.username).slice(-2)]));process.exitCode=1;}
finally{bots.forEach(quit);report.finished=new Date().toISOString();await fs.writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed===true,checks:report.checks,error:report.error}));}
