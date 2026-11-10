// Explicit synthetic loopback lab only. Never uses a production player or replays an old request.
import fs from 'node:fs/promises';import http from 'node:http';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {randomUUID,createHash} from 'node:crypto';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../../../ops/rcon-client.mjs';import {receiver} from '../../touhou-maids/tests/svc-receiver.mjs';
const root=process.env.VOICE_UPLOAD_QA_REPORT_ROOT,lab=process.env.MAID_VOICE_QA_LAB,anchor=process.env.MAID_VOICE_QA_CLIENT_ANCHOR;
assert(root&&lab&&anchor);assert.equal((await fs.readFile(lab+'/.maid-render-qa','utf8')).trim(),'20261106 127.0.0.1:29467');
const props=await fs.readFile(lab+'/server.properties','utf8');assert(/^server-ip=127\.0\.0\.1$/m.test(props)&&/^server-port=29467$/m.test(props)&&/^rcon.port=29468$/m.test(props));
const run=q=>command(q,20000,{port:29468,properties:lab+'/server.properties'}),req=createRequire(anchor),bots=[],results=[],checks=[];let peer;let normalizations=0;
const report={passed:false,checks,realPlayersUsed:false,originalRequestReplayed:false,proxyFirstChunkRootCauseVerified:false,humanHearingVerified:false};
const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*Math.PI*2)*1500),44+i*2);
const digest=createHash('sha256').update(wav).digest('hex'),token=(await fs.readFile(root+'/qa-media.token','utf8')).trim();
const media=http.createServer(async(q,s)=>{try{assert.equal(q.url,'/v1/normalize');assert.equal(q.headers.authorization,'Bearer '+token);const b=[];for await(const c of q)b.push(c);assert.equal(createHash('sha256').update(Buffer.concat(b)).digest('hex'),digest);normalizations++;s.writeHead(200,{'content-type':'audio/wav'});s.end(wav);}catch{s.writeHead(400);s.end();}});
const check=(name,ok)=>{checks.push({name,ok:!!ok});assert(ok,name);};
const until=async(fn,ms=15000)=>{for(let end=Date.now()+ms;Date.now()<end;){const value=await fn();if(value)return value;await sleep(50);}throw Error('SYNTHETIC_CONDITION_TIMEOUT');};
try{
 await new Promise(done=>media.listen(29472,'127.0.0.1',done));await until(async()=>{try{return(await run('version QiandengVoice')).includes('0.1.5');}catch{return false;}},90000);
 for(const username of ['ag_MaidQApat','ag_VoiceQA']){const b=req('mineflayer').createBot({host:'127.0.0.1',port:29467,username,auth:'offline',version:'1.21.1',checkTimeoutInterval:60000});b.on('error',()=>{});bots.push(b);await new Promise((done,reject)=>{b.once('spawn',done);b.once('kicked',reject);setTimeout(()=>reject(Error('SYNTHETIC_SPAWN_TIMEOUT')),45000).unref();});await run('op '+username);await run('gamemode creative '+username);await run('tp '+username+' '+(username==='ag_MaidQApat'?0:3)+' 80 0');}
 const source=bots[0],channel='mcagent:voice';source._client.on('custom_payload',p=>{if(p.channel===channel&&p.data[0]===1)results.push(JSON.parse(p.data.subarray(1).toString()));});
 source._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from(channel)});await sleep(300);peer=await receiver(bots[1],{port:29471});
 const send=data=>source._client.write('custom_payload',{channel,data});
 const json=(op,requestId,extra={})=>send(Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify({op,requestId,...extra}))]));
 const begin=id=>json('begin',id,{bytes:wav.length,sha256:digest,format:'wav'});
 const chunk=(id,sequence,data)=>{const h=Buffer.alloc(21);h[0]=2;Buffer.from(id.replaceAll('-',''),'hex').copy(h,1);h.writeInt32BE(sequence,17);send(Buffer.concat([h,data]));};
 const state=(id,name)=>until(()=>results.find(r=>r.requestId===id&&r.state===name));
 const a=randomUUID();begin(a);await state(a,'uploading');chunk(a,0,wav.subarray(0,1));json('finish',a);const rejected=await state(a,'failed');check('incomplete finish returns the original request ID',rejected.reason==='UPLOAD_INCOMPLETE');
 const b=randomUUID();begin(b);await state(b,'uploading');check('failed finish does not block the next independent utterance',true);chunk(b,1,wav.subarray(0,16384));check('wrong sequence returns correlated failure',(await state(b,'failed')).reason==='UPLOAD_CHUNK_INVALID');
 const c=randomUUID();begin(c);await state(c,'uploading');chunk(c,0,Buffer.alloc(16385));check('oversized chunk retains request correlation',(await state(c,'failed')).reason==='UPLOAD_CHUNK_INVALID');
 const d=randomUUID();begin(d);await state(d,'uploading');for(let at=0,n=0;at<wav.length;at+=16384,n++){chunk(d,n,wav.subarray(at,at+16384));await sleep(10);}json('finish',d);
 chunk(d,0,wav.subarray(0,1));json('finish',d); // race the original asynchronous receipt reservation
 const sent=await state(d,'sent');await sleep(500);check('valid independent upload reaches native entity SVC packets',peer.state.audio>0&&peer.state.errors===0);check('valid upload is normalized once',normalizations===1);
 check('immediate late frames cannot downgrade the original upload while its receipt is being reserved',!results.some(r=>r.requestId===d&&r.state==='failed'));
 const n=results.length,audio=peer.state.audio;chunk(d,0,wav.subarray(0,1));json('finish',d);await until(()=>results.length>=n+2);await sleep(700);
 check('late chunk and duplicate finish retain the original terminal result',results.slice(n).filter(r=>r.requestId===d).every(r=>r.state===sent.state));check('late requests do not normalize or play a second copy',normalizations===1&&peer.state.audio===audio);
 report.uploads={incomplete:a,invalidSequence:b,oversized:c,valid:d};report.receivedAudioPackets=peer.state.audio;report.normalizations=normalizations;report.results=results;report.passed=true;
}catch(e){report.error=String(e);process.exitCode=1;}
finally{peer?.close();for(const b of bots)b.quit();media.closeAllConnections();media.close();try{await run('stop');}catch{}report.completedAt=new Date().toISOString();await fs.writeFile(root+'/voice-upload-native.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
