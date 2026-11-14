// Real SVC encrypted UDP handshake and synthetic audio; no microphone/account credentials.
import assert from 'node:assert/strict';
import net from 'node:net';
import {createSocket} from 'node:dgram';
import {createRequire} from 'node:module';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const require=createRequire(process.env.VOICE_QA_NODE_PACKAGE),mineflayer=require('mineflayer');
const proxyPort=Number(process.env.VOICE_QA_PORT),udpPort=Number(process.env.VOICE_QA_UDP);
const baseline=process.env.VOICE_QA_BASELINE==='1',bots=[],sockets=[],timers=[];
let checks=0;
const check=(b,s)=>{assert.ok(b,s);checks++;};
async function until(fn,label,ms=12000){for(let end=Date.now()+ms;Date.now()<end;){if(fn())return;await sleep(50);}throw Error(label);}
function vint(n){const bytes=[];do{bytes.push((n&127)|(n>127?128:0));n>>>=7;}while(n);return Buffer.from(bytes);}
function readv(data,at){let n=0,shift=0,v;do{v=data[at++];n|=(v&127)<<shift;shift+=7;if(shift>35)throw Error('bad length');}while(v&128);return[n,at];}
async function connect(name,source,expected){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:proxyPort,username:name,auth:'offline',version:'1.21.1',hideErrors:true,
  connect(client){const socket=net.connect(proxyPort,'127.0.0.1');socket.once('error',e=>client.emit('error',e));socket.once('connect',()=>{
   socket.write(`PROXY TCP4 ${source} 127.0.0.1 ${socket.localPort} ${proxyPort}\r\n`);client.setSocket(socket);client.emit('connect');});}
 });bots.push(bot);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout')),15000);bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('error',reject);bot.once('kicked',reason=>reject(Error(JSON.stringify(reason))));});
 let secret,uuid,key,auth=0,audio=0,host,sequence=0n,secretCount=0,errors=0,sendHost,sendPort;
 const sock=createSocket('udp4');sockets.push(sock);await new Promise(resolve=>sock.bind(0,'127.0.0.1',resolve));
 const send=(id,body=Buffer.alloc(0))=>{
  const iv=randomBytes(12),cipher=createCipheriv('aes-128-gcm',key,iv);
  const enc=Buffer.concat([iv,cipher.update(Buffer.concat([Buffer.from([id]),body])),cipher.final(),cipher.getAuthTag()]);
  sock.send(Buffer.concat([Buffer.from([255]),uuid,vint(enc.length),enc]),sendPort,sendHost);
 };
 sock.on('message',(packet,peer)=>{try{
  assert.equal(peer.address,'127.0.0.1');assert.equal(peer.port,udpPort);assert.equal(packet[0],255);
  const [length,at]=readv(packet,1),enc=packet.subarray(at,at+length),dec=createDecipheriv('aes-128-gcm',key,enc.subarray(0,12));
  dec.setAuthTag(enc.subarray(-16));const data=Buffer.concat([dec.update(enc.subarray(12,-16)),dec.final()]);
  if(data[0]===6){auth++;send(9);}else if(data[0]===9)send(10);else if(data[0]===8)send(8);else if(data[0]===2||data[0]===4)audio++;
 }catch{errors++;}});
 bot._client.on('custom_payload',packet=>{if(packet.channel!=='voicechat:secret')return;
  secret=packet.data;secretCount++;key=secret.subarray(0,16);uuid=secret.subarray(20,36);
  const [length,at]=readv(secret,54);host=secret.toString('utf8',at,at+length);
  if(!baseline){assert.equal(host,expected);assert.equal(secret.readInt32BE(16),udpPort);
   sendHost=host.slice(0,host.lastIndexOf(':'));sendPort=Number(host.slice(host.lastIndexOf(':')+1));send(5,Buffer.concat([uuid,key]));}
 });
 await sleep(200);
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('voicechat:secret\0voicechat:state\0voicechat:states\0voicechat:request_secret\0voicechat:update_state')});
 const version=Buffer.alloc(4);version.writeInt32BE(20);bot._client.write('custom_payload',{channel:'voicechat:request_secret',data:version});
 if(name==='qa_denied'&&!baseline){await sleep(1200);check(secretCount===0,'unauthorized native SVC secret withheld');return;}
 await until(()=>secret,'native secret timeout');
 if(baseline){check(host==='','baseline leaves the client on its game host');return;}
 await until(()=>auth>0,'native SVC UDP authentication timeout');
 bot._client.write('custom_payload',{channel:'voicechat:update_state',data:Buffer.from([0])});
 timers.push(setInterval(()=>send(8),1000));await sleep(250);
 check(secretCount===1,'one native secret, no forwarding duplicate');check(errors===0,'valid encrypted UDP replies');
 return {get audio(){return audio;},async speak(){for(let n=0;n<12;n++){
  const opus=Buffer.from([248,255,254]),seq=Buffer.alloc(8);seq.writeBigInt64BE(sequence++);
  send(1,Buffer.concat([vint(opus.length),opus,seq,Buffer.from([0])]));await sleep(20);
 }},get secretCount(){return secretCount;}};
}
try{
 const lan=await connect('qa_svc_lan','192.168.3.25',`localhost:${udpPort}`);
 if(!baseline){
  const wan=await connect('qa_svc_wan','203.0.113.25',`127.0.0.1:${udpPort}`);
  const local=await connect('qa_svc_local','127.0.0.1',`127.0.0.1:${udpPort}`);
  await lan.speak();await until(()=>wan.audio>0&&local.audio>0,'LAN-to-other-listeners audio timeout');checks++;
  await wan.speak();await until(()=>lan.audio>0,'public-classified speaker audio timeout');checks++;
  await connect('qa_denied','203.0.113.26',`127.0.0.1:${udpPort}`);
  check(lan.secretCount===1&&wan.secretCount===1,'no late duplicate secret');
 }
 console.log(JSON.stringify({baseline,checks,network:'isolated real Velocity + Paper + SVC 2.6.27',peerSource:'test PROXY header',authentication:'synthetic provider',audio:'synthetic Opus silence',padListeningVerified:false}));
}finally{for(const timer of timers)clearInterval(timer);for(const bot of bots)bot.quit();for(const socket of sockets)socket.close();await sleep(200);}
