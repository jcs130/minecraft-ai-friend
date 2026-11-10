// Uses original native maids in a synthetic loopback world, never production identities.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
const stage=process.env.MAID_FOLLOW_QA_STAGE,anchor=process.env.MAID_FOLLOW_QA_CLIENT_ANCHOR,reportFile=process.env.MAID_FOLLOW_QA_REPORT;
assert(stage&&anchor&&reportFile&&process.env.MAID_FOLLOW_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const {command}=await import(pathToFileURL(process.env.MAID_FOLLOW_QA_RCON));const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const baseline=process.argv.includes('--baseline'),restart=process.argv.includes('--restart');
const report={baseline,restart,checks:[],productionChanged:false},responses=[];let bot,seq=0;
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);assert(ok,name);};
const until=async(fn,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const x=await fn();if(x)return x;await delay(200);}throw Error('timeout '+label);};
const ints=s=>s.replaceAll('-','').match(/.{8}/g).map(x=>parseInt(x,16)|0).join(',');
const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const profile='{schemaVersion:1,walkDistance:32,stopDistance:16,returnDistance:64}';
const fixtureFile=process.env.MAID_FOLLOW_QA_FIXTURE;assert(fixtureFile);
const fixture=restart?JSON.parse(await fs.readFile(fixtureFile,'utf8')):{maid:randomUUID(),other:randomUUID()};
async function ask(id,action,value=''){
 await delay(1100);const request='radius_'+Date.now()+'_'+(++seq),start=responses.length;
 bot.chat(`/qdmaid ${action} ${id} ${request}${value?' '+value:''}`);
 const r=await until(()=>responses.slice(start).find(r=>r.action===action&&r.requestId===request),action);assert(r.ok,'QA command rejected: '+r.error);return r.data;
}
const diagnostics=async id=>JSON.parse((await rc('followqa '+id)).split('FOLLOW_QA ')[1]);
try{
 const expected=baseline?'0.1.22-dialogue-once':'0.1.23-follow-radius';check('pinned QA bridge loaded',(await rc('version QiandengjiMaidBridge')).includes(expected));
 bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:'MaidRadiusQA',auth:'offline',hideErrors:true});
 bot.on('error',()=>{});bot.on('messagestr',(s,p)=>{if(p==='system'&&s.startsWith('QD_MAID '))try{responses.push(JSON.parse(s.slice(8)));}catch{}});
 bot._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{responses.push(JSON.parse(p.data.toString()));}catch{}});
 await until(()=>bot.entity,'QA owner');await rc('minecraft:gamemode creative MaidRadiusQA');await rc('minecraft:time set 1000');
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids\0qiandengji:maid_request')});
 await rc('minecraft:forceload add 192 -16 320 16');
 await rc('minecraft:fill 194 90 -6 306 95 6 minecraft:air');await rc('minecraft:fill 194 89 -6 306 89 6 minecraft:stone');
 await rc('minecraft:tp MaidRadiusQA 200.5 90 0.5');
 if(!restart){
  await fs.writeFile(fixtureFile,JSON.stringify(fixture));
  for(const [key,x] of [['maid',224.5],['other',202.5]])await rc(`minecraft:summon touhou_little_maid:maid ${x} 90 0.5 {UUID:[I;${ints(fixture[key])}],Owner:[I;${ints(bot.player.uuid)}],Invulnerable:1b,PersistenceRequired:1b,CustomName:'"SyntheticRadius${key}"'}`);
  await rc(`minecraft:data modify entity ${fixture.maid} NeoForgeData.qiandengji_follow set value ${profile}`);
 }
 await ask(fixture.maid,'follow');let context=await ask(fixture.maid,'context');report.initial=context;
 if(baseline){
  await delay(11000);context=await ask(fixture.maid,'context');report.baseline=context;
  check('old bridge reproduces short-distance return despite stored profile',context.ownerDistance<4&&context.follow.walkBeyond===3);
 }else{
  check('per-maid contract exposes real distances and units',context.follow.customized&&context.follow.walkBeyond===32&&context.follow.stopWithin===16&&context.follow.recoveryBeyond===64&&context.follow.distanceUnit==='blocks');
  check('native range aligns its original teleport boundary to 64 blocks',(await diagnostics(fixture.maid)).restrictRadius===62);
  if(restart){
   check('profile persists across normal save and JVM restart',(await rc(`minecraft:data get entity ${fixture.maid} NeoForgeData.qiandengji_follow`)).includes('returnDistance: 64'));
   check('original synthetic identity survives restart',context.maidId===fixture.maid||context.id===fixture.maid||JSON.stringify(context).includes(fixture.maid));
  }
  await rc(`minecraft:tp ${fixture.maid} 224.5 90 0.5`);await delay(11000);context=await ask(fixture.maid,'context');
  check('24-block roaming is not pulled back after old stuck timeout',context.ownerDistance>20&&context.ownerDistance<32);
  await ask(fixture.other,'follow');let other=await ask(fixture.other,'context');
  check('another maid retains default 3-block follow and native 8-block radius',other.follow.walkBeyond===3&&!other.follow.customized&&(await diagnostics(fixture.other)).restrictRadius===8);
  await ask(fixture.other,'stay');
  await rc(`minecraft:tp ${fixture.maid} 240.5 90 0.5`);const samples=[];
  await until(async()=>{const c=await ask(fixture.maid,'context');samples.push(c);return c.ownerDistance<31;},'real native walking beyond 32 blocks',20000);
  check('40-block distance closes by native walking',samples.at(-1).position[0]<232);
  check('walking stops well outside the old 2-block tether',samples.every(c=>c.ownerDistance>12));
  // Glass walls stop navigation. Ten seconds exceeds the old forced recovery timer.
  await rc('minecraft:fill 237 90 -1 237 94 1 minecraft:glass');await rc('minecraft:fill 239 90 -1 239 94 1 minecraft:glass');
  await rc('minecraft:fill 237 90 -1 239 94 -1 minecraft:glass');await rc('minecraft:fill 237 90 1 239 94 1 minecraft:glass');
  await rc(`minecraft:tp ${fixture.maid} 238.5 90 0.5`);await delay(11000);context=await ask(fixture.maid,'context');
  check('blocked route within 64 blocks does not auto-teleport',context.ownerDistance>34&&context.position[0]>237);
  await rc('minecraft:fill 237 90 -1 239 94 1 minecraft:air');
  await rc('minecraft:tp MaidRadiusQA 234.5 90 0.5');await ask(fixture.maid,'stay');const stayed=await ask(fixture.maid,'context');await rc('minecraft:tp MaidRadiusQA 304.5 90 0.5');await delay(9500);context=await ask(fixture.maid,'context');
  check('stay beats a long-distance recovery',context.sitting&&context.homeMode&&!context.follow.active&&dist(stayed.position,context.position)<.5);
  await rc('minecraft:tp MaidRadiusQA 234.5 90 0.5');await ask(fixture.maid,'follow');await rc('minecraft:tp MaidRadiusQA 200.5 90 0.5');
  check('follow after stay keeps the wider original native radius',(await diagnostics(fixture.maid)).restrictRadius===62);
  await rc(`minecraft:tp ${fixture.maid} 278.5 90 0.5`);await until(async()=>{context=await ask(fixture.maid,'context');return context.ownerDistance<5;},'original safe recovery beyond 64',18000);
  check('far-away original native maid can still safely return',context.position[1]>=89.9&&context.ownerDistance<5);
  await rc(`minecraft:data modify entity ${fixture.maid} NeoForgeData.qiandengji_follow.walkDistance set value "ambiguous"`);context=await ask(fixture.maid,'context');
  check('invalid profiles are explicit and do not guess',!context.follow.active&&context.follow.state==='follow_profile_invalid');
  await rc(`minecraft:data modify entity ${fixture.maid} NeoForgeData.qiandengji_follow set value ${profile}`);
  await rc(`minecraft:data merge entity ${fixture.maid} {NoAI:1b}`);context=await ask(fixture.maid,'context');
  check('explicitly disabled AI is respected',context.follow.state==='movement_paused');await rc(`minecraft:data merge entity ${fixture.maid} {NoAI:0b}`);
  await rc('minecraft:execute in minecraft:the_nether run minecraft:tp MaidRadiusQA 0.5 100 0.5');context=await ask(fixture.maid,'context');
  check('cross-dimension idle following remains paused',context.follow.state==='different_dimension'&&context.dimension==='minecraft:overworld');
  await rc('minecraft:execute in minecraft:overworld run minecraft:tp MaidRadiusQA 200.5 90 0.5');await rc(`minecraft:tp ${fixture.maid} 224.5 90 0.5`);
  await rc('minecraft:save-all flush');report.final=await ask(fixture.maid,'context');
 }
}catch(error){report.failure=String(error);console.log(report.failure);}
finally{
 bot?.quit();report.responses=responses;report.pass=!report.failure&&report.checks.every(c=>c.ok);await fs.writeFile(reportFile,JSON.stringify(report,null,2));
 console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failure:report.failure}));if(!report.pass)process.exitCode=1;
}
