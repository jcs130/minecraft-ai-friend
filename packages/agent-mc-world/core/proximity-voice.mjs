// Canonical dependency-free mcagent:voice client; never creates a connection or model.
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const CHANNEL='mcagent:voice',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminal=new Set(['sent','failed','cancelled','unknown','not_found']);
const states=new Set([...terminal,'uploading','queued','playing','subscribed']),attached=new WeakMap();
export function inspectVoiceWav(wav){
  if(!Buffer.isBuffer(wav)||wav.length<44||wav.length>4*1024*1024||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('VOICE_PCM16_WAV_REQUIRED');
  let fmt,bytes,offset;
  for(let at=12;at+8<=wav.length;){const size=wav.readUInt32LE(at+4),kind=wav.toString('ascii',at,at+4);
    if(kind==='data'){offset=at+8;bytes=size;break;}
    if(at+8+size>wav.length)throw Error('VOICE_WAV_TRUNCATED');
    if(kind==='fmt '){if(size<16)throw Error('VOICE_PCM16_WAV_REQUIRED');fmt={format:wav.readUInt16LE(at+8),channels:wav.readUInt16LE(at+10),sampleRate:wav.readUInt32LE(at+12),bits:wav.readUInt16LE(at+22)};}
    at+=8+size+(size%2);
  }
  if(!fmt||fmt.format!==1||fmt.bits!==16||![1,2].includes(fmt.channels)||fmt.sampleRate<8000||fmt.sampleRate>96000||!offset||!bytes||offset+bytes>wav.length||bytes%(fmt.channels*2))throw Error('VOICE_PCM16_WAV_REQUIRED');
  const durationMs=bytes/(fmt.channels*2*fmt.sampleRate)*1000;if(durationMs<100||durationMs>30000)throw Error('VOICE_DURATION_0_1_TO_30_SECONDS');
  return{...fmt,durationMs,bytes:wav.length,samples:bytes/(fmt.channels*2)};
}
export function attachProximityVoice(bot,{onHearing,onResult,isAuthenticated,seenUtterances=new Set(),timeoutMs=110000}={}){
  const ready=()=>bot?._client?.state==='play'&&(!isAuthenticated||isAuthenticated());
  if(!ready())throw Error('VOICE_AUTHENTICATED_PLAY_REQUIRED');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw Error('VOICE_TIMEOUT_INVALID');
  attached.get(bot)?.close();
  const pending=new Map(),lastResults=new Map();let closed=false,uploading=false;
  const send=row=>{if(closed||!ready())throw Error('VOICE_NOT_CONNECTED');bot._client.write('custom_payload',{channel:CHANNEL,data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify(row))])});};
  const register=()=>{if(closed||!ready())return;bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from(CHANNEL)});if(onHearing)send({op:'subscribe',requestId:randomUUID(),captions:'events'});};
  const payload=packet=>{
    if(closed||!ready()||packet.channel!==CHANNEL||!Buffer.isBuffer(packet.data)||packet.data[0]!==1||packet.data.length>16001)return;
    let row;try{row=JSON.parse(packet.data.subarray(1).toString('utf8'));}catch{return;}
    if(!row||typeof row!=='object'||Array.isArray(row))return;
    if(row.type==='nearby_voice'){
      if(typeof row.text!=='string'||!row.text.trim()||row.text.length>4000||!UUID.test(row.utteranceId??'')||!UUID.test(row.speakerUuid??'')||typeof row.speaker!=='string'||row.speaker.length>64)return;
      const key=row.speakerUuid.toLowerCase()+':'+row.utteranceId.toLowerCase();if(seenUtterances.has(key))return;
      seenUtterances.add(key);while(seenUtterances.size>512)seenUtterances.delete(seenUtterances.values().next().value);
      onHearing?.({type:'nearby_voice',speaker:row.speaker,speakerUuid:row.speakerUuid,utteranceId:row.utteranceId,text:row.text});return;
    }
    if(row.type!=='voice_result'||!UUID.test(row.requestId??'')||!states.has(row.state))return;
    row={type:'voice_result',requestId:row.requestId,state:row.state,reason:typeof row.reason==='string'?row.reason.slice(0,240):''};
    lastResults.set(row.requestId,row);while(lastResults.size>128)lastResults.delete(lastResults.keys().next().value);
    onResult?.(row);const wait=pending.get(row.requestId);if(!wait)return;
    wait.last=row;if(wait.until(row)){clearTimeout(wait.timer);pending.delete(row.requestId);wait.resolve(row);}
  };
  const exchange=(row,until=result=>terminal.has(result.state),signal)=>{
    if(!UUID.test(row.requestId??''))throw Error('VOICE_REQUEST_UUID_REQUIRED');if(pending.has(row.requestId))throw Error('VOICE_REQUEST_ALREADY_PENDING');
    return new Promise((resolve,reject)=>{
      const finish=value=>{clearTimeout(wait.timer);signal?.removeEventListener('abort',abort);pending.delete(row.requestId);resolve(value);};
      const abort=()=>finish({requestId:row.requestId,state:'unknown',reason:'VOICE_CANCELLED_QUERY_SAME_REQUEST_DO_NOT_REPLAY'});
      const wait={resolve:finish,until,last:null,timer:setTimeout(()=>finish({type:'voice_result',requestId:row.requestId,state:'unknown',reason:'VOICE_TIMEOUT_QUERY_SAME_REQUEST_DO_NOT_REPLAY',lastState:wait.last?.state??null}),timeoutMs)};
      if(signal?.aborted){abort();return;}
      signal?.addEventListener('abort',abort,{once:true});pending.set(row.requestId,wait);
      try{send(row);}catch(error){clearTimeout(wait.timer);signal?.removeEventListener('abort',abort);pending.delete(row.requestId);reject(error);}});
  };
  const close=()=>{if(closed)return;if(onHearing&&ready())try{send({op:'subscribe',requestId:randomUUID(),captions:'chat'});}catch{}
    closed=true;bot._client.off('custom_payload',payload);bot.off('spawn',register);bot.off('end',close);
    for(const [requestId,wait]of pending){clearTimeout(wait.timer);wait.resolve({requestId,state:'unknown',reason:'VOICE_CONNECTION_ENDED_DO_NOT_REPLAY'});}pending.clear();if(attached.get(bot)?.close===close)attached.delete(bot);
  };
  const voice={
    say(text,{requestId=randomUUID(),voice}={}){if(typeof text!=='string'||!text.trim()||text.length>200)throw Error('VOICE_TEXT_MAX_200');return exchange({op:'say',requestId,text,...(voice?{voice}:{})});},
    status(requestId){return exchange({op:'status',requestId},()=>true);},
    async upload(wav,{requestId=randomUUID(),signal}={}){
      if(uploading)throw Error('VOICE_UPLOAD_ALREADY_PENDING');inspectVoiceWav(wav);uploading=true;
      try{const result=await exchange({op:'begin',requestId,format:'wav',bytes:wav.length,sha256:createHash('sha256').update(wav).digest('hex')},row=>row.state==='uploading'||row.state==='queued'||row.state==='playing'||terminal.has(row.state),signal);
        if(result.state!=='uploading')return result;const raw=Buffer.from(requestId.replaceAll('-',''),'hex');
        for(let at=0,sequence=0;at<wav.length;at+=16384,sequence++){
          if(closed||!ready()||signal?.aborted)return{requestId,state:'unknown',reason:'VOICE_UPLOAD_CONNECTION_CHANGED_OR_CANCELLED_DO_NOT_REPLAY'};
          const last=lastResults.get(requestId);if(last&&terminal.has(last.state))return last;
          const header=Buffer.alloc(21);header[0]=2;raw.copy(header,1);header.writeInt32BE(sequence,17);bot._client.write('custom_payload',{channel:CHANNEL,data:Buffer.concat([header,wav.subarray(at,at+16384)])});await sleep(10);
        }return exchange({op:'finish',requestId},undefined,signal);
      }finally{uploading=false;}
    },close,
  };
  bot._client.on('custom_payload',payload);bot.on('spawn',register);bot.once('end',close);attached.set(bot,voice);register();return voice;
}
