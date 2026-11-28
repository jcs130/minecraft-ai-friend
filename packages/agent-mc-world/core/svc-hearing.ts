import { randomUUID } from 'node:crypto';
import type { SimpleVoiceChatOptions, SimpleVoiceChatOpus } from '../src/simple-voice-chat.ts';

type Frame = Parameters<NonNullable<SimpleVoiceChatOptions['onAudio']>>[0];
export interface VoiceSpeaker { name: string; uuid: string }
export interface VoiceTranscript {
  speaker: VoiceSpeaker; text: string; utteranceId: string; observedAt: string;
}
type Segment = { speaker: VoiceSpeaker; observedAt: string; frames: Map<bigint,Buffer>; last: number };
export interface SvcHearingOptions {
  speaker: (uuid: string) => VoiceSpeaker | undefined;
  decoder: () => SimpleVoiceChatOpus & {close?():void};
  transcribe: (wav:Buffer, signal:AbortSignal) => Promise<string>;
  deliver: (row:VoiceTranscript) => void;
  current: () => boolean;
}

// whisper.cpp accepts mono 16 kHz PCM16 WAV. The game packets are 48 kHz mono.
function speechWav(samples:Int16Array[],count:number) {
  const data=Buffer.alloc(44+Math.floor(count/3)*2);
  data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
  data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);
  data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);
  data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);
  let n=0,sum=0,offset=44;
  for(const chunk of samples) for(const sample of chunk) {
    sum+=sample;
    if(++n===3){data.writeInt16LE(Math.round(sum/3),offset);offset+=2;n=0;sum=0;}
  }
  return data;
}
export async function transcribeSvcWav(endpoint:string,wav:Buffer,signal:AbortSignal):Promise<string> {
  const form=new FormData();
  form.set('file',new Blob([new Uint8Array(wav)],{type:'audio/wav'}),randomUUID()+'.wav');
  form.set('response_format','json');
  const res=await fetch(endpoint,{method:'POST',body:form,signal,redirect:'error'});
  if(!res.ok){await res.body?.cancel();throw Error('ASR_HTTP_'+res.status);}
  const json=await res.json() as {text?:string};
  if(typeof json.text!=='string')throw Error('ASR_INVALID_RESPONSE');
  return json.text.trim().slice(0,2000);
}

/** Collect UDP frames without ever waiting for decoding, ASR or the body queue on the game tick. */
export class SvcHearing {
  private streams=new Map<string,Segment>();
  private completed=new Map<string,{seq:bigint;at:number}>();
  private queue:Segment[]=[];
  private stop=new AbortController();
  private active=false;
  private timer=setInterval(()=>this.flushSilent(),150);
  private counters={segments:0,transcripts:0,dropped:0,errors:0,lastError:null as string|null};
  constructor(private options:SvcHearingOptions){this.timer.unref();}
  status(){return {...this.counters,buffered:this.streams.size,queued:this.queue.length,processing:this.active};}
  receive(frame:Frame) {
    if(this.stop.signal.aborted || !this.options.current() || frame.kind!=='nearby')return;
    const key=frame.speakerUuid+'/'+frame.channelUuid;
    const seq=BigInt(frame.sequence),now=Date.now();
    const completed=this.completed.get(key);
    if(completed && seq<=completed.seq)return;
    let segment=this.streams.get(key);
    if(frame.ended){if(segment)this.flush(key,segment,seq);return;}
    if(!segment) {
      const speaker=this.options.speaker(frame.speakerUuid);
      if(!speaker || this.streams.size>=4){this.counters.dropped++;return;}
      segment={speaker,observedAt:new Date(now).toISOString(),frames:new Map(),last:now};
      this.streams.set(key,segment);
    }
    if(segment.frames.has(seq))return;
    segment.frames.set(seq,frame.opus);segment.last=now;
    if(segment.frames.size>=500)this.flush(key,segment);
  }
  private flushSilent(){
    const now=Date.now();
    for(const [key,s] of this.streams)if(now-s.last>=550)this.flush(key,s);
    for(const [key,r] of this.completed)if(now-r.at>30000)this.completed.delete(key);
  }
  private flush(key:string,s:Segment,end?:bigint){
    this.streams.delete(key);
    const seq=[...s.frames.keys()].reduce((a,b)=>a>b?a:b,end??-1n);
    this.completed.set(key,{seq,at:Date.now()});
    if(s.frames.size<8)return;
    if(this.queue.length>=4){this.counters.dropped++;return;}
    this.counters.segments++;this.queue.push(s);void this.pump();
  }
  private async pump(){
    if(this.active||this.stop.signal.aborted)return;
    this.active=true;
    try {
      while(this.queue.length && !this.stop.signal.aborted){
        const s=this.queue.shift()!;
        let decoder:ReturnType<SvcHearingOptions['decoder']>|undefined;
        const signal=AbortSignal.any([this.stop.signal,AbortSignal.timeout(25000)]);
        const close=()=>decoder?.close?.();
        try{
          decoder=this.options.decoder();
          signal.addEventListener('abort',close,{once:true});
          if(!decoder.decode)throw Error('ASR_DECODER_UNAVAILABLE');
          const chunks:Int16Array[]=[];let count=0,voiced=0;
          for(const [,packet] of [...s.frames].sort(([a],[b])=>a<b?-1:1)){
            signal.throwIfAborted();
            const pcm=await decoder.decode(packet);
            if(!pcm.length||pcm.length>5760||count+pcm.length>48000*12)throw Error('ASR_FRAME_LIMIT');
            let squares=0;for(const sample of pcm)squares+=sample*sample;
            if(squares/pcm.length>=160*160)voiced+=pcm.length;
            count+=pcm.length;chunks.push(pcm);
          }
          if(voiced<48000*0.16)continue;
          const text=(await this.options.transcribe(speechWav(chunks,count),signal)).trim();
          if(text && !signal.aborted && this.options.current()){
            this.options.deliver({speaker:s.speaker,observedAt:s.observedAt,text,utteranceId:randomUUID()});this.counters.transcripts++;
          }
        }catch(error){
          if(!this.stop.signal.aborted){this.counters.errors++;this.counters.lastError=error instanceof Error && /^ASR_[A-Z0-9_]+$/.test(error.message)?error.message:'ASR_PROCESSING_FAILED';}
        }finally{signal.removeEventListener('abort',close);close();}
      }
    }finally{this.active=false;}
  }
  close(){clearInterval(this.timer);this.stop.abort();this.streams.clear();this.queue=[];this.completed.clear();}
}
