// Real loopback Minecraft/Velocity; synthetic backend/auth/audio, actual VoiceUploads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {attachProximityVoice} from '../../../../../packages/agent-mc-world/core/proximity-voice.mjs';
const root=process.env.VOICE_CHUNK_QA_ROOT,anchor=process.env.VOICE_QA_NODE_PACKAGE;
assert(root&&anchor,'explicit fresh loopback QA directory and node package required');
assert.equal(fs.readFileSync(path.join(root,'voice-transport-qa.marker'),'utf8'),'');
const require=createRequire(anchor),mc=require('minecraft-protocol'),data=require('minecraft-data')('1.21.1');
const baseline=process.env.VOICE_QA_BASELINE==='1',delay=process.env.VOICE_QA_DELAY==='1';
const rounds=20,clients=[],records=[],waiters=new Map();let token=0;
const hash=b=>createHash('sha256').update(b).digest('hex');
const wire=spawn('java',['-cp',process.env.VOICE_QA_WIRE_CLASSPATH,'dev.god.godvoice.VoiceWireProbe'],{stdio:['pipe','pipe','inherit']});
readline.createInterface({input:wire.stdout}).on('line',line=>{const r=JSON.parse(line),w=waiters.get(r.token);assert(w);waiters.delete(r.token);w(r);});
const decode=(actor,session,frame)=>new Promise(resolve=>{const n=token++;waiters.set(n,resolve);wire.stdin.write(JSON.stringify({token:n,actor,session,frame:frame.toString('base64')})+'\n');});
function meta(b){if(b[0]===1){const r=JSON.parse(b.subarray(1));return{op:r.op,requestId:r.requestId,frameBytes:b.length,sha256:hash(b)};}
 const h=b.subarray(1,17).toString('hex');return{op:'chunk',requestId:[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-'),sequence:b.readInt32BE(17),chunkBytes:b.length-21,frameBytes:b.length,sha256:hash(b)};}
const server=mc.createServer({host:'127.0.0.1',port:25882,'online-mode':false,encryption:false,version:'1.21.1',hideErrors:true});
server.on('playerJoin',c=>{
 const session=randomUUID();c.on('error',()=>{});
 c.write('login',{...data.loginPacket,entityId:c.id,isHardcore:false,gameMode:0,previousGameMode:1,worldName:'minecraft:overworld',hashedSeed:[0,0],maxPlayers:4,viewDistance:2,reducedDebugInfo:false,enableRespawnScreen:true,isDebug:false,isFlat:true,enforceSecureChat:false});
 c.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:voice')});
 c.on('custom_payload',async p=>{
  if(p.channel!=='mcagent:voice')return;
  const item={...meta(p.data),actor:c.uuid,session,at:Date.now()};records.push(item);
  const r=await decode(c.uuid,session,p.data);Object.assign(item,r);
  if(r.state)c.write('custom_payload',{channel:p.channel,data:Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify({type:'voice_result',requestId:r.requestId,state:r.state,reason:r.reason??''}))])});
 });
});
let proxy;const trials=[];
try{
 await new Promise(r=>server.once('listening',r));
 const output=fs.openSync(path.join(root,'proxy.log'),'w');
 proxy=spawn('java',['-Xms128m','-Xmx256m','-XX:ActiveProcessorCount=4','-Dvoice.transport.qa=true',`-Dvoice.chunk.qa.delay-first=${delay}`,'-Dterminal.jline=false','-Dterminal.ansi=false','-jar',process.env.VOICE_QA_VELOCITY],{cwd:root,stdio:['pipe',output,output]});
 for(let n=0;n<150&&!fs.readFileSync(path.join(root,'proxy.log'),'utf8').includes('VOICE_CHUNK_QA_READY');n++){
  await sleep(100);assert.equal(proxy.exitCode,null,'proxy startup');
 }
 assert.match(fs.readFileSync(path.join(root,'proxy.log'),'utf8'),/VOICE_CHUNK_QA_READY/);
 for(const [label,port]of[['direct',25882],['proxy',25881]]){
  const c=mc.createClient({host:'127.0.0.1',port,version:'1.21.1',username:'qa_'+label,auth:'offline'});clients.push(c);c.on('error',()=>{});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('login timeout')),15000);c.once('login',()=>{clearTimeout(timer);resolve();});c.once('end',r=>{clearTimeout(timer);reject(Error(r));});});await sleep(300);
  const bot=new EventEmitter();bot._client=c;const voice=attachProximityVoice(bot,{timeoutMs:1500});
  const outgoing=[],write=c.write.bind(c);c.write=(name,p)=>{if(name==='custom_payload'&&p.channel==='mcagent:voice')outgoing.push(meta(p.data));return write(name,p);};
  for(let round=0;round<rounds;round++){
   const wav=Buffer.alloc(44+96000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
   const requestId=randomUUID(),result=await voice.upload(wav,{requestId});await sleep(80);
   const sent=outgoing.filter(r=>r.requestId===requestId),received=records.filter(r=>r.requestId===requestId);
   assert(received.every(r=>sent.some(s=>s.sha256===r.sha256)),'no payload mutation');
   const failure=received.find(r=>r.state==='failed');
   trials.push({label,round,requestId,result,outgoing:sent,received,firstRejection:failure??null});
  }
  voice.close();c.end();
 }
 const direct=trials.filter(r=>r.label==='direct'),proxied=trials.filter(r=>r.label==='proxy');
 assert(direct.every(r=>r.result.state==='sent'&&!r.firstRejection),'direct upload validation');
 if(!baseline)assert(proxied.every(r=>r.result.state==='sent'&&!r.firstRejection),'candidate proxy upload validation');
 if(baseline&&delay)assert(proxied.every(r=>r.firstRejection?.before?.nextSequence===0&&r.firstRejection.sequence>0),'baseline first arriving chunk is not sequence zero');
 console.log(JSON.stringify({baseline,delay,directPass:direct.length,proxyPass:proxied.filter(r=>r.result.state==='sent'&&!r.firstRejection).length,proxyFirstSequenceRejections:proxied.filter(r=>r.firstRejection?.before?.nextSequence===0).length,rounds,actualVoiceUploads:true,syntheticCompletion:true,humanHearingVerified:false}));
}finally{
 for(const c of clients)c.end();
 if(proxy?.exitCode===null){proxy.stdin.write('shutdown\n');await Promise.race([new Promise(r=>proxy.once('exit',r)),sleep(5000)]);if(proxy.exitCode===null)proxy.kill();}
 wire.stdin.end();server.close();fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({baseline,delay,trials},null,2));
}
