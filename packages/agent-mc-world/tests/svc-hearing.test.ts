import {describe,it,expect,vi} from 'vitest';
import {SvcHearing,type VoiceTranscript} from '../src/simple-voice-chat.ts';
function fixture(recognize=(async()=> '一起去钓鱼')) {
  const delivered:VoiceTranscript[]=[],decoded:number[]=[];
  const hearing=new SvcHearing({speaker:uuid=>uuid==='self'?undefined:{name:uuid,uuid},
    decoder:()=>({encode:()=>Buffer.alloc(0),decode(packet){decoded.push(packet[0]);return new Int16Array(960).fill(800);}}),
    current:()=>true,transcribe:async(wav)=>{expect(wav.readUInt32LE(24)).toBe(16000);return recognize();},deliver:row=>delivered.push(row)});
  const send=(speaker:string,n:number,ended=false)=>hearing.receive({kind:'nearby',bytes:ended?0:1,heard:'unknown',
    opus:Buffer.from([n]),speakerUuid:speaker,channelUuid:speaker,sequence:String(n),ended});
  return {hearing,delivered,decoded,send};
}
describe('native SVC hearing',()=>{
  it('separates speakers, orders frames, deduplicates and ignores self audio',async()=>{
    const f=fixture();
    try{
      for(const n of [3,2,1,4,5,5,6,7,8,9])for(const name of ['Lin','Yu','self'])f.send(name,n);
      for(const name of ['Yu','Lin','self'])f.send(name,10,true);
      f.send('Lin',7);f.send('Lin',10,true);
      await vi.waitFor(()=>expect(f.delivered).toHaveLength(2));
      expect(f.delivered.map(row=>row.speaker.name)).toEqual(['Yu','Lin']);
      expect(new Set(f.delivered.map(row=>row.utteranceId)).size).toBe(2);
      expect(f.decoded.slice(0,9)).toEqual([1,2,3,4,5,6,7,8,9]);
    }finally{f.hearing.close();}
  });
  it('continues after a failed recognition and discards a late result after disconnect',async()=>{
    let resolve!:()=>void;let calls=0;
    const f=fixture(async()=>{if(++calls===1)throw Error('ASR_HTTP_503');await new Promise<void>(r=>resolve=r);return 'late';});
    try{
      for(const name of ['A','B']){for(let i=1;i<=9;i++)f.send(name,i);f.send(name,10,true);}
      await vi.waitFor(()=>expect(calls).toBe(2));expect(f.hearing.status().errors).toBe(1);
      f.hearing.close();resolve();await vi.waitFor(()=>expect(f.hearing.status().processing).toBe(false));
      expect(f.delivered).toEqual([]);
    }finally{f.hearing.close();}
  });
});
