import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayWorldStream} from '../public/play-world-stream.js';
import {createPlayRtcGateway} from '../src/play-rtc-gateway.mjs';
test('world transport switches only on fresh identity; RTC loss resumes original read-only source',()=>{
 let receive,lost,ready=false,legacyStarts=0,legacyCloses=0,detach=0;const seen=[],errors=[],events=new Map();
 const win={location:{origin:'https://fixture.invalid'},addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),
  parent:{location:{origin:'https://fixture.invalid'},QdPlayRtc:{status:()=>({ready}),subscribeWorld:(a,b)=>(receive=a,lost=b,()=>detach++)}}};
 const stream=createPlayWorldStream({onMessage:m=>seen.push(m.data),onUnavailable:r=>errors.push(r)},()=>{legacyStarts++;return{close:()=>legacyCloses++,readyState:1}},win);
 assert.equal(legacyStarts,1);ready=true;events.get('qd-play-rtc-ready')();
 receive({data:'{"type":"snapshot"}'});assert.equal(legacyCloses,0);assert.deepEqual(seen,[]);
 receive({data:'{"type":"identity"}'});receive({data:'{"type":"snapshot"}'});
 assert.equal(legacyCloses,1);assert.equal(seen.length,2);
 lost('PEER_DISCONNECTED');assert.equal(legacyStarts,2);assert.equal(detach,1);assert.deepEqual(errors,['PEER_DISCONNECTED']);
 stream.close();assert.equal(events.size,0);assert.equal(legacyCloses,2);
});
test('cross-origin parent cannot substitute a private game stream',()=>{
 let called=false;
 const stream=createPlayWorldStream({onMessage(){},onUnavailable(){}},()=>({close(){},readyState:1}),{
  location:{origin:'https://a.invalid'},parent:{location:{origin:'https://b.invalid'},QdPlayRtc:{status:()=>{called=true}}},addEventListener(){},removeEventListener(){}});
 assert.equal(called,false);stream.close();
});
test('disabled runtime, absent ownership and foreign receipt clients fail before constructing peers',async()=>{
 const disabled=createPlayRtcGateway();await assert.rejects(()=>disabled.offer({},'browser-1',{}),/RTC_DISABLED/);
 let created=0;const live=createPlayRtcGateway({runtime:{createPeerConnection(){created++}}});
 await assert.rejects(()=>live.offer({portal:{owner:null}},'browser-1',{}),/OWN_PLAY_REQUIRED/);
 assert.throws(()=>live.query({portal:{owner:null}},'browser-1','request-1'),/OWN_PLAY_REQUIRED/);
 assert.equal(created,0);assert.deepEqual(disabled.capabilities(),{enabled:false,iceServers:[]});
});
