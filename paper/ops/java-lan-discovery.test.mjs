import test from 'node:test';import assert from 'node:assert/strict';import dgram from 'node:dgram';import path from 'node:path';
import {validateConfig,payload,createAnnouncer,destination}from'./java-lan-discovery.mjs';
const config=()=>validateConfig({schemaVersion:1,motd:'千灯纪 · 重返艾恩葛朗特',interfaceAddress:'192.168.3.163',port:25565,backendPort:25565,statusScript:path.resolve('fixture-runtime/mcstatus.mjs'),stateFile:path.resolve('fixture-runtime/lan-status.json')});
test('vanilla discovery fields carry the actual LAN game entry',()=>{
 assert.equal(payload(config()).toString('utf8'),'[MOTD]千灯纪 · 重返艾恩葛朗特[/MOTD][AD]25565[/AD]');
 assert.deepEqual(destination,{address:'224.0.2.60',port:4445,ttl:1});
});
test('configuration rejects delimiter injection, bad ports and unintended interfaces',()=>{
 for(const override of[{motd:'x[/MOTD][AD]22'},{motd:'bad\nname'},{port:0},{port:65536},{port:2.5},{interfaceAddress:'0.0.0.0'},{interfaceAddress:'203.0.113.1'},{interfaceAddress:'192.168.999.1'}])assert.throws(()=>validateConfig({...config(),...override}));
});
test('an unavailable or stale game cannot keep producing discovery packets',async()=>{
 let time=1000,ready=false,packets=[];
 const a=createAnnouncer(config(),{now:()=>time,probe:async()=>{if(!ready)throw Error('game stopped');},send:b=>packets.push(b)});
 assert.equal(a.broadcast(),false);await a.refresh();assert.equal(a.broadcast(),false);
 ready=true;await a.refresh();assert.equal(a.broadcast(),true);assert.equal(packets.length,1);
 time+=30001;assert.equal(a.broadcast(),false);assert.equal(a.state().phase,'suppressed');
 ready=false;await a.refresh();assert.equal(a.broadcast(),false);assert.equal(a.state().phase,'suppressed');
});
test('health checks coalesce while a previous check is waiting',async()=>{
 let release,calls=0;const wait=new Promise(r=>release=r);
 const a=createAnnouncer(config(),{probe:async()=>{calls++;await wait;},send:()=>{}});
 const first=a.refresh(),second=a.refresh();assert.equal(first,second);assert.equal(calls,1);release();await first;
});
test('consumer receives a native packet through real UDP without a public QA broadcast',async()=>{
 const receiver=dgram.createSocket('udp4'),sender=dgram.createSocket('udp4');
 try{
  await new Promise(r=>receiver.bind(0,'127.0.0.1',r));const port=receiver.address().port;
  const packet=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture timed out')),2000);receiver.once('message',b=>{clearTimeout(timer);resolve(b);});});
  const a=createAnnouncer(config(),{probe:async()=>{},send:b=>sender.send(b,port,'127.0.0.1')});
  await a.refresh();a.broadcast();const received=(await packet).toString('utf8');
  assert.equal(received.match(/\[AD\](\d+)\[\/AD\]/)[1],'25565');assert.match(received,/千灯纪/);
 }finally{receiver.close();sender.close();}
});
