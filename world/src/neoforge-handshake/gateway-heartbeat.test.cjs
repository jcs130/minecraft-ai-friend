'use strict'
const test=require('node:test'),assert=require('node:assert/strict');const {GatewayHeartbeat,nonceKey}=require('./gateway-heartbeat.cjs')
test('frontend uses its own nonce and RTT while backend acknowledgements remain separate',()=>{
  let at=0,callback,cleared=0;const writes=[],expired=[];const h=new GatewayHeartbeat({send:p=>writes.push(p),expire:r=>expired.push(r),now:()=>at,nonce:()=>123,schedule:fn=>{callback=fn;return 1},unschedule:()=>cleared++})
  h.start();h.start();assert.equal(writes.length,1);h.backendAck();at=40;h.acknowledge([0,123]);assert.equal(h.stats.rttMs,40);assert.equal(h.stats.backendAcked,1);at=10000;callback();assert.equal(writes.length,2);assert.equal(expired.length,0);h.stop();assert.equal(cleared,1)
})
test('unanswered clients expire at the deadline, traffic cannot reset it, and stale ACKs fail',()=>{
  let at=0,callback;const expired=[];const h=new GatewayHeartbeat({send:()=>{},expire:r=>expired.push(r),now:()=>at,nonce:()=>44,schedule:f=>{callback=f;return 1},unschedule:()=>{}})
  h.start();assert.throws(()=>h.acknowledge(45),/UNEXPECTED_ACK/);at=59999;callback();assert.equal(expired.length,0);at=60000;callback();assert.equal(expired.length,1);assert.equal(h.timer,null);h.stop()
})
test('actual protocol long forms agree without precision loss',()=>{
  assert.equal(nonceKey([0,2147483646]),nonceKey(2147483646));assert.equal(nonceKey([-1,4294967295]),nonceKey(-1n));assert.throws(()=>nonceKey(NaN),/INVALID/)
})
test('the actual 1.21.1 packet codec preserves the generated nonce on the wire',()=>{
  const protocol=require('./component-protocol.cjs').createBedrockFrontendProtocol();let params
  const h=new GatewayHeartbeat({send:p=>{params=p},expire:()=>{},nonce:()=>123456789,schedule:()=>1,unschedule:()=>{}});h.start()
  const raw=protocol.createPacketBuffer('packet',{name:'keep_alive',params}),parsed=protocol.parsePacketBuffer('packet',raw)
  assert.equal(nonceKey(parsed.data.params.keepAliveId),'123456789');h.acknowledge(parsed.data.params.keepAliveId);assert.equal(h.stats.frontendAcked,1);h.stop()
})
