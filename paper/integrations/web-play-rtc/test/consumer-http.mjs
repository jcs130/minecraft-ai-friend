// Opt-in integration against the prepared, actual consumer. Synthetic ownership
// and negotiation only; no website login, Minecraft connection or production key.
import assert from 'node:assert/strict';
import http from 'node:http';import {once} from 'node:events';import {pathToFileURL} from 'node:url';
const candidate=process.env.QD_RTC_CANDIDATE;if(!candidate)throw Error('Set QD_RTC_CANDIDATE');
const {createToyServer}=await import(pathToFileURL(candidate+'/server.mjs'));
const {createGateway}=await import(pathToFileURL(candidate+'/src/gateway.mjs'));
let issued=0,negotiated=0;const checks=[];
const runtime={requiresOwner:true,browserConfiguration:()=>{issued++;return {iceServers:[],iceTransportPolicy:'relay'}},
 createPeerConnection:()=>({onDataChannel:{subscribe(){}},connectionStateChange:{subscribe(){}},close(){},
   async setRemoteDescription(){negotiated++;throw Error('Intentional fixture termination after validated HTTP routing')}})};
const key='a'.repeat(64),id='b'.repeat(43),origin='https://game.fixture.test';
const app=createToyServer({port:0,originKey:key,playRtcRuntime:runtime});
const row={id,rate:new Map(),touchedAt:Date.now(),csrfToken:'fixture-only-csrf',portal:{owner:{id:'owner-a'}}};
row.play={ownerId:'owner-a',authorized:true,connectionId:'fixture-connection',identityMatches:()=>true,
 status:()=>({sceneAvailable:true}),bridge:{snapshot:()=>({active:false})},controllers:new Map(),async close(){}};
app.sessions.set(id,row);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const gateway=createGateway({publicOrigin:origin,upstreamPort:app.server.address().port,originKey:key});
gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
function request(path,{method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{
 const h={host:'game.fixture.test','x-forwarded-proto':'https','x-forwarded-for':'192.0.2.23','x-qd-origin-proof':key,
  origin,'sec-fetch-site':'same-origin',cookie:'__Host-qdtoy_sid='+id,'x-csrf-token':row.csrfToken,'x-client-id':'browser-fixture',
  'content-type':'application/json',...headers};for(const k of Object.keys(h))if(h[k]===null)delete h[k];
 const text=body===undefined?undefined:JSON.stringify(body);if(text)h['content-length']=Buffer.byteLength(text);
 const q=http.request({host:'127.0.0.1',port:gateway.server.address().port,path,method,headers:h},res=>{
  let data='';res.on('data',c=>data+=c);res.on('end',()=>{let value;try{value=JSON.parse(data)}catch{}resolve({status:res.statusCode,value})});
 });q.on('error',reject);q.end(text);
})}
try{
 for(const path of ['/api/play/rtc/status','/api/play/rtc/offer','/api/play/rtc/receipt']){
  const r=await request(path,{method:path.endsWith('status')?'GET':'POST',body:{},headers:{cookie:null}});
  assert.equal(r.status,401);assert.equal(r.value.error.reason,'GATEWAY_STORAGE_REQUIRED');
 }checks.push('exact RTC paths reach cookie guard');
 assert.equal((await request('/api/play/rtc/status')).status,200);assert.equal(issued,1);checks.push('owner scoped capabilities');
 row.play.ownerId='owner-b';assert.equal((await request('/api/play/rtc/status')).status,409);assert.equal(issued,1);row.play.ownerId='owner-a';checks.push('cross owner denied');
 assert.equal((await request('/api/play/rtc/offer',{method:'POST',body:{},headers:{'x-csrf-token':null}})).status,403);
 assert.equal((await request('/api/play/rtc/status',{headers:{origin:'https://evil.invalid'}})).status,403);checks.push('CSRF and origin retained');
 assert.equal((await request('/api/play/rtc/admin')).status,404);checks.push('unknown RTC path denied');
 const offer={type:'offer',sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fixture:'+ 'x'.repeat(12000)+'\r\n'};
 const r=await request('/api/play/rtc/offer',{method:'POST',body:offer});assert.equal(r.status,503);assert.equal(negotiated,1);checks.push('12 KiB SDP reaches executor through both HTTP layers');
 const receipt=await request('/api/play/rtc/receipt',{method:'POST',body:{requestId:'unknown-request'}});
 assert.equal(receipt.status,200);assert.equal(receipt.value.status,'unknown');checks.push('unknown receipt read does not replay');
 assert.equal((await request('/api/play/control',{method:'POST',body:{data:'x'.repeat(9000)}})).status,413);checks.push('ordinary write budget retained');
 console.log(JSON.stringify({passed:true,checks,fixtureOnly:true,realOuterGateway:true,realApplication:true}));
}finally{await gateway.close();await app.close()}
