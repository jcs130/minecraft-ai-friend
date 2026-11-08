// SVC receiver reused from proximity-voice delivery tests. Synthetic loopback QA only.
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';import {createSocket} from 'node:dgram';import {setTimeout as sleep} from 'node:timers/promises';import assert from 'node:assert/strict';
async function until(fn){for(let end=Date.now()+15000;Date.now()<end;){if(await fn())return;await sleep(100);}throw Error('Synthetic UDP handshake timed out');}
function vint(n){const out=[];do{let b=n&127;n>>>=7;if(n)b|=128;out.push(b);}while(n);return Buffer.from(out);}
function readv(b,offset){let n=0,s=0,p=offset;for(;p<b.length&&s<35;s+=7){let v=b[p++];n|=(v&127)<<s;if(!(v&128))return[n,p];}throw Error('Invalid synthetic UDP packet');}
export async function receiver(bot){
 const sock=createSocket('udp4'),state={audio:0,positional:0,positions:[],acks:0,errors:0,secret:false,packets:[],players:new Map(),stateChanges:0};let key,uuid,sequence=0n,closed=false;
 const send=(id,body=Buffer.alloc(0))=>{const iv=randomBytes(12),cipher=createCipheriv('aes-128-gcm',key,iv),encrypted=Buffer.concat([iv,cipher.update(Buffer.concat([Buffer.from([id]),body])),cipher.final(),cipher.getAuthTag()]);sock.send(Buffer.concat([Buffer.from([255]),uuid,vint(encrypted.length),encrypted]),25940,'127.0.0.1');};
 sock.on('message',(packet,rinfo)=>{try{
  assert.equal(rinfo.address,'127.0.0.1');assert.equal(rinfo.port,25940);assert.equal(packet[0],255);const[len,at]=readv(packet,1),enc=packet.subarray(at,at+len),dec=createDecipheriv('aes-128-gcm',key,enc.subarray(0,12));dec.setAuthTag(enc.subarray(-16));const data=Buffer.concat([dec.update(enc.subarray(12,-16)),dec.final()]);
  if(data[0]===6){state.acks++;send(9);}else if(data[0]===8)send(8);else if(data[0]===9)send(10);else if(data[0]===2||data[0]===4){const[size,start]=readv(data,data[0]===4?57:33);if(size>0){state.audio++;if(data[0]===4){state.positional++;state.positions.push([data.readDoubleBE(33),data.readDoubleBE(41),data.readDoubleBE(49)]);}state.packets.push(data.subarray(start,start+size).toString('base64'));}}
 }catch{state.errors++;}});
 const secret=packet=>{
  if(['voicechat:state','voicechat:states'].includes(packet.channel)){
   try{const data=packet.data;let at=packet.channel==='voicechat:states'?4:0,count=at?data.readInt32BE(0):1;assert.ok(count>=0&&count<=32);
    for(let i=0;i<count;i++){const disabled=!!data[at++],disconnected=!!data[at++],id=data.subarray(at,at+16).toString('hex');at+=16;const[size,start]=readv(data,at);const name=data.toString('utf8',start,start+size);at=start+size;const group=!!data[at++];if(group)at+=16;state.players.set(name,{id,disabled,disconnected});state.stateChanges++;}assert.equal(at,data.length);
   }catch{state.errors++;}return;
  }
  if(packet.channel!=='voicechat:secret')return;const data=packet.data;key=data.subarray(0,16);assert.equal(data.readInt32BE(16),25940);uuid=data.subarray(20,36);state.secret=true;send(5,Buffer.concat([uuid,key]));};
 bot._client.on('custom_payload',secret);await new Promise(resolve=>sock.bind(0,'127.0.0.1',resolve));
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('voicechat:secret\0voicechat:state\0voicechat:states\0voicechat:request_secret\0voicechat:update_state')});const version=Buffer.alloc(4);version.writeInt32BE(20);bot._client.write('custom_payload',{channel:'voicechat:request_secret',data:version});
 await until(()=>state.acks>0);const timer=setInterval(()=>send(8),1000);
 const setDisabled=value=>bot._client.write('custom_payload',{channel:'voicechat:update_state',data:Buffer.from([value?1:0])});
 setDisabled(false);await sleep(400);
 const result={state,setDisabled,async speak(packets,whisper=false){for(const encoded of [...packets,'']){const data=Buffer.from(encoded,'base64'),seq=Buffer.alloc(8);seq.writeBigInt64BE(sequence++);const body=Buffer.concat([vint(data.length),data,seq,Buffer.from([whisper?1:0])]);send(1,body);send(1,body);await sleep(20);}},close(){if(closed)return;closed=true;clearInterval(timer);bot._client.off('custom_payload',secret);sock.close();}};return result;
}
