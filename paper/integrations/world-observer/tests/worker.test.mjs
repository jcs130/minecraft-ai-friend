import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ObservationWorker, validateWorkerConfig, readBoundedJSON } from '../worker.mjs';
const uuid='11111111-1111-3111-8111-111111111111';
function fixture(){
 let now=100000,allowed=true,localAvailable=true,closes=0,publisherCloses=0,creates=0,after=0,cloudReads=0,localReads=0;
 const job={id:'a'.repeat(32),lease:randomUUID(),playerUuid:uuid,playerName:'ObservedPlayer',scope:'scene',publisherToken:'pub_'+'a'.repeat(43)};
 const prepared={attach(){creates++;return{url:'http://127.0.0.1:10101/',listen:async()=>{},close:async()=>{closes++;},ingest:row=>({after:++after,generation:row.generation}),host:{status:()=>({viewer:{loadedColumns:25,reason:null},identity:{confirmed:true}})}};}};
 const fetcher=async(url,options)=>{
  if(url.pathname.includes('world-view')){cloudReads++;return Response.json({jobs:allowed?[{...job,expiresAt:new Date(now+8000).toISOString()}]:[]});}
  localReads++;
  const target=JSON.parse(options.body).targets[0];
  return Response.json({schemaVersion:1,minecraftVersion:'1.21.1',targets:[{uuid,lease:target.lease,available:localAvailable,generation:'22222222-2222-3222-8222-222222222222'}]});
 };
 const worker=new ObservationWorker({config:{portalOrigin:'https://portal.example.test/',observerOrigin:'http://127.0.0.1:10001/',portalToken:'synthetic',observerKey:'synthetic'},
 prepared,registry:{},decodePacket:()=>{},simplifyNBT:x=>x,fetcher,now:()=>now,
 startPublisher:async()=>{let done;const promise=new Promise(resolve=>{done=resolve;});return{done:promise,close(){publisherCloses++;done();}};}});
 return{worker,counts:()=>({creates,closes,publisherCloses}),reads:()=>({cloudReads,localReads}),advance:(ms=3000)=>{now+=ms;},revoke:()=>{allowed=false;},offline:()=>{localAvailable=false;}};
}
test('same observation job reuses one host and publisher; revoked permission closes only observation resources',async()=>{
 const f=fixture();await f.worker.step();assert.equal(f.worker.sources.size,1);f.advance();await f.worker.step();assert.equal(f.counts().creates,1);
 f.revoke();f.advance();await f.worker.step();assert.equal(f.worker.sources.size,0);assert.deepEqual(f.counts(),{creates:1,closes:1,publisherCloses:1});await f.worker.close();
});
test('slow appearance preparation never holds up the actual world and publisher',async()=>{
 const f=fixture();let preparations=0;
 f.worker.appearanceSource={forPlayer(){preparations++;return new Promise(()=>{})},binding(){return null}};
 await f.worker.step();assert.equal(f.counts().creates,1);assert.equal(preparations,1);assert.equal(f.worker.status().sources.length,1);assert.equal(f.worker.status().readOnly,true);await f.worker.close();
});
test('a game-side offline receipt closes the old source without any replay or game reconnection',async()=>{
 const f=fixture();await f.worker.step();f.offline();f.advance(50);await f.worker.step();assert.equal(f.worker.sources.size,0);assert.equal(f.counts().closes,1);await f.worker.close();
});

test('20Hz local sampling reuses one source; HUD/terrain and cloud grants do not set pose cadence',async()=>{
 const f=fixture();
 for(let i=0;i<20;i++){await f.worker.step();f.advance(50);}
 assert.deepEqual(f.reads(),{cloudReads:1,localReads:20});assert.equal(f.counts().creates,1);
 await f.worker.step();await f.worker.step();assert.equal(f.reads().localReads,21,'same-time calls cannot flood the Paper thread');
 assert.equal(f.worker.status().sampling.intervalMs,50);await f.worker.close();
});

test('a slow cloud renewal never blocks an already authorized local pose sample',async()=>{
 const f=fixture();await f.worker.step();const fetcher=f.worker.fetcher;let release;
 f.worker.fetcher=async(url,options)=>{
  if(url.pathname.includes('world-view'))await new Promise(resolve=>{release=resolve;});
  return fetcher(url,options);
 };
 f.advance();let completed=false;const pending=f.worker.step().then(()=>{completed=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(completed,true);assert.equal(f.reads().localReads,2);assert.ok(f.worker.authorityInFlight);
 f.revoke();release();await f.worker.authorityInFlight;await pending;
 assert.equal(f.worker.sources.size,0);await f.worker.close();
});

test('cloud outage still expires an active grant while renewal is pending',async()=>{
 const f=fixture();await f.worker.step();const fetcher=f.worker.fetcher;let release;
 f.worker.fetcher=async(url,options)=>{
  if(url.pathname.includes('world-view'))await new Promise(resolve=>{release=resolve;});
  return fetcher(url,options);
 };
 f.advance(3000);await f.worker.step();const reads=f.reads().localReads;
 f.advance(5100);await f.worker.step();assert.equal(f.worker.sources.size,0);assert.equal(f.reads().localReads,reads);
 await f.worker.close();release();await f.worker.authorityInFlight;
 assert.equal(f.worker.sources.size,0,'a late cloud response cannot resurrect a closed observer');
});

test('publisher handshake is single-flight and cannot stall motion or survive source retirement',async()=>{
 const f=fixture();let release,signal,lateCloses=0;
 f.worker.startPublisher=async options=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});};
 await f.worker.step();const pending=[...f.worker.sources.values()][0].publisherPending;
 for(let i=0;i<4;i++){f.advance(50);await f.worker.step();}
 assert.equal(f.reads().localReads,5);assert.ok(signal&&!signal.aborted);
 await f.worker.close();assert.equal(signal.aborted,true);
 release({done:new Promise(()=>{}),close(){lateCloses++;}});await pending;assert.equal(lateCloses,1);
});

test('concurrent step callers share an in-flight local request',async()=>{
 const f=fixture();await f.worker.step();const fetcher=f.worker.fetcher;let release,calls=0;
 f.worker.fetcher=async(url,options)=>{
  if(!url.pathname.includes('world-view')){calls++;await new Promise(resolve=>{release=resolve;});}
  return fetcher(url,options);
 };
 f.advance(50);const a=f.worker.step(),b=f.worker.step();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);release();await Promise.all([a,b]);await f.worker.close();
});
test('revoked/stale cloud authority cannot leave a local live publisher running',async()=>{
 const f=fixture();await f.worker.step();f.worker.fetcher=async()=>{throw Error('isolated outage');};
 f.advance();f.advance();f.advance();await f.worker.step();assert.equal(f.worker.sources.size,0);await f.worker.close();
});
test('shutdown during an in-flight cloud poll cannot create a late host',async()=>{
 const f=fixture();let release,entered;const ready=new Promise(resolve=>{entered=resolve;});
 f.worker.fetcher=async()=>{entered();await new Promise(resolve=>{release=resolve;});return Response.json({jobs:[]});};
 const pending=f.worker.step();await ready;await f.worker.close();release();await pending;
 assert.equal(f.worker.sources.size,0);assert.equal(f.counts().creates,0);
});
test('HTTP failures and inflated response bodies are bounded',async()=>{
 await assert.rejects(readBoundedJSON(new Response('bad',{status:503}),100),/HTTP_503/);
 await assert.rejects(readBoundedJSON(new Response('x'.repeat(200)),100),/RESPONSE_LIMIT/);
});
test('worker cannot follow remote source URLs or URLs containing credentials',()=>{
 const base={rendererRoot:path.resolve('test/renderer'),assetDirectory:path.resolve('test/assets'),observerKeyFile:path.resolve('test/local.key'),portalTokenFile:path.resolve('test/portal.key'),observerOrigin:'http://127.0.0.1:10001/',portalOrigin:'https://portal.example.test/'};
 assert.equal(validateWorkerConfig(base).observerOrigin,'http://127.0.0.1:10001');
 for(const observerOrigin of ['http://192.168.1.1/','https://127.0.0.1/','http://localhost/','http://user:pass@127.0.0.1/','http://127.0.0.1/a'])assert.throws(()=>validateWorkerConfig({...base,observerOrigin}));
 assert.throws(()=>validateWorkerConfig({...base,portalOrigin:'http://public.example.test/'}));
});
