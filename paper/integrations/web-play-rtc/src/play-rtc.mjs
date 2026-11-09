import { randomUUID, createHash } from 'node:crypto';

export const PLAY_RTC = Object.freeze({schemaVersion:1, protocol:'qiandengji.play.v1',
  reliable:'qd.play.control', input:'qd.play.input', world:'qd.play.world',
  maxBytes:16384, maxReceipts:512, receiptTtlMs:300000, inputTtlMs:350,
  maxPending:8, maxBufferedBytes:262144});
const idPattern=/^[a-zA-Z0-9_-]{8,100}$/;
const allowed=new Set(['acquire','release','stop','heartbeat','primary','secondary','hotbar','navigate','inventory']);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Owned by the existing game body, not the browser transport. Query after a
 * broken connection never re-executes an action. Entries are bounded and expire
 * explicitly; missing/expired means unknown, never permission to retry. */
export class PlayReceiptBook {
  constructor({now=Date.now}={}){this.rows=new Map();this.now=now;}
  prune(){for(const [k,v]of this.rows)if(this.now()-v.at>PLAY_RTC.receiptTtlMs&&!v.pending)this.rows.delete(k);}
  reserve(client,id,packet){
    this.prune();const key=client+':'+id,hash=digest(packet),old=this.rows.get(key);
    if(old)return {existing:true,row:old,conflict:old.hash!==hash};
    if(this.rows.size>=PLAY_RTC.maxReceipts)return {full:true};
    const row={hash,at:this.now(),pending:true,result:{requestId:id,status:'accepted',completed:false}};
    this.rows.set(key,row);return {row};
  }
  get(client,id){this.prune();return this.rows.get(client+':'+id)?.result??{requestId:id,status:'unknown',reason:'RECEIPT_UNAVAILABLE',retryable:false};}
}

/** One authenticated peer for one existing body. Call authorize continuously;
 * an SDP or a channel label is never identity/ownership authority. */
export function createPlayRtcSession({peer,clientId,authorize,execute,stop,openWorld,receipts=new PlayReceiptBook(),
  now=Date.now,rate=()=>{},onClose=()=>{},setInterval:interval=globalThis.setInterval,clearInterval:clear=globalThis.clearInterval}={}){
  if(!idPattern.test(clientId)||![authorize,execute,stop].every(v=>typeof v==='function'))throw Error('PLAY_RTC_OPTIONS');
  const channels=new Map(),tokens=new Map();let closed=false,sequence=0,inputSequence=-1,reliableSequence=-1,generation=0,pending=0;
  let epoch=null,createdAt=now(),lastSeen=now(),worldAbort=null,opened=false;const timers=[];
  const authorized=()=>{try{return authorize()===true}catch{return false}};
  function close(reason='TRANSPORT_CLOSED'){
    if(closed)return;closed=true;worldAbort?.abort();for(const t of timers)clear(t);
    try{stop(reason)}catch{};for(const c of channels.values())try{c.close()}catch{}
    void Promise.resolve(peer?.close()).catch(()=>{});onClose(reason);
  }
  async function world(subscribe){
    worldAbort?.abort();worldAbort=null;
    if(!subscribe||!openWorld)return;
    const c=channels.get(PLAY_RTC.world);if(c?.readyState!=='open')return;
    const abort=new AbortController();worldAbort=abort;
    try{
      const stream=await openWorld(abort.signal);
      for await(const data of stream){
        for(let i=0;i<data.byteLength;i+=16384){
          const began=now();
          while(c.bufferedAmount>65536&&!abort.signal.aborted){
            if(now()-began>2000)throw Error('WORLD_BACKPRESSURE');
            await new Promise(r=>setTimeout(r,10));
          }
          if(closed||abort.signal.aborted)return;
          if(!authorized())throw Error('AUTH_REVOKED');
          c.send(Buffer.from(data.subarray(i,i+16384)));
        }
      }
      if(!abort.signal.aborted)close('WORLD_SOURCE_CLOSED');
    }catch{if(!abort.signal.aborted)close('WORLD_STREAM_FAILED')}
  }
  function send(value){
    const c=channels.get(PLAY_RTC.reliable);if(closed||c?.readyState!=='open')return;
    let data=JSON.stringify({schemaVersion:1,...value});
    if(value.kind==='receipt'&&Buffer.byteLength(data)>PLAY_RTC.maxBytes){
      const summary=Object.fromEntries(['kind','requestId','ok','status','reason','active','epoch','completed','execution','retryable']
        .filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
      data=JSON.stringify({schemaVersion:1,...summary,detailsIncluded:false,nextSafeRead:'query_receipt'});
    }
    if(Buffer.byteLength(data)>PLAY_RTC.maxBytes||c.bufferedAmount>PLAY_RTC.maxBufferedBytes){close('CONTROL_BACKPRESSURE');return}
    try{c.send(data)}catch{close('CONTROL_SEND_FAILED')}
  }
  function challenge(){
    if(!authorized()){close('AUTH_REVOKED');return}
    if(now()-lastSeen>5000){close('CLIENT_EXPIRED');return}
    for(const [k,t]of tokens)if(t<now())tokens.delete(k);
    const token=randomUUID();tokens.set(token,now()+PLAY_RTC.inputTtlMs);
    send({kind:'clock',token,expiresInMs:PLAY_RTC.inputTtlMs,serverAt:now()});
  }
  function outcome(row,result,final=false){
    if(row.final)return;
    row.pending=!final&&result?.status==='sent';row.final=final||!row.pending;row.at=now();
    row.result={...result,requestId:row.result.requestId,completed:result?.completed===true,
      execution:final?'terminal':result?.status==='sent'?'accepted':'returned'};
    if(result?.active&&result.epoch)epoch=result.epoch;
    else if(result?.active===false)epoch=null;
    send({kind:'receipt',...row.result});
  }
  async function receive(label,raw){
    if(closed)return;if(!authorized()){close('AUTH_REVOKED');return}
    const bytes=typeof raw==='string'?Buffer.from(raw):Buffer.from(raw??[]);
    if(bytes.length>PLAY_RTC.maxBytes){close('MESSAGE_LIMIT');return}
    let m;try{m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{close('INVALID_JSON');return}
    if(m?.schemaVersion!==1||typeof m!=='object'){close('INVALID_SCHEMA');return}
    try{rate();}catch{close('RATE_LIMITED');return}lastSeen=now();
    if(label===PLAY_RTC.input){
      if(m.kind!=='motion'||!Number.isSafeInteger(m.sequence)||m.sequence<=inputSequence||m.generation!==generation
        ||typeof m.token!=='string'||!(tokens.get(m.token)>=now())||!epoch||m.epoch!==epoch)return;
      inputSequence=m.sequence;
      // The host assigns its existing bridge's single arrival-order sequence;
      // unordered input must never invalidate a reliable inventory operation.
      try{await execute({schemaVersion:1,type:'motion',input:m.input,epoch,sequence:++sequence},clientId)}catch{close('INPUT_FAILED')}
      return;
    }
    if(label!==PLAY_RTC.reliable){close('CHANNEL_DENIED');return}
    if(m.kind==='world'&&typeof m.subscribe==='boolean'){void world(m.subscribe);return}
    if(m.kind==='ping'){send({kind:'pong',at:m.at,serverAt:now()});return}
    if(m.kind==='query'&&idPattern.test(m.requestId??'')){send({kind:'receipt',...receipts.get(clientId,m.requestId)});return}
    if(m.kind!=='action'||!idPattern.test(m.requestId??'')||!allowed.has(m.packet?.type)
      ||!Number.isSafeInteger(m.sequence)||!Number.isSafeInteger(m.generation)){
      send({kind:'receipt',requestId:m.requestId,status:'rejected',reason:'INVALID_ACTION',retryable:false});return;
    }
    const saved=receipts.reserve(clientId,m.requestId,{generation:m.generation,packet:m.packet});
    if(saved.existing){send({kind:'receipt',...(saved.conflict?{requestId:m.requestId,status:'rejected',reason:'REQUEST_ID_CONFLICT',retryable:false}:saved.row.result)});return}
    if(saved.full){send({kind:'receipt',requestId:m.requestId,status:'rejected',reason:'RECEIPT_CAPACITY',retryable:false});return}
    const row=saved.row;
    if(m.sequence<=reliableSequence||m.generation!==generation+1){outcome(row,{status:'rejected',reason:'STALE_CONTROL',retryable:false});return}
    reliableSequence=m.sequence;generation=m.generation;
    if(pending>=PLAY_RTC.maxPending&&!['stop','release'].includes(m.packet.type)){
      outcome(row,{status:'rejected',reason:'CONTROL_BUSY',retryable:false});return;
    }
    pending++;
    try{
      const result=await execute({...m.packet,schemaVersion:1,sequence:++sequence,requestId:m.requestId},clientId,
        terminal=>outcome(row,terminal,true));
      outcome(row,result);
    }catch(e){outcome(row,{ok:false,status:'unknown',reason:e?.reason??'EXECUTION_UNKNOWN',retryable:false});}
    finally{pending--;}
  }
  function attach(channel){
    const label=channel.label;
    const correct=channel.protocol===PLAY_RTC.protocol&&[PLAY_RTC.reliable,PLAY_RTC.input,PLAY_RTC.world].includes(label)
      &&(label===PLAY_RTC.input?channel.ordered===false&&channel.maxRetransmits===0:
        channel.ordered===true&&channel.maxRetransmits==null&&channel.maxPacketLifeTime==null);
    if(closed||!correct||channels.has(label)){close('CHANNEL_POLICY');return}
    channels.set(label,channel);
    channel.onmessage=e=>{void receive(label,e.data)};
    channel.onclose=()=>close('CHANNEL_CLOSED');channel.onerror=()=>close('CHANNEL_ERROR');
    if(label===PLAY_RTC.reliable){const open=()=>{if(!opened){opened=true;lastSeen=now()}challenge()};channel.onopen=open;if(channel.readyState==='open')open();}
  }
  timers.push(interval(()=>{
    if(closed)return;if(!authorized()){close('AUTH_REVOKED');return}
    if(opened&&channels.get(PLAY_RTC.reliable)?.readyState==='open')challenge();
    else if(now()-createdAt>10000)close('HANDSHAKE_TIMEOUT');
  },100));
  timers.forEach(t=>t?.unref?.());
  return {attach,receive,close,receipts,status:()=>({closed,epoch,generation,pending,readOnly:false})};
}
