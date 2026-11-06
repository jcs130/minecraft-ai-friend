import{createRequire}from'node:module';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';import{readFileSync,writeFileSync}from'node:fs';import{randomUUID,randomBytes,createCipheriv,createDecipheriv}from'node:crypto';import{createSocket}from'node:dgram';import{setTimeout as sleep}from'node:timers/promises';import assert from'node:assert/strict';
import{command}from'../../../ops/rcon-client.mjs';
import{attachProximityVoice}from'../client.mjs';
// Explicit loopback fixture only. Never defaults to a production server.
const [rootArg,mode,baseArg,dependencies,compat]=process.argv.slice(2);
assert.ok(rootArg&&baseArg&&dependencies,'evidence directory, mode, fixture root and Mineflayer dependency root required');
assert.ok(['baseline','candidate','restart'].includes(mode));
const root=resolve(rootArg),base=resolve(baseArg),lab=base+'/lab';
assert.equal(dirname(root).toLowerCase(),base.toLowerCase());
const installRecipePacketBypass=compat?(await import(pathToFileURL(resolve(compat)).href)).installRecipePacketBypass:()=>{};
assert.equal(readFileSync(lab+'/.voice-delivery-qa','utf8'),'LOOPBACK_ONLY_29520');assert.match(readFileSync(lab+'/server.properties','utf8'),/^server-port=29520$/m);
assert.match(readFileSync(lab+'/server.properties','utf8'),/^server-ip=127\.0\.0\.1$/m);
const mineflayer=createRequire(pathToFileURL(resolve(dependencies,'package.json')))('mineflayer'),bots=[],udp=[],report={checks:[],failures:[],productionPlayersUsed:false,originalRequestReplayed:false,clientAudioOutputVerified:false};let voice;
const run=text=>command(text,10000,{properties:lab+'/server.properties',port:29521});
const check=(name,value)=>{(value?report.checks:report.failures).push(name);};
async function until(fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Fixture condition timed out');}
function vint(n){const out=[];do{let b=n&127;n>>>=7;if(n)b|=128;out.push(b);}while(n);return Buffer.from(out);}
function readv(b,offset){let n=0,s=0,p=offset;for(;p<b.length&&s<35;s+=7){let v=b[p++];n|=(v&127)<<s;if(!(v&128))return[n,p];}throw Error('Invalid synthetic UDP packet');}
async function receiver(bot){
 const sock=createSocket('udp4'),state={audio:0,acks:0,errors:0,secret:false,packets:[]};let key,uuid;
 const send=(id,body=Buffer.alloc(0))=>{const iv=randomBytes(12),cipher=createCipheriv('aes-128-gcm',key,iv),encrypted=Buffer.concat([iv,cipher.update(Buffer.concat([Buffer.from([id]),body])),cipher.final(),cipher.getAuthTag()]);sock.send(Buffer.concat([Buffer.from([255]),uuid,vint(encrypted.length),encrypted]),29522,'127.0.0.1');};
 sock.on('message',(packet,rinfo)=>{try{
  assert.equal(rinfo.address,'127.0.0.1');assert.equal(rinfo.port,29522);assert.equal(packet[0],255);const[len,at]=readv(packet,1),enc=packet.subarray(at,at+len),dec=createDecipheriv('aes-128-gcm',key,enc.subarray(0,12));dec.setAuthTag(enc.subarray(-16));const data=Buffer.concat([dec.update(enc.subarray(12,-16)),dec.final()]);
  if(data[0]===6){state.acks++;send(9);}else if(data[0]===8)send(8);else if(data[0]===9)send(10);else if(data[0]===2){const[size,start]=readv(data,33);if(size>0){state.audio++;state.packets.push(data.subarray(start,start+size).toString('base64'));}}
 }catch{state.errors++;}});
 const secret=packet=>{if(packet.channel!=='voicechat:secret')return;const data=packet.data;key=data.subarray(0,16);assert.equal(data.readInt32BE(16),29522);uuid=data.subarray(20,36);state.secret=true;send(5,Buffer.concat([uuid,key]));};
 bot._client.on('custom_payload',secret);await new Promise(resolve=>sock.bind(0,'127.0.0.1',resolve));
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('voicechat:secret\0voicechat:state\0voicechat:states\0voicechat:request_secret\0voicechat:update_state')});const version=Buffer.alloc(4);version.writeInt32BE(20);bot._client.write('custom_payload',{channel:'voicechat:request_secret',data:version});
 await until(()=>state.acks>0);const timer=setInterval(()=>send(8),1000);
 const setDisabled=value=>bot._client.write('custom_payload',{channel:'voicechat:update_state',data:Buffer.from([value?1:0])});
 setDisabled(false);await sleep(400);
 const result={state,setDisabled,close(){clearInterval(timer);bot._client.off('custom_payload',secret);sock.close();}};udp.push(result);return result;
}
try{
 for(const name of ['QVSource','QVReceiver','QVFar','QVDisabled']){
  const bot=mineflayer.createBot({host:'127.0.0.1',port:29520,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(bot);installRecipePacketBypass(bot._client);bot.on('error',()=>{});
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);setTimeout(()=>reject(Error('Isolated login timed out')),15000).unref()});await run('gamemode creative '+name);
 }
 for(const cmd of ['time set day','gamerule doMobSpawning false','tp QVSource 0 80 0','tp QVReceiver 3 80 0','tp QVFar 200 80 0','tp QVDisabled 4 80 0'])await run(cmd);
 voice=attachProximityVoice(bots[0],{timeoutMs:15000});const wav=readFileSync(root+'/synthetic.wav');
 if(mode==='restart'){
  const prior=JSON.parse(readFileSync(base+'/last-receipt.json','utf8'));const res=await voice.status(prior.requestId);check('restart retains delivery and terminal receipt',JSON.stringify(res.delivery)===JSON.stringify(prior.delivery)&&res.state===prior.state);const dup=await voice.upload(wav,{requestId:prior.requestId});check('restart does not replay old synthetic request',dup.delivery?.packetOffers===prior.delivery?.packetOffers);report.passed=!report.failures.length;
 }else{
  const noReceiver=await voice.upload(wav,{requestId:randomUUID()});report.noReceiver=noReceiver;check('no receiver is explicitly diagnosed',noReceiver.state==='sent'&&noReceiver.reason==='VOICE_NO_RECEIVER_CHECK_STATUS'&&noReceiver.delivery?.packetOffers===0&&noReceiver.actualHearingVerified===false);
  report.noModStatus=await run('voice status QVReceiver QVSource');check('unmodified receiver has actionable status',report.noModStatus.includes('VOICE_CLIENT_NOT_INSTALLED'));
  const near=await receiver(bots[1]),far=await receiver(bots[2]),disabled=await receiver(bots[3]);disabled.setDisabled(true);await sleep(500);
  report.disabledStatus=await run('voice status QVDisabled QVSource');check('disabled listener is explicitly diagnosed',report.disabledStatus.includes('VOICE_CLIENT_DISABLED'));
  const id=randomUUID(),sent=await voice.upload(wav,{requestId:id});await sleep(300);report.sent=sent;report.udp={near:near.state.audio,far:far.state.audio,disabled:disabled.state.audio,errors:udp.reduce((n,r)=>n+r.state.errors,0)};
  check('encrypted UDP audio reaches enabled near receiver',near.state.audio>=45);check('far receiver receives zero audio',far.state.audio===0);check('disabled receiver receives zero audio',disabled.state.audio===0);check('UDP authenticates and decrypts without errors',report.udp.errors===0);
  check('receipt differentiates offer from hearing',sent.reason==='VOICE_SENT_HEARING_UNVERIFIED'&&sent.delivery?.listenerCount===1&&sent.delivery?.packetOffers===near.state.audio&&sent.actualHearingVerified===false);
  const before=near.state.audio,duplicate=await voice.upload(wav,{requestId:id});await sleep(300);check('duplicate returns persisted receipt without playback',near.state.audio===before&&JSON.stringify(duplicate.delivery)===JSON.stringify(sent.delivery));
  await run('execute in minecraft:the_nether run tp QVReceiver 3 80 0');await sleep(700);const other=await voice.upload(wav,{requestId:randomUUID()});await sleep(150);check('different dimension blocks audio and diagnoses no receiver',near.state.audio===before&&other.reason==='VOICE_NO_RECEIVER_CHECK_STATUS');
  for(const [status,code]of [[403,'VOICE_MEDIA_AUTH_REJECTED'],[503,'VOICE_MEDIA_BUSY'],[422,'VOICE_AUDIO_INPUT_REJECTED'],[299,'VOICE_NORMALIZED_AUDIO_INVALID']]){
   writeFileSync(base+'/http-mode',String(status));const failure=await voice.upload(wav,{requestId:randomUUID()});check('backend '+status+' gives stage-specific error',failure.state==='failed'&&failure.reason===code&&typeof failure.nextStep==='string'&&!JSON.stringify(failure).includes('private detail'));
  }
  writeFileSync(base+'/http-mode','200');writeFileSync(base+'/last-receipt.json',JSON.stringify(sent));writeFileSync(root+'/opus.json',JSON.stringify(near.state.packets));
  report.passed=report.failures.length===0;
 }
}catch(e){report.passed=false;report.error=e.stack;}
finally{voice?.close();for(const r of udp)r.close();for(const b of bots)b.quit('isolated voice verification finished');writeFileSync(root+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(!report.passed)process.exitCode=1;
