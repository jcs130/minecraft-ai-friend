import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayRtcSession,PlayReceiptBook,PLAY_RTC as P} from '../src/play-rtc.mjs';
function fixture(){let time=0,auth=true,stops=0;const callbacks=[],calls=[],sent=[],terminal=[];
 const book=new PlayReceiptBook({now:()=>time});
 const session=createPlayRtcSession({clientId:'browser-123',receipts:book,peer:{close(){}},now:()=>time,
  authorize:()=>auth,stop:()=>stops++,setInterval:f=>(callbacks.push(f),f),clearInterval(){},
  execute:async(p,c,done)=>{calls.push(p);terminal.push(done);return p.type==='acquire'?{ok:true,active:true,epoch:'lease-1',status:'active'}:
    p.type==='secondary'?{ok:true,active:true,epoch:'lease-1',status:'sent'}:{ok:true,active:true,epoch:'lease-1',status:'applied'}}});
 function channel(label){return{label,protocol:P.protocol,ordered:label!==P.input,maxRetransmits:label===P.input?0:null,maxPacketLifeTime:null,bufferedAmount:0,readyState:'open',send:s=>sent.push(JSON.parse(s)),close(){}}}
 session.attach(channel(P.reliable));session.attach(channel(P.input));
 const send=(m,label=P.reliable)=>session.receive(label,JSON.stringify({schemaVersion:1,...m}));
 const action=(type='acquire',n=1)=>({kind:'action',requestId:'request-'+n,sequence:n,generation:n,packet:{type,epoch:n===1?null:'lease-1'}});
 return{session,book,calls,sent,terminal,send,action,channel,callbacks,setTime:t=>time=t,revoke:()=>auth=false,stops:()=>stops};
}
test('separate ordered commands and lossy input preserve authoritative sequence and one body',async()=>{
 const f=fixture();await f.send(f.action());const token=f.sent.find(m=>m.kind==='clock').token;
 await f.send({kind:'motion',token,epoch:'lease-1',sequence:100,generation:1,input:{forward:1}},P.input);
 await f.send(f.action('hotbar',2));assert.deepEqual(f.calls.map(p=>p.sequence),[1,2,3]);
 assert.deepEqual(f.calls.map(p=>p.type),['acquire','motion','hotbar']);f.session.close();
});
test('expired, out-of-order, wrong-epoch and pre-stop input is never applied',async()=>{
 const f=fixture();await f.send(f.action());const token=f.sent.find(m=>m.kind==='clock').token;
 const m={kind:'motion',token,epoch:'lease-1',sequence:3,generation:1,input:{forward:1}};
 await f.send(m,P.input);await f.send(m,P.input);await f.send({...m,sequence:4,epoch:'other'},P.input);
 await f.send(f.action('stop',2));await f.send({...m,sequence:5},P.input);
 f.setTime(351);await f.send({...m,sequence:6,generation:2},P.input);
 assert.deepEqual(f.calls.map(p=>p.type),['acquire','motion','stop']);f.session.close();
});
test('duplicate use returns existing receipt, conflicting ID never executes, terminal receipt survives disconnect',async()=>{
 const f=fixture();await f.send(f.action());const m=f.action('secondary',2);await f.send(m);await f.send(m);
 assert.equal(f.calls.length,2);assert.equal(f.book.get('browser-123','request-2').status,'sent');
 f.terminal[1]({ok:true,status:'used',completed:true});await f.send({...m,packet:{type:'inventory'}});
 assert.equal(f.sent.at(-1).reason,'REQUEST_ID_CONFLICT');f.session.close();
 assert.equal(f.book.get('browser-123','request-2').status,'used');assert.equal(f.calls.length,2);
 assert.equal(f.book.get('browser-123','not-found').status,'unknown');
});
test('authorization revocation synchronously stops, closes and blocks queued input',async()=>{
 const f=fixture();await f.send(f.action());f.revoke();f.callbacks[0]();
 await f.send(f.action('secondary',2));assert.equal(f.stops(),1);assert.equal(f.calls.length,1);assert.equal(f.session.status().closed,true);
});
test('wrong reliability, duplicate channels, oversized and malformed requests fail closed',async()=>{
 for(const bad of ['policy','duplicate','oversized','json']){const f=fixture();
  if(bad==='policy')f.session.attach({...f.channel(P.world),ordered:false});
  if(bad==='duplicate')f.session.attach(f.channel(P.input));
  if(bad==='oversized')await f.session.receive(P.reliable,'x'.repeat(16385));
  if(bad==='json')await f.session.receive(P.reliable,'{');
  assert.equal(f.session.status().closed,true,bad);assert.equal(f.calls.length,0);
 }
});
test('unknown execution never claims completion and is not retried',async()=>{
 const f=fixture();await f.send(f.action());await f.send(f.action('secondary',2));f.session.close();
 const receipt=f.book.get('browser-123','request-2');assert.equal(receipt.completed,false);assert.equal(receipt.execution,'accepted');
 assert.equal(f.calls.length,2);
});
test('request ledger is bounded, pending actions are not evicted to permit replay',()=>{
 const b=new PlayReceiptBook({now:()=>0});for(let i=0;i<512;i++)assert.ok(b.reserve('client',String(i),{}).row);
 assert.equal(b.reserve('client','overflow',{}).full,true);assert.equal(b.rows.size,512);
});
test('client inactivity deadline starts after handshake, not during ICE gathering',()=>{
 let time=0,tick;const sent=[];
 const s=createPlayRtcSession({clientId:'browser-123',peer:{close(){}},authorize:()=>true,execute:async()=>{},stop(){},
  now:()=>time,setInterval:f=>(tick=f,f),clearInterval(){}});
 time=6000;tick();assert.equal(s.status().closed,false);
 s.attach({label:P.reliable,protocol:P.protocol,ordered:true,maxRetransmits:null,maxPacketLifeTime:null,
  readyState:'open',bufferedAmount:0,send:v=>sent.push(JSON.parse(v)),close(){}});
 assert.equal(s.status().closed,false);assert.equal(sent[0].kind,'clock');time=11001;tick();assert.equal(s.status().closed,true);
});
test('large successful inventory receipts retain truth while details use safe query',async()=>{
 const f=fixture();await f.send(f.action());await f.send(f.action('secondary',2));
 f.terminal[1]({ok:true,status:'confirmed',completed:true,inventory:'x'.repeat(20000)});
 const sent=f.sent.at(-1);assert.equal(sent.status,'confirmed');assert.equal(sent.detailsIncluded,false);assert.equal(sent.nextSafeRead,'query_receipt');
 assert.equal(f.book.get('browser-123','request-2').inventory.length,20000);assert.equal(f.session.status().closed,false);f.session.close();
});
