// Passive diagnostic seam for an EXISTING authenticated connection. Never creates a bot,
// registers a channel, sends a packet, retries a request, plays audio or calls a model.
import {createHash} from 'node:crypto';
const channel='mcagent:voice',uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function traceVoiceConnection(bot,{runId,connectionId,onRecord,maxEvents=256}={}){
 if(!runId||!connectionId||typeof onRecord!=='function')throw Error('ORIGINAL_HOST_RUN_AND_CONNECTION_IDS_REQUIRED');
 if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>512)throw Error('TRACE_LIMIT_1_TO_512');
 const client=bot._client,original=client.write;let count=0,closed=false;
 const emit=row=>{if(closed||count>=maxEvents)return;try{onRecord(Object.freeze({schema:1,at:Date.now(),ordinal:++count,runId,connectionId,actor:client.uuid??null,protocolState:client.state,...row}));}catch{/* diagnostics must not change transport */}};
 const frame=(direction,p)=>{
  if(closed||count>=maxEvents)return;
  if(p?.channel!==channel||!Buffer.isBuffer(p.data))return;
  const b=p.data,row={event:'frame',direction,channel,frameBytes:b.length};
  if(b.length<=65536)row.frameSha256=createHash('sha256').update(b).digest('hex');
  try{
   if(b[0]===2&&b.length>=17){const h=b.subarray(1,17).toString('hex');row.requestId=[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');row.op='chunk';if(b.length>=21){row.sequence=b.readInt32BE(17);row.chunkBytes=b.length-21;}}
   if(b[0]===1&&b.length<=16001){const c=JSON.parse(b.subarray(1));if(uuid.test(c.requestId??''))row.requestId=c.requestId;
    for(const key of ['op','state','reason'])if(typeof c[key]==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(c[key]))row[key]=c[key];
    if(c.op==='begin'&&Number.isSafeInteger(c.bytes))row.expectedBytes=c.bytes;
   }
  }catch{row.headerInvalid=true;}
  emit(row);
 };
 const wrapper=function(name,p,...rest){if(name==='custom_payload')frame('C2S-write',p);return Reflect.apply(original,this,[name,p,...rest]);};
 const receive=p=>frame('S2C-received',p),state=next=>emit({event:'state',state:next});
 const close=()=>{if(closed)return;emit({event:'detached'});closed=true;if(client.write===wrapper)client.write=original;client.off('custom_payload',receive);client.off('state',state);bot.off('end',close);};
 client.write=wrapper;client.on('custom_payload',receive);client.on('state',state);bot.once('end',close);emit({event:'attached'});
 return{close};
}
