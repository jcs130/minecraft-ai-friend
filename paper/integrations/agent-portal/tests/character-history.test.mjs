import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import test from 'node:test';
import { characterHistoryCatalog, signCharacterHistory, verifyCharacterHistory } from '../src/character-history.mjs';
import { siteFixture, testPassword } from './helpers.mjs';

function fixture(ownerId = 'verified-owner', canonical = randomUUID()) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const active = { uuid:canonical, ownerId, identitySha256:'a'.repeat(64), state:'active' };
  const old = { uuid:randomUUID(), ownerId, identitySha256:'b'.repeat(64), state:'archived' };
  const plan = { schemaVersion:1, realmId:'isolated', notBefore:1000, expiresAt:3000,
    roles:[{ authoritative:active, history:[old] }] };
  return { privateKey, publicKey, plan, active, old, proofs:[active,old] };
}

test('review requires matching ownership and original role proofs and detects tampering', () => {
  const f = fixture();
  assert.throws(() => signCharacterHistory(f.plan, [f.active], f.privateKey), /changed/);
  assert.throws(() => signCharacterHistory(f.plan, [f.active, {...f.old, state:'active'}], f.privateKey), /changed/);
  const wrongOwner = { ...f.plan, roles:[{authoritative:f.active,history:[{...f.old,ownerId:'another-owner'}]}] };
  assert.throws(() => signCharacterHistory(wrongOwner, f.proofs, f.privateKey), /ownership conflict/);
  assert.throws(() => signCharacterHistory({...f.plan,roles:[...f.plan.roles,...f.plan.roles]}, f.proofs, f.privateKey),
    /Ambiguous/);
  const envelope = signCharacterHistory(f.plan, f.proofs, f.privateKey);
  assert.deepEqual(verifyCharacterHistory(envelope, f.publicKey), f.plan);
  assert.throws(() => verifyCharacterHistory({...envelope,plan:{...envelope.plan,expiresAt:4000}}, f.publicKey), /invalid/);
  const { publicKey:wrongKey } = generateKeyPairSync('ed25519');
  assert.throws(() => verifyCharacterHistory(envelope, wrongKey), /invalid/);
});

test('read-only redirect rechecks realm, time, active identity and archival status', async () => {
  const f = fixture();
  const envelope = signCharacterHistory(f.plan, f.proofs, f.privateKey);
  let current = f.proofs;
  let time = 2200;
  let reads = 0;
  const config = { envelope, publicKey:f.publicKey, realmId:f.plan.realmId, now:()=>time,
    async readProofs(owner, ids) {
      reads++;
      assert.equal(owner, f.active.ownerId);
      assert.deepEqual([...ids].sort(), [f.active.uuid,f.old.uuid].sort());
      return current;
    } };
  const catalogue = characterHistoryCatalog(config);
  assert.throws(() => characterHistoryCatalog({...config,realmId:'another-realm'}), /realm mismatch/);
  assert.equal(await catalogue.resolveCatalog(f.old.uuid,'another-owner'), null);
  assert.equal(await catalogue.resolveCatalog(f.active.uuid,f.active.ownerId), null);
  assert.equal(reads, 0);
  assert.equal(await catalogue.resolveCatalog(f.old.uuid,f.active.ownerId), f.active.uuid);
  current = [f.active,{...f.old,state:'active'}];
  assert.equal(await catalogue.resolveCatalog(f.old.uuid,f.active.ownerId), null);
  current = [{...f.active,identitySha256:'c'.repeat(64)},f.old];
  assert.equal(await catalogue.resolveCatalog(f.old.uuid,f.active.ownerId), null);
  current = f.proofs;
  time = f.plan.expiresAt;
  assert.equal(await catalogue.resolveCatalog(f.old.uuid,f.active.ownerId), null);
});

test('browsers get an owner-scoped catalogue redirect; body switches never resolve aliases', async t => {
  let verified;
  const calls = [];
  const site = await siteFixture(t, {}, { characterHistory: { resolveCatalog: (...args) => verified.resolveCatalog(...args) },
    characterBodies:{ current(characterId,{ownerId}) {
      calls.push({characterId,ownerId});
      return {characterId,activeKind:'numen',targetKinds:['mineflayer'],status:'ready',generation:3};
    }, switchBody() { throw Error('A historic UUID must not delegate any body control'); } }
  });
  const owner = site.portal.store.ownerByName('fixture-admin');
  const f = fixture(owner.id, site.uuid);
  let proofs = f.proofs;
  verified = characterHistoryCatalog({envelope:signCharacterHistory(f.plan,f.proofs,f.privateKey),publicKey:f.publicKey,
    realmId:f.plan.realmId,now:()=>1800,readProofs:()=>proofs});
  const path = '/api/v1/character-bodies/catalog/';
  assert.equal((await fetch(site.origin+path+f.old.uuid)).status,401);
  const session = await fetch(site.origin+'/api/v1/session');
  const csrf = (await session.json()).csrfToken;
  const login = await fetch(site.origin+'/api/v1/sessions',{method:'POST',headers:{
    Cookie:session.headers.get('set-cookie').split(';')[0], Origin:site.origin,'X-CSRF-Token':csrf,
    'Content-Type':'application/json',
  },body:JSON.stringify({username:'fixture-admin',password:testPassword})});
  assert.equal(login.status,200);
  const headers = {Cookie:login.headers.get('set-cookie').split(';')[0]};
  const db = site.portal.store.db;
  db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id,site.uuid,'fixture',Date.now());
  const redirected = await fetch(site.origin+path+f.old.uuid,{headers,redirect:'manual'});
  assert.equal(redirected.status,307);
  assert.equal(redirected.headers.get('location'),path+site.uuid);
  assert.equal(redirected.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(calls,[{characterId:site.uuid,ownerId:site.uuid}]);
  const followed = await fetch(site.origin+path+f.old.uuid,{headers});
  assert.equal((await followed.json()).characterId,site.uuid);
  const changed = await site.admin.request('/character-bodies/'+f.old.uuid+'/switch','POST',
    {requestId:randomUUID(),targetKind:'mineflayer',expectedGeneration:3});
  assert.equal(changed.status,404);
  proofs = [{...f.active,ownerId:'another-owner'},f.old];
  assert.equal((await fetch(site.origin+path+f.old.uuid,{headers,redirect:'manual'})).status,404);
});
