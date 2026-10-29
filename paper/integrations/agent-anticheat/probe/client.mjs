import fs from'node:fs/promises';import{createRequire}from'node:module';import assert from'node:assert/strict';import{command}from'../../../ops/rcon-client.mjs';
const label=process.argv[2],stage='E:/MC/staging/aincrad-conquest-20261027';if(!/^[a-z0-9]{1,24}$/.test(label))throw Error('isolated label only');
const props=await fs.readFile(stage+'/server.properties','utf8');assert.match(props,/^server-port=25924\r?$/m);assert.match(props,/^server-ip=127\.0\.0\.1\r?$/m);assert.match(props,/QD_AINCRAD_CONQUEST_QA_ONLY/);
const require=createRequire('E:/MC/research/paper-task-routes-20261015/pristine-client/package.json'),mf=require('mineflayer');const report={checks:[],errors:[],messages:[],positions:[],samples:[],fixtures:'QA mana, tools and clear test floor; not autonomous gameplay'};const clients=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rc=q=>command(q,15000,{port:25925,properties:stage+'/server.properties'});const check=(text,ok)=>{assert.ok(ok,text);report.checks.push(text);};
async function bot(name){const b=mf.createBot({host:'127.0.0.1',port:25924,version:'1.21.1',auth:'offline',username:name,checkTimeoutInterval:60000});clients.push(b);b.on('error',e=>report.errors.push(e.message));b.on('kicked',e=>report.errors.push('kicked:'+JSON.stringify(e)));b.on('messagestr',s=>report.messages.push({name,text:s}));await Promise.race([new Promise(r=>b.once('spawn',r)),sleep(30000).then(()=>{throw Error('spawn timeout');})]);await sleep(3500);return b;}
async function chat(b,q){await sleep(1150);const n=report.messages.length;b.chat(q);await sleep(650);return report.messages.slice(n).filter(m=>m.name===b.username).map(m=>m.text).join('\n');}
const logRoot=stage+'/plugins/LightAntiCheat/logs';
async function logs(){const result=new Map();for(const name of await fs.readdir(logRoot).catch(()=>[])){if(name.endsWith('.log'))result.set(name,await fs.readFile(logRoot+'/'+name,'utf8'));}return result;}
const initialLogs=await logs();
async function newFlags(){const after=await logs();return [...after].flatMap(([name,text])=>text.slice((initialLogs.get(name)||'').length).split('\n').filter(Boolean)).filter(line=>/ag_ACWarrior|ag_ACMage/.test(line));}
try{
 const a=await bot('ag_ACWarrior');await rc('qdqa setup '+a.username);await sleep(1600);check('normal Mineflayer never gets a body exemption',(await rc('acqa inspect '+a.username)).includes('native=false'));
 if(!label.startsWith('flight')){
 for(const q of['/mycli profession choose warrior','/mycli skills learn warrior_sky_leap','/mycli skills prepare warrior_sky_leap'])await chat(a,q);
 const ground=a.entity.position.y;const leap=await chat(a,'/mycli cast warrior_sky_leap');report.leapReceipt=leap;let high=ground;for(let i=0;i<70;i++){high=Math.max(high,a.entity.position.y);await sleep(50);}check('real class leap reaches its specified eight-block height',high-ground>7&&high-ground<9);report.samples.push({skill:'warrior_sky_leap',rise:high-ground});
 await sleep(16000);await rc('qdqa setup '+a.username);await chat(a,'/mycli skills learn blink');await rc('qdqa mana '+a.username);const before=a.entity.position.clone();await a.lookAt(before.offset(6,-.5,0));const blink=await chat(a,'/mycli cast blink');report.blinkReceipt=blink;await sleep(300);check('real blink moves player',a.entity.position.distanceTo(before)>2);
 await rc('qdqa setup '+a.username);await rc('acqa tool '+a.username);await sleep(350);const pick=a.inventory.items().find(i=>i.name==='diamond_pickaxe');check('actual efficiency V tool delivered',!!pick);await a.equip(pick,'hand');const block=a.blockAt(a.entity.position.offset(2,0,0));check('test stone exists',block?.name==='stone');await a.lookAt(block.position.offset(.5,.5,.5));
 // This pristine Mineflayer dependency has a known enchantments-is-not-iterable
 // digTime bug. Use real normal dig packets at a conservative 200ms, without
 // changing the received item or replacing server validation with a mock.
 const start=Date.now();a._client.write('block_dig',{status:0,location:block.position,face:1,sequence:1});await sleep(200);a._client.write('block_dig',{status:2,location:block.position,face:1,sequence:2});for(let i=0;i<20&&a.blockAt(block.position).name!=='air';i++)await sleep(50);const diggingMs=Date.now()-start;check('efficiency V breaks real stone quickly',diggingMs<1500&&a.blockAt(block.position).name==='air');report.efficiencyVDigMs=diggingMs;report.digHarness='vanilla start/finish packets; no client enchantment mutation';
 const m=await bot('ag_ACMage');await rc('qdqa setup '+m.username);for(const q of['/mycli profession choose mage','/mycli skills learn mage_soar','/mycli skills prepare mage_soar'])await chat(m,q);await rc('qdqa mana '+m.username);
 const soar=await chat(m,'/mycli cast mage_soar');report.soarReceipt=soar;check('real skill grants flight permission',(await rc('acqa inspect '+m.username)).includes('allow=true'));
 const from=m.entity.position.clone();await m.creative.flyTo(from.offset(3,3,0));await sleep(700);check('authorised flight actually moves',m.entity.position.distanceTo(from)>2);await m.creative.stopFlying();await sleep(19000);check('temporary flight permission is removed',(await rc('acqa inspect '+m.username)).includes('allow=false'));
 await chat(m,'/mycli skills learn starbolt');await rc('acqa ranged '+m.username);await sleep(400);const hp0=Number((await rc('acqa hp '+m.username)).match(/health=([0-9.]+)/)?.[1]);
 const target=Object.values(m.entities).find(e=>e.name==='zombie'&&e.position.distanceTo(m.entity.position)>7&&e.position.distanceTo(m.entity.position)<12);check('actual ranged target is beyond melee reach',!!target);
 for(let i=0;i<3;i++){await rc('qdqa mana '+m.username);await m.lookAt(target.position.offset(0,1.5,0));await chat(m,'/mycli cast starbolt');await sleep(3100);}
 const hp1=Number((await rc('acqa hp '+m.username)).match(/health=([0-9.]+)/)?.[1]);report.ranged={before:hp0,after:hp1,guard:await rc('agentac')};check('real ranged spells damage the remote monster',hp1<hp0-5);
 report.nativeSpawnRequest=await rc('acqa spawn '+a.username);await sleep(2500);const native=await rc('acqa inspect ACNativeBody');report.nativeInspection=native;check('Numen body created via real API',native.includes('native=true'));check('remote client remains checked',(await rc('acqa inspect '+a.username)).includes('native=false'));
 check('both real clients remain connected',clients.every(b=>b._client.state==='play'));
 await sleep(1500);report.legalFlags=await newFlags();check('leap, slow fall, blink, temporary flight, efficiency and ranged spells produce no false flags',report.legalFlags.length===0);
 }
 await rc('minecraft:fill 32 64 -8 48 64 8 minecraft:stone');await rc('minecraft:fill 32 65 -8 48 110 8 minecraft:air');
 await rc('minecraft:tp '+a.username+' 40.5 65 0.5');await sleep(3000);
 check('negative flight fixture has a real loaded floor and settled position',a.blockAt(a.entity.position.offset(0,-1,0))?.name==='stone'&&Math.abs(a.entity.position.y-65)<.2&&Math.abs(a.entity.position.x-40.5)<.2);
 const origin=a.entity.position.clone();a.physicsEnabled=false;let correction=false,requestedY=origin.y;
 const corrected=()=>{correction=true;};a._client.on('position',corrected);
 for(let n=1;n<=100&&!correction;n++){requestedY=origin.y+n*.32;a.entity.position.set(origin.x,requestedY,origin.z);a.entity.onGround=false;a._client.write('position',{x:origin.x,y:requestedY,z:origin.z,onGround:false});await sleep(50);}
 a._client.removeListener('position',corrected);await sleep(600);
 const actual=await rc('acqa inspect '+a.username),serverY=Number(actual.match(/ y=([\d.-]+)/)?.[1]);
 report.illegalAttempt={requestedY,serverY,guard:actual,serverCorrection:correction};
 report.illegalFlags=await newFlags();check('the same ag_ client still receives real flight enforcement',report.illegalFlags.some(s=>/Flight[ABC]/.test(s))&&correction&&serverY<requestedY-.1);
 await rc('minecraft:tp '+a.username+' 40.5 65 0.5');a.physicsEnabled=true;
}catch(e){report.errors.push(e.stack||String(e));}
finally{for(const b of clients){b.clearControlStates();b.quit('legal skill anti-cheat test finished');}await sleep(600);await fs.writeFile(stage+'/client-'+label+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));process.exit(report.errors.length?1:0);}
