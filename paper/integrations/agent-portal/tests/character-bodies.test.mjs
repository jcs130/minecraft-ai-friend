import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {siteFixture} from './helpers.mjs';

const path='/character-bodies';

test('desktop view requires explicit two-sided approval and only reads original owner-scoped bodies and receipts', async t => {
  const requestId=randomUUID(), calls=[];
  const f=await siteFixture(t,{}, {characterBodies:{
    current(characterId,{ownerId}) {
      calls.push(['view',ownerId]);
      return {characterId,activeKind:'mineflayer',targetKinds:['numen'],status:'ready',generation:2};
    },
    lookup({characterId,requestId:id},{ownerId}) {
      calls.push(['receipt',ownerId,id]);
      return {characterId,requestId:id,targetKind:'numen',activeKind:'numen',status:'completed',phase:'completed',generation:2};
    },
    switchBody() { throw Error('Desktop reads must not change the driver'); }
  }});
  const owner=f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id,f.uuid,'fixture',Date.now());
  async function machine(url,{token,method='GET',body,headers={}}={}) {
    const response=await fetch(f.origin+'/api/v1'+url,{method,headers:{
      ...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers
    },...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  }
  async function login(requested,approved) {
    const {data:grant}=await machine('/resident-onboarding/browser-start',{method:'POST',body:requested?{bodyRead:true}:{}});
    const args={id:grant.id,code:grant.code,...(approved?{bodyRead:true}:{})};
    assert.equal((await f.admin.request('/resident-onboarding/browser-approve','POST',args)).status,200);
    return (await machine('/resident-onboarding/browser-status',{method:'POST',token:grant.secret,body:{}})).data;
  }
  for(const [requested,approved] of [[false,false],[false,true],[true,false]]) {
    const grant=await login(requested,approved);
    assert.equal(grant.bodyReadExpiresAt,undefined);
    assert.equal((await machine(path,{token:grant.onboardingToken})).status,401);
  }
  const grant=await login(true,true), token=grant.onboardingToken;
  assert.equal(grant.bodyReadExpiresAt,grant.expiresAt);
  const list=await machine(path,{token});
  assert.equal(list.status,200); assert.equal(list.data.characters[0].characterId,f.uuid);
  const receiptPath=path+'/'+f.uuid+'/switch/'+requestId;
  assert.equal((await machine(receiptPath,{token})).data.requestId,requestId);
  assert.deepEqual(calls,[['view',f.uuid],['receipt',f.uuid,requestId]]);
  assert.equal((await machine(path+'/'+randomUUID()+'/switch/'+requestId,{token})).status,404);
  assert.equal((await machine(path,{token,headers:{Origin:f.origin}})).status,403);
  assert.equal((await machine(path+'/'+f.uuid+'/switch',{method:'POST',body:{requestId,targetKind:'numen',expectedGeneration:2},token})).status,403);
  assert.equal(calls.length,2);
  f.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(f.uuid);
  assert.deepEqual((await machine(path,{token})).data.characters,[]);
  assert.equal((await machine(receiptPath,{token})).status,404);
  f.portal.store.db.prepare('UPDATE resident_onboarding SET connected=? WHERE owner=?').run('consumed',owner.id);
  assert.equal((await machine(path,{token})).status,401);
});
function role(id) {
  return {id,name:id,characterId:randomUUID(),bodyId:randomUUID(),bodyKind:'numen',ownerGameId:randomUUID(),
    workerHash:createHash('sha256').update(randomUUID()).digest('hex')};
}

test('unconfigured body selection is unavailable; the website must authenticate even for reads', async t=>{
  const f=await siteFixture(t);
  assert.equal((await f.client().request(path)).status,401);
  assert.deepEqual((await f.admin.request(path)).data,{available:false,characters:[]});
});

test('an owned original player can switch without being registered as an independent resident', async t=>{
  const calls=[];
  const f=await siteFixture(t,{}, {characterBodies:{
    current(characterId,{ownerId}){
      calls.push({characterId,ownerId});
      return {characterId,activeKind:'mineflayer',targetKinds:['numen'],status:'ready',generation:4,autonomous:true};
    },
  }});
  assert.deepEqual((await f.admin.request(path)).data.characters,[]);
  const owner=f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id,f.uuid,'fixture',Date.now());
  const {characters}=(await f.admin.request(path)).data;
  assert.deepEqual(calls,[{characterId:f.uuid,ownerId:f.uuid}]);
  assert.equal(characters[0].characterId,f.uuid);
  assert.equal(characters[0].name,f.agent.name);
  assert.equal(characters[0].autonomous,true);
  f.agent.identityConflict=true;
  assert.deepEqual((await f.admin.request(path)).data.characters,[]);
  assert.equal(calls.length,1);
});

test('public selection and receipts are scoped by current ownership and the original character and request', async t=>{
  const ours=role('kirito'), other=role('neighbor'), calls=[];
  const current={characterId:ours.characterId,activeKind:'numen',targetKinds:['maid'],generation:3,status:'ready',pendingRequestId:null};
  const requestId=randomUUID(), change={requestId,targetKind:'maid',expectedGeneration:3};
  const done={characterId:ours.characterId,requestId,targetKind:'maid',generation:4,activeKind:'maid',
    status:'completed',phase:'completed',reason:null};
  let output=done;
  const provider={
    current:async (c,auth)=>{calls.push(['read',c,auth]);return {...current,sessionKey:'never-show-this'};},
    switchBody:async (payload,auth)=>{calls.push(['switch',payload,auth]);return {...output,token:'never-show-this'};},
    lookup:async (payload,auth)=>{calls.push(['receipt',payload,auth]);return output;},
  };
  const f=await siteFixture(t,{residentTurns:[ours,other]},{characterBodies:provider});
  const siteOwner=f.portal.store.ownerByName('fixture-admin');
  const db=f.portal.store.db;
  db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(siteOwner.id,ours.ownerGameId,'fixture',Date.now());
  const base=path+'/'+ours.characterId+'/switch', ref=base+'/'+requestId;
  const read=await f.admin.request(path);
  assert.equal(read.status,200);
  assert.equal(read.data.available,true);
  assert.equal(read.data.characters.length,1);
  assert.equal(read.data.characters[0].characterId,ours.characterId);
  assert.equal(JSON.stringify(read.data).includes('never-show-this'),false);
  assert.deepEqual(calls,[['read',ours.characterId,{ownerId:ours.ownerGameId}]]);
  assert.notEqual(siteOwner.id,ours.ownerGameId);
  assert.equal((await f.admin.request(path+'/'+other.characterId+'/switch','POST',change)).status,404);
  assert.equal((await f.admin.request(path+'/'+other.characterId+'/switch/'+requestId)).status,404);
  assert.equal((await f.admin.request(base,'POST',{...change,ownerId:other.ownerGameId})).status,400);
  assert.equal((await f.admin.request(base,'POST',change,{Origin:'https://another.invalid'})).status,403);
  assert.equal((await f.admin.request(base,'POST',change,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal(calls.length,1);
  const switched=await f.admin.request(base,'POST',change);
  assert.equal(switched.status,200);assert.deepEqual(switched.data,done);
  assert.deepEqual(calls.at(-1),['switch',{characterId:ours.characterId,...change},{ownerId:ours.ownerGameId}]);
  assert.deepEqual((await f.admin.request(ref)).data,done);
  assert.deepEqual(calls.at(-1),['receipt',{characterId:ours.characterId,requestId},{ownerId:ours.ownerGameId}]);
  output={...done,requestId:randomUUID()};
  assert.equal((await f.admin.request(ref)).status,502);
  output={...done,characterId:other.characterId};
  assert.equal((await f.admin.request(ref)).status,502);
  db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(ours.ownerGameId);
  const count=calls.length;
  assert.equal((await f.admin.request(ref)).status,404);
  assert.equal((await f.admin.request(base,'POST',change)).status,404);
  assert.deepEqual((await f.admin.request(path)).data.characters,[]);
  assert.equal(calls.length,count);
});
