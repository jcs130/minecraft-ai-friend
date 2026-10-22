import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { siteFixture, testPassword } from './helpers.mjs';
import { normalizeEmail, smtpOptions, SmtpMailer } from '../src/email-auth.mjs';

async function emailSite(t, extra = {}) {
  const messages = [], sender = { ready: true, send: async message => { messages.push(message); } };
  const f = await siteFixture(t, { emailAuth: { registrationMode: 'email' }, emailSender: sender, ...extra });
  const guest = f.client(); await guest.init();
  const begin = (client = guest, values = {}) => client.request('/accounts', 'POST', { username: 'EmailUser', password: 'abc123', email: 'person@example.test', ...values });
  const verify = (client, response, values = {}) => client.request('/auth/email/verify', 'POST', { challengeId: response.data.challengeId, code: messages.at(-1).code, ...values });
  const cool = () => f.portal.store.db.prepare('UPDATE email_challenges SET created_at=created_at-61000').run();
  return { ...f, messages, sender, guest, begin, verify, cool };
}

test('email registration waits for verification, stores hashes only, accepts verified-email login and prevents reuse', async t => {
  const f = await emailSite(t); const response = await f.begin();
  assert.equal(response.status, 202); assert.equal(response.data.verificationRequired, true);
  assert.equal(f.portal.store.ownerByName('EmailUser'), undefined); assert.equal((await f.guest.request('/account')).status, 401);
  const serialized = JSON.stringify(f.portal.store.db.prepare('SELECT * FROM email_challenges').all());
  assert.ok(!serialized.includes('abc123')); assert.ok(!serialized.includes(f.messages[0].code)); assert.ok(!JSON.stringify(response.data).includes(f.messages[0].code));
  const confirmed = await f.verify(f.guest, response); assert.equal(confirmed.status, 200); assert.equal(confirmed.data.owner.username, 'EmailUser');
  assert.equal((await f.guest.request('/account')).data.email.address, 'person@example.test');
  assert.equal((await f.verify(f.guest, response)).status, 400);
  await f.guest.request('/session', 'DELETE');
  assert.equal((await f.guest.request('/sessions', 'POST', { username: 'PERSON@EXAMPLE.TEST', password: 'abc123' })).status, 200);
});

test('codes are tied to the requesting browser, expire, and lock after five incorrect guesses', async t => {
  const f = await emailSite(t), response = await f.begin(), other = f.client(); await other.init();
  assert.equal((await f.verify(other, response)).status, 400);
  const wrong = f.messages[0].code === '00000000' ? '11111111' : '00000000';
  for (let i = 0; i < 5; i++) assert.equal((await f.verify(f.guest, response, { code: wrong })).data.error.reason, 'EMAIL_CODE_INCORRECT');
  assert.equal((await f.verify(f.guest, response)).data.error.reason, 'EMAIL_CODE_EXPIRED');
  f.cool(); const expired = await f.begin(f.guest, { username: 'OtherUser' });
  f.portal.store.db.prepare('UPDATE email_challenges SET expires_at=? WHERE id=?').run(Date.now() - 1, expired.data.challengeId);
  assert.equal((await f.verify(f.guest, expired)).data.error.reason, 'EMAIL_CODE_EXPIRED');
  assert.equal(f.portal.store.countOwners(), 1);
});

test('email cooldown persists and a delivery failure never creates an account or changes a password', async t => {
  const f = await emailSite(t), response = await f.begin();
  assert.equal((await f.begin()).status, 429);
  f.sender.send = async () => { throw Error('SMTP provider error with private credential'); }; f.cool();
  const failed = await f.begin(f.guest, { username: 'DeliveryFailed', email: 'other@example.test' });
  assert.equal(failed.status, 503); assert.equal(failed.data.error.reason, 'EMAIL_DELIVERY_FAILED');
  assert.ok(!JSON.stringify(failed.data).includes('private credential')); assert.equal(f.portal.store.ownerByName('DeliveryFailed'), undefined);
  assert.equal((await f.verify(f.guest, response)).status, 200);
});

test('existing accounts bind a verified email without replacing owner UUID, game ownership or password', async t => {
  const f = await emailSite(t), original = f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(original.id, f.uuid, 'isolated original owner', Date.now());
  assert.equal((await f.admin.request('/account/email', 'POST', { email: 'admin@example.test', currentPassword: 'wrong' })).status, 401);
  const response = await f.admin.request('/account/email', 'POST', { email: 'admin@example.test', currentPassword: testPassword });
  assert.equal(response.status, 202); assert.equal((await f.verify(f.admin, response)).status, 200);
  assert.equal(f.portal.store.ownerByName('fixture-admin').id, original.id); assert.equal(f.portal.store.ownerByName('fixture-admin').password_hash, original.password_hash);
  assert.deepEqual(f.portal.store.ownedUuids(original.id), [f.uuid]);
  const stranger = f.client(); await stranger.init();
  const publicText = JSON.stringify((await stranger.request('/roster')).data); assert.ok(!publicText.includes('admin@example.test'));
});

test('password recovery revokes sessions and PATs, keeps game bindings, and requires a new login', async t => {
  const f = await emailSite(t); const registered = await f.begin(); await f.verify(f.guest, registered);
  const owner = f.portal.store.ownerByName('EmailUser');
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, f.uuid, 'isolated original owner', Date.now());
  const pat = await f.guest.request('/client-credentials', 'POST', { agentId: f.agent.id, label: 'Before reset' }); assert.equal(pat.status, 201);
  const resetter = f.client(); await resetter.init(); f.cool();
  const started = await resetter.request('/auth/password-reset', 'POST', { email: 'person@example.test' }); assert.equal(started.status, 202);
  const reset = await f.verify(resetter, started, { newPassword: 'new123' }); assert.equal(reset.status, 200); assert.equal(reset.data.passwordReset, true); assert.equal(reset.data.owner, null);
  assert.equal((await f.guest.request('/account')).status, 401);
  assert.equal((await f.client().request('/agents', 'GET', undefined, { Authorization: 'Bearer ' + pat.data.token })).status, 401);
  assert.equal((await resetter.request('/sessions', 'POST', { username: 'person@example.test', password: 'abc123' })).status, 401);
  assert.equal((await resetter.request('/sessions', 'POST', { username: 'EmailUser', password: 'new123' })).status, 200);
  assert.deepEqual(f.portal.store.ownedUuids(owner.id), [f.uuid]); assert.equal((await f.verify(resetter, started, { newPassword: 'new456' })).status, 400);
});

test('reset responses hide email existence and normal password changes invalidate outstanding recovery codes', async t => {
  const f = await emailSite(t); const started = await f.begin(); await f.verify(f.guest, started);
  f.cool(); const resetter = f.client(); await resetter.init();
  const known = await resetter.request('/auth/password-reset', 'POST', { email: 'person@example.test' }); const sent = f.messages.length, knownCode = f.messages.at(-1).code;
  const unknown = await resetter.request('/auth/password-reset', 'POST', { email: 'absent@example.test' });
  assert.equal(known.status, unknown.status); assert.equal(known.data.message, unknown.data.message); assert.equal(f.messages.length, sent);
  assert.equal((await f.guest.request('/account/password', 'POST', { currentPassword: 'abc123', newPassword: 'updated123' })).status, 200);
  assert.equal((await f.verify(resetter, known, { code: knownCode, newPassword: 'reset123' })).status, 400);
});

test('unconfigured email cannot silently fall back to unverified registration, while old usernames still log in', async t => {
  const f = await emailSite(t, { emailSender: { ready: false } });
  assert.equal((await f.guest.request('/session')).data.allowRegistration, false);
  assert.equal((await f.begin()).data.error.reason, 'EMAIL_NOT_CONFIGURED');
  assert.equal((await f.guest.request('/sessions', 'POST', { username: 'fixture-admin', password: testPassword })).status, 200);
  const caps = (await f.guest.request('/site')).data.emailAuth;
  assert.equal(caps.phone.available, false); assert.equal(caps.wechat.available, false);
});

test('SMTP configuration requires TLS and email normalization rejects header injection without rewriting provider aliases', () => {
  assert.equal(normalizeEmail('Person+Game@Example.test'), 'person+game@example.test');
  assert.throws(() => normalizeEmail('person@example.test\r\nBcc:evil@example.test'));
  const config = { host: 'smtp.example.test', port: 587, user: 'mailer', password: 'private-only', from: 'world@example.test' };
  const options = smtpOptions(config); assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.logger, false);
  assert.equal(smtpOptions({ ...config, port: 465, secure: true }).secure, true);
});

test('real SMTP connection refuses an unencrypted server before transmitting an authentication secret', async t => {
  const sockets = new Set(); let wire = '';
  const smtp = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.write('220 isolated.local ESMTP\r\n'); socket.on('data', bytes => { wire += bytes.toString(); if (/EHLO/.test(bytes.toString())) socket.write('250-isolated.local\r\n250 AUTH PLAIN\r\n'); else socket.write('502 Unsupported\r\n'); }); });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => smtp.close(resolve)); });
  const f = await siteFixture(t), file = path.join(f.root, 'private-mail.json');
  await fs.writeFile(file, JSON.stringify({ host: '127.0.0.1', port: smtp.address().port, user: 'isolated-user', password: 'never-sent-unencrypted', from: 'world@example.test' }));
  const sender = new SmtpMailer({ siteName: '千灯纪', emailAuth: { smtpConfigFile: file } });
  try { await assert.rejects(sender.send({ email: 'person@example.test', code: '12345678', purpose: 'register' })); } finally { sender.close(); }
  assert.ok(wire.includes('STARTTLS')); assert.ok(!wire.includes('AUTH PLAIN ')); assert.ok(!wire.includes('never-sent-unencrypted'));
});
