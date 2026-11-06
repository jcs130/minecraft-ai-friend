import test from 'node:test';
import assert from 'node:assert/strict';
import {HostingStore} from '../src/store.mjs';
import {hubByokAdapter} from '../src/hub-model.mjs';
const fixtureInternal=Buffer.alloc(32,7).toString('hex');
const role={serverId:'fixture',ownerId:'owner',roleUuid:'00000000-0000-4000-a000-000000000001',numenOwnerUuid:'00000000-0000-4000-a000-000000000002',name:'HostedTest'};
const catalogue={providers:[{id:'fixture',hub:{provider:'openai-api',base_url:'https://fixture.invalid/v1',wire_api:'chat'},models:[{id:'exact-model'}]}]};
test('dedicated Hub binds only the selected own key and revokes a persisted orphan before reuse',async t=>{
  const store=new HostingStore(':memory:');t.after(()=>store.close());const calls=[];
  const fetcher=async(url,options)=>{const path=new URL(url).pathname;calls.push({path,...options,body:options.body&&JSON.parse(options.body)});
    return new Response(JSON.stringify(path.endsWith('capabilities')?{schema:'qiandengji-hosted-byok/v1',isolatedByok:true,sharedFallback:false}:path.endsWith('/keys')?(options.method==='POST'?{key:'synthetic-role-token-long-enough'}:{keys:[{id:'fixture-token-id'}]}):{ok:true}),{status:200});};
  const args={endpoint:'http://127.0.0.1:29152/',internalKey:fixtureInternal,catalogue,store,settings:{autonomy:{}},fetcher};
  const first=hubByokAdapter(args);
  await first.bind({role,profile:{provider:'fixture',model:'exact-model',goal:'Explore'},apiKey:'synthetic-vendor-own-key'});
  const runtime=first.configurationFor(role);assert.equal(runtime.planner.model,'exact-model');assert.equal(runtime.environment.QDJ_HOSTED_HUB_TOKEN,'synthetic-role-token-long-enough');
  assert.ok(!JSON.stringify(runtime).includes('synthetic-vendor-own-key'));
  const connection=calls.find(r=>r.path.includes('/connections/')&&r.body.api_key);
  assert.equal(connection.body.model,'exact-model');assert.equal(connection.body.api_key,'synthetic-vendor-own-key');
  for(const tool of ['bash','read','edit','task','webfetch'])assert.ok(connection.body.disabled_tools.split(',').includes(tool));
  const second=hubByokAdapter(args);assert.equal((await second.abort({role})).stopped,true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM hub_model_bindings').get().n,0);
  assert.ok(calls.some(c=>c.method==='DELETE'&&c.path.endsWith('/keys/fixture-token-id')));
});
test('shared Hub capability never receives a user provider key',async t=>{
  const store=new HostingStore(':memory:');t.after(()=>store.close());let calls=0;
  const adapter=hubByokAdapter({endpoint:'http://127.0.0.1:29152/',internalKey:fixtureInternal,catalogue,store,fetcher:async()=>{calls++;return new Response(JSON.stringify({schema:'qiandengji-hosted-byok/v1',isolatedByok:false,sharedFallback:true}));}});
  await assert.rejects(adapter.bind({role,profile:{provider:'fixture',model:'exact-model'},apiKey:'synthetic-own-key'}),{code:'HUB_ISOLATION_REQUIRED'});
  assert.equal(calls,1);
});
