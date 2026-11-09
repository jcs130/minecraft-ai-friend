// Opt-in actual Chromium <-> werift ICE/DTLS/SCTP. Isolated actor adapter only;
// no production account, Minecraft world, game command or model invocation.
import http from 'node:http';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {loadPlayRtcRuntime} from '../src/play-rtc-runtime.mjs';
const required=n=>{if(!process.env[n])throw Error('Set '+n);return process.env[n]};
const candidate=required('QD_RTC_CANDIDATE');
const {createToyServer}=await import(pathToFileURL(candidate+'/server.mjs'));
const {createGateway}=await import(pathToFileURL(candidate+'/src/gateway.mjs'));
const {GameConnection}=await import(pathToFileURL(candidate+'/src/game.mjs'));
const {createViewerControlBridge}=await import(pathToFileURL(candidate+'/vendor/mc-visual-console/packages/modern-viewer/renderer-src/host/viewer-control.mjs'));
const Peer=createRequire(required('QD_RTC_WERIFT_PACKAGE'))('werift').RTCPeerConnection;
const puppeteer=createRequire(required('QD_RTC_BROWSER_PACKAGE'))('puppeteer-core');
const row={portal:{owner:{id:'fixture-owner'}},touchedAt:Date.now(),id:'f'.repeat(43),csrfToken:'fixture-only-csrf',rate:new Map()};
const role={id:'fixture-role',username:'FixtureActor',playerUuid:'00000000-0000-4000-8000-000000000001'};
const play=new GameConnection({runtime:{},session:row,role,ownerId:'fixture-owner',root:'',target:{}});row.play=play;
play.bot={username:role.username,_client:{uuid:role.playerUuid,state:'play'},entity:{id:1,position:{x:0,y:64,z:0},yaw:0,pitch:0}};
play.authorized=true;play.phase='ready';let stopped=0,uses=0,inventoryPending=false;const motions=[];
play.host={status:()=>({viewer:{available:true,state:'snapshot',loadedColumns:1}})};
play.bridge=createViewerControlBridge({adapter:{identity:()=>play.safeIdentity(),ready:()=>play.identityMatches(),capabilities:['motion','inventory'],
  stop:()=>stopped++,motion:input=>motions.push({at:Date.now(),inventoryPending,input}),
  action:async(type,value)=>{if(type==='inventory'){inventoryPending=true;await new Promise(r=>setTimeout(r,300));inventoryPending=false;uses++}return{ok:true,status:'confirmed',completed:true,scope:'fixture-only'}}},
  authorize:async()=>true,acquire:async()=>{},release:async()=>{}});
const runtime=process.env.QD_RTC_TURN_CONFIG?await loadPlayRtcRuntime(process.env.QD_RTC_TURN_CONFIG,{Peer}):{createPeerConnection:()=>new Peer({iceUseIpv4:true,iceUseIpv6:false,iceInterfaceAddresses:{udp4:'127.0.0.1'}})};
const proof='e'.repeat(64),publicOrigin='https://game.fixture.test';
const app=createToyServer({port:0,originKey:proof,playRtcRuntime:runtime});app.sessions.set(row.id,row);
app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const gateway=createGateway({publicOrigin,upstreamPort:app.server.address().port,originKey:proof});
gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
const clients=new Set();
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/events'){res.writeHead(200,{'content-type':'text/event-stream'});clients.add(res);res.on('close',()=>clients.delete(res));
   res.write('data: '+JSON.stringify({type:'identity',fixture:true})+'\n\n');res.write('data: '+JSON.stringify({type:'snapshot',fixture:true,blocks:[1,2,3]})+'\n\n');return;}
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Isolated play transport</title>');return}
  // This fixture stands in for the trusted TLS reverse proxy only. All HTTP
  // routes still cross the actual outer gateway and application. No real cookie.
  const routes={'/offer':'/api/play/rtc/offer','/receipt':'/api/play/rtc/receipt','/capabilities':'/api/play/rtc/status',
   '/play-rtc-client.mjs':'/play-rtc-client.mjs','/native-rtc-protocol.js':'/native-rtc-protocol.js'};
  if(!routes[req.url])throw Error('Fixture path denied');
  if(req.method==='POST'&&(req.headers.origin!==base||req.headers['x-fixture-csrf']!=='isolated-test'))throw Error('Fixture origin/CSRF required');
  const upstream=http.request({host:'127.0.0.1',port:gateway.server.address().port,path:routes[req.url],method:req.method,
   headers:{host:'game.fixture.test',origin:publicOrigin,'x-forwarded-proto':'https','x-forwarded-for':'192.0.2.31',
    'x-qd-origin-proof':proof,cookie:'__Host-qdtoy_sid='+row.id,'x-csrf-token':row.csrfToken,'x-client-id':'browser-fixture',
    'sec-fetch-site':'same-origin','content-type':'application/json'}},incoming=>{res.writeHead(incoming.statusCode,{'content-type':incoming.headers['content-type']??'text/plain'});incoming.pipe(res)});
  upstream.on('error',()=>{res.destroy()});req.pipe(upstream);
 }catch(e){res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:e.reason??e.message}))}
});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;play.host.url=base+'/';
const browser=await puppeteer.launch({executablePath:required('QD_RTC_BROWSER'),headless:true});let report={passed:false};
try{
 const page=await browser.newPage();await page.goto(base);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const connected=await page.evaluate(async()=>{
  const capabilities=await fetch('/capabilities').then(r=>r.json());
  const {createPlayRtcClient}=await import('/play-rtc-client.mjs');
  const post=(url,body)=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-fixture-csrf':'isolated-test'},body:JSON.stringify(body)}).then(r=>r.json());
  window.lost=[];window.events=[];
  window.peerStats=null;
  class RecordingPeer extends RTCPeerConnection{constructor(config){super(config);window.fixturePeer=this}}
  window.client=createPlayRtcClient({...capabilities,Peer:RecordingPeer,offer:v=>post('/offer',v),queryReceipt:requestId=>post('/receipt',{requestId}),onLost:r=>lost.push(r)});
  const ready=await client.connect();if(ready)client.subscribeWorld(m=>events.push(JSON.parse(m.data)),r=>lost.push(r));return ready;
 });if(!connected)report.diagnostics=await page.evaluate(()=>({status:client.status(),lost}));assert.equal(connected,true,'real browser channel connected');
 await page.waitForFunction(()=>events.some(e=>e.type==='snapshot'),{timeout:10000});
 const result=await page.evaluate(async()=>{
  const acquired=await client.action({type:'acquire',epoch:null});window.lease=acquired.epoch;
  const action=client.action({type:'inventory',epoch:lease,operation:'fixture'});
  await new Promise(r=>setTimeout(r,100));
  client.motion({epoch:lease,input:{forward:1,strafe:0,lookYaw:0,lookPitch:0}});
  const receipt=await action;
  window.receiptId=receipt.requestId;
  return {acquired,receipt,events,transport:client.status()};
 });assert.equal(result.acquired.active,true);assert.equal(uses,1);assert.equal(result.receipt.status,'confirmed');
 assert.ok(motions.some(m=>m.inventoryPending),'motion must not wait for pending inventory acknowledgement');
 const network=await page.evaluate(async()=>{
  const stats=await fixturePeer.getStats();const pair=[...stats.values()].find(s=>s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated);
  return pair?{localType:stats.get(pair.localCandidateId)?.candidateType,remoteType:stats.get(pair.remoteCandidateId)?.candidateType,roundTripSeconds:pair.currentRoundTripTime,bytesSent:pair.bytesSent,bytesReceived:pair.bytesReceived}:null;
 });
 if(process.env.QD_RTC_TURN_CONFIG){assert.equal(network?.localType,'relay');assert.equal(network?.remoteType,'relay');assert.ok(network.bytesSent>0&&network.bytesReceived>0)}
 const before=stopped;row.expired=true;
 await page.waitForFunction(()=>lost.length>0,{timeout:5000});assert.ok(stopped>before,'revocation stops original controller');
 row.expired=false;
 const after=await page.evaluate(()=>client.query(receiptId));assert.equal(after.status,'confirmed');assert.equal(uses,1);
 const fallback=await page.evaluate(async()=>{
  const {createPlayRtcClient}=await import('/play-rtc-client.mjs');let offers=0;
  const c=createPlayRtcClient({Peer:class{constructor(){throw Error('UDP not available fixture')}},offer:()=>offers++});
  return {connected:await c.connect(),offers,status:c.status()};
 });assert.equal(fallback.connected,false);assert.equal(fallback.offers,0);assert.equal(fallback.status.transport,'http');assert.equal(uses,1);
 report={passed:true,realOuterGateway:true,realApplication:true,network,realIceDtlsSctp:true,fixtureOnly:true,worldSnapshot:result.events.some(e=>e.type==='snapshot'),
   motionDuringPendingAction:motions.some(m=>m.inventoryPending),uses,revocationStopped:true,receiptAfterDisconnect:after.status,fallbackBeforeAction:true,errors};
 assert.equal(errors.length,0);
}catch(e){report.error=e.message;report.httpLayers='actual consumer gateway and application';throw e}finally{
 await browser.close();await gateway.close();app.sessions.delete(row.id);await app.close();await play.bridge.dispose();for(const c of clients)c.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));
 if(process.env.QD_RTC_REPORT)await fs.writeFile(process.env.QD_RTC_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
