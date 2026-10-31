// Explicit loopback fixture only; no production identity, authentication change or public chat.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [root,reportFile,dependencyPackage,rconModule,mode='initial']=process.argv.slice(2);
assert.ok([root,reportFile,dependencyPackage,rconModule].every(value=>value&&path.isAbsolute(value)));
assert.ok(['initial','readback'].includes(mode));
const lab=path.join(root,'game-lab'),properties=path.join(lab,'paper/server.properties');
assert.match(await readFile(path.join(lab,'.qa-only'),'utf8'),/^isolated-auto-appearance-20261031/);
assert.match(await readFile(properties,'utf8'),/^server-port=29420$/m);
const {command}=await import(pathToFileURL(rconModule)),mf=createRequire(dependencyPackage)('mineflayer');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),bots=[];
const report={mode,checks:[],started:new Date().toISOString(),productionWrites:false};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
async function until(predicate,label,timeout=60_000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await delay(100);}throw Error(label+' timed out');}
async function connect(name){
 const bot=mf.createBot({host:'127.0.0.1',port:29422,username:name,version:'1.21.1',auth:'offline',hideErrors:true});bots.push(bot);
 bot.messages=[];bot.appearances=[];bot.errorReason=null;
 bot.on('message',value=>bot.messages.push(value.toString()));bot.on('error',error=>{bot.errorReason=error.message;});
 bot.on('end',()=>{bot.ended=true;});
 bot._client.on('custom_payload',packet=>{if(packet.channel==='mcagent:appearance')try{bot.appearances.push(JSON.parse(packet.data));}catch{}});
 await until(()=>bot.entity||bot.ended,name+' spawn');assert.ok(!bot.ended,bot.errorReason||'Disconnected');
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:appearance\0mcagent:ysm_asset')});
 return bot;
}
const own=bot=>[...bot.appearances].reverse().find(row=>row.playerName===bot.username&&row.available===true);
try{
 await until(async()=>{try{return(await command('minecraft:list',3000,{port:29421,properties})).includes('players online');}catch{return false;}},'isolated Paper ready',120_000);
 const names=['ag_AutoA31','ag_AutoB31','ag_AutoC31','ag_AutoD31'];
 const actors=[];for(const name of names)actors.push(await connect(name));
 await until(()=>actors.every(bot=>own(bot)?.modelId&&own(bot).modelId!=='default'),'four native automatic assignments');
 const observed=Object.fromEntries(actors.map(bot=>[bot.username,{uuid:own(bot).playerUuid,model:own(bot).modelId,texture:own(bot).texture}]));
 check('four real native bodies receive four distinct models',new Set(Object.values(observed).map(row=>row.model)).size===4);
 check('all selected models provide original web and camera resources',actors.every(bot=>own(bot).webAvailable===true&&/^[a-f0-9]{64}$/.test(own(bot).assetSha256)));
 for(const bot of actors){bot.chat('/appearance status');await until(()=>bot.messages.some(text=>text.startsWith('MC_APPEARANCE_ASSIGNMENT ')),'private assignment status');}
 check('actual native confirmation and saved choice policy agree',actors.every(bot=>bot.messages.some(text=>text.includes('MC_APPEARANCE_ASSIGNMENT ')&&(text.includes('"phase":"applied"')||mode==='readback'&&text.includes('"phase":"manual"')))));
 if(mode==='initial'){
  const eye=await connect('ag_AutoEyeNew31');
  await until(()=>own(eye)?.modelId==='default','excluded fixture ready');await delay(9000);
  check('explicit observer exclusion retains its default model',own(eye)?.modelId==='default'&&!eye.messages.some(text=>text.includes('正在分配初始YSM')));
  const before=JSON.parse(await readFile(path.join(lab,'velocity/plugins/agentappearance/automatic-appearances.json'),'utf8'));
  const pool=JSON.parse(await readFile(path.join(lab,'velocity/plugins/agentappearance/models.json'),'utf8')).automaticAssignment.models;
  const counts=Object.fromEntries(pool.map(pick=>[pick.model,Object.values(before.players).filter(row=>row.model===pick.model).length]));
  const minimum=Math.min(...Object.values(counts));
  const fresh=await connect('ag_AutoFresh31');
  await until(()=>own(fresh)?.modelId&&own(fresh).modelId!=='default','fresh real body receives initial model');
  check('a new body chooses a least-used compatible model after pool exhaustion',counts[own(fresh).modelId]===minimum);
  fresh.quit('fresh assignment verified');
  await delay(31_000);
  actors[0].chat('/appearance set qiandengji_naruto skin');
  await until(()=>own(actors[0])?.modelId==='qiandengji_naruto','personal change after initial assignment');
  await delay(4000);
  check('personal appearance replaces the initial model and is not overwritten',own(actors[0]).modelId==='qiandengji_naruto');
  observed[actors[0].username]={uuid:own(actors[0]).playerUuid,model:own(actors[0]).modelId,texture:own(actors[0]).texture};
  await writeFile(path.join(root,'expected-readback.json'),JSON.stringify(observed,null,2));
 }else{
  const expected=JSON.parse(await readFile(path.join(root,'expected-readback.json'),'utf8'));
  check('all native choices survive a normal cold restart',actors.every(bot=>own(bot).playerUuid===expected[bot.username].uuid&&own(bot).modelId===expected[bot.username].model&&own(bot).texture===expected[bot.username].texture));
  check('restart does not replay automatic setup',actors.every(bot=>!bot.messages.some(text=>text.includes('正在分配初始YSM'))));
  const observer=await connect('ag_RoleGuard31');await until(()=>own(observer)?.modelId==='default','registered observer native state');await delay(9000);
  observer.chat('/appearance status');await until(()=>observer.messages.some(text=>text.includes('MC_APPEARANCE_ASSIGNMENT ')),'registered observer policy');
  check('observer registry excludes a real body without relying on its name',own(observer).modelId==='default'&&observer.messages.some(text=>text.includes('MC_APPEARANCE_ASSIGNMENT ')&&text.includes('"phase":"excluded"')));
  const fresh=await connect('ag_AutoFinal31');await until(()=>own(fresh)?.modelId&&own(fresh).modelId!=='default','final artifact assigns a fresh body');
  check('final candidate assigns a new native model with original web resources',own(fresh).webAvailable===true&&/^[a-f0-9]{64}$/.test(own(fresh).assetSha256));
 }
 report.models=observed;report.passed=true;
}catch(error){report.passed=false;report.error=error.message;report.messages=Object.fromEntries(bots.map(bot=>[bot.username,bot.messages.slice(-12)]));throw error;}
finally{for(const bot of bots)if(!bot.ended)bot.quit('isolated model check complete');await delay(1000);report.finished=new Date().toISOString();await writeFile(reportFile,JSON.stringify(report,null,2));}
