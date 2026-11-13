import{createRequire}from'node:module';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';import{readFileSync,writeFileSync}from'node:fs';import{randomUUID,randomBytes,createCipheriv,createDecipheriv}from'node:crypto';import{createSocket}from'node:dgram';import{setTimeout as sleep}from'node:timers/promises';import assert from'node:assert/strict';
import{command}from'../../../ops/rcon-client.mjs';
import{attachProximityVoice}from'../client.mjs';
// Explicit loopback fixture only. Never defaults to a production server.
const [rootArg,mode,baseArg,dependencies,compat]=process.argv.slice(2);
assert.ok(rootArg&&baseArg&&dependencies,'evidence directory, mode, fixture root and Mineflayer dependency root required');
assert.ok(['baseline','candidate','restart','goddess'].includes(mode));
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
 const sock=createSocket('udp4'),state={audio:0,privateAudio:0,acks:0,errors:0,secret:false,packets:[],privatePackets:[],players:new Map(),stateChanges:0};let key,uuid;
 const send=(id,body=Buffer.alloc(0))=>{const iv=randomBytes(12),cipher=createCipheriv('aes-128-gcm',key,iv),encrypted=Buffer.concat([iv,cipher.update(Buffer.concat([Buffer.from([id]),body])),cipher.final(),cipher.getAuthTag()]);sock.send(Buffer.concat([Buffer.from([255]),uuid,vint(encrypted.length),encrypted]),29522,'127.0.0.1');};
 sock.on('message',(packet,rinfo)=>{try{
  assert.equal(rinfo.address,'127.0.0.1');assert.equal(rinfo.port,29522);assert.equal(packet[0],255);const[len,at]=readv(packet,1),enc=packet.subarray(at,at+len),dec=createDecipheriv('aes-128-gcm',key,enc.subarray(0,12));dec.setAuthTag(enc.subarray(-16));const data=Buffer.concat([dec.update(enc.subarray(12,-16)),dec.final()]);
  if(data[0]===6){state.acks++;send(9);}else if(data[0]===8)send(8);else if(data[0]===9)send(10);else if(data[0]===2||data[0]===3){
   const [size,start]=readv(data,33);
   if(size>0){
    const payload=data.subarray(start,start+size).toString('base64');
    if(data[0]===3){state.privateAudio++;state.privatePackets.push(payload);}
    else{state.audio++;state.packets.push(payload);}
   }
  }
 }catch{state.errors++;}});
 const secret=packet=>{
  if(['voicechat:state','voicechat:states'].includes(packet.channel)){
   try{const data=packet.data;let at=packet.channel==='voicechat:states'?4:0,count=at?data.readInt32BE(0):1;assert.ok(count>=0&&count<=32);
    for(let i=0;i<count;i++){const disabled=!!data[at++],disconnected=!!data[at++],id=data.subarray(at,at+16).toString('hex');at+=16;const[size,start]=readv(data,at);const name=data.toString('utf8',start,start+size);at=start+size;const group=!!data[at++];if(group)at+=16;state.players.set(name,{id,disabled,disconnected});state.stateChanges++;}assert.equal(at,data.length);
   }catch{state.errors++;}return;
  }
  if(packet.channel!=='voicechat:secret')return;const data=packet.data;key=data.subarray(0,16);assert.equal(data.readInt32BE(16),29522);uuid=data.subarray(20,36);state.secret=true;send(5,Buffer.concat([uuid,key]));};
 bot._client.on('custom_payload',secret);await new Promise(resolve=>sock.bind(0,'127.0.0.1',resolve));
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('voicechat:secret\0voicechat:state\0voicechat:states\0voicechat:request_secret\0voicechat:update_state')});const version=Buffer.alloc(4);version.writeInt32BE(20);bot._client.write('custom_payload',{channel:'voicechat:request_secret',data:version});
 await until(()=>state.acks>0);const timer=setInterval(()=>send(8),1000);
 const setDisabled=value=>bot._client.write('custom_payload',{channel:'voicechat:update_state',data:Buffer.from([value?1:0])});
 setDisabled(false);await sleep(400);
 const result={state,setDisabled,close(){clearInterval(timer);bot._client.off('custom_payload',secret);sock.close();}};udp.push(result);return result;
}
try{
 for(const name of [mode==='goddess'?'Goddess':'QVSource','QVReceiver','QVFar','QVDisabled']){
  const bot=mineflayer.createBot({host:'127.0.0.1',port:29520,version:'1.21.1',username:name,auth:'offline',hideErrors:true});bots.push(bot);installRecipePacketBypass(bot._client);bot.on('error',()=>{});
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);setTimeout(()=>reject(Error('Isolated login timed out')),15000).unref()});await run('gamemode creative '+name);
 }
 for(const cmd of ['time set day','gamerule doMobSpawning false','tp '+bots[0].username+' 0 80 0','tp QVReceiver 3 80 0','tp QVFar 200 80 0','tp QVDisabled 4 80 0'])await run(cmd);
 if(mode==='goddess'){
  const [goddess,nearPlayer,farPlayer,plainPlayer]=bots;
  const messages=new Map(bots.map(bot=>[bot.username,[]]));
  for(const bot of bots)bot.on('messagestr',line=>messages.get(bot.username).push(line));
  await run('op Goddess');
  const near=await receiver(nearPlayer),far=await receiver(farPlayer);
  const total=r=>r.state.audio+r.state.privateAudio;
  const heard=(bot,line)=>messages.get(bot.username).some(message=>message.includes(line));
 const waitForPlayback=async n=>{
  const ledger=lab+'/plugins/QiandengVoice/receipts/'+goddess.player.uuid+'.jsonl';
  await until(()=>{
   try{return readFileSync(ledger,'utf8').split('\n').filter(line=>line&&JSON.parse(line).state==='sent').length>=n;}
   catch{return false;}
  },22000);
  await sleep(250);
 };
 let played=0;
 try{
  played=readFileSync(lab+'/plugins/QiandengVoice/receipts/'+goddess.player.uuid+'.jsonl','utf8')
   .split('\n').filter(line=>line&&JSON.parse(line).state==='sent').length;
 }catch(error){if(error.code!=='ENOENT')throw error;}
  const qaLine='旅人，你好。沿着灯火往前走，我在公会等你。';
  goddess.chat('/minecraft:msg QVReceiver '+qaLine);
  await until(()=>total(near)>0,20000);
  await waitForPlayback(played+1);
  check('native whisper delivers text only to its intended recipient',heard(nearPlayer,qaLine)&&!heard(farPlayer,qaLine)&&!heard(plainPlayer,qaLine));
  check('private sound uses the static channel and has no nearby echo',near.state.privateAudio>0&&near.state.audio===0&&total(far)===0);
  const before=total(near);
  await run('execute in minecraft:the_nether run tp QVFar 3 80 0');
  await sleep(500);
  goddess.chat('/minecraft:msg QVFar 跨维度私聊验收。');
  await until(()=>total(far)>0,20000);
  await waitForPlayback(played+2);
  check('only the addressed listener receives audio across dimensions',far.state.privateAudio>0&&far.state.audio===0&&total(near)===before&&heard(farPlayer,'跨维度私聊验收。'));
  const farBefore=total(far);
  goddess.chat('/minecraft:msg QVDisabled 原版也能收到文字。');
  await until(()=>heard(plainPlayer,'原版也能收到文字。'));
  await sleep(1100);
  check('vanilla recipient still receives text without any broadcast audio',total(near)===before&&total(far)===farBefore);
  nearPlayer.chat('/minecraft:msg QVFar 普通账号私聊。');
  await until(()=>heard(farPlayer,'普通账号私聊。'));
  await sleep(1100);
  check('another account cannot trigger Goddess private TTS',total(near)===before&&total(far)===farBefore);
  near.setDisabled(true);
  await until(async()=>(await run('voice status QVReceiver')).includes('VOICE_CLIENT_DISABLED'));
  goddess.chat('/minecraft:msg QVReceiver 禁用语音仍有文字。');
  await until(()=>heard(nearPlayer,'禁用语音仍有文字。'));
  await sleep(1100);
  check('disabled SVC client still receives only text',total(near)===before&&total(far)===farBefore);
  report.udp={target:near.state.privateAudio,acrossDimensions:far.state.privateAudio,unexpected:near.state.audio+far.state.audio,
    errors:near.state.errors+far.state.errors};
  check('both encrypted audio sessions decode without transport errors',report.udp.errors===0);
  writeFileSync(root+'/goddess-private-opus.json',JSON.stringify(near.state.privatePackets));
  report.passed=!report.failures.length;
 }else{
 // Velocity also advertises its registered channels for every player. This
 // transport declaration alone must not impersonate an Agent voice adapter.
 for(const bot of bots)bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:voice')});
 await sleep(300);
 check('proxy channel advertisement alone never connects a vanilla player',(await run('voice status QVFar')).includes('VOICE_CLIENT_NOT_INSTALLED'));
 voice=attachProximityVoice(bots[0],{timeoutMs:15000});const wav=readFileSync(root+'/synthetic.wav');
 if(mode==='restart'){
  const near=await receiver(bots[1]);await until(()=>near.state.players.has('QVSource'));
  check('fresh registration restores bridge presence after restart',near.state.players.get('QVSource')?.disconnected===false);
  check('unregistered player remains disconnected after restart',near.state.players.get('QVFar')?.disconnected===true);
  const prior=JSON.parse(readFileSync(base+'/last-receipt.json','utf8'));const res=await voice.status(prior.requestId);check('restart retains delivery and terminal receipt',JSON.stringify(res.delivery)===JSON.stringify(prior.delivery)&&res.state===prior.state);const dup=await voice.upload(wav,{requestId:prior.requestId});await sleep(300);check('restart does not replay old synthetic request',dup.delivery?.packetOffers===prior.delivery?.packetOffers&&near.state.audio===0);report.passed=!report.failures.length;
 }else{
  const noReceiver=await voice.upload(wav,{requestId:randomUUID()});report.noReceiver=noReceiver;check('no receiver is explicitly diagnosed',noReceiver.state==='sent'&&noReceiver.reason==='VOICE_NO_RECEIVER_CHECK_STATUS'&&noReceiver.delivery?.packetOffers===0&&noReceiver.actualHearingVerified===false);
  report.noModStatus=await run('voice status QVReceiver QVSource');check('unmodified receiver has actionable status',report.noModStatus.includes('VOICE_CLIENT_NOT_INSTALLED'));
  const near=await receiver(bots[1]),far=await receiver(bots[2]),disabled=await receiver(bots[3]);disabled.setDisabled(true);await sleep(500);
  await until(()=>near.state.players.has('QVSource'));
  report.bridgeState=near.state.players.get('QVSource');
  check('native SVC client receives connected bridge state for the existing Agent UUID',report.bridgeState.id===bots[0].player.uuid.replaceAll('-','')&&!report.bridgeState.disconnected&&!report.bridgeState.disabled);
  report.bridgeDiagnostic=await run('voice status QVSource QVReceiver');
  check('bridge diagnostic distinguishes adapter from a native audio receiver',report.bridgeDiagnostic.includes('VOICE_BRIDGE_CONNECTED')&&report.bridgeDiagnostic.includes('installed=false'));
  const updates=near.state.stateChanges;
  bots[0]._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:voice')});await sleep(300);
  check('duplicate registration does not repeatedly broadcast voice states',near.state.stateChanges===updates);
  const nativeVoice=attachProximityVoice(bots[3]);await sleep(200);
  check('real client disabled state remains controlled by that client',(await run('voice status QVDisabled')).includes('VOICE_CLIENT_DISABLED'));
  nativeVoice.close();await sleep(200);
  check('closing native adapter preserves its real UDP connection and disabled state',(await run('voice status QVDisabled')).includes('connected=true, disabled=true'));
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
  // Back in the same world, actual protocol registration/unregistration must
  // control only this bridge's state; no admin writes to SVC player state.
  await run('execute in minecraft:overworld run tp QVReceiver 3 80 0');await sleep(300);
  voice.close();voice=null;await sleep(400);
  check('adapter close restores the disconnected icon through a real state packet',near.state.players.get('QVSource')?.disconnected===true);
  check('adapter close removes bridge diagnostic',(await run('voice status QVSource')).includes('VOICE_CLIENT_NOT_INSTALLED'));
  bots[0]._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:voice')});
  bots[0]._client.write('custom_payload',{channel:'mcagent:voice',data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify({op:'status',requestId:randomUUID()}))])});await sleep(300);
  check('legacy valid voice request also establishes presence without a new handshake',near.state.players.get('QVSource')?.disconnected===false);
  bots[0]._client.write('custom_payload',{channel:'minecraft:unregister',data:Buffer.from('mcagent:voice')});await sleep(300);
  check('legacy bridge unregister clears confirmed adapter state',near.state.players.get('QVSource')?.disconnected===true);
  voice=attachProximityVoice(bots[0],{timeoutMs:15000});await sleep(400);
  check('reattaching the same body reports connected without replaying audio',near.state.players.get('QVSource')?.disconnected===false&&near.state.audio===before);
  report.finalBridgeState=near.state.players.get('QVSource');
  report.passed=report.failures.length===0;
 }
 }
}catch(e){report.passed=false;report.error=e.stack;}
finally{voice?.close();for(const r of udp)r.close();for(const b of bots)b.quit('isolated voice verification finished');writeFileSync(root+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(!report.passed)process.exitCode=1;
