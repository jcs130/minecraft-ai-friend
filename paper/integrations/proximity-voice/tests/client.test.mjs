import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {randomUUID} from 'node:crypto';
import {attachProximityVoice} from '../client.mjs';
function fake(){const bot=new EventEmitter();bot._client=new EventEmitter();bot._client.state='play';bot._client.write=(_name,data)=>bot.emit('write',data);return bot;}
function receipt(bot,requestId,state){bot._client.emit('custom_payload',{channel:'mcagent:voice',data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify({type:'voice_result',requestId,state}))])});}
test('enqueue and playing are not completion; sent completes the original request',async()=>{
 const bot=fake(),voice=attachProximityVoice(bot,{timeoutMs:1000}),requestId=randomUUID();let done=false;
 const promise=voice.say('你好',{requestId,voice:'existing'}).then(row=>{done=true;return row;});
 receipt(bot,requestId,'queued');receipt(bot,requestId,'playing');await Promise.resolve();assert.equal(done,false);
 receipt(bot,requestId,'sent');assert.equal((await promise).state,'sent');voice.close();
});
test('timeout is unknown and sends once; disconnect releases waiters without replay',async()=>{
 const bot=fake(),voice=attachProximityVoice(bot,{timeoutMs:10});let sends=0;bot.on('write',row=>{if(row.channel==='mcagent:voice')sends++;});
 assert.equal((await voice.say('你好')).state,'unknown');assert.equal(sends,1);
 const waiting=voice.say('再见');bot.emit('end');assert.equal((await waiting).state,'unknown');assert.equal(sends,2);
});
test('caption events require an explicit handler; malformed data is ignored',()=>{
 const bot=fake();let heard;const voice=attachProximityVoice(bot,{onHearing:row=>heard=row});
 for(const value of ['not-json',JSON.stringify({type:'nearby_voice',utteranceId:randomUUID(),text:'去公会'})])bot._client.emit('custom_payload',{channel:'mcagent:voice',data:Buffer.concat([Buffer.from([1]),Buffer.from(value)])});
 assert.equal(heard.text,'去公会');voice.close();
});
test('invalid audio never uploads; actor identity cannot be supplied',async()=>{
 const bot=fake(),voice=attachProximityVoice(bot);await assert.rejects(voice.upload(Buffer.from('mp3')),/PCM16_WAV/);assert.throws(()=>voice.say('x'.repeat(201)),/MAX_200/);voice.close();
});

test('external audio uploads through the same body without requesting server TTS',async()=>{
 const bot=fake(),voice=attachProximityVoice(bot,{timeoutMs:1000}),requestId=randomUUID(),ops=[],chunks=[];
 bot.on('write',packet=>{
  if(packet.channel!=='mcagent:voice')return;
  if(packet.data[0]===2){chunks.push(packet.data.subarray(21));return;}
  const row=JSON.parse(packet.data.subarray(1).toString());ops.push(row.op);
  if(row.op==='begin')receipt(bot,requestId,'uploading');
  if(row.op==='finish'){receipt(bot,requestId,'queued');receipt(bot,requestId,'playing');receipt(bot,requestId,'sent');}
 });
 const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
 const result=await voice.upload(wav,{requestId});assert.equal(result.state,'sent');assert.deepEqual(ops,['begin','finish']);assert.deepEqual(Buffer.concat(chunks),wav);voice.close();
});

for(const state of ['sent','failed','cancelled','unknown'])test(`${state} settles only its original request and never retries`,async()=>{
 const bot=fake(),voice=attachProximityVoice(bot,{timeoutMs:1000}),requestId=randomUUID(),sent=[];
 bot.on('write',packet=>{if(packet.channel==='mcagent:voice')sent.push(JSON.parse(packet.data.subarray(1)));});
 let done=false;const result=voice.say('一起去公会',{requestId}).then(row=>{done=true;return row;});
 receipt(bot,randomUUID(),'sent');receipt(bot,requestId,'queued');receipt(bot,requestId,'playing');
 await Promise.resolve();assert.equal(done,false);
 receipt(bot,requestId,state);assert.deepEqual(await result,{type:'voice_result',requestId,state});
 receipt(bot,requestId,'playing');receipt(bot,requestId,'sent');await Promise.resolve();
 assert.deepEqual(sent.map(row=>[row.op,row.requestId]),[['say',requestId]]);voice.close();
});

test('lost receipt returns unknown with last state; explicit status reuses ID without replay',async()=>{
 const bot=fake(),voice=attachProximityVoice(bot,{timeoutMs:10}),requestId=randomUUID(),sent=[];
 bot.on('write',packet=>{if(packet.channel==='mcagent:voice')sent.push(JSON.parse(packet.data.subarray(1)));});
 const waiting=voice.say('等一下',{requestId});receipt(bot,requestId,'queued');receipt(bot,requestId,'playing');
 const unknown=await waiting;assert.equal(unknown.state,'unknown');assert.equal(unknown.lastState,'playing');
 assert.match(unknown.reason,/DO_NOT_REPLAY/);
 const query=voice.status(requestId);receipt(bot,requestId,'sent');assert.equal((await query).state,'sent');
 assert.deepEqual(sent.map(row=>[row.op,row.requestId]),[['say',requestId],['status',requestId]]);voice.close();
});

test('nearby voice and unrelated payloads cannot settle a pending speech request',async()=>{
 const bot=fake(),heard=[],voice=attachProximityVoice(bot,{timeoutMs:1000,onHearing:row=>heard.push(row)}),requestId=randomUUID();
 let done=false;const waiting=voice.say('你好',{requestId}).then(row=>{done=true;return row;});
 const message={type:'nearby_voice',requestId,utteranceId:randomUUID(),speaker:'其他玩家',text:'一起去公会'};
 bot._client.emit('custom_payload',{channel:'mcagent:voice',data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify(message))])});
 const terminal=Buffer.from(JSON.stringify({type:'voice_result',requestId,state:'sent'}));
 bot._client.emit('custom_payload',{channel:'other:voice',data:Buffer.concat([Buffer.from([1]),terminal])});
 bot._client.emit('custom_payload',{channel:'mcagent:voice',data:Buffer.concat([Buffer.from([2]),terminal])});
 await Promise.resolve();assert.equal(done,false);assert.deepEqual(heard,[message]);
 receipt(bot,requestId,'sent');assert.equal((await waiting).state,'sent');voice.close();
});
