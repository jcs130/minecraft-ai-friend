import { createHash, randomUUID } from 'node:crypto';
import { inspectVoiceWav } from './proximity-voice.mjs';
import type { ChatDeliveryReceipt } from '../src/contracts/chat-delivery.ts';

interface Connection {
  current(): boolean;
  send(bytes:Buffer, requestId:string, signal:AbortSignal):Promise<{state:string;frames?:number;reason?:string}>;
}
interface Receipt {
  chatId:string; requestId:string; state:string; recipientHeard:'unknown'; frames?:number;
  sha256?:string; reason?:string; at:string;
}

/** A confirmed public text send owns one artifact, independent of audience playback and the body. */
export class SvcPublicSpeech {
  private tail:Promise<void> = Promise.resolve();
  private lifetime = new AbortController();
  private recent = new Map<string,Receipt>();
  private pending = 0;

  constructor(private readonly publish:(receipt:Readonly<Receipt>)=>void = ()=>{}) {}
  status() { return [...this.recent.values()].slice(-8).map(row=>({...row})); }
  disconnect() {
    this.lifetime.abort();
    this.lifetime = new AbortController();
  }
  enqueue(chat:ChatDeliveryReceipt, producer:string|undefined, connection:Connection|null) {
    if (!producer || chat.channel!=='public' || chat.to || chat.voiceRequestId || chat.status!=='sent' ||
        !chat.text.trim() || /^\s*\//u.test(chat.text)) return;
    const previous = this.recent.get(chat.id);
    if(previous) return previous.requestId;
    const requestId=randomUUID();
    const receipt:Receipt={chatId:chat.id,requestId,state:'queued',recipientHeard:'unknown',at:chat.sentAt};
    this.recent.set(chat.id,receipt);
    while(this.recent.size>128)this.recent.delete(this.recent.keys().next().value!);
    const record=(state:string,reason?:string)=>{
      receipt.state=state;
      if(reason)receipt.reason=reason;
      this.publish({...receipt});
    };
    if (!connection || !connection.current()) { record('failed','SVC_NOT_READY'); return requestId; }
    if(this.pending>=8){record('failed','SVC_PUBLIC_QUEUE_FULL');return requestId;}
    this.pending++;
    const signal=AbortSignal.any([this.lifetime.signal,AbortSignal.timeout(60_000)]);
    const current=()=>{signal.throwIfAborted();if(!connection.current())throw Error('SVC_CONNECTION_CHANGED');};
    this.tail=this.tail.then(async()=>{
      try {
        current();
        const url=new URL(producer);
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('SVC_ARTIFACT_URL_INVALID');
        url.pathname=url.pathname.replace(/\/$/,'')+'/api/voice-artifacts';
        record('synthesizing');
        const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},redirect:'error',
          body:JSON.stringify({requestId,text:chat.text}),signal});
        const reader=response.body?.getReader();
        if(!reader)throw Error('SVC_ARTIFACT_EMPTY');
        const chunks:Uint8Array[]=[];
        try {
          if(!response.ok)throw Error('SVC_ARTIFACT_HTTP_'+response.status);
          if(response.headers.get('x-voice-artifact-id')!==requestId)throw Error('SVC_ARTIFACT_ID_MISMATCH');
          if(response.headers.get('x-voice-generation-complete')==='false')throw Error('SVC_ARTIFACT_INCOMPLETE');
          let size=0;
          for(;;){const {value,done}=await reader.read();if(done)break;
            size+=value.length;if(size>4*1024*1024)throw Error('SVC_ARTIFACT_TOO_LARGE');chunks.push(value);}
        } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
        const wav=Buffer.concat(chunks);
        inspectVoiceWav(wav);
        receipt.sha256=createHash('sha256').update(wav).digest('hex');
        const advertised=response.headers.get('x-voice-audio-sha256');
        if(advertised && advertised!==receipt.sha256)throw Error('SVC_ARTIFACT_HASH_MISMATCH');
        current();record('uploading');
        const result=await connection.send(wav,requestId,signal);
        receipt.frames=result.frames;
        record(result.state,result.reason);
      } catch(error){record(signal.aborted?'cancelled':'failed',String(error).slice(0,180));}
      finally {this.pending--;}
    });
    return requestId;
  }
}
