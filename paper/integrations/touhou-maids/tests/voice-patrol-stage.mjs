// Marked synthetic loopback lab only; normal shutdown in finally. Never load this fixture in production.
import fs from'node:fs/promises';import http from'node:http';import assert from'node:assert/strict';import{createRequire}from'node:module';import{command}from'../../../ops/rcon-client.mjs';
const root=process.env.MAID_VOICE_QA_REPORT_ROOT,lab=process.env.MAID_VOICE_QA_LAB,anchor=process.env.MAID_VOICE_QA_CLIENT_ANCHOR;
assert(root&&lab&&anchor,'Explicit synthetic lab, report root and installed client anchor required');
const props=await fs.readFile(lab+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=29467$/m.test(props)&&/^rcon.port=29468$/m.test(props));
const phase=process.argv.includes('--baseline')?'baseline':'candidate';
assert.equal((await fs.readFile(lab+'/.maid-render-qa','utf8')).trim(),'20261106 127.0.0.1:29467');
const rc=q=>command(q,20000,{port:29468,properties:lab+'/server.properties'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
const result={phase,productionChanged:false,realPlayerDataUsed:false,checks:[],defects:[],humanHearingVerified:false},check=(name,ok)=>{result.checks.push({name,ok:!!ok});assert(ok,name);};
const qa=async action=>{const text=await rc('maidvoiceqa '+action+' ag_MaidQApat'),m=text.match(/MAID_VOICE_QA (\{[^\n]+\})/);if(!m)throw Error('QA_REPLY:'+text.slice(0,300));return JSON.parse(m[1]);};
const req=createRequire(anchor);let bot,peer;const mediaRequests=[];
const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*Math.PI*2)*1500),44+i*2);
const token=(await fs.readFile(root+'/qa-media.token','utf8')).trim();
const media=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);let raw='';for await(const b of req)raw+=b;mediaRequests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'audio/wav'});res.end(wav);});
try{
 await new Promise(done=>media.listen(29472,'127.0.0.1',done));
 for(let i=0;i<100;i++){try{if((await rc('version QiandengjiMaidBridge')).includes('0.1.'))break;}catch{}if(i===99)throw Error('QA_NOT_READY');await delay(1200);}
 bot=req('mineflayer').createBot({host:'127.0.0.1',port:29467,username:'ag_MaidQApat',auth:'offline',version:'1.21.1',checkTimeoutInterval:60000});bot.on('error',e=>result.connectionError=e.message);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('QA_SPAWN_TIMEOUT')),45000);bot.once('spawn',()=>{clearTimeout(timer);resolve()});bot.once('kicked',r=>reject(Error('QA_KICKED:'+JSON.stringify(r))))});
 const first=await qa('scene');result.initial=first;check('synthetic original maid has movable native AI',first.canMove&&!first.sitting);
 const bubble=await qa('public-bubble');result.bubble=bubble;
 if(phase==='baseline'){check('old public speech has no native head bubble',bubble.bubbles===first.bubbles);result.defects.push('public text delivery did not add a native head bubble');}
 else check('same public operation adds exactly one native head bubble',bubble.bubbles===first.bubbles+1);
 await qa('hostile');await delay(1800);let state=await qa('state');result.untargetedHostile=state;
 if(phase==='baseline'){check('old idle companion ignores an untargeted hostile',state.task==='touhou_little_maid:idle'&&state.mobs[0].target==='none'&&state.mobs[0].health===20);result.defects.push('visible untargeted hostile did not start native combat');}
 else{
  check('visible untargeted hostile starts the real native attack task',state.task==='touhou_little_maid:attack');
  for(let i=0;i<30;i++){state=await qa('state');if(state.mobs[0].health<20)break;await delay(250);}
  result.actualAttack=state;check('native melee really damages the hostile',state.mobs[0].health<20);
  for(const type of ['frozen','neutral','friendly']){const before=await qa(type);await delay(1600);state=await qa('state');(result.negativeStates??={})[type]={before,after:state};check(type+' is not proactively attacked',state.task==='touhou_little_maid:idle'&&state.mobs[0].health===before.mobs[0].health);}
  const mixedBefore=await qa('mixed');await delay(4000);const mixedAfter=await qa('state');result.mixed={before:mixedBefore,after:mixedAfter};check('native combat damages the hostile while leaving nearer decorative and peaceful neutral mobs unharmed',mixedAfter.mobs[0].health<20&&mixedAfter.mobs.slice(1).every((m,i)=>m.health===mixedBefore.mobs[i+1].health));
  await qa('clear');await delay(6200);state=await qa('state');result.afterCombat=state;check('native day schedule resumes after temporary nighttime combat',state.task==='touhou_little_maid:idle'&&state.savedSchedule==='DAY'&&state.brainActivities.includes('rest'));
  await qa('stay');await qa('stationed-hostile');await delay(1600);state=await qa('state');check('owner stationing remains authoritative',state.sitting&&state.task==='touhou_little_maid:idle');
  await qa('clear');await qa('low');await qa('hostile');await delay(1500);state=await qa('state');check('low health does not start pursuit',state.task==='touhou_little_maid:idle');
 }
 await qa('clear');await qa('hostile');await qa('clear');
 if(phase==='baseline'){result.passed=true;await qa('remove');}else{
 const {receiver}=await import('./svc-receiver.mjs');peer=await receiver(bot,{port:29471});
 await qa('ambient');await delay(7500);check('real encrypted positional voice reaches the synthetic client',peer.state.positional>0&&peer.state.errors===0);
 result.voice={packets:peer.state.audio,positional:peer.state.positional,errors:peer.state.errors,mediaRequests:mediaRequests.length};
 if(phase==='candidate')check('original random recording uses no server TTS request',mediaRequests.length===0);

 await fs.writeFile(root+'/native-'+phase+'-opus.json',JSON.stringify(peer.state.packets));
 await qa('remove');result.passed=true;}
}catch(e){result.error=e.message;result.passed=false;process.exitCode=1;}
finally{peer?.close();bot?.quit();media.closeAllConnections();media.close();try{await rc('stop')}catch{}result.completedAt=new Date().toISOString();await fs.writeFile(root+'/native-'+phase+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
