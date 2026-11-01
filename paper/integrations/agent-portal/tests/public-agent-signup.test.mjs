import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {siteFixture,testPassword} from './helpers.mjs';
import {newSecret,verifyPassword} from '../src/store.mjs';
import {offlineUuid,seal} from '../src/game-accounts.mjs';
import {trialPoolOwnerId,isTrialAgent} from '../src/trial-pool.mjs';
import {runAgentAccess} from '../public/agent-register.mjs';

const body=(username='ag_Lite')=>({requestId:randomUUID(),clientSecret:newSecret(),username});
const fixture=t=>siteFixture(t,{agentAccess:{enabled:true,publicSignup:true}});
async function api(f,endpoint,method='GET',value,token,headers={}){
  const r=await fetch(f.origin+'/api/v1/agent-access/'+endpoint,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(value?{body:JSON.stringify(value)}:{})});
  return {status:r.status,data:await r.json(),headers:r.headers};
}
async function login(f,value){return (await api(f,'sessions','POST',{clientId:value.requestId,clientSecret:value.clientSecret})).data.token;}

test('public signup is an explicit policy, never inferred from a claimed plugin name',async t=>{
  const f=await siteFixture(t),value=body();
  assert.equal((await api(f,'public-register','POST',value,null,{'User-Agent':'Cortico-Lite official'})).data.error.reason,'PUBLIC_SIGNUP_DISABLED');
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n,0);
  f.config.agentAccess.publicSignup=true;
  const caps=await (await fetch(f.origin+'/api/v1/agent-access')).json();
  assert.equal(caps.publicSignup.enabled,true);assert.equal(caps.invitationRequired,false);assert.equal(caps.publicSignup.role,'ordinary_agent');
  for(const headers of [{Origin:f.origin},{Cookie:'browser=present'}])assert.equal((await api(f,'public-register','POST',value,null,headers)).status,403);
  assert.equal((await api(f,'public-register','POST',value)).status,201);
  const secretOwner=f.portal.store.ownerById(trialPoolOwnerId(f.portal.store));
  assert.equal(secretOwner.role,'owner');assert.equal(await verifyPassword('anything',secretOwner.password_hash),false);
});

test('public registration retries recover one identity; collisions and altered credentials cannot claim it',async t=>{
  const f=await fixture(t),value=body();
  const first=await api(f,'public-register','POST',value);assert.equal(first.status,201);assert.equal(first.data.ownership,'experience_pool');
  assert.equal((await api(f,'public-register','POST',value)).data.duplicate,true);
  for(const changed of [{...value,clientSecret:newSecret()},{...value,username:'ag_Other'}])assert.equal((await api(f,'public-register','POST',changed)).status,409);
  assert.equal((await api(f,'public-register','POST',body('ag_lite'))).data.error.reason,'AGENT_NAME_RESERVED');
  f.game.roster=async()=>[{...f.agent,name:'ag_Existing'}];
  assert.equal((await api(f,'public-register','POST',body('ag_Existing'))).data.error.reason,'ACCOUNT_EXISTS');
  for(const name of ['live','ag_Live','ag_TestEye','ag_12345678901234','ag_'])assert.ok([400,403].includes((await api(f,'public-register','POST',body(name))).status));
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n,1);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n,0);
});

test('public network quota persists and original retries work when the new-registration quota is full',async t=>{
  const f=await fixture(t),values=[];
  for(let i=0;i<6;i++){values.push(body('ag_Limit'+i));assert.equal((await api(f,'public-register','POST',values[i])).status,201);}
  const denied=await api(f,'public-register','POST',body('ag_Limit6'));
  assert.equal(denied.status,429);assert.equal(denied.data.error.reason,'PUBLIC_REGISTRATION_LIMIT');assert.ok(Number(denied.headers.get('retry-after'))>0);
  assert.equal((await api(f,'public-register','POST',values[0])).status,200);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_public_registrations').get().n,6);
  const rows=f.portal.store.db.prepare('SELECT address_hash FROM agent_public_registrations').all();assert.ok(rows.every(row=>/^[a-f0-9]{64}$/.test(row.address_hash)));
});

test('public signup shares the existing experience-pool capacity and cannot expand owner or administrator authority',async t=>{
  const f=await fixture(t),value={...body(),role:'admin',op:true,ownerId:'requested-owner',permissions:['*']};
  assert.equal((await api(f,'public-register','POST',value)).status,201);const token=await login(f,value);
  for(const endpoint of ['/api/v1/admin/owners','/api/v1/agents','/api/v1/agent-invites']){
    const response=await fetch(f.origin+endpoint,{headers:{Authorization:'Bearer '+token}});assert.ok([401,403].includes(response.status),endpoint);
  }
  const status=await api(f,'status','GET',undefined,token);assert.equal(status.data.gameAccountCreated,false);assert.equal(status.data.ownership,'experience_pool');
  assert.equal((await api(f,'register','POST',body('ag_NoInvite'))).data.error.reason,'INVITE_REQUIRED');
  const admin=f.portal.store.db.prepare("SELECT * FROM owners WHERE role='admin'").get();
  for(let i=0;i<4;i++)f.portal.agentAccess.pool.issue(admin,{requestId:randomUUID(),clientSecret:newSecret(),count:20});
  f.portal.agentAccess.pool.issue(admin,{requestId:randomUUID(),clientSecret:newSecret(),count:19});
  assert.equal((await api(f,'public-register','POST',body('ag_Full'))).data.error.reason,'TRIAL_POOL_FULL');
});

test('public Agent uses the encrypted creation receipt and transfers only after the existing in-game ownership proof',async t=>{
  const f=await fixture(t),key=randomBytes(32),dir=path.join(f.root,'bridge'),keyFile=path.join(f.root,'bridge.key');
  await fs.mkdir(path.join(dir,'results'),{recursive:true});await fs.writeFile(keyFile,key.toString('hex'));
  Object.assign(f.config.authBridge,{enabled:true,directory:dir,keyFile});
  const heartbeat=()=>fs.writeFile(path.join(dir,'heartbeat.json'),seal(key,'heartbeat',{ready:true,at:Date.now()}));
  const receipt=(id,result)=>fs.writeFile(path.join(dir,'results',id+'.json'),seal(key,'result:'+id,{requestId:id,...result}));
  const value=body('ag_LiteBody'),uuid=offlineUuid(value.username);assert.equal((await api(f,'public-register','POST',value)).status,201);const token=await login(f,value),id=randomUUID();
  await heartbeat();assert.equal((await api(f,'activate','POST',{requestId:id,gamePassword:'isolated-public-game-password'},token)).status,202);
  assert.ok(['pending','unknown'].includes((await api(f,'status','GET',undefined,token)).data.state));
  const retry=await api(f,'activate','POST',{requestId:randomUUID(),gamePassword:'not-a-replacement'},token);assert.equal(retry.status,409);
  await receipt(id,{state:'succeeded',username:value.username,playerUuid:uuid});
  assert.equal((await api(f,'status','GET',undefined,token)).data.state,'ready');assert.equal(isTrialAgent(f.portal.store,uuid),true);
  f.game.roster=async()=>[f.agent,{...f.agent,id:'d'.repeat(24),name:value.username,playerUuid:uuid}];
  const user=f.client();await user.init();await user.request('/accounts','POST',{username:'LiteOwner',password:testPassword});
  const claimId=randomUUID();await heartbeat();assert.equal((await user.request('/agent-claims','POST',{username:value.username,requestId:claimId})).status,202);
  assert.equal(isTrialAgent(f.portal.store,uuid),true);
  await receipt(claimId,{state:'succeeded',username:value.username,playerUuid:uuid});assert.equal((await user.request('/jobs/'+claimId)).data.state,'succeeded');
  assert.equal(isTrialAgent(f.portal.store,uuid),false);assert.equal((await api(f,'status','GET',undefined,token)).data.job.id,id);
  assert.equal((await api(f,'public-register','POST',value)).data.duplicate,true);
  assert.equal(f.portal.store.db.prepare("SELECT count(*) AS n FROM account_jobs WHERE operation='create'").get().n,1);
});

test('join-plugin saves credentials before exchange and resumes the same identity without inventing game success',async t=>{
  const f=await fixture(t),file=path.join(f.root,'private','identity.json'),args=['join-plugin','--portal',f.origin,'--username','ag_LiteHelper','--identity-file',file],output=[];
  assert.equal(await runAgentAccess(args,line=>output.push(line),{maxWaitMs:5,pollIntervalMs:1}),2);
  const before=JSON.parse(await fs.readFile(file,'utf8'));assert.match(before.clientSecret,/^[A-Za-z0-9_-]{43}$/);assert.equal(before.joinRegistered,true);
  assert.equal(JSON.parse(output.at(-1)).state,'awaiting_game_bridge');
  assert.equal(await runAgentAccess(args,line=>output.push(line),{maxWaitMs:5,pollIntervalMs:1}),2);
  const after=JSON.parse(await fs.readFile(file,'utf8'));for(const key of ['clientId','clientSecret','gameRequestId','gamePassword'])assert.equal(after[key],before[key]);
  for(const secret of [before.clientSecret,before.gamePassword,before.token])assert.ok(!output.join('\n').includes(secret));
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n,1);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n,0);
});
