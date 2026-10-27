import fs from'node:fs/promises';import{createRequire}from'node:module';import assert from'node:assert/strict';
import{command}from'../../ops/rcon-client.mjs';import{installRecipePacketBypass}from'../../ops/mineflayer-client-compat.mjs';
const stage='E:/MC/staging/aincrad-conquest-20261027',label=process.argv[2];assert(/^[a-z0-9]+$/.test(label));assert.match(await fs.readFile(stage+'/server.properties','utf8'),/^motd=QD_AINCRAD_CONQUEST_QA_ONLY\r?$/m);
const mf=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json')('mineflayer');const wait=ms=>new Promise(r=>setTimeout(r,ms));
const bots=[],result={checks:[],errors:[],receipts:[]},channel='qiandengji:agent';
const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name)};
const rc=async q=>{const t=await command(q,15000,{properties:stage+'/server.properties',port:25925});result.receipts.push({q,t});return t;};
async function bot(name){const b=mf.createBot({host:'127.0.0.1',port:25924,username:name,version:'1.21.1',auth:'offline',defaultChatPatterns:false,checkTimeoutInterval:60000});bots.push(b);b.acks=[];b.on('error',e=>result.errors.push(e.message));b.on('kicked',e=>result.errors.push(JSON.stringify(e)));b._client.on('custom_payload',p=>{if(p.channel===channel)b.acks.push(JSON.parse(p.data.toString()))});installRecipePacketBypass(b._client);await Promise.race([new Promise(r=>b.once('spawn',r)),wait(30000).then(()=>{throw Error('join_timeout')})]);return b;}
const marker=(b,key)=>rc('minecraft:data get entity '+b.username+' BukkitValues."agentfriend:'+key+'"');
const identity=(b,reconnect)=>{b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from(channel)});b._client.write('custom_payload',{channel,data:Buffer.from(JSON.stringify({op:'identity',protocol:1,control:'agent',reconnect}))});};
try{
 const a=await bot('RuntimeProofQA'),human=await bot('ag_OnlyPrefixQA');await wait(700);
 check('name without handshake is not an Agent proof',!(await marker(human,'automation_reconnect')).includes('entity data: 1b'));
 identity(a,true);await wait(700);
 check('non ag name receives protocol identity acknowledgement',a.acks.some(p=>p.type==='identity_ack'&&p.reconnect===true));
 check('current connection records its reconnect capability',(await marker(a,'automation_reconnect')).includes('entity data: 1b'));
 for(let i=0;i<8;i++){human.chat('/mycli status');await wait(1150);}
 check('frequent CLI use is recorded as a hint',(await marker(human,'cli_activity_hint')).includes('frequent_cli'));
 check('frequent CLI use grants no maintenance exemption',!(await marker(human,'automation_reconnect')).includes('entity data: 1b'));
 a._client.write('custom_payload',{channel,data:Buffer.from('{"op":"identity","protocol":1,"control":"agent","reconnect":"false"}')});await wait(400);
 check('malformed declaration cannot change accepted identity',(await marker(a,'automation_reconnect')).includes('entity data: 1b'));
 identity(a,false);await wait(400);check('explicit reconnect opt out is honored',(await marker(a,'automation_reconnect')).includes('entity data: 0b'));
 identity(a,true);await wait(300);
 check('maintenance queries exact live UUID evidence',(await rc('minecraft:execute as @a if data entity @s BukkitValues{"agentfriend:automation_reconnect":1b} if data entity @s BukkitValues."agentfriend:automation_session" run minecraft:data get entity @s UUID')).includes('RuntimeProofQA has the following entity data:'));
 a.quit();await wait(700);const again=await bot('RuntimeProofQA');await wait(400);
 check('new connection cannot reuse old persisted proof',!(await marker(again,'automation_reconnect')).includes('entity data: 1b'));
 check('clients remain connected',again._client.state==='play'&&human._client.state==='play');
}catch(e){result.errors.push(e.stack||String(e));}
finally{for(const b of bots)b.quit();await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks.length,errors:result.errors}));process.exit(result.errors.length?1:0);}
