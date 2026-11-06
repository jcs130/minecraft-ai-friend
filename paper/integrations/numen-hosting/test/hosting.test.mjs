import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostingStore } from '../src/store.mjs';
import { HostedRoles } from '../src/hosting.mjs';
import { PROTOCOL } from '../src/protocol.mjs';
import { NumenHostedBody } from '../src/numen-body.mjs';

const role={ownerId:'website-owner',serverId:'test-world',roleUuid:'00000000-0000-0000-0000-000000000001',
  numenOwnerUuid:'00000000-0000-0000-0000-000000000002',name:'HostedTest'};
const frame={sequence:1,yaw:90,pitch:0,keys:['forward'],attack:false,use:false,slot:0};
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'numen-hosting-'));
  let store=new HostingStore(join(directory,'host.sqlite')),clock=10000;const calls=[];
  const response={protocol:PROTOCOL,roleUuid:role.roleUuid,serverId:role.serverId,name:role.name,bodyKind:'numen',fenced:true};
  const body={attach:async(...args)=>{calls.push(['attach',...args]);return response;},
    transition:async(r,args)=>{calls.push(['transition',args]);return{...response,...args};},
    input:async(r,args)=>{calls.push(['input',args]);return args;},
    call:async(r,args)=>{calls.push(['call',args]);return{id:args.id,state:'partial',message:'dispatched'};},
    result:async(r,id)=>({id,state:'completed',message:'original result'})};
  const harness={stop:async()=>({stopped:true}),prepare:async()=>{},start:async()=>{}};
  const hosting=new HostedRoles({store,body,harness,now:()=>clock});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return{hosting,body,harness,calls,response,store,setClock:n=>clock=n,
    restart(){store.close();store=new HostingStore(join(directory,'host.sqlite'));hosting.store=store;return store;}};
}
test('attaches exact UUID and switches brains without creating another body',async t=>{
  const f=fixture(t);await f.hosting.attach(role);await f.hosting.switch(role,'numen');await f.hosting.switch(role,'harness',{runtime:'configured-hub'});
  assert.equal(f.calls.filter(c=>c[0]==='attach').length,1);assert.equal(f.hosting.status(role).mode,'harness');
  assert.equal(f.calls[0][1].roleUuid,role.roleUuid);
});

test('returning to the original client first fences the body and confirms native save/logout',async t=>{
  const f=fixture(t);await f.hosting.attach(role);let releases=0;
  f.body.release=async(r,lease)=>{assert.equal(f.hosting.status(role).mode,'paused');releases++;return{...f.response,detached:true};};
  const row=await f.hosting.release(role);assert.equal(row.state,'detached');
  await f.hosting.release(role);assert.equal(releases,1);await f.hosting.attach(role);assert.equal(f.hosting.status(role).state,'ready');
});

test('an unconfirmed native logout remains a recovery state rather than a reported success',async t=>{
  const f=fixture(t);await f.hosting.attach(role);f.body.release=async()=>({...f.response,detached:false});
  await assert.rejects(f.hosting.release(role),{code:'RELEASE_UNKNOWN'});assert.equal(f.hosting.status(role).state,'recovery_required');
});
test('same name cannot acquire another UUID; ownership cannot be overwritten',async t=>{
  const f=fixture(t);await f.hosting.attach(role);
  await assert.rejects(f.hosting.attach({...role,roleUuid:'00000000-0000-0000-0000-000000000003'}),{code:'IDENTITY_CONFLICT'});
  assert.throws(()=>f.hosting.status({...role,ownerId:'other-owner'}),{code:'ROLE_NOT_BOUND'});
  await assert.rejects(f.hosting.attach({...role,ownerId:'other-owner'}),{code:'IDENTITY_CONFLICT'});
});
test('mismatched game identity blocks activation',async t=>{
  const f=fixture(t);f.body.attach=async()=>({...f.response,roleUuid:role.numenOwnerUuid});
  await assert.rejects(f.hosting.attach(role),{code:'BODY_IDENTITY_MISMATCH'});
  assert.equal(f.hosting.status(role).state,'recovery_required');
});
test('no handoff when the old body cancellation is not confirmed',async t=>{
  const f=fixture(t);await f.hosting.attach(role);let starts=0;f.harness.start=async()=>starts++;
  f.body.transition=async()=>({...f.response,fenced:false});
  await assert.rejects(f.hosting.switch(role,'harness',{runtime:'configured-hub'}),{code:'CANCEL_UNKNOWN'});
  assert.equal(starts,0);assert.equal(f.hosting.status(role).state,'recovery_required');
});
test('concurrent mode requests do not produce two drivers',async t=>{
  const f=fixture(t);await f.hosting.attach(role);let done;
  f.harness.stop=()=>new Promise(r=>done=r);
  const first=f.hosting.switch(role,'numen');await new Promise(r=>setImmediate(r));
  await assert.rejects(f.hosting.switch(role,'manual',{controllerId:'browser-one'}),{code:'TRANSITION_BUSY'});
  done({stopped:true});await first;
});
test('manual takeover invalidates old model epoch and other browsers',async t=>{
  const f=fixture(t);await f.hosting.attach(role);const old=await f.hosting.switch(role,'harness',{runtime:'configured-hub'});
  const next=await f.hosting.switch(role,'manual',{controllerId:'browser-one'});
  await assert.rejects(f.hosting.call(role,{id:'old-decision',epoch:old.epoch,tool:'say',args:{text:'late'}}),{code:'CONTROL_CHANGED'});
  await assert.rejects(f.hosting.input(role,'browser-two',next.epoch,frame),{code:'CONTROL_EXPIRED'});
  assert.equal((await f.hosting.input(role,'browser-one',next.epoch,frame)).sequence,1);
  await assert.rejects(f.hosting.input(role,'browser-one',next.epoch,frame),{code:'STALE_INPUT'});
});
test('manual timeout pauses; old keys never replay on heartbeat return',async t=>{
  const f=fixture(t);await f.hosting.attach(role);const next=await f.hosting.switch(role,'manual',{controllerId:'browser-one'});
  await f.hosting.input(role,'browser-one',next.epoch,frame);f.setClock(14000);await f.hosting.expire();
  assert.equal(f.hosting.status(role).mode,'paused');
  await assert.rejects(f.hosting.input(role,'browser-one',next.epoch,{...frame,sequence:2}),{code:'CONTROL_EXPIRED'});
});
test('unknown dispatch survives process restart and blocks new actions until readback',async t=>{
  const f=fixture(t);await f.hosting.attach(role);const started=await f.hosting.switch(role,'harness',{runtime:'configured-hub'});
  f.body.call=async()=>{throw Error('connection lost after dispatch');};
  const req={id:'stable-action',epoch:started.epoch,tool:'lua',args:{code:'return numen.task.status()'}};
  assert.equal((await f.hosting.call(role,req)).state,'unknown');f.restart();
  assert.equal(f.hosting.status(role).state,'recovery_required');
  assert.equal((await f.hosting.call(role,req)).state,'unknown');
  await assert.rejects(f.hosting.switch(role,'numen'),{code:'ACTION_UNRESOLVED'});
  assert.equal((await f.hosting.reconcile(role,req.id)).state,'completed');
  await f.hosting.switch(role,'numen');
});
test('stable request ID gives original receipt and rejects changed arguments',async t=>{
  const f=fixture(t);await f.hosting.attach(role);const state=await f.hosting.switch(role,'harness',{runtime:'configured-hub'});
  const req={id:'one-action',epoch:state.epoch,tool:'say',args:{text:'hi'}};
  await f.hosting.call(role,req);await f.hosting.call(role,req);
  assert.equal(f.calls.filter(c=>c[0]==='call').length,1);
  await assert.rejects(f.hosting.call(role,{...req,args:{text:'different'}}),{code:'REQUEST_CONFLICT'});
});
test('service refuses to substitute unextended Numen summon or Mineflayer',async()=>{
  let calls=0;const body=new NumenHostedBody({sessionFor:async()=>({listTools:async()=>({tools:[{name:'create_companion'}]}),callTool:async()=>calls++})});
  await assert.rejects(body.attach(role,{epoch:1}),{code:'NUMEN_HOSTING_NOT_INSTALLED'});assert.equal(calls,0);
});
test('partial server hosting capability cannot pass readiness',async()=>{
  const body=new NumenHostedBody({sessionFor:async()=>({listTools:async()=>({tools:[{name:'hosted_body'}]}),
    callTool:async()=>({structuredContent:{protocol:PROTOCOL,stableIdentity:true}})})});
  await assert.rejects(body.attach(role,{epoch:1}),{code:'NUMEN_HOSTING_INCOMPATIBLE'});
});

test('native loop cannot be selected without an available native model',async t=>{
  const f=fixture(t);await f.hosting.attach(role);const before=f.hosting.status(role);
  const requests=[];
  const native=new NumenHostedBody({sessionFor:async()=>({listTools:async()=>({tools:[{name:'hosted_body'}]}),
    callTool:async request=>{requests.push(request.arguments.op);return{structuredContent:{protocol:PROTOCOL,
      stableIdentity:true,serverFence:true,inputTimeout:true,persistedReceipts:true,modes:['paused','numen','harness','manual'],nativeModelReady:false}};}})});
  f.body.prepare=(r,mode)=>native.prepare(r,mode);
  await assert.rejects(f.hosting.switch(role,'numen'),{code:'NUMEN_MODEL_UNAVAILABLE'});
  assert.deepEqual(f.hosting.status(role),before);assert.ok(requests.every(op=>op==='capabilities'));
  assert.equal(f.calls.filter(call=>call[0]==='transition').length,0);await native.close();
});
test('second service cannot open or reset the active store',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'numen-hosting-lock-')),path=join(directory,'host.sqlite');
  const first=new HostingStore(path);t.after(()=>{first.close();rmSync(directory,{recursive:true,force:true});});
  first.bind(role);const row=first.transition('test-world/'+role.roleUuid,'numen','ready');
  assert.throws(()=>new HostingStore(path),{code:'SERVICE_ALREADY_RUNNING'});
  assert.equal(first.get(row.id).epoch,row.epoch);assert.equal(first.get(row.id).mode,'numen');
});
test('late action receipts remain queryable after manual takeover',async t=>{
  const f=fixture(t);await f.hosting.attach(role);const state=await f.hosting.switch(role,'harness',{runtime:'configured-hub'});
  let resolve;f.body.call=()=>new Promise(r=>resolve=r);
  const action=f.hosting.call(role,{id:'pending-action',epoch:state.epoch,tool:'lua',args:{code:'return 1'}});
  await f.hosting.switch(role,'manual',{controllerId:'browser-one'});
  resolve({id:'pending-action',state:'cancelled',message:'original stopped'});assert.equal((await action).state,'cancelled');
  assert.equal(f.hosting.status(role).mode,'manual');
});
