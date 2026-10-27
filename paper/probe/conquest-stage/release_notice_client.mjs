/** Verify actual private delivery, reconnect and saved per-account deduplication. */
import fs from'node:fs/promises';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{command}from'../../ops/rcon-client.mjs';import{installRecipePacketBypass}from'../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));
assert.match(await fs.readFile(stage+'/server.properties','utf8'),/^motd=QD_AINCRAD_CONQUEST_QA_ONLY\r?$/m);
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),clients=[],report={checks:[],errors:[],messages:[]};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name)};
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:25925});
async function connect(username){const b=mf.createBot({host:'127.0.0.1',port:25924,username,version:'1.21.1',auth:'offline',defaultChatPatterns:false,checkTimeoutInterval:60000});clients.push(b);b.messages=[];b.on('messagestr',s=>b.messages.push(s));b.on('error',e=>report.errors.push(e.message));b.on('kicked',e=>report.errors.push(JSON.stringify(e)));installRecipePacketBypass(b._client);await Promise.race([new Promise(r=>b.once('spawn',r)),wait(30000).then(()=>{throw Error('join_timeout')})]);return b;}
const notices=b=>b.messages.filter(s=>s.startsWith('[更新 0.4.47.20]')||s.startsWith('[冒险指南]'));
try{
 await rc('minecraft:execute in minecraft:overworld run minecraft:gamerule doMobSpawning false');
 const observer=await connect('ReleaseSpectator');await rc('minecraft:gamemode spectator '+observer.username);
 const first=await connect('ag_ReleaseQA2');await wait(9000);
 if(label.startsWith('cold'))check('normal restart does not repeat the notice',notices(first).length===0);
 else{
  check('ordinary account receives exactly two compact release lines',notices(first).length===2);
  check('notice gives actual existing RPG and dungeon entry points',notices(first).join(' ').includes('/mycli guide magic')&&notices(first).join(' ').includes('/mycli dungeon list'));
  check('notice has no machine payload',notices(first).every(s=>s.length<160&&!s.includes('MC_')&&!s.includes('sessionId')));
 }
 check('spectator sees no other accounts private release notice',notices(observer).length===0);
 check('release delivery does not open a GUI',!first.currentWindow);
 first.quit();await wait(1000);const again=await connect('ag_ReleaseQA2');await wait(5500);
 check('same account reconnect does not repeat the notice',notices(again).length===0);
 const pdc=await rc('minecraft:data get entity '+again.username+' BukkitValues."agentfriend:onboarding_release_revision"');
 check('delivered release revision is persisted on the actual player',pdc.includes('entity data: 1'));
 check('client is still in play state',again._client.state==='play');
}catch(e){report.errors.push(e.stack||String(e));}
finally{report.messages=clients.map(b=>({name:b.username,text:b.messages}));for(const b of clients)b.quit();await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));process.exit(report.errors.length?1:0);}
