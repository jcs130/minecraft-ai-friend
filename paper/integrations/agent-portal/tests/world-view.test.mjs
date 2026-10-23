import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { siteFixture, testPassword } from './helpers.mjs';
import { loadConfig } from '../src/config.mjs';
const token='obs_'+'a'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
const site={build:{browserBundleSha256:'1'.repeat(64),consoleBundleSha256:'2'.repeat(64)},page:()=>Buffer.from('<html>trusted viewer</html>'),file:()=>null};
async function fixture(t,live={}) {
  const f=await siteFixture(t,{live:{worldObserverEnabled:true,worldObserverTokenHash:hash,native3dSiteDirectory:path.resolve('isolated-site'),...live}},{spectatorSite:site});
  f.agent.authenticated=true;await f.portal.ready;
  f.worker=(options={})=>fetch(f.origin+'/api/v1/internal/world-view/poll',{method:'POST',body:'{}',...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...options.headers}});
  f.watch=(client,id,viewerId=randomUUID())=>client.request(`/live/${id}/watch`,'POST',{viewerId});
  f.id=(await f.admin.request('/live')).data.channels[0].id;return f;
}
test('live roles are automatic, private and UUID-bound without manual channels or game accounts',async t=>{
  const f=await fixture(t),result=(await f.admin.request('/live')).data;
  assert.equal(result.mode,'native-3d');assert.equal(result.channels[0].extraPlayerSlots,0);
  assert.equal(result.channels[0].managed,true);assert.equal(result.channels[0].canManage,false);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM live_channels').get().n,0);
  assert.ok(!JSON.stringify(result).includes(token));assert.ok(!JSON.stringify(result).includes(f.uuid));
  assert.equal((await fetch(f.origin+'/api/v1/live').then(r=>r.json())).channels.length,0);
  assert.deepEqual((await f.worker().then(r=>r.json())).jobs,[]);
});
test('viewing creates only an observation lease; jobs are unavailable to browsers and public tokens',async t=>{
  const f=await fixture(t);assert.equal((await f.watch(f.admin,f.id)).status,200);
  const jobs=(await f.worker().then(r=>r.json())).jobs;assert.equal(jobs.length,1);
  assert.equal(jobs[0].playerUuid,f.uuid);assert.equal(jobs[0].playerName,'ag_Alpha');assert.match(jobs[0].publisherToken,/^pub_/);
  assert.equal(f.portal.worldView.publisher(f.id,jobs[0].publisherToken,[f.agent]).playerUuid,f.uuid);
  assert.equal((await f.worker({headers:{Origin:f.origin}})).status,403);
  assert.equal((await f.worker({headers:{Cookie:'anything'}})).status,403);
  assert.equal((await f.worker({headers:{Authorization:'Bearer pub_'+'a'.repeat(43)}})).status,401);
});
test('viewer watch requires normal CSRF/session and another owner cannot lease or fetch that role',async t=>{
  const f=await fixture(t),bob=f.client();await bob.init();await bob.request('/accounts','POST',{username:'watcher-bob',password:testPassword});
  assert.equal((await f.watch(bob,f.id)).status,404);
  assert.equal((await fetch(f.origin+`/api/v1/live/${f.id}/watch`,{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).status,403);
  await f.watch(f.admin,f.id);await f.worker();
  assert.equal((await fetch(f.origin+`/watch/${f.id}/`)).status,403);
  assert.equal((await bob.request(`/live/${f.id}/watch`,'POST',{viewerId:randomUUID()})).status,404);
});
test('one actual UUID shares its source across viewers and page mode is independent of source lease',async t=>{
  const f=await fixture(t);await f.watch(f.admin,f.id);await f.watch(f.admin,f.id);
  const first=(await f.worker().then(r=>r.json())).jobs;
  assert.equal(first.length,1);assert.equal((await f.worker().then(r=>r.json())).jobs[0].lease,first[0].lease);
  const result=(await f.admin.request('/live')).data.channels[0];assert.equal(result.watchUrl,`/watch/${f.id}/`);
});
test('switching the same browser view releases its old target and rotates source identity',async t=>{
  const f=await fixture(t),second={...f.agent,name:'ag_Beta',playerUuid:'22222222-2222-3222-8222-222222222222'};
  f.game.roster=async()=>[f.agent,second];const viewerId=randomUUID();
  await f.watch(f.admin,f.id,viewerId);const old=(await f.worker().then(r=>r.json())).jobs[0];
  const next=(await f.admin.request('/live')).data.channels.find(r=>r.playerName==='ag_Beta');
  await f.watch(f.admin,next.id,viewerId);const jobs=(await f.worker().then(r=>r.json())).jobs;
  assert.equal(jobs.length,1);assert.equal(jobs[0].playerUuid,second.playerUuid);
  assert.throws(()=>f.portal.worldView.publisher(f.id,old.publisherToken,[f.agent,second]));
});
test('logout revokes the private live source without waiting for browser metadata refresh',async t=>{
  const f=await fixture(t);await f.watch(f.admin,f.id);const old=(await f.worker().then(r=>r.json())).jobs[0];
  await f.admin.request('/session','DELETE');assert.deepEqual((await f.worker().then(r=>r.json())).jobs,[]);
  assert.throws(()=>f.portal.worldView.publisher(f.id,old.publisherToken,[f.agent]));
});
test('ownership removal, target authentication loss, and same-name UUID replacement fail closed',async t=>{
  const f=await fixture(t),alice=f.client();await alice.init();await alice.request('/accounts','POST',{username:'watch-alice',password:testPassword});
  const owner=f.portal.store.ownerByName('watch-alice');
  await f.admin.request('/admin/bindings','POST',{ownerId:owner.id,agentId:f.agent.id,proof:'Independently verified isolated owner',confirmedOwnership:true});
  await f.watch(alice,f.id);await f.worker();f.portal.store.db.prepare('DELETE FROM ownerships WHERE owner_id=?').run(owner.id);
  assert.deepEqual((await f.worker().then(r=>r.json())).jobs,[]);
  await f.watch(f.admin,f.id);await f.worker();f.agent.authenticated=false;
  assert.deepEqual((await f.worker().then(r=>r.json())).jobs,[]);
  f.agent.authenticated=true;await f.watch(f.admin,f.id);await f.worker();f.agent.playerUuid='33333333-3333-3333-8333-333333333333';
  assert.deepEqual((await f.worker().then(r=>r.json())).jobs,[]);
});
test('only explicit public UUIDs are anonymous scenes; no inventory permissions are inherited',async t=>{
  const f=await fixture(t,{worldObserverPublicUuids:['11111111-1111-3111-8111-111111111111']}),guest=f.client();await guest.init();
  assert.equal((await guest.request('/live')).data.channels[0].scope,'scene');
  assert.equal((await f.watch(guest,f.id)).status,200);
  assert.equal((await f.worker().then(r=>r.json())).jobs[0].scope,'scene');
  f.agent.name='Goddess';assert.equal((await f.admin.request('/live')).data.channels.length,0);
  f.agent.name='ag_Alpha_eye';assert.equal((await f.admin.request('/live')).data.channels.length,0);
});
test('idle pages release observations; source capacity does not steal an existing view',async t=>{
  const f=await fixture(t,{worldObserverMaxTargets:1}),second={...f.agent,name:'ag_Beta',playerUuid:'22222222-2222-3222-8222-222222222222'};
  f.game.roster=async()=>[f.agent,second];await f.watch(f.admin,f.id);const initial=(await f.worker().then(r=>r.json())).jobs[0];
  const next=(await f.admin.request('/live')).data.channels.find(r=>r.playerName===second.name);await f.watch(f.admin,next.id);
  assert.equal((await f.worker().then(r=>r.json())).jobs[0].lease,initial.lease);
  const now=Date.now();f.portal.worldView.now=()=>now+21000;assert.deepEqual((await f.worker().then(r=>r.json())).jobs,[]);
});
test('unsafe observer configuration cannot expose a new public source or unbounded pool',()=>{
  for(const live of [{worldObserverMaxTargets:16},{worldObserverEnabled:true},{worldObserverPublicUuids:['ag_Alpha']}])assert.throws(()=>loadConfig({skipLocalConfig:true,live}),/observation/);
});
test('native Numen bodies use exact live registry identity, never a nickname or absent authentication alone',async t=>{
  const f=await fixture(t);Object.assign(f.agent,{authenticated:null,statusSource:'minecraft.server-list-ping.uuid',identitySource:'Numen.CompanionRegistry'});
  assert.equal((await f.watch(f.admin,f.id)).status,200);
  f.agent.identitySource='Paper.usercache';assert.equal((await f.watch(f.admin,f.id)).status,503);
  f.agent.identitySource='Numen.CompanionRegistry';f.agent.statusSource='minecraft.server-list-ping.sample';assert.equal((await f.watch(f.admin,f.id)).status,503);
  f.agent.statusSource='minecraft.server-list-ping.uuid';f.agent.authenticated=false;assert.equal((await f.watch(f.admin,f.id)).status,503);
});
