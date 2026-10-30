import {describe,it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {attachProximityVoice,inspectVoiceWav} from '../src/proximity-voice.ts';
import {ProximityVoiceLane,type ProximityVoiceContext,type GameVoiceReceipt} from '../core/proximity-voice-lane.ts';
export function wav(seconds=.2,rate=48000){const bytes=Buffer.alloc(44+Math.round(seconds*rate)*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes;}
function bot(){const value=new EventEmitter() as any;value._client=new EventEmitter();value._client.state='play';value._client.write=(name:string,data:unknown)=>value.emit('write',name,data);return value;}
function wire(bot:any,row:unknown){bot._client.emit('custom_payload',{channel:'mcagent:voice',data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify(row))])});}
function receipt(bot:any,requestId:string,state:string){wire(bot,{type:'voice_result',requestId,state});}
const eventually=async(check:()=>boolean)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(ok=>setTimeout(ok,5));}throw Error('evidence did not arrive');};
describe('canonical proximity protocol',()=>{
 it('requires authenticated play and rejects invalid WAV before effects',async()=>{const b=bot();expect(()=>attachProximityVoice(b,{isAuthenticated:()=>false})).toThrow(/AUTHENTICATED/);
   const voice=attachProximityVoice(b);await expect(voice.upload(Buffer.from('no'))).rejects.toThrow(/PCM16/);expect(()=>inspectVoiceWav(wav(30.1))).toThrow(/30_SECONDS/);voice.close();});
 it('deduplicates real utterance UUIDs across reconnect and removes old listeners',()=>{const b=bot(),seen=new Set<string>(),rows:any[]=[];
   const options={seenUtterances:seen,onHearing:(row:unknown)=>rows.push(row)};const old=attachProximityVoice(b,options),next=attachProximityVoice(b,options);
   expect(b._client.listenerCount('custom_payload')).toBe(1);
   const row={type:'nearby_voice',speaker:'小鱼',speakerUuid:randomUUID(),utteranceId:randomUUID(),text:'一起去公会'};
   wire(b,row);wire(b,row);wire(b,{...row,speakerUuid:undefined});expect(rows).toEqual([row]);old.close();expect(b._client.listenerCount('custom_payload')).toBe(1);
   next.close();const replacement=attachProximityVoice(b,options);wire(b,row);expect(rows.length).toBe(1);replacement.close();expect(b._client.listenerCount('custom_payload')).toBe(0);
 });
 it('uploads exact WAV without server TTS; intermediate states are not completion',async()=>{const b=bot(),voice=attachProximityVoice(b),id=randomUUID(),ops:string[]=[],parts:Buffer[]=[];let done=false;
   b.on('write',(_name:string,p:any)=>{if(p.channel!=='mcagent:voice')return;if(p.data[0]===2){parts.push(p.data.subarray(21));return;}
     const r=JSON.parse(p.data.subarray(1));ops.push(r.op);if(r.op==='begin')receipt(b,id,'uploading');if(r.op==='finish'){receipt(b,id,'queued');receipt(b,id,'playing');}});
   const value=voice.upload(wav(),{requestId:id}).then(r=>{done=true;return r;});await eventually(()=>ops.includes('finish'));expect(done).toBe(false);
   receipt(b,id,'sent');expect((await value).state).toBe('sent');expect(ops).toEqual(['begin','finish']);expect(Buffer.concat(parts)).toEqual(wav());voice.close();
 });
 it('returns duplicate queued/playing without reuploading frames',async()=>{const b=bot(),voice=attachProximityVoice(b),id=randomUUID();let frames=0;
   b.on('write',(_name:string,p:any)=>{if(p.channel!=='mcagent:voice')return;if(p.data[0]===2)frames++;else {const r=JSON.parse(p.data.subarray(1));if(r.op==='begin')receipt(b,id,'playing');}});
   expect((await voice.upload(wav(),{requestId:id})).state).toBe('playing');expect(frames).toBe(0);voice.close();
 });
 it('does not replay after timeout or disconnect',async()=>{const b=bot(),voice=attachProximityVoice(b,{timeoutMs:8});let sent=0;b.on('write',()=>sent++);
   expect((await voice.say('你好')).state).toBe('unknown');expect(sent).toBe(1);const pending=voice.say('再见');b.emit('end');expect((await pending).state).toBe('unknown');expect(sent).toBe(2);
 });
});
function laneFixture(options:{file?:string;url?:string;live?:boolean}={}){
 const b=bot(),changes:GameVoiceReceipt[]=[],heard:any[]=[],ops:string[]=[],parts:Buffer[]=[];let valid=true,world='minecraft:town',revision=1,auto=0;
 const context=():ProximityVoiceContext=>{const key=world,rev=revision;return{bot:b,generation:'test-account-1',world:{key,revision:rev,source:'vanilla-login',observedAt:new Date().toISOString()},stillCurrent:()=>valid&&world===key&&revision===rev,disableAutoSpeech:()=>{auto++;}};};
 b.on('write',(_name:string,p:any)=>{if(p.channel!=='mcagent:voice')return;if(p.data[0]===2){parts.push(p.data.subarray(21));return;}
   const r=JSON.parse(p.data.subarray(1));ops.push(r.op);if(r.op==='begin')receipt(b,r.requestId,'uploading');if(r.op==='finish')receipt(b,r.requestId,'sent');if(r.op==='status')receipt(b,r.requestId,'sent');});
 const lane=new ProximityVoiceLane({config:()=>({enabled:true,audioProducerUrl:options.url??'',outputMode:options.live?'live-and-game':'game-only'}),context:()=>valid?context():null,
   blob:()=>({bytes:wav(),mime:'audio/wav'}),hearing:(row,w)=>heard.push({row,world:w}),changed:r=>changes.push(r),file:options.file,timeoutMs:30});
 return{lane,b,changes,heard,ops,parts,setValid:(value:boolean)=>{valid=value;},setWorld:(value:string)=>{world=value;revision++;},getAuto:()=>auto};
}
describe('independent game voice lane',()=>{
 it('never uploads explicitly incomplete generated audio or replaces false with unknown',async()=>{
   const server=createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'Content-Type':'audio/wav','X-Voice-Generation-Complete':'false'}).end(wav());});
   await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const f=laneFixture({url:'http://127.0.0.1:'+(server.address() as any).port});
   try {await f.lane.call({action:'speak',text:'不应播放的截断台词。'});await eventually(()=>f.changes.some(r=>r.game.state==='failed'));
     expect(f.changes.at(-1)!.generationComplete).toBe(false);expect(f.ops).not.toContain('begin');}
   finally{await f.lane.stop();server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
 });
 it('acknowledges without blocking a body queue, and persists same-ID dedup across instances',async()=>{const dir=await mkdtemp(join(tmpdir(),'mc-voice-')),file=join(dir,'ledger.json'),f=laneFixture({file}),id=randomUUID();
   const admission=await f.lane.call({action:'upload',audio_handle:'audio:1',requestId:id});expect(admission.failed).toBeUndefined();expect((admission.data as any).recipientHeard).toBe('unknown');
   await eventually(()=>f.changes.some(r=>r.game.state==='sent'));const count=f.ops.filter(op=>op==='begin').length;
   await f.lane.call({action:'upload',audio_handle:'audio:1',requestId:id});expect(f.ops.filter(op=>op==='begin').length).toBe(count);await f.lane.stop();
   expect(JSON.parse(await readFile(file,'utf8')).requests[0].game.state).toBe('sent');
   const next=laneFixture({file});await next.lane.call({action:'upload',audio_handle:'audio:1',requestId:id});expect(next.ops).not.toContain('begin');await next.lane.stop();
 });
 it('keeps game-only output separate and labels transcript native-world delivery without inventing source world',async()=>{const f=laneFixture();await f.lane.call({});const row={type:'nearby_voice',speaker:'小鱼',speakerUuid:randomUUID(),utteranceId:randomUUID(),text:'我在这里'};
   wire(f.b,row);expect(f.heard[0].row.speakerUuid).toBe(row.speakerUuid);expect(f.heard[0].world.key).toBe('minecraft:town');expect(f.heard[0].row.world).toBeUndefined();
   f.setWorld('minecraft:other_town');f.lane.sync();wire(f.b,row);expect(f.heard.length).toBe(1);expect(f.b._client.listenerCount('custom_payload')).toBe(1);await f.lane.stop();
 });
 it('live mode fans out exactly one generated WAV; broadcast failure does not erase game transmission',async()=>{
   let synthesis=0,broadcast=0;const bytes=wav(),server=createServer(async(req,res)=>{if(req.url==='/api/voice-artifacts'){synthesis++;for await(const _ of req){}res.writeHead(200,{'Content-Type':'audio/wav','X-Voice-Generation-Complete':'null'}).end(bytes);}else {broadcast++;res.writeHead(503).end();}});
   await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const url='http://127.0.0.1:'+(server.address() as any).port,f=laneFixture({url,live:true});
   try {const id=randomUUID();await f.lane.call({action:'speak',text:'小鱼，等我一下。',requestId:id});await eventually(()=>f.changes.some(r=>r.game.state==='sent'&&r.broadcast.state==='failed'));
     expect(synthesis).toBe(1);expect(broadcast).toBe(1);expect(Buffer.concat(f.parts)).toEqual(bytes);expect(f.ops).not.toContain('say');const row=f.changes.at(-1)!;expect(row.generationComplete).toBeNull();expect(row.audioSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
   }finally{await f.lane.stop();server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
 });
 it('world change cancels a pending synthesis before audio upload or broadcast',async()=>{let release!:()=>void;const waiting=new Promise<void>(ok=>{release=ok;});const server=createServer(async(req,res)=>{for await(const _ of req){}await waiting;res.end(wav());});await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
   const f=laneFixture({url:'http://127.0.0.1:'+(server.address() as any).port});try {await f.lane.call({action:'speak',text:'我过来了'});f.setWorld('minecraft:another');f.lane.sync();release();await eventually(()=>f.changes.some(r=>r.game.state==='unknown'));expect(f.ops).not.toContain('begin');}
   finally{release();await f.lane.stop();server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
 });
 it('does not admit two concurrent uploads or reuse one request for different content',async()=>{const f=laneFixture(),id=randomUUID();const [one,two]=await Promise.all([f.lane.call({action:'upload',audio_handle:'h',requestId:id}),f.lane.call({action:'upload',audio_handle:'h',requestId:randomUUID()})]);expect([one,two].filter(r=>r.failed).length).toBe(1);
   await eventually(()=>f.changes.some(r=>r.game.state==='sent'));const conflict=await f.lane.call({action:'speak',text:'changed',requestId:id});expect(conflict.failed).toBe(true);await f.lane.stop();
 });
});
