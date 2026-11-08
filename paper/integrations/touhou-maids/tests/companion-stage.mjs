// Existing synthetic world only. Real chat events, actual encrypted SVC UDP, no production identities.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import http from 'node:http';
import {createRequire} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';import {pathToFileURL} from 'node:url';
const stage=process.env.MAID_SOCIAL_QA_STAGE,root=process.env.MAID_SOCIAL_QA_REPORT_ROOT,fixtureRoot=process.env.MAID_SOCIAL_QA_FIXTURE_ROOT,anchor=process.env.MAID_SOCIAL_QA_CLIENT_ANCHOR;
assert(stage&&root&&fixtureRoot&&anchor&&process.env.MAID_SOCIAL_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const fixture=JSON.parse(await fs.readFile(fixtureRoot+'/fixture.json','utf8'));assert(fixture.synthetic);
const {command}=await import(pathToFileURL(process.env.MAID_SOCIAL_QA_RCON));const rc=c=>command(c,15000,{port:25939,properties:stage+'/server.properties'});
const qa=async action=>{const result=await rc('companionqa '+action+' '+fixture.maid);assert(result.includes('synthetic_companion_'+action),result);return result;};
const baseline=process.argv.includes('--baseline'),run='cv'+Date.now().toString(36),report={run,baseline,checks:[],realPlayerDataUsed:false,productionChanged:false,actualHumanHearingVerified:false},bots=[],peers=[],modelRequests=[],mediaRequests=[];
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);assert(ok,name);};
const until=async(fn,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await delay(100);}throw Error('Timeout '+label);};
let mode='ok',asrText='隔离肥鱼，你好，语音测试',releaseAsr;const asrRequests=[];const realVoice=process.argv.includes('--real-voice'),replyText=realVoice?'你好，我是肥鱼。一起去冒险吧。':'你好，我是隔离肥鱼。';
const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*Math.PI*2)*1500),44+i*2);
const longWav=Buffer.alloc(44+960000);wav.copy(longWav,0,0,44);longWav.writeUInt32LE(longWav.length-8,4);longWav.writeUInt32LE(longWav.length-44,40);for(let at=44;at<longWav.length;at+=48000)wav.copy(longWav,at,44);
const model=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;let body=JSON.parse(raw);modelRequests.push(body);await delay(mode==='late'?4500:500);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'synthetic',object:'chat.completion',model:'qa-native',choices:[{message:{role:'assistant',content:replyText},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
const media=http.createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const raw=Buffer.concat(chunks);if(req.url==='/v1/asr'){assert.equal(raw.toString('ascii',0,4),'RIFF');asrRequests.push(req.headers['x-request-id']);if(mode==='asr-wait')await new Promise(resolve=>releaseAsr=resolve);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({text:asrText}));return;}const body=JSON.parse(raw);mediaRequests.push(body);if(mode==='media-failure'){res.writeHead(503);res.end();return;}res.writeHead(200,{'content-type':'audio/wav'});res.end(body.text===replyText?wav:longWav);});
async function speechSince(at){const dir=stage+'/plugins/QiandengjiMaidBridge/speech-receipts';const rows=[];for(const file of await fs.readdir(dir)){if(!file.endsWith('.json'))continue;const row=JSON.parse(await fs.readFile(dir+'/'+file,'utf8'));if(Date.parse(row.reservedAt)>=at)rows.push(row);}return rows;}
async function connect(name){let bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(bot);bot.lines=[];bot.replies=[];bot.on('error',()=>{});bot.on('messagestr',(text,kind)=>{bot.lines.push(text);if(kind==='system'&&text.startsWith('QD_MAID '))try{bot.replies.push(JSON.parse(text.slice(8)));}catch{}});await until(()=>bot.entity&&bot.player?.uuid,name);return bot;}
let seq=0;
async function ask(bot,action,value='',id=run+'_'+(++seq),maid=fixture.maid){await delay(1000);let start=bot.replies.length;bot.chat(`/qdmaid ${action} ${maid} ${id}${value?' '+value:''}`);return until(()=>bot.replies.slice(start).find(r=>r.requestId===id),action);}
async function chat(bot,text){bot.chat(text);await delay(2200);}

try{
 await until(async()=>{try{return(await rc('version QiandengjiMaidBridge')).includes(baseline?'0.1.13-receipts':'0.1.14-companion');}catch{return false;}},'startup',150000);
 await new Promise(resolve=>model.listen(19088,'127.0.0.1',resolve));await new Promise(resolve=>media.listen(19091,'127.0.0.1',resolve));
 const owner=await connect(fixture.username),visitor=await connect('MaidVisitorQA');
 await rc('minecraft:difficulty normal');await qa('clear');
 await rc('minecraft:fill 294 89 294 340 89 310 minecraft:stone');await rc('minecraft:time set 1000');
 for(const bot of bots){await rc('minecraft:gamemode creative '+bot.username);await rc('minecraft:tp '+bot.username+' 300.5 90 300.5');await delay(800);await rc('minecraft:effect give '+bot.username+' minecraft:instant_health 1 10 true');await rc('minecraft:effect give '+bot.username+' minecraft:resistance infinite 4 true');await rc('minecraft:gamemode survival '+bot.username);}
 await rc(`minecraft:tp ${fixture.maid} 302.5 90 300.5`);await rc('speechqa quiet '+fixture.maid);await ask(owner,'follow');await ask(owner,'brain','native');
 let c;
 if(!process.argv.includes('--travel-only')){
 await chat(visitor,'隔离肥鱼，你好');check('addressed chat works',modelRequests.length===1);
 await delay(5500);await chat(visitor,'你现在准备做什么呢');check('natural followup reaches selected model',modelRequests.length===2);
 await chat(owner,'这里有矿石');check('another unaddressed speaker not subscribed',modelRequests.length===2);
 await chat(visitor,'!不要把公屏当附近');check('shout not interpreted as followup',modelRequests.length===2);
 const {receiver}=await import('./svc-receiver.mjs');const peer=await receiver(visitor);peers.push(peer);
 await delay(5500);await chat(visitor,'隔离肥鱼，请再问好');await until(()=>peer.state.audio>0,'encrypted audio');await delay(1400);
 check('real UDP position sound decoded',peer.state.positional>0&&peer.state.errors===0&&peer.state.positions.every(p=>p.every(Number.isFinite)));
 const speech=(await ask(owner,'context')).data.speech;check('voice remains hearing-unverified',speech.transport==='simple_voice_chat_position'&&speech.hearingVerified===false);
 await delay(5500);let n=visitor.lines.length;const voiceStart=Date.now();await rc('speechqa ambient '+fixture.maid);await until(()=>visitor.lines.slice(n).some(s=>s.includes('[附近·女仆]')),'ambient text');check('ambient captions available to vanilla clients',true);
 await until(async()=>(await speechSince(voiceStart)).some(r=>r.observation?.kind==='ambient'&&r.status==='playing'),'ambient playing');
 await chat(visitor,'隔离肥鱼，我在和你说话，请回应');await until(async()=>(await speechSince(voiceStart)).some(r=>r.observation?.kind==='reply'&&r.status==='sent'),'reply priority');
 const voices=await speechSince(voiceStart);check('reply interrupts ambient instead of being discarded',voices.some(r=>r.observation?.kind==='ambient'&&r.status==='cancelled'&&r.observation.reason==='ambient_interrupted_for_reply')&&voices.some(r=>r.observation?.kind==='reply'&&r.status==='sent'&&r.observation.packetOffers>0));
 report.voiceReceipts=voices.map(r=>({id:r.operationId,status:r.status,reason:r.observation.reason,packetOffers:r.observation.packetOffers}));
 await qa('arm');await qa('threat');await delay(1800);
 c=(await ask(owner,'context')).data;report.threatDiagnostics=await rc('companionqa diagnostics '+fixture.maid);check('armed idle switches to native defence',c.taskId==='touhou_little_maid:attack'&&c.companion.state==='native_defence');
 await qa('clear');await delay(6500);c=(await ask(owner,'context')).data;check('cleared threat returns to idle following',c.taskId==='touhou_little_maid:idle');
 await ask(owner,'stay');await qa('threat');await delay(1500);c=(await ask(owner,'context')).data;check('owner stay never overridden',c.sitting===true&&c.homeMode===true&&c.taskId==='touhou_little_maid:idle');await qa('clear');
 await ask(owner,'follow');await qa('arm');await qa('threat');await delay(1700);await qa('low');await delay(1700);c=(await ask(owner,'context')).data;check('low health returns to companion mode',c.taskId==='touhou_little_maid:idle'&&c.companion.state==='recovering_near_owner');await qa('clear');await qa('heal');
 }else await qa('arm');
 const equipmentBefore=(await ask(owner,'inventory')).data.equipment;
 assert(equipmentBefore&&['main','off','head','chest','legs','feet'].every(k=>Object.hasOwn(equipmentBefore,k)),'Read all real equipment slots before travel');report.equipmentBefore=equipmentBefore;
 await rc('minecraft:execute in minecraft:overworld run minecraft:forceload add 394 394 410 410');await delay(1200);
 await rc('minecraft:fill 394 89 394 410 89 410 minecraft:stone');await rc('minecraft:fill 394 90 394 410 93 410 minecraft:air');
 assert((await rc('minecraft:execute if block 400 89 400 minecraft:stone')).includes('passed'),'Synthetic arrival platform must exist');
 await rc('minecraft:tp '+owner.username+' 400.5 90 400.5');await delay(1800);c=(await ask(owner,'context')).data;check('same-world owner teleport carries original maid',c.ownerDistance<5&&c.maidId===fixture.maid&&c.ownerId===fixture.owner);
 await rc('minecraft:execute in minecraft:the_nether run minecraft:forceload add 394 394 410 410');await delay(500);
 await rc('minecraft:execute in minecraft:the_nether run minecraft:fill 394 89 394 410 89 410 minecraft:stone');await rc('minecraft:execute in minecraft:the_nether run minecraft:fill 394 90 394 410 93 410 minecraft:air');
 await rc('minecraft:execute in minecraft:the_nether run minecraft:tp '+owner.username+' 400.5 90 400.5');await delay(2200);c=(await ask(owner,'context')).data;check('cross-world transfer keeps original maid identity',c.ownerDistance!==null&&c.ownerDistance<5&&c.maidId===fixture.maid&&c.lifeState==='alive');
 await rc('minecraft:execute in minecraft:overworld run minecraft:tp '+owner.username+' 300.5 90 300.5');await delay(2000);c=(await ask(owner,'context')).data;check('cross-world return preserves equipped sword',c.lifeState==='alive'&&(await rc('minecraft:data get entity '+fixture.maid+' HandItems[0].id')).includes('iron_sword'));
 report.equipmentAfter=(await ask(owner,'inventory')).data.equipment;check('all six equipment slots survive cross-world roundtrip',JSON.stringify(report.equipmentAfter)===JSON.stringify(equipmentBefore));
 const stayed=(await ask(owner,'stay')).data.observation.position;await rc('minecraft:tp '+owner.username+' 400.5 90 400.5');await delay(1700);c=(await ask(owner,'context')).data;check('stationed maid not teleported with owner',c.ownerDistance>50&&c.sitting&&c.position.every((value,i)=>Math.abs(value-stayed[i])<2));
 await rc('minecraft:tp '+owner.username+' 300.5 90 300.5');await ask(owner,'follow');await rc('minecraft:execute in minecraft:overworld run minecraft:forceload remove 394 394 410 410');await rc('minecraft:execute in minecraft:the_nether run minecraft:forceload remove 394 394 410 410');await rc('minecraft:save-all flush');
}catch(error){report.error=String(error);report.syntheticMessages=bots.map(b=>({name:b.username,lines:b.lines.slice(-10)}));console.log(report.error);}
finally{for(const peer of peers)peer.close();for(const bot of bots)bot.quit();model.closeAllConnections();media.closeAllConnections();model.close();media.close();report.passed=!report.error;report.modelCalls=modelRequests.length;report.mediaCalls=mediaRequests.length;await fs.writeFile(root+`/companion-${baseline?'baseline':'candidate'}-${run}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;}
