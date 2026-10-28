// Add to an existing authenticated Mineflayer connection; this creates no bot or model loop.
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

const CHANNEL='mcagent:voice', UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function attachProximityVoice(bot,{onHearing,timeoutMs=110_000}={}){
  const pending=new Map();let closed=false,uploading=false;
  const send=row=>{if(closed||bot._client.state!=='play')throw Error('VOICE_NOT_CONNECTED');bot._client.write('custom_payload',{channel:CHANNEL,data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify(row))])});};
  const register=()=>{bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from(CHANNEL)});if(onHearing)send({op:'subscribe',requestId:randomUUID(),captions:'events'});};
  const payload=packet=>{
    if(packet.channel!==CHANNEL||packet.data?.[0]!==1||packet.data.length>16_001)return;
    let row;try{row=JSON.parse(packet.data.subarray(1).toString('utf8'));}catch{return;}
    if(row.type==='nearby_voice'){if(typeof row.text==='string'&&UUID.test(row.utteranceId??''))onHearing?.(row);return;}
    if(row.type!=='voice_result')return;const wait=pending.get(row.requestId);if(!wait)return;
    wait.last=row;if(wait.until(row)){clearTimeout(wait.timer);pending.delete(row.requestId);wait.resolve(row);}
  };
  const terminal=new Set(['sent','failed','cancelled','unknown','not_found']);
  const exchange=(row,until=result=>terminal.has(result.state))=>{
    if(!UUID.test(row.requestId??''))throw Error('VOICE_REQUEST_UUID_REQUIRED');
    if(pending.has(row.requestId))throw Error('VOICE_REQUEST_ALREADY_PENDING');
    return new Promise((resolve,reject)=>{
      const wait={resolve,until,last:null,timer:setTimeout(()=>{pending.delete(row.requestId);resolve({type:'voice_result',requestId:row.requestId,state:'unknown',reason:'VOICE_TIMEOUT_QUERY_SAME_REQUEST_DO_NOT_REPLAY',lastState:wait.last?.state??null});},timeoutMs)};
      pending.set(row.requestId,wait);try{send(row);}catch(error){clearTimeout(wait.timer);pending.delete(row.requestId);reject(error);}
    });
  };
  const close=()=>{if(closed)return;closed=true;bot._client.off('custom_payload',payload);bot.off('spawn',register);bot.off('end',close);for(const [requestId,wait]of pending){clearTimeout(wait.timer);wait.resolve({requestId,state:'unknown',reason:'VOICE_CONNECTION_ENDED_DO_NOT_REPLAY'});}pending.clear();};
  bot._client.on('custom_payload',payload);bot.on('spawn',register);bot.once('end',close);if(bot._client.state==='play')register();
  return {
    say(text,{requestId=randomUUID(),voice}={}){if(typeof text!=='string'||!text.trim()||text.length>200)throw Error('VOICE_TEXT_MAX_200');return exchange({op:'say',requestId,text,...(voice?{voice}:{})});},
    status(requestId){return exchange({op:'status',requestId},()=>true);},
    async upload(wav,{requestId=randomUUID()}={}){
      if(uploading)throw Error('VOICE_UPLOAD_ALREADY_PENDING');
      if(!Buffer.isBuffer(wav)||wav.length<44||wav.length>4*1024*1024||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('VOICE_PCM16_WAV_REQUIRED');
      uploading=true;try{
        const result=await exchange({op:'begin',requestId,format:'wav',bytes:wav.length,sha256:createHash('sha256').update(wav).digest('hex')},row=>row.state==='uploading'||terminal.has(row.state));
        if(result.state!=='uploading')return result;
        const raw=Buffer.from(requestId.replaceAll('-',''),'hex');
        for(let at=0,sequence=0;at<wav.length;at+=16384,sequence++){
          if(closed)throw Error('VOICE_NOT_CONNECTED');const header=Buffer.alloc(21);header[0]=2;raw.copy(header,1);header.writeInt32BE(sequence,17);
          bot._client.write('custom_payload',{channel:CHANNEL,data:Buffer.concat([header,wav.subarray(at,at+16384)])});await sleep(10);
        }
        return exchange({op:'finish',requestId});
      }finally{uploading=false;}
    },
    close,
  };
}
