import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {HostingStore} from '../src/store.mjs';
import {HostedProfiles} from '../src/profiles.mjs';
const role={serverId:'test',roleUuid:'00000000-0000-0000-0000-000000000001',numenOwnerUuid:'00000000-0000-0000-0000-000000000002',ownerId:'user-one',name:'HostedOne'};
const catalogue={providers:[{id:'provider-a',label:'A',models:[{id:'test-model',label:'Test model'}]},{id:'provider-b',label:'B',models:[{id:'test-model',label:'Test model'}]}],harnesses:[{id:'native',label:'Numen',mode:'numen',providers:['provider-a','provider-b']} ]};
const config={revision:0,provider:'provider-a',model:'test-model',harness:'native',goal:'探索副本'};
function fixture(t,adapters={}){const store=new HostingStore(':memory:');t.after(()=>store.close());return new HostedProfiles({store,key:randomBytes(32),catalogue,adapters});}
test('own API key is required, encrypted at rest and never returned to a browser',async t=>{
  const p=fixture(t);p.save(role,config);assert.throws(()=>p.require(role,'numen'),{code:'API_KEY_REQUIRED'});
  const value=p.save(role,{...config,revision:1,apiKey:'synthetic-user-key'});assert.equal(value.keyConfigured,true);
  const raw=JSON.stringify(p.store.db.prepare('SELECT * FROM hosted_profiles').all());assert.ok(!raw.includes('synthetic-user-key'));
  assert.ok(!JSON.stringify(value).includes('synthetic-user-key'));assert.ok(!JSON.stringify(p.cataloguePublic()).includes('apiKey'));
  assert.throws(()=>p.read({...role,ownerId:'other'}),{code:'PROFILE_OWNER_CHANGED'});
});
test('blank retains provider key; provider changes clear it; stale updates rejected',t=>{
  const p=fixture(t);p.save(role,{...config,apiKey:'synthetic-user-key'});
  assert.throws(()=>p.save(role,config),{code:'PROFILE_CHANGED'});
  assert.equal(p.save(role,{...config,revision:1,apiKey:''}).keyConfigured,true);
  assert.equal(p.save(role,{...config,revision:2,provider:'provider-b'}).keyConfigured,false);
  assert.throws(()=>p.save(role,{...config,revision:3,endpoint:'http://127.0.0.1/private'}),{code:'PROFILE_INVALID'});
});
test('browser cannot select models outside reviewed provider and harness catalogue',t=>{
  const p=fixture(t);
  assert.throws(()=>p.save(role,{...config,model:'invented-model'}),{code:'MODEL_NOT_SUPPORTED'});
  assert.throws(()=>p.save(role,{...config,apiKey:'line\nbreak'}),{code:'API_KEY_INVALID'});
  assert.equal(p.cataloguePublic().harnesses[0].available,false);
  p.save(role,{...config,apiKey:'synthetic-user-key'});
  assert.throws(()=>p.require(role,'numen'),{code:'BYOK_ADAPTER_UNAVAILABLE'});
});
test('isolated model binding uses exact owner and model, holds key away from game runtime and revokes before changes',async t=>{
  let captured,closed=0;const p=fixture(t,{native:{isolatedByok:true,async bind(value){captured=value;return{isolatedByok:true,ownerId:role.ownerId,model:config.model,async close(){closed++;return{stopped:true};}};}}});
  p.save(role,{...config,apiKey:'synthetic-user-key'});await p.start(role,'numen');
  assert.equal(captured.apiKey,'synthetic-user-key');assert.equal(captured.profile.apiKey,undefined);
  assert.throws(()=>p.save(role,{...config,revision:1,removeKey:true}),{code:'HOSTING_MUST_PAUSE'});
  await p.stop(role);assert.equal(closed,1);assert.equal(p.save(role,{...config,revision:1,removeKey:true}).keyConfigured,false);
});
test('failed model setup exposes no provider error or key and requires confirmed abort',async t=>{
  let aborts=0;const p=fixture(t,{native:{isolatedByok:true,async bind(){throw Error('synthetic-user-key');},async abort(){aborts++;return{stopped:true};}}});
  p.save(role,{...config,apiKey:'synthetic-user-key'});
  await assert.rejects(p.start(role,'numen'),error=>error.code==='MODEL_BINDING_UNCONFIRMED'&&!String(error).includes('synthetic-user-key'));
  await assert.rejects(p.start(role,'numen'),{code:'MODEL_LEASE_ACTIVE'});await p.stop(role);assert.equal(aborts,1);
});
