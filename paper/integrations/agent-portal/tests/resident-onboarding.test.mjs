import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {siteFixture} from './helpers.mjs';
import {ResidentTurns} from '../src/resident-turns.mjs';

function capacity(id, bodyKind) {
  const key = 'rwt_' + randomBytes(32).toString('base64url');
  return {key, slot:{id,bodyKind,bodyId:randomUUID(),ownerGameId:randomUUID(),workerHash:createHash('sha256').update(key).digest('hex')}};
}
async function call(f, path, payload, token) {
  const res = await fetch(f.origin + '/api/v1/' + path, {method:'POST', headers:{'Content-Type':'application/json',
    ...(token ? {Authorization:'Bearer ' + token} : {})}, body:JSON.stringify(payload)});
  return {status:res.status,...await res.json()};
}

test('website login requires both local confirmation and the original plugin secret', async t => {
  const f = await siteFixture(t,{residentCreationSlots:[capacity('blank','maid').slot]});
  const path = 'resident-onboarding/';
  const pending = await call(f,path+'browser-start',{});
  assert.equal(pending.status,201);
  assert.match(pending.code,/^\d{6}$/);
  const approve = {id:pending.id,code:pending.code};
  assert.equal((await call(f,path+'browser-approve',approve)).status,403);
  assert.equal((await f.admin.request('/'+path+'browser-approve','POST',approve,{'X-CSRF-Token':'invalid'})).status,403);
  assert.deepEqual(await call(f,path+'browser-status',{},pending.secret),{status:200,state:'pending'});
  const wrong = {...approve,code:pending.code === '123456' ? '123457' : '123456'};
  assert.equal((await f.admin.request('/'+path+'browser-approve','POST',wrong)).status,400);
  const accepted = await f.admin.request('/'+path+'browser-approve','POST',approve);
  assert.deepEqual(accepted.data,{authorized:true});
  assert.equal((await call(f,path+'browser-status',{},pending.id)).status,401);
  const status = await call(f,path+'browser-status',{},pending.secret);
  assert.equal(status.state,'authorized');
  assert.deepEqual(await call(f,path+'browser-status',{},pending.secret),status);
  assert.deepEqual((await call(f,path+'list',{},status.onboardingToken)).availableBodies,['maid']);
  const locked = await call(f,path+'browser-start',{});
  const digits = locked.code === '111111' ? '111112' : '111111';
  for (let i=0;i<5;i++) assert.equal((await f.admin.request('/'+path+'browser-approve','POST',{id:locked.id,code:digits})).status,400);
  assert.equal((await f.admin.request('/'+path+'browser-approve','POST',{id:locked.id,code:locked.code})).status,403);
  assert.equal((await call(f,path+'browser-status',{},locked.secret)).status,401);
});

test('an explicit website owner controls only the named resident without gaining game account ownership', async t => {
  const f = await siteFixture(t);
  const store = f.portal.store;
  const websiteOwnerId = store.db.prepare('SELECT id FROM owners LIMIT 1').get().id;
  const explicit = {...capacity('given','numen').slot,characterId:randomUUID(),name:'桐人',websiteOwnerId};
  const ordinary = {...capacity('other','maid').slot,characterId:randomUUID(),name:'结衣',ownerGameId:explicit.ownerGameId};
  const relay = new ResidentTurns({...f.config,residentTurns:[explicit,ordinary]},store);
  assert.deepEqual(relay.list(websiteOwnerId).residents.map(x=>x.id),['given']);
  assert.deepEqual(store.ownedUuids(websiteOwnerId),[]);
  assert.deepEqual(relay.list(randomUUID()).residents,[]);
  const second = randomUUID();
  store.db.prepare('INSERT INTO owners(id,username,normalized,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
    .run(second,'secondowner','secondowner','unused','owner',Date.now());
  store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)')
    .run(second,explicit.ownerGameId,'test',Date.now());
  assert.deepEqual(relay.list(websiteOwnerId).residents,[]);
  assert.deepEqual(relay.list(second).residents.map(x=>x.id),['other']);
});

test('maid-only production allows both website and plugin creation while preserving existing Numen', async t => {
  const existing = {...capacity('numen-existing','numen').slot,characterId:randomUUID(),name:'桐人'};
  const f = await siteFixture(t,{residentCreationMode:'maid-only',residentTurns:[existing],
    residentCreationSlots:[capacity('blank-maid','maid').slot,capacity('blank-agent','numen').slot]});
  const db = f.portal.store.db;
  const owner = db.prepare('SELECT id FROM owners LIMIT 1').get();
  db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)')
    .run(owner.id,existing.ownerGameId,'test',Date.now());
  const base = 'resident-onboarding/';
  const {data:{code}} = await f.admin.request('/'+base+'code','POST', {});
  const {onboardingToken} = await call(f,base+'pair',{code});
  const desktop = await call(f,base+'list',{},onboardingToken);
  assert.deepEqual(desktop.availableBodies,['maid']);
  assert.equal(desktop.residents[0].id,existing.id);
  const profile = {requestId:randomUUID(),bodyKind:'numen',name:'新朋友'};
  assert.equal((await call(f,base+'create',profile,onboardingToken)).error.reason,'MAID_ONLY');
  assert.equal((await f.admin.request('/resident-turns','POST',profile)).data.error.reason,'MAID_ONLY');
  const maid = {...profile,bodyKind:'maid',persona:'照看营地。'};
  const created = await f.admin.request('/resident-turns','POST',maid);
  assert.equal(created.status,201);
  const same = await call(f,base+'create',maid,onboardingToken);
  assert.deepEqual(same.resident,created.data.resident);
  assert.equal(db.prepare('SELECT count(*) AS n FROM resident_births').get().n,1);
});

test('a capacity registered to a player can only be allocated by that website account', async t => {
  const {slot} = capacity('personal','maid');
  const f = await siteFixture(t,{residentCreationSlots:[slot]});
  const store = f.portal.store;
  const player = store.db.prepare('SELECT id FROM owners LIMIT 1').get().id;
  store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)')
    .run(player,slot.ownerGameId,'fixture',Date.now());
  const relay = new ResidentTurns(f.config,store), stranger = randomUUID();
  assert.deepEqual(relay.list(player).availableBodies,['maid']);
  assert.deepEqual(relay.list(stranger).availableBodies,[]);
  const input = {requestId:randomUUID(),bodyKind:'maid',name:'星灯'};
  assert.throws(() => relay.create(stranger,input),e => e.reason === 'NO_BODY_CAPACITY');
  assert.equal(relay.create(player,input).state,'preparing');
  assert.equal((await f.admin.request('/resident-onboarding/code','POST',{}, {'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await call(f,'resident-onboarding/pair',{code:['2222-2222-2222']})).status,400);
});

for (const kind of ['maid','numen']) {
  test(kind + ' desktop creates, waits for native activation, connects and later reuses the same character', async t => {
    const {key,slot} = capacity('blank',kind), other = capacity('claimed','maid');
    Object.assign(other.slot,{name:'已有居民',characterId:randomUUID()});
    const f = await siteFixture(t,{residentCreationSlots:[slot],residentTurns:[other.slot]});
    const base = 'resident-onboarding/', row = 'resident-turns/blank/';
    async function signIn() {
      const {data:{code}} = await f.admin.request('/'+base+'code','POST',{});
      const [{onboardingToken}, replay] = await Promise.all([call(f,base+'pair',{code}),call(f,base+'pair',{code})])
        .then(results => results.sort((a,b) => a.status-b.status));
      assert.equal(replay.status,403);
      return onboardingToken;
    }
    const grant = await signIn();
    const parallel = await signIn();
    assert.equal((await call(f,base+'list',{},parallel)).status,200);
    const list = () => call(f,base+'list',{},grant);
    assert.deepEqual((await list()).availableBodies,[kind]);
    assert.deepEqual((await list()).residents,[]);
    assert.equal((await call(f,base+'connect',{id:other.slot.id,characterId:other.slot.characterId},grant)).status,404);
    const profile = {requestId:randomUUID(),bodyKind:kind,name:'灯灯',persona:'喜欢夜游。'};
    const [one,two] = await Promise.all([call(f,base+'create',profile,grant),call(f,base+'create',profile,grant)]);
    assert.equal(one.status,201); assert.deepEqual(one,two);
    const born = one.resident;
    assert.equal(born.state,'preparing'); assert.notEqual(born.characterId,slot.bodyId);
    assert.equal((await call(f,base+'create',{...profile,name:'另外一人'},grant)).status,409);
    assert.equal((await call(f,base+'create',{...profile,requestId:randomUUID()},grant)).status,409);
    assert.equal((await call(f,base+'connect',born,grant)).status,409);
    assert.equal((await f.admin.request('/'+row+'code','POST',{})).status,409);
    const identity = {bodyId:slot.bodyId,bodyKind:kind,ownerGameId:slot.ownerGameId};
    assert.equal((await call(f,row+'activation',identity,other.key)).status,401);
    assert.equal((await call(f,row+'activation',{...identity,bodyId:randomUUID()},key)).status,409);
    assert.equal((await call(f,row+'activation',{...identity,readyCharacterId:randomUUID()},key)).status,409);
    assert.deepEqual((await call(f,row+'activation',identity,key)).activation,{name:profile.name,persona:profile.persona,characterId:born.characterId});
    assert.equal((await call(f,row+'activation',{...identity,readyCharacterId:born.characterId},key)).status,200);
    assert.equal((await list()).residents[0].state,'available');
    const owner = f.portal.store.db.prepare('SELECT id FROM owners LIMIT 1').get().id;
    const restarted = new ResidentTurns(f.config,f.portal.store);
    assert.equal(restarted.list(owner).residents[0].characterId,born.characterId);
    assert.deepEqual(restarted.list(randomUUID()).residents,[]);
    assert.throws(() => new ResidentTurns({...f.config,residentCreationSlots:[{...slot,bodyId:randomUUID()}]},f.portal.store));
    assert.throws(() => new ResidentTurns({...f.config,residentCreationSlots:[],residentTurns:[{...other.slot,bodyId:slot.bodyId}]},f.portal.store));
    const session = await call(f,base+'connect',born,grant);
    assert.equal(session.status,200); assert.equal((await list()).status,401);
    assert.deepEqual(await call(f,base+'connect',born,grant),session);
    assert.equal((await call(f,'resident-turns/claimed/poll',{},session.token)).status,401);
    const again = await signIn();
    const second = await call(f,base+'connect',(await call(f,base+'list',{},again)).residents[0],again);
    assert.equal(second.resident.characterId,born.characterId);
    assert.equal((await call(f,row+'poll',{},session.token)).status,401);
    const start = await call(f,row+'begin',{},second.token);
    assert.equal((await call(f,row+'begin',{},second.token)).requestId,start.requestId);
    assert.equal((await call(f,row+'check',{},key)).requestId,start.requestId);
    const scene = {desktopRequestId:start.requestId,communication:{version:1,messages:[],outputs:[{mode:'native',scope:'nearby'}],maxTextChars:40}};
    const offer = {kind:'plan',instructions:'test',...identity,characterId:born.characterId,scene};
    assert.equal((await call(f,row+'offer',{...offer,scene:{...scene,desktopRequestId:randomUUID()}},key)).state,'local');
    const pending = call(f,row+'offer',offer,key);
    let turn;
    for (let i=0;i<25 && !turn;i++) { turn = (await call(f,row+'poll',{},second.token)).turn; if (!turn) await delay(10); }
    assert.ok(turn);
    assert.equal((await call(f,row+'check',{},key)).requestId,null);
    for (const invalid of [{mode:'speech',text:'你好'},{mode:'native',text:'你好',recipientId:'other'},{mode:'native',text:'你好',sourceEventId:'elsewhere'}]) {
      assert.equal((await call(f,row+'reply',{id:turn.id,answer:{communication:invalid}},second.token)).status,400);
    }
    const answer = {communication:{mode:'native',text:'你好'}};
    assert.equal((await call(f,row+'reply',{id:turn.id,answer},second.token)).accepted,true);
    assert.deepEqual((await pending).answer,answer);
  });
}
