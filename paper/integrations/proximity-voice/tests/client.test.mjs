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
