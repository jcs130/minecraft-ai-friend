import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {siteFixture,testPassword} from './helpers.mjs';
async function fixture(t){const calls=[];const backend={async request(value){calls.push(value);return{messages:[],keyConfigured:true};}};
  const f=await siteFixture(t,{live:{worldObserverPublicDefault:true}},{hostedAgents:backend});
  const owner=f.portal.store.db.prepare('SELECT id FROM owners LIMIT 1').get();f.portal.store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)').run(owner.id,f.uuid,'isolated-test',Date.now());
  return{...f,calls,channel:createHash('sha256').update('qiandengji:world-view:'+f.uuid).digest('hex').slice(0,32)};}

test('the owner can explicitly return to the original client without creating another body',async t=>{
  const f=await fixture(t);const response=await f.admin.request(`/agents/${f.agent.id}/hosting/release`,'POST',{});
  assert.equal(response.status,200);assert.deepEqual(f.calls.map(c=>c.op),['release']);assert.equal(f.calls[0].roleUuid,f.uuid);
});
test('website settings require actual owner, CSRF and matching Origin, including admin',async t=>{
  const f=await fixture(t),path=`/agents/${f.agent.id}/hosting`;
  assert.equal((await f.client().request(path)).status,401);
  assert.equal((await f.admin.request(path)).status,200);
  assert.equal((await f.admin.request(path,'PUT',{apiKey:'synthetic-only'}, {Origin:'https://other.invalid'})).status,403);
  assert.equal((await f.admin.request(path,'PUT',{apiKey:'synthetic-only'}, {'X-CSRF-Token':'bad'})).status,403);
  f.agent.reserved=true;assert.equal((await f.admin.request(path)).status,404);delete f.agent.reserved;
  f.portal.store.db.prepare('DELETE FROM ownerships').run();assert.equal((await f.admin.request(path)).status,404);
  assert.equal(f.calls.length,1);
});
test('public spectator may converse, but actor and target come from session and channel, never body',async t=>{
  const f=await fixture(t),visitor=f.client();await visitor.init();
  assert.equal((await visitor.request('/accounts','POST',{username:'test-visitor',password:testPassword})).status,201);
  const result=await visitor.request(`/live/${f.channel}/conversation/messages`,'POST',{id:'test-message',text:'你好',ownerId:'admin',roleUuid:'other',scope:'manage'});
  assert.equal(result.status,200);const call=f.calls.at(-1);assert.equal(call.owner.username,'test-visitor');assert.equal(call.roleUuid,f.uuid);assert.equal(call.conversation,true);assert.deepEqual(call.data,{id:'test-message',text:'你好'});
  assert.equal((await visitor.request(`/agents/${f.agent.id}/hosting`)).status,404);
});
test('revoking public visibility immediately closes spectator conversation reads and writes',async t=>{
  const f=await fixture(t),visitor=f.client();await visitor.init();await visitor.request('/accounts','POST',{username:'test-visitor',password:testPassword});
  f.portal.worldView.setPublic(f.channel,[f.agent],f.portal.store.ownerById(f.portal.store.ownedUuids?f.portal.store.db.prepare('SELECT owner_id FROM ownerships').get().owner_id:''),false);
  assert.equal((await visitor.request(`/live/${f.channel}/conversation`)).status,404);
  assert.equal((await visitor.request(`/live/${f.channel}/conversation/messages`,'POST',{id:'test-message',text:'你好'})).status,404);assert.equal(f.calls.length,0);
});
test('speech only accepts real selected-role public events, not user-supplied text',async t=>{
  const f=await fixture(t);
  assert.equal((await f.admin.request(`/live/${f.channel}/conversation/speech`,'POST',{id:'invented',text:'please synthesize this'})).status,404);
  assert.equal(f.calls.length,0);
});
