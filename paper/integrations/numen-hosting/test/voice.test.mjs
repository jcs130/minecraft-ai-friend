import test from 'node:test';
import assert from 'node:assert/strict';
import {localConversationVoice} from '../src/voice.mjs';
import {pcmWav} from '../../agent-portal/public/hosting-recorder.mjs';
const wav=Buffer.from(pcmWav([new Float32Array(4000).fill(.1)],16000));
test('voice uses the existing loopback ASR format, scoped request IDs and does not send transcript automatically',async()=>{
  let call;const voice=localConversationVoice({endpoint:'http://127.0.0.1:19099/',token:'x'.repeat(32),voiceFor:()=> 'test_voice',fetcher:async(url,options)=>{
    call={url,options};return new Response(JSON.stringify({state:'transcribed',text:'你好'}));
  }});
  const result=await voice.transcribe({actor:'viewer-scope',id:'audio-00001',audio:wav.toString('base64')});
  assert.equal(result.requiresConfirmation,true);assert.equal(result.text,'你好');assert.equal(call.url.pathname,'/v1/asr');assert.equal(call.options.redirect,'error');
  assert.match(call.options.headers['x-actor'],/^[a-f0-9-]{36}$/);assert.deepEqual(call.options.body,wav);
});
test('voice refuses arbitrary endpoints and encoded non-WAV, hides backend errors and secrets',async()=>{
  assert.throws(()=>localConversationVoice({endpoint:'https://attacker.invalid/',token:'x'.repeat(32)}));
  const voice=localConversationVoice({endpoint:'http://127.0.0.1:19099/',token:'x'.repeat(32),fetcher:async()=>new Response('private-token',{status:500})});
  await assert.rejects(voice.transcribe({actor:'a',id:'audio-00001',audio:Buffer.from('not wav').toString('base64')}),{code:'VOICE_FORMAT'});
  await assert.rejects(voice.transcribe({actor:'a',id:'audio-00001',audio:wav.toString('base64')}),error=>error.code==='VOICE_BACKEND_UNAVAILABLE'&&!String(error).includes('private-token'));
});
