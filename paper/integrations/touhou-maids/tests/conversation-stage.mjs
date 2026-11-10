// Existing synthetic world only. Real chat events, actual encrypted SVC UDP, no production identities.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import http from 'node:http';
import {createRequire} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';import {pathToFileURL} from 'node:url';
const stage=process.env.MAID_SOCIAL_QA_STAGE,root=process.env.MAID_SOCIAL_QA_REPORT_ROOT,fixtureRoot=process.env.MAID_SOCIAL_QA_FIXTURE_ROOT,anchor=process.env.MAID_SOCIAL_QA_CLIENT_ANCHOR;
assert(stage&&root&&fixtureRoot&&anchor&&process.env.MAID_SOCIAL_QA_RCON);
assert.equal(await fs.readFile(stage+'/.maid-lifecycle-qa','utf8'),'FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA');
const props=await fs.readFile(stage+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=25938$/m.test(props)&&/^rcon.port=25939$/m.test(props));
const fixture=JSON.parse(await fs.readFile(fixtureRoot+'/fixture.json','utf8'));assert(fixture.synthetic);
const {command}=await import(pathToFileURL(process.env.MAID_SOCIAL_QA_RCON));const rc=c=>command(c,15000,{port:25939,properties:stage+'/server.properties'});
const baseline=process.argv.includes('--baseline'),run='cv'+Date.now().toString(36),report={run,baseline,checks:[],realPlayerDataUsed:false,productionChanged:false,actualHumanHearingVerified:false},bots=[],peers=[],modelRequests=[],mediaRequests=[];
const check=(name,ok)=>{report.checks.push({name,ok:!!ok});console.log((ok?'PASS ':'FAIL ')+name);assert(ok,name);};
const until=async(fn,label,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await delay(100);}throw Error('Timeout '+label);};
let mode='ok',asrText='隔离肥鱼，你好，语音测试',releaseAsr;const asrRequests=[];const realVoice=process.argv.includes('--real-voice'),replyText=realVoice?'你好，我是肥鱼，一起去冒险吧。':'你好，我是隔离肥鱼。';
const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*Math.PI*2)*1500),44+i*2);
const model=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;let body=JSON.parse(raw);modelRequests.push(body);await delay(mode==='late'?4500:500);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'synthetic',object:'chat.completion',model:'qa-native',choices:[{message:{role:'assistant',content:replyText},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});
const media=http.createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const raw=Buffer.concat(chunks);if(req.url==='/v1/asr'){assert.equal(raw.toString('ascii',0,4),'RIFF');asrRequests.push(req.headers['x-request-id']);if(mode==='asr-wait')await new Promise(resolve=>releaseAsr=resolve);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({text:asrText}));return;}mediaRequests.push(JSON.parse(raw));if(mode==='media-failure'){res.writeHead(503);res.end();return;}res.writeHead(200,{'content-type':'audio/wav'});res.end(wav);});
async function connect(name){let bot=createRequire(anchor)('mineflayer').createBot({host:'127.0.0.1',port:25938,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(bot);bot.lines=[];bot.replies=[];bot.on('error',()=>{});bot.on('messagestr',(text,kind)=>{bot.lines.push(text);if(kind==='system'&&text.startsWith('QD_MAID '))try{bot.replies.push(JSON.parse(text.slice(8)));}catch{}});await until(()=>bot.entity&&bot.player?.uuid,name);return bot;}
let seq=0;
async function ask(bot,action,value='',id=run+'_'+(++seq),maid=fixture.maid){await delay(1000);let start=bot.replies.length;bot.chat(`/qdmaid ${action} ${maid} ${id}${value?' '+value:''}`);return until(()=>bot.replies.slice(start).find(r=>r.requestId===id),action);}
async function chat(bot,text){bot.chat(text);await delay(2200);}
try{
 await until(async()=>{try{return(await rc('version QiandengjiMaidBridge')).includes(baseline?'0.1.11-social':process.env.MAID_SOCIAL_QA_VERSION||'0.1.12-conversation');}catch{return false;}},'QA startup',150000);
 await new Promise(resolve=>model.listen(19088,'127.0.0.1',resolve));await new Promise(resolve=>media.listen(19091,'127.0.0.1',resolve));
 const owner=await connect(fixture.username),visitor=await connect('MaidVisitorQA'),bystander=await connect('MaidOtherQA');
 if(process.argv.includes('--receipt-regression')){
   visitor._client.on('custom_payload',p=>{if(p.channel==='qiandengji:maids')try{visitor.replies.push(JSON.parse(p.data.toString()));}catch{}});
   visitor._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('qiandengji:maids')});
   const saved=[];
   if(!process.argv.includes('--restart'))for(const [action,value] of [['follow',''],['stay',''],['sit',''],['pickup','true']]){
     const applied=await ask(owner,action,value);check(action+' applied',applied.ok&&applied.data.status==='applied');
     const query=run+'_q'+(++seq),offset=owner.replies.length;
     owner.chat(`/qdmaid receipt ${fixture.maid} ${applied.requestId} ${query}`);
     const read=await until(()=>owner.replies.slice(offset).find(r=>r.requestId===query),'read original '+action);
     check(action+' original receipt readable',read.ok&&read.data.operationId===applied.requestId&&read.data.status==='applied');
     saved.push({action,id:applied.requestId});
   }
   if(!process.argv.includes('--restart'))await fs.writeFile(root+'/original-receipt-ids.json',JSON.stringify(saved));
   else for(const old of JSON.parse(await fs.readFile(root+'/original-receipt-ids.json','utf8'))){
     const query=run+'_old'+(++seq),offset=owner.replies.length;
     owner.chat(`/qdmaid receipt ${fixture.maid} ${old.id} ${query}`);
     const read=await until(()=>owner.replies.slice(offset).find(r=>r.requestId===query),'persisted receipt '+old.action);
     check('restart reads original '+old.action+' without replay',read.ok&&read.data.operationId===old.id&&read.data.status==='applied');await delay(1100);
   }
 }
 await rc('minecraft:fill 294 89 294 340 89 310 minecraft:stone');await rc('minecraft:time set 1000');
 for(const bot of bots){await rc('minecraft:gamemode survival '+bot.username);await rc('minecraft:effect give '+bot.username+' minecraft:resistance infinite 4 true');await rc('minecraft:tp '+bot.username+' 300.5 90 300.5');}
 await rc(`minecraft:tp ${fixture.maid} 302.5 90 300.5`);await rc('speechqa quiet '+fixture.maid);await ask(owner,'brain','native');await ask(owner,'follow');await delay(1200);
 if(process.argv.includes('--restart')){
   const receiver=await import('./svc-receiver.mjs');for(const bot of bots)peers.push(await receiver.receiver(bot));await delay(6500);
   check('restart never replays historical owner or public dialogue',modelRequests.length===0&&mediaRequests.length===0&&peers.every(p=>p.state.audio===0));
   const context=(await ask(owner,'context')).data;check('restart keeps original owner and live identity',context.maidId===fixture.maid&&context.ownerId===fixture.owner&&context.lifeState==='alive');
   check('context explains actual appearance and natural dialogue',context.appearance.modelId===context.modelId&&context.appearance.type==='native_maid'&&context.conversation.nearbyRange===8&&context.speech.voice===(realVoice?'deepfish-low-warm-20261029':'qa-companion'));
   if(realVoice){
     assert(/^backend:\s*http:\/\/127\.0\.0\.1:8857\s*$/m.test(await fs.readFile(stage+'/plugins/QiandengVoice/config.yml','utf8')),'Real-voice acceptance requires the actual loopback ASR service, not the fixture mock');
     const configured=JSON.parse(await fs.readFile(stage+'/plugins/QiandengjiMaidBridge/companion-speech.json','utf8'));assert.equal(configured.backend,'http://127.0.0.1:8857');assert.equal(configured.maidId,fixture.maid);assert.equal(configured.voice,'deepfish-low-warm-20261029');
     visitor.chat('隔离肥鱼，请用一句话问好');await until(()=>peers[1].state.audio>40,'existing real TTS to encrypted UDP',110000);await delay(4500);
     check('existing DeepFish voice reaches actual SVC listener',peers[1].state.audio>40&&peers[1].state.errors===0&&mediaRequests.length===0);
     await delay(1200);check('maid audio alone never starts another model call',modelRequests.length===1);
     const before=visitor.lines.length;await peers[1].speak(peers[1].state.packets);await until(()=>visitor.lines.slice(before).some(s=>s.includes('[语音识别]')&&s.includes('你好')&&s.includes('冒险')),'received Opus returns through real CPU ASR',110000);
     report.recognizedCaption=visitor.lines.slice(before).find(s=>s.includes('[语音识别]'));
     check('received encrypted audio decodes to the original Chinese reply',report.recognizedCaption?.includes('你好')&&report.recognizedCaption.includes('冒险')&&asrRequests.length===0);
     await until(()=>modelRequests.length===2,'one intentionally injected microphone followup');await delay(5000);check('explicit microphone followup replies once without an automatic loop',modelRequests.length===2);report.realVoice=true;report.receivedOpusPackets=peers[1].state.audio;
   }
 }else if(baseline){
   await chat(visitor,'隔离肥鱼，你好');check('baseline nearby name-addressed chat never reaches configured model',modelRequests.length===0);
   const ctx=await ask(owner,'context');check('baseline has no unified voice status',!ctx.data.speech);
 }else{
   await chat(visitor,'你好，大家今天去哪里冒险？');check('ordinary conversation does not call a model',modelRequests.length===0);
   await chat(visitor,'!隔离肥鱼，公屏测试');check('global shout is delivered but never treated as nearby addressing',modelRequests.length===0&&bystander.lines.some(s=>s.includes('!隔离肥鱼，公屏测试')));
   const start=visitor.lines.length;await chat(visitor,'隔离肥鱼，你好');await until(()=>modelRequests.length===1,'one addressed request');
   if(process.argv.includes('--receipt-regression')){
     const reply=await until(()=>visitor.replies.find(r=>r.action==='chat-result'&&r.data?.status==='replied'),'authenticated nearby reply');
     check('subscriber gets original public identity and request',reply.recipientUuid===visitor.player.uuid&&reply.data.operationId===reply.requestId&&reply.data.maidId===fixture.maid&&reply.data.observation.conversation==='nearby_visitor');
   }
   await until(()=>visitor.lines.slice(start).some(s=>s.includes('[隔离肥鱼] 你好，我是隔离肥鱼')),'natural reply');check('addressed chat produces one model reply',modelRequests.length===1);
   check('incoming chat is not echoed as a second maid dialogue line',!bystander.lines.some(s=>s.includes('MaidVisitorQA → 隔离肥鱼')));
   check('nearby bystander gets attributed text',bystander.lines.some(s=>s.includes('[附近·女仆] 隔离肥鱼：')));
   check('vanilla-only listeners cause no TTS calls',mediaRequests.length===0);
   check('public chat has no owner tools or private contexts',!(modelRequests[0].tools?.length)&&modelRequests[0].messages[0].content.includes('本轮只交流'));
   await rc('minecraft:tp MaidVisitorQA 330 90 300');await chat(visitor,'隔离肥鱼，远处测试');check('far address does not wake model',modelRequests.length===1);
   await rc('minecraft:gamemode creative MaidVisitorQA');await rc('minecraft:execute in minecraft:the_nether run minecraft:tp MaidVisitorQA 302 90 300');check('cross-world fixture really entered the nether',(await rc('minecraft:data get entity MaidVisitorQA Dimension')).includes('the_nether'));await chat(visitor,'隔离肥鱼，跨维度测试');check('same coordinates in another dimension do not wake model',modelRequests.length===1);
   await rc('minecraft:execute in minecraft:overworld run minecraft:tp MaidVisitorQA 300.5 90 300.5');await delay(400);await rc('minecraft:gamemode survival MaidVisitorQA');
   await rc('essentials:mute MaidVisitorQA');await chat(visitor,'隔离肥鱼，禁言测试');check('cancelled muted chat never calls model',modelRequests.length===1);await rc('essentials:mute MaidVisitorQA');
   await chat(visitor,'/msg MaidBrainQA 隔离肥鱼，私聊测试');check('delivered private messages do not wake maid',modelRequests.length===1&&owner.lines.some(s=>s.includes('私聊测试')));
   if(!process.argv.includes('--receipt-only')){
   const receiver=await import('./svc-receiver.mjs');const peer=await receiver.receiver(visitor);peers.push(peer);const otherPeer=await receiver.receiver(bystander);peers.push(otherPeer);
   const audio=peer.state.audio;await chat(visitor,'@隔离肥鱼 请用一句话问好');await until(()=>peer.state.audio>audio,'native SVC UDP audio');
   check('public reply uses configured voice once',mediaRequests.length===1&&mediaRequests[0].voice==='qa-companion'&&mediaRequests[0].actor===fixture.maid);
   check('public reply sends actual encrypted entity audio',peer.state.audio>audio&&peer.state.errors===0&&otherPeer.state.audio>0);
   const speech=(await ask(owner,'context')).data.speech;check('speech reports sent but never claims hearing verified',speech.state==='sent'&&speech.hearingVerified===false);
   await delay(5500);let before=mediaRequests.length;await rc('speechqa ambient '+fixture.maid);await until(()=>mediaRequests.length>before,'ambient media');check('ambient and generated reply use the same voice',mediaRequests.at(-1).voice==='qa-companion');
   await delay(1800);before=mediaRequests.length;await rc('speechqa ambient '+fixture.maid);await delay(800);check('per-recipient sound projection never multiplies synthesis',mediaRequests.length===before);
   await rc('speechqa ambient '+fixture.otherMaid);await delay(800);check('other maids never call shared TTS',mediaRequests.length===before);
   const ownerPeer=await receiver.receiver(owner);peers.push(ownerPeer);const outsiderAudio=peer.state.audio;await ask(owner,'chat','主人专属隔离对话');await until(()=>mediaRequests.length>before,'owner reply voice');await delay(1600);check('owner native response audio is private',ownerPeer.state.audio>0&&peer.state.audio===outsiderAudio);
   await delay(5500);mode='media-failure';await chat(visitor,'隔离肥鱼，音频失败测试');await until(async()=>((await ask(owner,'context')).data.speech?.state)==='failed','voice failure');check('voice failure preserves text and no retry',visitor.lines.some(s=>s.includes('[隔离肥鱼] 你好，我是隔离肥鱼')));const count=mediaRequests.length;await delay(1500);check('failed speech is never automatically retried',mediaRequests.length===count);mode='ok';
   const microphone=peer.state.packets.slice(0,25);assert.equal(microphone.length,25);
   await delay(5500);before=modelRequests.length;const captionStart=visitor.lines.length;await peer.speak(microphone);await until(()=>asrRequests.length===1,'recognized microphone');await until(()=>modelRequests.length===before+1,'voice addressed maid');await delay(1800);
   check('real encrypted microphone packets reach ASR and exactly one maid reply',asrRequests.length===1&&modelRequests.length===before+1&&peer.state.errors===0);
   check('recognized speech keeps nearby ASR marker',visitor.lines.slice(captionStart).filter(s=>s.includes('[附近][语音识别]')&&s.includes(asrText)).length===1);
   before=modelRequests.length;asrText='大家准备出发吧';await otherPeer.speak(microphone);await until(()=>asrRequests.length===2,'ordinary microphone');await delay(1000);check('unaddressed recognized speech from a bystander never calls maid model',modelRequests.length===before);
   asrText='隔离肥鱼，你好，远处的录音';mode='asr-wait';await rc('minecraft:tp MaidVisitorQA 330.5 90 300.5');await delay(400);await peer.speak(microphone);await until(()=>releaseAsr,'deferred recognition');await rc('minecraft:tp MaidVisitorQA 300.5 90 300.5');await delay(400);releaseAsr();releaseAsr=undefined;await delay(1800);check('walking near after far recording does not retroactively wake maid',modelRequests.length===before);
   await delay(5500);await peer.speak(microphone);await until(()=>releaseAsr,'deferred nearby recognition');await rc('minecraft:tp MaidVisitorQA 330.5 90 300.5');await delay(400);releaseAsr();releaseAsr=undefined;await delay(1500);check('leaving before recognition prevents stale maid request',modelRequests.length===before);mode='ok';await rc('minecraft:tp MaidVisitorQA 300.5 90 300.5');
   await delay(5500);mode='late';const lateStart=visitor.lines.length;before=mediaRequests.length;visitor.chat('隔离肥鱼，等我回来再说');await delay(1000);await rc('minecraft:tp MaidVisitorQA 330.5 90 300.5');await delay(5000);check('leaving while model thinks cancels reply and voice delivery',mediaRequests.length===before&&!visitor.lines.slice(lateStart).some(s=>s.includes('[隔离肥鱼] 你好，我是隔离肥鱼')));mode='ok';
   await rc('minecraft:tp MaidVisitorQA 300.5 90 300.5');await delay(5500);mode='late';before=mediaRequests.length;visitor.chat('隔离肥鱼，重连前的对话');await delay(1000);peer.close();visitor.quit();await delay(900);const rejoined=await connect('MaidVisitorQA');await delay(5000);check('reconnected same identity never receives stale reply or audio',mediaRequests.length===before&&!rejoined.lines.some(s=>s.includes('[隔离肥鱼] 你好，我是隔离肥鱼')));mode='ok';
   }
 }
 await rc('minecraft:save-all flush');
}catch(error){report.error=String(error);report.syntheticMessages=Object.fromEntries(bots.map(b=>[b.username,b.lines.slice(-12)]));console.log(report.error);console.log(JSON.stringify(report.syntheticMessages));}
finally{releaseAsr?.();for(const peer of peers)peer.close();for(const bot of bots)bot.quit();model.closeAllConnections();media.closeAllConnections();await new Promise(resolve=>model.close(resolve));await new Promise(resolve=>media.close(resolve));report.passed=!report.error&&report.checks.every(c=>c.ok);report.modelCalls=modelRequests.length;report.mediaCalls=mediaRequests.length;report.asrCalls=asrRequests.length;await fs.mkdir(root,{recursive:true});await fs.writeFile(root+`/conversation-${baseline?'baseline':process.argv.includes('--restart')?'restart':'candidate'}-${run}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));if(!report.passed)process.exitCode=1;}
