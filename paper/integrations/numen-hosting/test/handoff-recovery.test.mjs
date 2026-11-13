import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { HostingStore } from '../src/store.mjs';
import { HostedRoles } from '../src/hosting.mjs';
import { HostedProfiles } from '../src/profiles.mjs';
import { NumenHostedBody } from '../src/numen-body.mjs';
import { nativeByokAdapter } from '../src/native-model.mjs';
import { hubByokAdapter } from '../src/hub-model.mjs';
import { hostedBootstrapClient } from '../src/bootstrap-client.mjs';
import { PROTOCOL, keyOf } from '../src/protocol.mjs';

// Synthetic identities, credentials and body/Hub adapters only. These tests do
// not log in to Minecraft or call a model provider.
const role = { ownerId:'audit-owner', serverId:'audit-world', name:'AuditHosted',
  roleUuid:'00000000-0000-4000-a000-000000000001', numenOwnerUuid:'00000000-0000-4000-a000-000000000099' };
const catalogue = { providers:[{ id:'audit', label:'Synthetic', models:[{ id:'audit-model',label:'Synthetic model' }]}],
  harnesses:[{ id:'native',label:'Numen',mode:'numen',providers:['audit'] },{ id:'opencode',label:'Hub',mode:'harness',providers:['audit'] }] };

function fixture(t) {
  const store = new HostingStore(':memory:');
  t.after(()=>store.close());
  const events = [], control = { modelStop:true, harnessStop:true, fence:true, bindFailure:false };
  let online = false, releases = 0, bindings = 0;
  const snapshot = lease => ({protocol:PROTOCOL,bodyKind:'numen',roleUuid:role.roleUuid,serverId:role.serverId,
    name:role.name,fenced:control.fence,mode:lease.mode??'paused',epoch:lease.epoch});
  const body = {
    async attach(r,lease) { online=true;events.push('attach');return snapshot(lease); },
    async transition(r,lease) { events.push('body:'+lease.mode);return snapshot(lease); },
    async prepare(r,mode) { events.push('prepare:'+mode); },
    async release(r,lease) { releases++;online=false;events.push('save-and-logout');return {...snapshot(lease),detached:true}; },
    async call(r,request) { events.push('action:'+request.id);return {id:request.id,state:'completed'}; },
    async result(r,id) { return {id,state:'completed'}; }
  };
  const adapter = { isolatedByok:true,
    async bind({role:r,profile,apiKey}) {
      bindings++;events.push('model-bind');assert.equal(apiKey,'synthetic-audit-key');
      if(control.bindFailure)throw Error('synthetic-audit-key must never be exposed');
      return {isolatedByok:true,ownerId:r.ownerId,model:profile.model,
        async close(){events.push('model-stop');return {stopped:control.modelStop};}};
    },
    async abort(){events.push('model-abort');return {stopped:control.modelStop};}
  };
  const profiles = new HostedProfiles({store,key:randomBytes(32),catalogue,adapters:{native:adapter,opencode:adapter}});
  const harness = { async stop(){events.push('harness-stop');return {stopped:control.harnessStop};},
    async prepare(){events.push('harness-prepare');},async start(){events.push('harness-start');} };
  const hosting = new HostedRoles({store,body,profiles,harness});
  const save = (harness='native',revision=0)=>hosting.saveProfile(role,{revision,harness,provider:'audit',model:'audit-model',goal:'Observe only',apiKey:'synthetic-audit-key'});
  return {store,hosting,body,profiles,harness,events,control,save,snapshot,get online(){return online;},get releases(){return releases;},get bindings(){return bindings;}};
}

test('handoff stops the old body, worker and model before binding and granting a new driver',async t=>{
  const f=fixture(t);await f.save();await f.hosting.attach(role);await f.hosting.switch(role,'numen');
  await f.hosting.switch(role,'paused');await f.save('opencode',1);f.events.length=0;
  await f.hosting.switch(role,'harness',{runtime:'opencode'});
  const index=event=>f.events.indexOf(event);
  for(const [before,after] of [['body:paused','harness-stop'],['harness-stop','model-abort'],['model-abort','model-bind'],
    ['model-bind','prepare:harness'],['prepare:harness','harness-prepare'],['harness-prepare','body:harness'],['body:harness','harness-start']]) {
    assert.ok(index(before)>=0&&index(after)>index(before),before+' must precede '+after);
  }
  assert.equal(f.hosting.status(role).mode,'harness');assert.equal(f.bindings,2);
});

test('pause revokes the active model but keeps the same online body and encrypted profile',async t=>{
  const f=fixture(t);await f.save();await f.hosting.attach(role);await f.hosting.switch(role,'numen');
  await f.hosting.switch(role,'paused');
  assert.equal(f.online,true);assert.equal(f.releases,0);assert.equal(f.profiles.active.size,0);
  assert.equal(f.profiles.read(role).keyConfigured,true);
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM hosted_profiles').all()).includes('synthetic-audit-key'));
});

test('exit waits for body fence, worker stop and model revocation before save/logout',async t=>{
  const f=fixture(t);await f.save();await f.hosting.attach(role);await f.hosting.switch(role,'numen');f.events.length=0;
  assert.equal((await f.hosting.release(role)).state,'detached');
  assert.deepEqual(f.events,['body:paused','harness-stop','model-stop','prepare:paused','save-and-logout']);
  assert.equal(f.online,false);assert.equal(f.profiles.active.size,0);
  await f.hosting.release(role);assert.equal(f.releases,1);
});

for(const step of ['fence','harnessStop','modelStop'])test(`exit cannot save/logout while ${step} is unconfirmed`,async t=>{
  const f=fixture(t);await f.save();await f.hosting.attach(role);await f.hosting.switch(role,'numen');
  f.control[step]=false;
  await assert.rejects(f.hosting.release(role));
  assert.equal(f.releases,0);assert.equal(f.online,true);assert.equal(f.hosting.status(role).state,'recovery_required');
  assert.equal(f.hosting.status(role).mode,'paused');
});

test('failed model binding stays paused, redacts errors and requires abort before another bind',async t=>{
  const f=fixture(t);await f.save();await f.hosting.attach(role);f.control.bindFailure=true;
  await assert.rejects(f.hosting.switch(role,'numen'),e=>e.code==='MODEL_BINDING_UNCONFIRMED'&&!String(e).includes('synthetic-audit-key'));
  assert.equal(f.hosting.status(role).state,'recovery_required');
  assert.ok(!f.events.includes('body:numen'));assert.ok(f.events.includes('model-abort'));
  f.control.bindFailure=false;await f.hosting.switch(role,'numen');
  assert.equal(f.hosting.status(role).mode,'numen');assert.equal(f.bindings,2);
});

test('unconfirmed model revocation retains its lease and blocks replacement and release',async t=>{
  const f=fixture(t);await f.save();await f.hosting.attach(role);await f.hosting.switch(role,'numen');
  f.control.modelStop=false;await assert.rejects(f.hosting.switch(role,'paused'),{code:'MODEL_STOP_UNCONFIRMED'});
  assert.equal(f.profiles.active.size,1);assert.equal(f.bindings,1);
  await assert.rejects(f.hosting.release(role),{code:'MODEL_STOP_UNCONFIRMED'});assert.equal(f.releases,0);
  await assert.rejects(f.save('opencode',1),{code:'HOSTING_MUST_PAUSE'});
  f.control.modelStop=true;await f.hosting.release(role);assert.equal(f.releases,1);
});

test('unknown original action blocks exit and both model modes until original result readback',async t=>{
  const f=fixture(t);await f.save('opencode');await f.hosting.attach(role);
  const active=await f.hosting.switch(role,'harness',{runtime:'opencode'});
  let calls=0;f.body.call=async()=>{calls++;throw Error('response lost after dispatch');};
  const request={id:'audit-original-action',epoch:active.epoch,tool:'say',args:{text:'synthetic'}};
  assert.equal((await f.hosting.call(role,request)).state,'unknown');
  assert.equal((await f.hosting.call(role,request)).state,'unknown');assert.equal(calls,1);
  for(const mode of ['numen','harness'])await assert.rejects(f.hosting.switch(role,mode,{runtime:'opencode'}),{code:'ACTION_UNRESOLVED'});
  await assert.rejects(f.hosting.release(role),{code:'ACTION_UNRESOLVED'});assert.equal(f.releases,0);
  assert.equal((await f.hosting.reconcile(role,request.id)).state,'completed');
  await f.hosting.release(role);assert.equal(f.releases,1);assert.equal(calls,1);
});

test('a killed service preserves its pending request as unknown and requires explicit recovery',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'hosting-crash-audit-')),database=join(directory,'hosting.sqlite');
  const source=`import {HostingStore} from ${JSON.stringify(new URL('../src/store.mjs',import.meta.url).href)};
    const store=new HostingStore(process.argv[1]);const role=JSON.parse(process.argv[2]);
    const row=store.bind(role);const active=store.transition(row.id,'harness','ready');
    store.reserve(row.id,'crash-original-request','fixed-signature',active.epoch);
    process.stdout.write('committed\\n');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',source,database,JSON.stringify(role)],{stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}await rm(directory,{recursive:true,force:true});});
  const committed=await new Promise((resolve,reject)=>{
    child.once('error',reject);child.once('exit',code=>reject(Error('child exited before commit: '+code)));
    child.stdout.once('data',bytes=>resolve(bytes.toString()));
  });assert.match(committed,/committed/);
  const exit=once(child,'exit');child.kill('SIGKILL');await exit;
  const recovered=new HostingStore(database);
  try {
    const row=recovered.get(keyOf(role));assert.equal(row.mode,'paused');assert.equal(row.state,'recovery_required');assert.equal(row.problem,'SERVICE_RESTART');
    const action=recovered.request(row.id,'crash-original-request');assert.equal(action.state,'unknown');assert.equal(action.signature,'fixed-signature');
  } finally {recovered.close();}
});

test('a failed scoped MCP call is not replayed when the next explicit query reconnects',async()=>{
  let sessions=0,closed=0;const operations=[];
  const body=new NumenHostedBody({sessionFor:async()=>{
    sessions++;return {async listTools(){return {tools:[{name:'hosted_body'}]};},async close(){closed++;},
      async callTool({arguments:a}){
        operations.push(a.op);
        if(a.op==='capabilities')return {structuredContent:{protocol:PROTOCOL,stableIdentity:true,serverFence:true,inputTimeout:true,persistedReceipts:true,modes:['paused','numen','harness','manual']}};
        if(a.op==='call')throw Error('restart invalidated token');
        return {structuredContent:{id:a.id,state:'completed'}};
      }};
  }});
  try {
    await assert.rejects(body.call(role,{id:'audit-original-call'}));
    assert.equal(closed,1);assert.equal((await body.result(role,'audit-original-call')).state,'completed');
    assert.equal(sessions,2);assert.deepEqual(operations,['capabilities','call','capabilities','result']);
  } finally {await body.close();}
});

test('a tool rejection keeps the authenticated session for the next explicit read',async()=>{
  let sessions=0;const operations=[];
  const body=new NumenHostedBody({sessionFor:async()=>{
    sessions++;
    return {
      listTools:async()=>({tools:[{name:'hosted_body'}]}),
      async callTool({arguments:args}){
        operations.push(args.op);
        if(args.op==='capabilities')return {structuredContent:{protocol:PROTOCOL,stableIdentity:true,serverFence:true,inputTimeout:true,persistedReceipts:true,modes:['paused','numen','harness','manual']}};
        if(args.op==='input')return {isError:true,content:[{type:'text',text:'stale input'}]};
        return {structuredContent:{roleUuid:role.roleUuid,ready:true}};
      }
    };
  }});
  try {
    await assert.rejects(body.input(role,{sequence:1}),{code:'NUMEN_RECEIPT_INVALID'});
    assert.equal((await body.observe(role)).roleUuid,role.roleUuid);
    assert.equal(sessions,1);
    assert.deepEqual(operations,['capabilities','input','observe']);
  } finally {await body.close();}
});

test('refused offline admission prevents opening a body control session',async t=>{
  const f=fixture(t);let admissions=0,sessions=0;
  const bootstrap=hostedBootstrapClient({endpoint:'http://127.0.0.1:19085/v1/hosted-role',controlKey:randomBytes(32),
    async fetcher(){admissions++;return new Response(JSON.stringify({error:'HOSTED_ROLE_NOT_READY'}),{status:409});}});
  const native=new NumenHostedBody({admitRole:bootstrap.admit,sessionFor:async()=>{sessions++;throw Error('control session must not open');}});
  f.hosting.body=native;
  await assert.rejects(f.hosting.attach(role),{code:'HOSTED_ROLE_NOT_READY'});
  assert.equal(admissions,1);assert.equal(sessions,0);assert.equal(f.hosting.status(role).state,'recovery_required');
  // The refusal is injected. Actual PlayerList admission remains a GameTest /
  // formal-server acceptance item, not something this transport test proves.
});

test('an admission timeout is reported unknown with no automatic reprovisioning',async()=>{
  let admissions=0;
  const bootstrap=hostedBootstrapClient({endpoint:'http://127.0.0.1:19085/v1/hosted-role',controlKey:randomBytes(32),
    async fetcher(){admissions++;throw Error('response lost after admission');}});
  await assert.rejects(bootstrap.admit(role),{code:'HOSTED_ADMISSION_UNKNOWN'});assert.equal(admissions,1);
});

test('a different admitted UUID is rejected before body control starts',async()=>{
  let sessions=0;
  const bootstrap=hostedBootstrapClient({endpoint:'http://127.0.0.1:19085/v1/hosted-role',controlKey:randomBytes(32),
    async fetcher(){return new Response(JSON.stringify({roleUuid:role.numenOwnerUuid}));}});
  const body=new NumenHostedBody({admitRole:bootstrap.admit,sessionFor:async()=>{sessions++;throw Error('wrong body must not connect');}});
  await assert.rejects(body.attach(role,{epoch:1}),{code:'BODY_IDENTITY_MISMATCH'});assert.equal(sessions,0);
});

test('a lost native model-bind response is revoked by the persisted original binding ID',async t=>{
  const store=new HostingStore(':memory:');t.after(()=>store.close());const messages=[];
  const body={async rpc(r,op,envelope){
    if(op==='capabilities')return {isolatedModels:true};
    const request=JSON.parse(Buffer.from(envelope.payload,'base64url'));messages.push({op,id:request.bindingId});
    if(op==='model_bind')throw Error('response lost');return {stopped:true,bindingId:request.bindingId};
  }};
  const args={store,body,catalogue,controlKey:randomBytes(32)};
  await assert.rejects(nativeByokAdapter(args).bind({role,profile:{provider:'audit',model:'audit-model',goal:'Observe'},apiKey:'synthetic-key'}));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM native_model_bindings').get().n,1);
  assert.equal((await nativeByokAdapter(args).abort({role})).stopped,true);
  assert.equal(messages[0].id,messages[1].id);assert.equal(store.db.prepare('SELECT count(*) AS n FROM native_model_bindings').get().n,0);
});

test('a failed Hub credential revocation preserves its binding for later explicit cleanup',async t=>{
  const store=new HostingStore(':memory:');t.after(()=>store.close());let failDelete=true;
  const calls=[];const provider={...catalogue.providers[0],hub:{provider:'openai-api',base_url:'https://fixture.invalid/v1',wire_api:'chat'}};
  const adapter=hubByokAdapter({endpoint:'http://127.0.0.1:29152/',internalKey:'synthetic-internal-control-key-long-enough',store,catalogue:{providers:[provider]},settings:{},
    async fetcher(url,options){
      const path=new URL(url).pathname;calls.push({path,method:options.method,body:options.body&&JSON.parse(options.body)});
      if(options.method==='DELETE'&&failDelete)return new Response('{}',{status:503});
      return new Response(JSON.stringify(path.endsWith('capabilities')?{schema:'qiandengji-hosted-byok/v1',isolatedByok:true,sharedFallback:false}:path.endsWith('/keys')?(options.method==='POST'?{key:'synthetic-scoped-key-long-enough'}:{keys:[{id:'synthetic-token-id'}]}):{ok:true}));
    }});
  await adapter.bind({role,profile:{provider:'audit',model:'audit-model',goal:'Observe'},apiKey:'synthetic-provider-key'});
  await assert.rejects(adapter.abort({role}),{code:'HUB_CONFIGURATION_REFUSED'});
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM hub_model_bindings').get().n,1);
  const deletes=calls.filter(x=>x.method==='DELETE');assert.equal(deletes.length,1);
  const deny=calls.findIndex(x=>x.body?.connections?.length===0),erase=calls.findIndex(x=>x.body?.api_key==='');
  assert.ok(deny>=0&&erase>deny);
  failDelete=false;assert.equal((await adapter.abort({role})).stopped,true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM hub_model_bindings').get().n,0);
});

test('lost release acknowledgement keeps recovery state and does not recreate or release twice',async t=>{
  const f=fixture(t);await f.save();await f.hosting.attach(role);
  let present=true,removed=0;
  f.body.release=async()=>{present=false;removed++;throw Error('reply lost after actual logout');};
  f.body.transition=async(r,lease)=>{if(!present)throw Error('selected registered Numen body is offline');return f.snapshot(lease);};
  await assert.rejects(f.hosting.release(role));
  assert.equal(f.hosting.status(role).state,'recovery_required');
  await assert.rejects(f.hosting.release(role));
  assert.equal(removed,1);assert.equal(f.events.filter(x=>x==='attach').length,1);
  // Safety is preserved, but status cannot discover the completed logout.
  // The missing offline release-receipt query is reported as an acceptance gap.
  assert.equal(f.hosting.status(role).state,'recovery_required');
});
