// Formal server smoke: temporary ordinary client, no item withdrawal/deposit or block edits.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {command} from '../ops/rcon-client.mjs';
import {fix1206PotionProtocol} from '../ops/minecraft-1206-potion.mjs';
const require=createRequire('E:/MC/probe/package.json');fix1206PotionProtocol(require);
const mineflayer=require('mineflayer'),{Vec3}=require('vec3');
const name='GuildAudit86';
const bot=mineflayer.createBot({host:'192.168.3.163',port:25565,username:name,auth:'offline',version:'1.20.6'});
const messages=[],protection=[],report={passed:false,tests:[],startedAt:new Date().toISOString()};
let windows=0,originalPosition;
bot.on('messagestr',line=>messages.push(line));
bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:protection')protection.push(JSON.parse(p.data.toString()));});
bot._client.on('open_window',()=>windows++);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rcon=text=>command(text,15000);
const until=async(test,label)=>{for(let i=0;i<120;i++){if(test())return;await sleep(100);}throw new Error(label+' timed out');};
const tp=async(x,y,z)=>{await rcon(`minecraft:tp ${name} ${x} ${y} ${z}`);await until(()=>bot.entity.position.distanceTo(new Vec3(x,y,z))<2,'teleport');await sleep(400);};
try{
  assert.match(await rcon('version AgentFriend'),/0\.3\.86/);
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject);});
  originalPosition=bot.entity.position.clone();await sleep(2400);bot.setQuickBarSlot(8);
  const text=await rcon('mycli admin guildstorageaudit');const audit=JSON.parse(text.slice(text.indexOf('{')));
  assert.equal(audit.ownerReady,true);assert.equal(audit.ownerUuid,'00000000-0000-0000-0009-00000d9f9c7b');assert.equal(audit.opBypass,false);report.audit=audit;
  await tp(-492.5,67,-503.5);
  for(const z of [-505,-504,-503]){
    const base=messages.length,openBefore=windows;
    const block=bot.blockAt(new Vec3(-494,67,z));assert.equal(block.name,'barrel');
    await bot.activateBlock(block);
    await until(()=>messages.slice(base).some(l=>l.startsWith('MC_GUILD_ACCESS ')),'private refusal');
    const line=messages.slice(base).find(l=>l.startsWith('MC_GUILD_ACCESS '));const data=JSON.parse(line.slice(16));
    assert.equal(data.reason,'guild_owner_only');assert.equal(data.allowed,false);assert.equal(data.ownerUuid,audit.ownerUuid);
    assert.ok(messages.slice(base).some(l=>l.includes('无权操作')&&l.includes('公共箱')));
    await sleep(250);assert.equal(windows,openBefore);report.tests.push({test:'private_barrel_denied',z,receipt:data,length:line.length});
  }
  assert.ok(protection.some(p=>p.reason==='guild_owner_only'));
  bot.chat('/mycli protect container -494 67 -505');await until(()=>messages.some(l=>l.startsWith('MC_PROTECTION ')),'preflight');
  const preflight=JSON.parse(messages.find(l=>l.startsWith('MC_PROTECTION ')).slice(14));assert.equal(preflight.allowed,false);report.tests.push({test:'private_preflight',receipt:preflight});
  await tp(-474.5,67,-493.5);
  for(const z of [-495,-493,-491,-489]){
    if(z===-489)await tp(-474.5,67,-490.5);
    const block=bot.blockAt(new Vec3(-473,67,z));assert.equal(block.name,'chest');
    const window=await Promise.race([bot.openContainer(block),sleep(8000).then(()=>{throw new Error('public open timed out');})]);
    assert.equal(window.inventoryStart,54);bot.closeWindow(window);await sleep(250);report.tests.push({test:'public_chest_read_only',z,slots:54});
  }
  bot.chat('/mycli guild shared');await until(()=>messages.some(l=>l.startsWith('MC_GUILD_SHARED ')),'public directions');
  assert.ok(messages.some(l=>l.includes('公会门内实体储物和展示物归萌萌所有')));report.tests.push({test:'public_directions',passed:true});report.passed=true;
}catch(error){report.error=String(error.stack??error);report.messages=messages.slice(-12);process.exitCode=1;}
finally{
  if(originalPosition&&bot._client.state==='play')try{await rcon(`minecraft:tp ${name} ${originalPosition.x} ${originalPosition.y} ${originalPosition.z}`);}catch{}
  bot.quit();report.finishedAt=new Date().toISOString();
  for(const root of ['E:/MC/ops/repairs/guild-ownership-20261006','F:/MC-backups/repairs/guild-ownership-20261006'])writeFileSync(root+'/live-test.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,tests:report.tests.map(t=>t.test),error:report.error}));
}
