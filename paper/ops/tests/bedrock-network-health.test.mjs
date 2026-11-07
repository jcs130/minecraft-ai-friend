import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,request,decode,discover} from '../bedrock-network-health.mjs';
import dgram from 'node:dgram';
test('discovery request matches 64-byte wire layout',()=>{const p=request(),b=unseal(p);assert.equal(p.length,64);assert.equal(b.length,18);assert.equal(b.readUInt16LE(0),0);assert(b.subarray(2,10).some(n=>n!==0));assert(b.subarray(10).every(n=>n===0));});
test('corrupt, undersized and mismatched lengths are rejected',()=>{const p=request();p[0]^=1;assert.throws(()=>unseal(p),/INTEGRITY/);assert.throws(()=>unseal(Buffer.alloc(12)),/SIZE/);const bad=Buffer.alloc(20);bad.writeUInt16LE(10);assert.throws(()=>unseal(seal(bad)),/LENGTH/);assert.throws(()=>decode(request()),/KIND/);});
test('timeout remains failure, never empty success',async()=>{await assert.rejects(discover('127.0.0.1',1,{timeout:30}),/TIMEOUT/);});
test('version-7 metadata and Unicode are read from actual UDP reply',async()=>{
 const parts=[Buffer.from([7])];const u=n=>{let a=[];do{let b=n&127;n>>>=7;a.push(b|(n?128:0));}while(n);parts.push(Buffer.from(a));};const n=v=>u((v<<1)^(v>>31));const s=v=>{let b=Buffer.from(v);u(b.length);parts.push(b);};
 s('千灯纪');n(2225);s('26.60');s('world');n(3);n(40);n(0);parts.push(Buffer.from([0,0,1,0]));s('challenge');n(4);
 const data=Buffer.from(Buffer.concat(parts).toString('hex'));const b=Buffer.alloc(24+data.length);b.writeUInt16LE(b.length);b.writeUInt16LE(1,2);b.writeUInt32LE(data.length,20);data.copy(b,24);
 const socket=dgram.createSocket('udp4');await new Promise(r=>socket.bind(0,'127.0.0.1',r));socket.on('message',(_,peer)=>socket.send(seal(b),peer.port,peer.address));
 try{const p=await discover('127.0.0.1',socket.address().port);assert.equal(p.name,'千灯纪');assert.equal(p.protocol,2225);assert.equal(p.players,3);assert.equal(p.maxPlayers,40);assert.equal(p.onlineAuth,true);assert.equal(p.selfSignedAuth,false);assert.equal(p.noncePresent,true);}finally{socket.close();}
});
