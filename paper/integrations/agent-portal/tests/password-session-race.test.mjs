import test from 'node:test';
import assert from 'node:assert/strict';
import { siteFixture, testPassword } from './helpers.mjs';
import { hashPassword, verifyPassword } from '../src/store.mjs';

const changedPassword = 'isolated-changed-password';
const login = (client, password = testPassword, username = 'fixture-admin') =>
  client.request('/sessions', 'POST', { username, password });

function pausedVerification() {
  const reached = Promise.withResolvers(), release = Promise.withResolvers();
  let paused = false;
  return { reached: reached.promise, release: release.resolve, async verify(password, hash) {
    const valid = await verifyPassword(password, hash);
    if (paused || !valid || password !== testPassword) return valid;
    paused = true; reached.resolve(); await release.promise;
    return valid;
  } };
}

async function assertStale(request, client) {
  const rejected = await request;
  const account = await client.request('/account');
  assert.deepEqual([rejected.status, account.status], [401, 401], 'an already verified old password cannot sign or use a session');
  assert.equal(rejected.data.error.reason, 'LOGIN_FAILED');
  assert.equal(rejected.response.headers.get('set-cookie'), null);
}

test('password change revokes previous sessions and blocks a paused old-password login', { timeout: 15000 }, async t => {
  const pause = pausedVerification();
  const f = await siteFixture(t, {}, { verifyPassword: pause.verify });
  const stale = f.client(), prior = f.client(), fresh = f.client(), other = f.client();
  await Promise.all([stale.init(), prior.init(), fresh.init(), other.init()]);
  const separatePassword = 'isolated-other-owner-password';
  const owner = f.portal.store.ownerByName('fixture-admin');
  const second = f.portal.store.createOwner('SecondOwner', await hashPassword(separatePassword));
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, f.uuid, 'isolated owner', Date.now());
  const pending = login(stale);
  try {
    await pause.reached;
    assert.equal((await login(prior)).status, 200, 'session issued before change must be revoked');
    const [change, different] = await Promise.all([
      f.admin.request('/account/password', 'POST', { currentPassword: testPassword, newPassword: changedPassword }),
      login(other, separatePassword, second.username),
    ]);
    assert.equal(change.status, 200);
    assert.equal(different.status, 200);
  } finally { pause.release(); }
  await assertStale(pending, stale);
  assert.equal((await prior.request('/account')).status, 401);
  assert.equal((await other.request('/account')).data.owner.id, second.id);
  assert.equal((await f.admin.request('/account')).data.owner.id, owner.id);
  assert.deepEqual(f.portal.store.ownedUuids(owner.id), [f.uuid]);
  assert.equal((await login(fresh, 'isolated-wrong-password')).status, 401);
  assert.equal((await login(fresh, changedPassword)).status, 200);
  assert.equal((await f.admin.request('/account/password', 'POST', { currentPassword: testPassword, newPassword: changedPassword })).status, 401);
});

test('email recovery rejects a paused old-password login and consumes the reset only once', { timeout: 15000 }, async t => {
  const pause = pausedVerification(), mail = [];
  const f = await siteFixture(t, { emailSender: { ready: true, send: async message => mail.push(message) } }, { verifyPassword: pause.verify });
  const owner = f.portal.store.ownerByName('fixture-admin');
  const email = 'reset-fixture@example.test';
  f.portal.store.db.prepare('INSERT INTO owner_emails VALUES(?,?,?)').run(owner.id, email, Date.now());
  const stale = f.client(), recovery = f.client(), fresh = f.client();
  await Promise.all([stale.init(), recovery.init(), fresh.init()]);
  const started = await recovery.request('/auth/password-reset', 'POST', { email });
  assert.equal(started.status, 202);
  const pending = login(stale);
  try {
    await pause.reached;
    const body = { challengeId: started.data.challengeId, code: mail[0].code, newPassword: changedPassword };
    const attempts = await Promise.all([1, 2].map(() => recovery.request('/auth/email/verify', 'POST', body)));
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 400]);
    assert.equal(attempts.find(r => r.status === 200).data.passwordReset, true);
  } finally { pause.release(); }
  await assertStale(pending, stale);
  assert.equal((await f.admin.request('/account')).status, 401);
  assert.equal((await recovery.request('/account')).status, 401);
  assert.equal((await login(fresh, changedPassword, email)).status, 200);
  assert.equal((await fresh.request('/account')).data.owner.id, owner.id);
});


test('overlapping password changes cannot both consume the same credential version', { timeout: 15000 }, async t => {
  const pause = pausedVerification();
  const f = await siteFixture(t, {}, { verifyPassword: pause.verify });
  const changed = newPassword => f.admin.request('/account/password', 'POST', { currentPassword: testPassword, newPassword });
  const delayed = changed('isolated-delayed-rotation');
  try {
    await pause.reached;
    assert.equal((await changed(changedPassword)).status, 200);
  } finally { pause.release(); }
  assert.equal((await delayed).status, 401);
  const fresh = f.client(); await fresh.init();
  assert.equal((await login(fresh, changedPassword)).status, 200);
});
