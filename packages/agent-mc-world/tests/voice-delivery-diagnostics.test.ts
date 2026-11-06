import {it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {attachProximityVoice} from '../src/proximity-voice.ts';
import {ProximityVoiceLane,type GameVoiceReceipt} from '../core/proximity-voice-lane.ts';
function bot(){const b=new EventEmitter() as any;b._client=new EventEmitter();b._client.state='play';b._client.write=()=>{};return b;}
function wire(b:any,row:unknown){b._client.emit('custom_payload',{channel:'mcagent:voice',data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify(row))])});}
it('preserves bounded delivery evidence and next step without promoting sent to heard',async()=>{
 const b=bot(),voice=attachProximityVoice(b),id=randomUUID(),waiting=voice.status(id);
 const result={type:'voice_result',requestId:id,state:'sent',reason:'VOICE_NO_RECEIVER_CHECK_STATUS',nextStep:'先完成语音首次设置，麦克风可以保持静音。',actualHearingVerified:false,delivery:{packetOffers:0,listenerCount:0,listenersTruncated:false}};
 wire(b,result);expect(await waiting).toEqual(result);voice.close();
});
it('ignores forged hearing and invalid counts, bounds guidance and drops extra fields',async()=>{
 const b=bot(),voice=attachProximityVoice(b),id=randomUUID(),waiting=voice.status(id);
 wire(b,{type:'voice_result',requestId:id,state:'sent',reason:'',actualHearingVerified:true,nextStep:'x'.repeat(1500),delivery:{packetOffers:-1,listenerCount:999,listenersTruncated:false},secret:'must not copy'});
 const row=await waiting;expect(row.actualHearingVerified).toBeUndefined();expect(row.delivery).toBeUndefined();expect(row.nextStep?.length).toBe(600);expect((row as any).secret).toBeUndefined();voice.close();
});
it('publishes guidance and counts to the Agent voice lane while hearing stays unknown',async()=>{
 const b=bot(),changed:GameVoiceReceipt[]=[],id=randomUUID();
 const bytes=Buffer.alloc(44+9600);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(9600,40);
 b._client.write=(_name:string,p:any)=>{if(p.channel!=='mcagent:voice'||p.data[0]!==1)return;const r=JSON.parse(p.data.subarray(1));
  if(r.op==='begin')wire(b,{type:'voice_result',requestId:id,state:'uploading'});
  if(r.op==='finish')wire(b,{type:'voice_result',requestId:id,state:'sent',reason:'VOICE_NO_RECEIVER_CHECK_STATUS',nextStep:'收听者用 /voice status',actualHearingVerified:false,delivery:{packetOffers:0,listenerCount:0,listenersTruncated:false}});
 };
 const lane=new ProximityVoiceLane({config:()=>({enabled:true,audioProducerUrl:'',outputMode:'game-only'}),context:()=>({bot:b,generation:'synthetic',world:{key:'minecraft:overworld',revision:1},stillCurrent:()=>true,disableAutoSpeech:()=>{}}),blob:()=>({bytes,mime:'audio/wav'}),hearing:()=>{},changed:r=>changed.push(r),timeoutMs:500});
 try{
  await lane.call({action:'upload',audio_handle:'fixture',requestId:id});
  for(let i=0;i<100&&!changed.some(r=>r.game.state==='sent');i++)await new Promise(r=>setTimeout(r,10));
  const last=changed.at(-1)!;expect(last.game.state).toBe('sent');expect(last.game.nextStep).toContain('/voice status');expect(last.game.delivery?.packetOffers).toBe(0);expect(last.recipientHeard).toBe('unknown');expect(last.goal_completed).toBe(false);
 }finally{await lane.stop();}
});
