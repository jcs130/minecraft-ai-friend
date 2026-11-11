// Approved 32/16/64 following with 24-block partner text/voice, 8-block visitors.
// Synthetic loopback identities, mock model/media; encrypted SVC and real server routing.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import http from 'node:http';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
import {receiver} from './svc-receiver.mjs';
const stage=process.env.MAID_SOCIAL_QA_STAGE,root=process.env.MAID_SOCIAL_QA_REPORT_ROOT,anchor=process.env.MAID_SOCIAL_QA_CLIENT_ANCHOR;
assert(stage&&root&&anchor&&process.env.MAID_SOCIAL_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const fixture=JSON.parse(await fs.readFile(process.env.MAID_SOCIAL_QA_FIXTURE_ROOT+'/fixture.json','utf8'));assert(fixture.synthetic);
const {command}=await import(pathToFileURL(process.env.MAID_SOCIAL_QA_RCON));const rc=q=>command(q,15000,{port:25939,properties:stage+'/server.properties'});
const bots=[],peers=[],requests=[],mediaCalls=[],report={checks:[],productionChanged:false,realPlayerDataUsed:false,humanHearingVerified:false,microphoneVerified:false};let seq=0;
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);assert(ok,name);};
const until=async(fn,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const x=await fn();if(x)return x;await delay(100);}throw Error('Timeout '+label);};
const model=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;requests.push(JSON.parse(raw));await delay(300);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'qa-range',object:'chat.completion',model:'qa-native',choices:[{message:{role:'assistant',content:'这条路真有意思，我们继续走吧。'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*Math.PI*2)*1500),44+2*i);
const media=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;mediaCalls.push(JSON.parse(raw));res.writeHead(200,{'content-type':'audio/wav'});res.end(wav);});
async function connect(name){const b=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(b);b.lines=[];b.replies=[];b.cameras=[];b.on('error',()=>{});b.on('messagestr',s=>{b.lines.push(s);if(s.startsWith('QD_MAID '))try{b.replies.push(JSON.parse(s.slice(8)));}catch{}});b._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{b.replies.push(JSON.parse(p.data.toString()));}catch{}});b._client.on('camera',p=>b.cameras.push(p.cameraId));await until(()=>b.entity&&b.player?.uuid,name);b._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids')});return b;}
async function place(b,x){await rc(`execute in minecraft:overworld run minecraft:tp ${b.username} ${x} 90 300.5`);await delay(350);}
async function say(b,text){const at=b.replies.length;b.chat(text);return until(()=>b.replies.slice(at).find(r=>r.action==='chat-result'&&r.data?.status==='replied'),'real public reply');}
const visible=b=>b.lines.filter(s=>s.startsWith('[附近·女仆]')&&s.includes('这条路真有意思')).length;
try{
 await new Promise(r=>model.listen(19088,'127.0.0.1',r));await new Promise(r=>media.listen(19091,'127.0.0.1',r));
 check('joint candidate loaded',(await rc('version QiandengjiMaidBridge')).includes('0.1.24-fast-followup'));
 const owner=await connect(fixture.username),guest=await connect('MaidVisitorQA'),eye=await connect('MaidEyeQA');
 await rc('minecraft:fill 294 89 294 335 89 310 minecraft:stone');await rc('minecraft:gamemode survival '+owner.username);await rc('minecraft:gamemode survival '+guest.username);
 await rc(`minecraft:data merge entity ${fixture.maid} {NoAI:1b}`);
 await rc(`minecraft:data modify entity ${fixture.maid} NeoForgeData.qiandengji_follow set value {schemaVersion:1,walkDistance:32,stopDistance:16,returnDistance:64}`);
 for(const b of bots)await place(b,320.5);
 await rc('execute in minecraft:overworld run minecraft:tp '+fixture.maid+' 300.5 90 300.5');await rc('speechqa quiet '+fixture.maid);
 await until(()=>eye.cameras.includes(owner.entity.id),'original Eye attachment');
 for(const b of bots){const p=await receiver(b);peers.push(p);}
 report.maidPosition=await rc('minecraft:data get entity '+fixture.maid+' Pos');
 check('frozen synthetic maid remains twenty blocks from listeners',report.maidPosition.includes('[300.5d, 90.0d, 300.5d]'));
 const first=await say(owner,'拜托啦隔离肥鱼～一起看看前面的路。');await until(()=>peers[0].state.positional>0&&peers[2].state.positional>0,'20-block partner and Eye positional audio');await delay(700);
 check('partner at twenty blocks receives actual model reply',first.data.observation.textPresentation==='nearby_canonical'&&requests.length===1);
 check('partner and attached Eye each see exactly one public line',visible(owner)===1&&visible(eye)===1);
 check('visitor at twenty blocks receives neither public text nor voice',visible(guest)===0&&peers[1].state.positional===0);
 check('one synthesis feeds both real encrypted voice receivers',mediaCalls.length===1&&peers[0].state.errors===0&&peers[2].state.errors===0);
 await place(owner,325.5);const before=requests.length;owner.chat('隔离肥鱼，再说一句。');await delay(1000);check('partner beyond twenty-four blocks does not start inference',requests.length===before);
 await place(owner,320.5);await delay(1500);
 await rc('rangeqa '+owner.username+' 16');await delay(700);check('ASR actual sixteen-block audibility is not enlarged by partner policy',requests.length===before);
 await rc('rangeqa '+owner.username+' 32');await until(()=>requests.length===before+1,'ASR with actual audible radius');await delay(1000);check('real bridge routes nearby partner ASR at twenty blocks once',requests.length===before+1);
 let count=requests.length;await rc('rangeqa '+guest.username+' 32');await delay(700);check('visitor ASR still limited to eight blocks',requests.length===count);
 await place(guest,309.5);guest.chat('隔离肥鱼，你好。');await delay(800);check('visitor beyond eight blocks cannot wake a model by text',requests.length===count);
 await place(guest,307.5);const packets=peers[1].state.positional;await say(guest,'隔离肥鱼，你好。');await until(()=>peers[1].state.positional>packets,'nearby visitor audio');check('visitor inside eight blocks can still talk and hear',requests.length===count+1);
 await rc('execute in minecraft:the_nether run minecraft:tp '+owner.username+' 300.5 90 300.5');await delay(500);count=requests.length;owner.chat('隔离肥鱼，你好。');await delay(800);check('same coordinates in another dimension remain inaudible',requests.length===count);
 await place(owner,320.5);await rc(`minecraft:data remove entity ${fixture.maid} NeoForgeData.qiandengji_follow`);await rc(`minecraft:data merge entity ${fixture.maid} {NoAI:0b}`);
 await rc('minecraft:save-all flush');
}catch(error){report.error=String(error);console.log(report.error);report.last=bots.map(b=>({name:b.username,dimension:b.game?.dimension,position:b.entity?.position,lines:b.lines.slice(-5)}));}
finally{
 try{await rc(`minecraft:data remove entity ${fixture.maid} NeoForgeData.qiandengji_follow`);await rc(`minecraft:data merge entity ${fixture.maid} {NoAI:0b}`);}catch{}
 for(const p of peers)p.close();for(const b of bots)b.quit();for(const s of [model,media]){s.closeAllConnections();await new Promise(r=>s.close(r));}
 report.passed=!report.error;report.modelCalls=requests.length;report.mediaCalls=mediaCalls.length;await fs.writeFile(root+'/conversation-range.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,count:report.checks.length,error:report.error}));if(report.error)process.exitCode=1;
}
