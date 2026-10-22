import test from 'node:test';
import assert from 'node:assert/strict';
import { siteFixture } from './helpers.mjs';

async function fixture(t, options = {}) {
  const messages = [];
  const f = await siteFixture(t, { emailAuth: { registrationMode: 'optional-email' },
    emailSender: { ready: options.mailReady !== false, send: async value => messages.push(value) }, ...options });
  const guest = f.client(); await guest.init();
  const signup = values => guest.request('/accounts', 'POST', { username: 'SimpleUser', password: 'abc123', ...values });
  return { ...f, guest, messages, signup };
}

test('optional-email creates a normal password owner without mail and never requires a mail service', async t => {
  const f = await fixture(t, { mailReady: false });
  const capability = (await f.guest.init()).data;
  assert.equal(capability.allowRegistration, true);
  assert.equal(capability.emailAuth.registrationOptions.usernamePassword, true);
  assert.equal(capability.emailAuth.registrationOptions.emailVerification, false);
  const created = await f.signup({});
  assert.equal(created.status, 201); assert.equal(created.data.owner.username, 'SimpleUser'); assert.equal(created.data.owner.role, 'owner');
  assert.equal(f.messages.length, 0);
  assert.equal((await f.guest.request('/account')).data.email.verified, false);
  assert.ok(!f.portal.store.ownerByName('SimpleUser').password_hash.includes('abc123'));
  await f.guest.request('/session', 'DELETE');
  assert.equal((await f.guest.request('/sessions', 'POST', { username: 'simpleuser', password: 'abc123' })).status, 200);
});

test('an optional email still requires the delivered code before creating any account', async t => {
  const f = await fixture(t), response = await f.signup({ email: 'person@example.test' });
  assert.equal(response.status, 202); assert.equal(f.portal.store.ownerByName('SimpleUser'), undefined);
  assert.equal((await f.guest.request('/account')).status, 401);
  const done = await f.guest.request('/auth/email/verify', 'POST', { challengeId: response.data.challengeId, code: f.messages[0].code });
  assert.equal(done.status, 200); assert.equal(done.data.owner.username, 'SimpleUser');
  assert.equal((await f.guest.request('/account')).data.email.verified, true);
  await f.guest.request('/session', 'DELETE');
  assert.equal((await f.guest.request('/sessions', 'POST', { username: 'person@example.test', password: 'abc123' })).status, 200);
});

test('an explicitly blank email creates the password account without a code', async t => {
  const f = await fixture(t), response = await f.signup({ email: '' });
  assert.equal(response.status, 201); assert.equal(f.messages.length, 0);
  assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM email_challenges').get().n, 0);
});

test('unavailable mail cannot silently discard a supplied address but allows a deliberate blank retry', async t => {
  const f = await fixture(t, { mailReady: false });
  const failed = await f.signup({ email: 'person@example.test' });
  assert.equal(failed.status, 503); assert.equal(failed.data.error.reason, 'EMAIL_NOT_CONFIGURED');
  assert.match(failed.data.error.message, /清空邮箱/); assert.equal(f.portal.store.ownerByName('SimpleUser'), undefined);
  assert.equal((await f.signup({ email: '' })).status, 201);
});

test('a malformed supplied optional email is rejected instead of being treated as verified or omitted', async t => {
  const f = await fixture(t);
  for (const email of [null, 'invalid-address', 'a@example.test\r\nBcc:other@example.test']) {
    const response = await f.signup({ email });
    assert.equal(response.status, 400); assert.equal(response.data.error.reason, 'INVALID_EMAIL');
  }
  assert.equal(f.portal.store.ownerByName('SimpleUser'), undefined); assert.equal(f.messages.length, 0);
});

test('operator registration closure and existing-name protection apply to lightweight accounts', async t => {
  const closed = await fixture(t, { allowRegistration: false });
  assert.equal((await closed.signup({})).data.error.reason, 'REGISTRATION_CLOSED');
  assert.equal(closed.portal.store.countOwners(), 1);
  const open = await fixture(t);
  assert.equal((await open.signup({})).status, 201);
  assert.equal((await open.signup({ username: 'simpleuser' })).data.error.reason, 'USERNAME_TAKEN');
  assert.equal((await open.signup({ username: 'TooShort', password: '12345' })).data.error.reason, 'INVALID_PASSWORD');
});

test('required-email mode retains verification and does not inherit the optional path', async t => {
  const f = await fixture(t, { emailAuth: { registrationMode: 'email' } });
  assert.equal((await f.signup({})).data.error.reason, 'INVALID_EMAIL');
  assert.equal((await f.signup({ email: '' })).data.error.reason, 'INVALID_EMAIL');
  assert.equal(f.portal.store.countOwners(), 1);
});
