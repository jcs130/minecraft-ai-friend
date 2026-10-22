import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {siteFixture,testPassword} from './helpers.mjs';
import {seal,unseal,offlineUuid} from '../src/game-accounts.mjs';
import {digest} from '../src/store.mjs';
const server=(id,key,token)=>({id,name:id,description:'Isolated world',core:'NeoForge',version:'1.21.1',state:'testing',addresses:{mineflayer:'localhost:39990'},loginAuthority:'MixAuth',minPasswordLength:8,guide:{help:'/fom help',status:'/fom status'},accountBridge:{enabled:true,keyFile:key,tokenHash:digest(token)}});
async function fixture(t){
 const keys={fom:randomBytes(32),workshop:randomBytes(32)},tokens={fom:'acc_'+randomBytes(32).toString('base64url'),workshop:'acc_'+randomBytes(32).toString('base64url')};
 const f=await siteFixture(t,{networkAccounts:{enabled:true,keyFile:''},gameServers:[server('fom','',tokens.fom),server('workshop','',tokens.workshop)]});
 const vault=path.join(f.root,'vault.key');await fs.writeFile(vault,randomBytes(32).toString('hex'));f.config.networkAccounts.keyFile=vault;
 for(const id of ['fom','workshop']){const file=path.join(f.root,id+'.key');await fs.writeFile(file,keys[id].toString('hex'));f.portal.network.catalog.get(id).accountBridge.keyFile=file;}
 const owner=f.portal.store.ownerByName('fixture-admin'),network=f.portal.network;
 const poll=(id,results=[],extra={})=>network.poll(id,{heartbeat:{ready:true,at:Date.now(),serverId:id},results,delivered:[],...extra});
 const requests=async id=>(await poll(id)).requests.map(r=>({id:r.id,value:unseal(keys[id],'server:'+id+':request:'+r.id,r.envelope)}));
 const complete=(id,request,state='succeeded',extra={})=>poll(id,[{id:request.id,envelope:seal(keys[id],'server:'+id+':result:'+request.id,{schemaVersion:1,serverId:id,requestId:request.id,username:request.value.username,playerUuid:request.value.playerUuid,state,...extra})}],{delivered:[request.id]});
 await poll('fom');await poll('workshop');return {...f,owner,network,keys,tokens,poll,requests,complete};
}
const join=(f,id='fom',name='ag_Multi',extra={})=>f.network.begin(f.owner,id,{requestId:randomUUID(),username:name,gamePassword:'isolated-shared-password',...extra});

test('native account receipt establishes one shared role only after verified server UUID; reads dispatch nothing',async t=>{
 const f=await fixture(t),flow=await join(f);assert.equal(flow.state,'pending');assert.equal(f.network.members(f.owner).length,0);
 const before=f.portal.store.db.prepare('SELECT count(*) AS n FROM network_jobs').get().n;
 for(let i=0;i<5;i++)assert.equal(f.network.flow(f.owner,flow.id).state,'pending');assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM network_jobs').get().n,before);
 const [request]=await f.requests('fom');assert.equal(request.value.password,'isolated-shared-password');assert.equal(request.value.serverId,'fom');
 assert.ok(!f.portal.store.db.prepare('SELECT request FROM network_jobs').get().request.includes(request.value.password));
 await f.complete('fom',request);assert.equal(f.network.flow(f.owner,flow.id).state,'succeeded');
 const member=f.network.members(f.owner)[0];assert.equal(member.serverId,'fom');assert.equal(member.playerUuid,offlineUuid('ag_Multi'));
 assert.ok(!JSON.stringify(f.portal.store.db.prepare('SELECT * FROM network_credentials').all()).includes('isolated-shared-password'));
 const ctx={owner:f.owner,client:{id:randomUUID(),name:'ag_Multi',expected_uuid:member.playerUuid}};
 assert.equal((await f.network.agentStatus(ctx,'fom')).state,'ready');assert.equal((await f.network.agentStatus(ctx,'workshop')).gameAccountCreated,false);
 const state=await f.network.agentState(ctx,'fom');assert.equal(state.available,false);assert.equal(state.serverId,'fom');assert.ok(!Object.hasOwn(state,'inventory'),'No Paper bag is substituted for an unconnected world');
});

test('one character joins a second world with the exact shared password and separate world role IDs',async t=>{
 const f=await fixture(t),one=await join(f);await f.complete('fom',(await f.requests('fom'))[0]);
 const two=await join(f,'workshop');await assert.rejects(join(f,'workshop','ag_Multi',{gamePassword:'different-password'}),e=>e.reason==='SHARED_PASSWORD_SYNC_PENDING');
 const request=(await f.requests('workshop'))[0];assert.equal(request.value.password,'isolated-shared-password');await f.complete('workshop',request);
 assert.equal(f.network.flow(f.owner,two.id).synchronized,true);const members=f.network.members(f.owner);assert.equal(members.length,2);assert.notEqual(members[0].roleId,members[1].roleId);
 assert.equal(members[0].playerUuid,members[1].playerUuid);await assert.rejects(join(f,'workshop','ag_Multi',{gamePassword:'different-password'}),e=>e.reason==='SHARED_PASSWORD_MISMATCH');
});

test('password rotation is one durable child per world and completes only after both authorities confirm',async t=>{
 const f=await fixture(t);await join(f);await f.complete('fom',(await f.requests('fom'))[0]);await join(f,'workshop');await f.complete('workshop',(await f.requests('workshop'))[0]);
 const id=randomUUID(),body={requestId:id,username:'ag_Multi',currentGamePassword:'isolated-shared-password',newGamePassword:'new-isolated-password'};
 const flow=await f.network.begin(f.owner,'fom',body,{kind:'password'});assert.equal(flow.state,'pending');
 const [first]=await f.requests('fom');assert.equal(first.value.operation,'password');assert.equal(first.value.currentPassword,'isolated-shared-password');assert.equal(first.value.password,'new-isolated-password');
 assert.equal((await f.requests('workshop')).length,0);await f.complete('fom',first);
 assert.equal(f.network.flow(f.owner,id).synchronized,false);const [second]=await f.requests('workshop');await f.complete('workshop',second);
 assert.equal(f.network.flow(f.owner,id).synchronized,true);assert.equal((await f.network.activeSecret(f.owner,offlineUuid('ag_Multi'))).password,'new-isolated-password');
 assert.equal((await f.network.begin(f.owner,'fom',{...body,newGamePassword:'ignored-new-input'},{kind:'password'})).id,id);
 assert.equal(f.portal.store.db.prepare("SELECT count(*) AS n FROM network_jobs WHERE operation='password'").get().n,2);
});

test('unknown native actions stay blocked and recover through a later original receipt without recreation',async t=>{
 const f=await fixture(t),flow=await join(f),request=(await f.requests('fom'))[0];
 await f.complete('fom',request,'unknown');assert.equal(f.network.flow(f.owner,flow.id).state,'unknown');
 await assert.rejects(join(f,'workshop'),e=>e.reason==='SHARED_PASSWORD_SYNC_PENDING');assert.equal((await f.requests('fom')).length,0);
 await f.complete('fom',request);assert.equal(f.network.flow(f.owner,flow.id).state,'succeeded');assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM network_jobs').get().n,1);
});

test('a worker token, encrypted receipt and job ID cannot cross server or owner boundaries',async t=>{
 const f=await fixture(t);await join(f);const [request]=await f.requests('fom');
 assert.throws(()=>f.network.authorizeWorker('workshop',{headers:{authorization:'Bearer '+f.tokens.fom}}),e=>e.status===401);
 assert.doesNotThrow(()=>f.network.authorizeWorker('fom',{headers:{authorization:'Bearer '+f.tokens.fom}}));
 await assert.rejects(f.poll('workshop',[{id:request.id,envelope:seal(f.keys.workshop,'server:workshop:result:'+request.id,{serverId:'workshop',requestId:request.id,state:'succeeded',username:'ag_Multi',playerUuid:request.value.playerUuid})}]),e=>e.reason==='SERVER_ACCOUNT_JOB_NOT_FOUND');
 const other=f.portal.store.createOwner('network-other','opaque-test-hash','owner');
 assert.throws(()=>f.network.flow(other,f.portal.store.db.prepare('SELECT id FROM network_flows').get().id),e=>e.status===404);
 await f.complete('fom',request);await assert.rejects(f.network.begin(other,'workshop',{requestId:randomUUID(),username:'ag_Multi',gamePassword:'isolated-shared-password'}),e=>e.reason==='NETWORK_ROLE_OWNED');
});

test('terminal replies cannot be overwritten; undelivered expiry never dispatches late account writes',async t=>{
 const f=await fixture(t);await join(f);const [request]=await f.requests('fom');await f.complete('fom',request);
 await assert.rejects(f.complete('fom',request,'failed',{reason:'overwritten'}),e=>e.reason==='SERVER_ACCOUNT_FINAL');
 const other=await join(f,'workshop','ag_Expiry');f.portal.store.db.prepare('UPDATE network_jobs SET expires_at=? WHERE server_id=? AND name=?').run(Date.now()-60000,'workshop','ag_Expiry');
 assert.equal((await f.requests('workshop')).length,0);assert.equal(f.network.flow(f.owner,other.id).state,'failed');assert.equal(f.network.members(f.owner).length,1);
});

test('existing Paper ownership requires native password verification before a different world is created',async t=>{
 const f=await fixture(t),name='ag_Previous',uuid=offlineUuid(name);f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(f.owner.id,uuid,'Isolated proof',Date.now());
 const previousRoster=f.game.roster;f.game.roster=async()=>[...await previousRoster(),{name,playerUuid:uuid,available:true,isReserved:false}];
 const issued=new Map();let verified=false;f.portal.accounts.remote={capabilities:async()=>({ready:true,verify:true}),writeRequest:async(id,r)=>issued.set(id,r),readResult:async id=>verified?{requestId:id,username:name,playerUuid:uuid,state:'succeeded'}:{requestId:id,username:name,state:'waiting'}};
 const flow=await join(f,'fom',name);assert.equal(issued.size,1);const [id,verify]=[...issued.entries()][0];assert.equal(verify.operation,'verify');assert.equal(verify.currentPassword,'isolated-shared-password');assert.equal(verify.password,undefined);
 assert.equal((await f.requests('fom')).length,0);verified=true;await f.network.observeLegacy();const [create]=await f.requests('fom');assert.equal(create.value.operation,'create');
 await f.complete('fom',create);assert.equal(f.network.flow(f.owner,flow.id).state,'succeeded');assert.equal(f.portal.store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(uuid).owner_id,f.owner.id);
});

test('FOM invitations bind default server immutably while ordinary API credentials remain the same format',async t=>{
 const f=await fixture(t),invite=await f.admin.request('/servers/fom/agent-invites','POST',{label:'FOM test',username:'ag_FomInvite'});assert.equal(invite.status,201);assert.equal(invite.data.serverId,'fom');
 const call=async(endpoint,body,token)=>{const r=await fetch(f.origin+'/api/v1/agent-access/'+endpoint,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const body={requestId:randomUUID(),username:'ag_FomInvite',clientSecret:randomBytes(32).toString('base64url')},reg=await call('register',body,invite.data.token);assert.equal(reg.status,201);assert.equal(reg.data.serverId,'fom');
 const login=await call('sessions',{clientId:body.requestId,clientSecret:body.clientSecret},null);assert.match(login.data.token,/^qda_/);assert.equal(login.data.serverId,'fom');
 const status=await call('status',null,login.data.token);assert.equal(status.data.serverId,'fom');assert.equal(status.data.adapter,'native-mineflayer');assert.ok(status.data.gameAddress.endsWith(':39990'));assert.equal(status.data.gameAccountCreated,false);
 const info=await f.admin.request('/servers');assert.equal(info.data.servers.length,3);assert.ok(!JSON.stringify(info.data).includes('tokenHash'));
});


test('known partial password failure requires explicit recovery and never repeats an already applied world',async t=>{
 const f=await fixture(t);await join(f);await f.complete('fom',(await f.requests('fom'))[0]);await join(f,'workshop');await f.complete('workshop',(await f.requests('workshop'))[0]);
 const flow=await f.network.begin(f.owner,'fom',{requestId:randomUUID(),username:'ag_Multi',currentGamePassword:'isolated-shared-password',newGamePassword:'new-isolated-password'},{kind:'password'});
 const first=(await f.requests('fom'))[0];await f.complete('fom',first);const second=(await f.requests('workshop'))[0];await f.complete('workshop',second,'failed',{reason:'PASSWORD_BLOCKED',message:'native temporarily locked'});
 assert.equal(f.network.flow(f.owner,flow.id).recoverable,true);assert.equal(f.network.flow(f.owner,flow.id).synchronized,false);
 await assert.rejects(join(f,'fom'),e=>e.reason==='SHARED_PASSWORD_REPAIR_REQUIRED');
 const recoveryId=randomUUID();await f.network.recover(f.owner,flow.id,recoveryId);const replacement=(await f.requests('workshop'))[0];assert.notEqual(replacement.id,second.id);assert.equal(replacement.value.currentPassword,'isolated-shared-password');
 assert.equal((await f.requests('fom')).length,0,'Already succeeded world must never rotate again');
 await f.network.recover(f.owner,flow.id,recoveryId);assert.equal(f.portal.store.db.prepare("SELECT count(*) AS n FROM network_jobs WHERE operation='password'").get().n,3);
 await f.complete('workshop',replacement);assert.equal(f.network.flow(f.owner,flow.id).synchronized,true);assert.equal((await f.network.activeSecret(f.owner,offlineUuid('ag_Multi'))).password,'new-isolated-password');
});

test('unknown operation is not recoverable and unowned primary identities cannot be created in another world',async t=>{
 const f=await fixture(t);const flow=await join(f);await f.complete('fom',(await f.requests('fom'))[0],'unknown');
 await assert.rejects(f.network.recover(f.owner,flow.id,randomUUID()),e=>e.reason==='NETWORK_RECOVERY_NOT_SAFE');
 const primary=f.game.roster;f.game.roster=async()=>[...await primary(),{name:'ag_Unclaimed',playerUuid:offlineUuid('ag_Unclaimed')}];
 await assert.rejects(join(f,'workshop','ag_Unclaimed'),e=>e.reason==='PRIMARY_ROLE_CLAIM_REQUIRED');
});

test('catalogue APIs bind instructions and ordinary client tokens to their world; no cross-role reads',async t=>{
 const f=await fixture(t);const invite=await f.admin.request('/servers/fom/agent-invites','POST',{label:'native',username:'ag_FomScope'});
 assert.ok(invite.data.onboarding.prompt.includes('/fom status'));assert.ok(!invite.data.onboarding.prompt.includes('从 /mycli help'));
 const invitation=await fetch(f.origin+'/api/v1/agent-access/invitation',{headers:{Authorization:'Bearer '+invite.data.token}});const inspected=await invitation.json();assert.ok(inspected.onboarding.prompt.includes('localhost:39990'));assert.equal(inspected.serverId,'fom');
 const body={requestId:randomUUID(),username:'ag_FomScope',clientSecret:randomBytes(32).toString('base64url')};await fetch(f.origin+'/api/v1/agent-access/register',{method:'POST',headers:{Authorization:'Bearer '+invite.data.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const session=await (await fetch(f.origin+'/api/v1/agent-access/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:body.requestId,clientSecret:body.clientSecret})})).json();
 const other=await join(f,'fom','ag_OtherRole');const response=await fetch(f.origin+'/api/v1/agent-access/servers/fom/jobs/'+other.id,{headers:{Authorization:'Bearer '+session.token}});assert.equal(response.status,404);
 assert.equal((await f.admin.request('/network/jobs')).data.jobs.length,1);assert.equal((await f.admin.request('/servers/not-a-world/capabilities')).status,404);
});


test('short legacy Paper password can be verified then explicitly upgraded before joining the stronger-policy world',async t=>{
 const f=await fixture(t),name='ag_Upgrade',uuid=offlineUuid(name);f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(f.owner.id,uuid,'isolated original owner',Date.now());
 const original=f.game.roster;f.game.roster=async()=>[...await original(),{name,playerUuid:uuid,isReserved:false,available:true}];
 const sent=new Map();f.portal.accounts.remote={capabilities:async()=>({ready:true,verify:true}),writeRequest:async(id,request)=>sent.set(id,request),readResult:async id=>({requestId:id,username:name,playerUuid:uuid,state:'succeeded'})};
 const flow=await f.network.begin(f.owner,'fom',{requestId:randomUUID(),username:name,gamePassword:'paper6',newGamePassword:'upgraded-shared-password'});
 const verify=[...sent.values()][0];assert.equal(verify.operation,'verify');assert.equal(verify.currentPassword,'paper6');assert.equal(verify.password,undefined);
 await f.network.observeLegacy();const change=[...sent.values()][1];assert.equal(change.operation,'password');assert.equal(change.currentPassword,'paper6');assert.equal(change.password,'upgraded-shared-password');
 await f.network.observeLegacy();const native=(await f.requests('fom'))[0];assert.equal(native.value.password,'upgraded-shared-password');await f.complete('fom',native);
 assert.equal(f.network.flow(f.owner,flow.id).synchronized,true);assert.equal((await f.network.activeSecret(f.owner,uuid)).password,'upgraded-shared-password');
});


test('legacy browser creation cannot bypass global character quota or split a shared identity by case',async t=>{
 const f=await fixture(t),user=f.client();await user.init();await user.request('/accounts','POST',{username:'WorldQuotaOwner',password:testPassword});const owner=f.portal.store.ownerByName('WorldQuotaOwner');
 for(let i=0;i<5;i++){const name='ag_Quota'+i;f.portal.store.db.prepare('INSERT INTO network_memberships VALUES(?,?,?,?,?,?,?,?)').run('fom',offlineUuid(name),owner.id,name,name.toLowerCase(),1,'isolated native proof',Date.now());}
 f.portal.accounts.remote={capabilities:async()=>({ready:true,verify:true}),writeRequest:async()=>{}};
 assert.equal((await user.request('/agents','POST',{requestId:randomUUID(),username:'ag_Overflow',gamePassword:'isolated-legacy-password'})).data.error.reason,'AGENT_LIMIT');
 const flow=await join(f);await f.complete('fom',(await f.requests('fom'))[0]);
 await assert.rejects(join(f,'workshop','ag_multi'),e=>e.reason==='CANONICAL_ROLE_NAME_REQUIRED');
 await assert.rejects(f.portal.accounts.start(f.owner,'create',{requestId:randomUUID(),username:'ag_multi',gamePassword:'different-legacy-password'}),e=>e.reason==='SHARED_JOIN_REQUIRED');
});

test('legacy password mutation waits for the original network flow; unfinished single-server writes block migration',async t=>{
 const f=await fixture(t),name='ag_Pending',uuid=offlineUuid(name);f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(f.owner.id,uuid,'isolated primary owner',Date.now());
 const original=f.game.roster;f.game.roster=async()=>[...await original(),{name,playerUuid:uuid,available:true,isReserved:false}];
 const sent=new Map();f.portal.accounts.remote={capabilities:async()=>({ready:true,verify:true}),writeRequest:async(id,r)=>sent.set(id,r),readResult:async id=>({requestId:id,username:name,state:'waiting'})};
 const native=await f.portal.accounts.start(f.owner,'password',{requestId:randomUUID(),username:name,currentGamePassword:'isolated-shared-password',gamePassword:'legacy-waiting-password'});
 await assert.rejects(join(f,'fom',name),e=>e.reason==='ORIGINAL_ACCOUNT_JOB_PENDING');
 f.portal.store.db.prepare("UPDATE account_jobs SET state='failed' WHERE id=?").run(native.id);await join(f,'fom',name);
 await assert.rejects(f.portal.accounts.start(f.owner,'password',{requestId:randomUUID(),username:name,currentGamePassword:'isolated-shared-password',gamePassword:'would-diverge-password'}),e=>e.reason==='SHARED_PASSWORD_REQUIRED');
});

test('repeating the same invitation exchange remains idempotent after a native-world character is created',async t=>{
 const f=await fixture(t),invite=f.portal.agentAccess.issue(f.owner,{label:'fom retry',username:'ag_RegRepeat',serverId:'fom'}),body={requestId:randomUUID(),username:'ag_RegRepeat',clientSecret:randomBytes(32).toString('base64url')};
 await f.portal.agentAccess.register(invite.token,body);await join(f,'fom',body.username);await f.complete('fom',(await f.requests('fom'))[0]);
 assert.equal((await f.portal.agentAccess.register(invite.token,body)).duplicate,true);
});
