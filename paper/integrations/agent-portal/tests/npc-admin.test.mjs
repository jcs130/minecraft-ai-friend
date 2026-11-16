import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {NpcAdmin,npcCatalogue} from '../src/npc-admin.mjs';
import {NpcWorker} from '../scripts/npc-worker.mjs';
import {siteFixture} from './helpers.mjs';
import {WorldMap,validateMapState} from '../src/world-map.mjs';
import {visiblePlayers} from '../public/world-map-model.js';

const id='10000000-0000-0000-0000-000000000011';
const profile={name:'桐人',persona:'喜欢探索、尊重伙伴的剑士。',brain:'qwen',voice:'none',appearance:'original',autonomous:true,mapVisible:true};
const catalog=(revision=0,p=profile)=>({schemaVersion:1,observedAt:new Date().toISOString(),residents:[{id,revision,profile:structuredClone(p),loaded:true,profession:'ranger',brains:[{id:'qwen',model:'qwen3.8-flash'}],voices:['none'],models:[{id:'original',label:'角色原外观'}],currentBrain:'qwen'}]});
test('NPC admin uses browser administrator role, CSRF and recent verification; no PAT/owner shortcut',async t=>{
  const f=await siteFixture(t),sync=new NpcAdmin(f.portal.store);
  sync.poll({catalogue:catalog(),results:[]});
  const guest=f.client();await guest.init();
  assert.equal((await guest.request('/admin/npcs')).status,401);
  const owner=await f.portal.store.createOwner('ordinary', 'ordinary-npc-password-2026','owner');
  assert.throws(()=>sync.enqueue(owner,id,{requestId:randomUUID(),revision:0,profile}),/ADMIN_REQUIRED/);
  assert.equal((await f.admin.request('/admin/npcs')).data.residents[0].profile.name,'桐人');
  const input={requestId:randomUUID(),revision:0,profile};
  assert.equal((await f.admin.request('/admin/npcs/'+id,'PUT',input,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.admin.request('/admin/npcs/'+id,'PUT',input,{Authorization:'Bearer untrusted'})).status,403);
  assert.equal((await f.admin.request('/admin/npcs/'+id,'PUT',input)).status,202);
  assert.equal((await f.admin.request('/admin/npcs/'+id,'PUT',input)).data.requestId,input.requestId);
  assert.equal((await f.admin.request('/admin/npcs/'+id,'PUT',{...input,profile:{...profile,name:'other'}})).status,409);
  f.portal.store.db.prepare('UPDATE sessions SET verified_at=0').run();
  assert.equal((await f.admin.request('/admin/npcs/'+id,'PUT',{...input,requestId:randomUUID()})).data.error.reason,'REAUTH_REQUIRED');
});
test('host receipts must match revision and actual profile; unknown is not completion or permission to replay',async t=>{
  const f=await siteFixture(t),service=new NpcAdmin(f.portal.store),owner=f.portal.store.ownerByName('fixture-admin');
  service.poll({catalogue:catalog(),results:[]});
  const requestId=randomUUID(),input={requestId,revision:0,profile};service.enqueue(owner,id,input);
  const a=service.poll({catalogue:catalog(),results:[]});assert.equal(a.requests[0].reconcileOnly,false);
  const b=service.poll({catalogue:catalog(),results:[]});assert.equal(b.requests[0].requestId,requestId);assert.equal(b.requests[0].reconcileOnly,true);
  const result={id,requestId,status:'applied',completed:true,reason:'native_profile_verified'};
  assert.throws(()=>service.poll({catalogue:catalog(),results:[result]}),/APPLIED_STATE_MISMATCH/);
  service.poll({catalogue:catalog(1),results:[result]});assert.equal(service.state().jobs[0].status,'applied');
  assert.throws(()=>service.enqueue(owner,id,{requestId:randomUUID(),revision:0,profile}),/REVISION_CHANGED/);
  assert.throws(()=>service.enqueue(owner,id,{requestId:randomUUID(),revision:1,profile:{...profile,brain:'shell'}}),/OPTION_NOT_CONFIGURED/);
  const reloaded=new NpcAdmin(f.portal.store);assert.equal(reloaded.state().jobs[0].status,'applied');
});
test('catalogue is allowlisted, cannot publish credentials, executable endpoints or arbitrary fields',()=>{
  const raw=catalog();raw.residents[0].apiKey='private';raw.residents[0].brains[0].endpoint='http://private';
  const out=npcCatalogue(raw);assert.doesNotMatch(JSON.stringify(out),/private|endpoint|apiKey/);
  raw.residents[0].profile.endpoint='http://private';assert.throws(()=>npcCatalogue(raw),/PROFILE_INVALID/);
});
test('lost host command response only queries the original request after restart',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'npc-worker-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const calls=[],job={id,requestId:randomUUID(),revision:0,profile};
  const worker=new NpcWorker({journalDirectory:root},{command:async cmd=>{calls.push(cmd);throw Error('lost reply');}});
  const result=await worker.process(job);assert.equal(result.status,'unknown');
  const again=new NpcWorker({journalDirectory:root},{command:async cmd=>{calls.push(cmd);return 'MC_RESIDENT '+JSON.stringify({...result,reason:'original_request_not_current_no_replay'});}});
  await again.process(job);assert.equal(calls.filter(c=>c.includes(' apply ')).length,1);assert.match(calls[1],new RegExp('receipt '+id+' '+job.requestId));
  await assert.rejects(()=>again.process({...job,profile:{...profile,name:'changed'}}),/CONFLICT/);
});
test('NPC map positions are separately typed, Chinese named, privacy filtered and expire with the sample',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'npc-map-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let now=Date.now();const npc={uuid:id,name:'桐人',kind:'npc',profession:'ranger',dimension:'minecraft:aincrad',x:12,y:64,z:15,yaw:0,pitch:0,inventory:'private'};
  const value={schemaVersion:1,sequence:1,observedAt:new Date(now).toISOString(),players:[],npcs:[npc],maps:[]};
  const checked=validateMapState(value,now);assert.equal(checked.npcs[0].name,'桐人');assert.equal(checked.npcs[0].inventory,undefined);
  const map=new WorldMap({dataDir:root,worldMap:{enabled:true}},{now:()=>now});await map.acceptState(value);
  assert.equal(visiblePlayers(await map.state(),'',now)[0].kind,'npc');now+=21000;
  assert.deepEqual((await map.state()).npcs,[]);assert.deepEqual(visiblePlayers(await map.state(),'',now),[]);
  assert.throws(()=>validateMapState({...value,npcs:[npc,npc]},now),/MAP_NPC_FORMAT/);
});
