import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Store } from '../src/store.mjs';
import { LoginThrottle } from '../src/login-throttle.mjs';
import { siteFixture, testPassword } from './helpers.mjs';

function guardFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-auth-throttle-'));
  let now = Date.now(), store = new Store(directory);
  const guard = () => new LoginThrottle(store, () => now);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true }); });
  return { guard, advance: ms => { now += ms; }, db: () => store.db,
    reopen() { store.close(); store = new Store(directory); } };
}

test('failed attempts cool down, lock after five, do not extend on rejected calls, and recover', t => {
  const f = guardFixture(t), g = f.guard();
  for (let n = 1; n <= 5; n++) {
    g.reserve('192.0.2.1', 'owner:one');
    if (n >= 3) assert.throws(() => g.reserve('192.0.2.1', 'owner:one'), error => error.status === 429 && error.retryAfterSeconds > 0);
    if (n < 5) f.advance(2500);
  }
  f.advance(60_000);
  assert.throws(() => g.reserve('192.0.2.1', 'owner:one'), error => error.retryAfterSeconds === 240);
  f.advance(240_001);
  const ticket = g.reserve('192.0.2.1', 'owner:one'); g.succeeded(ticket);
  assert.doesNotThrow(() => g.reserve('192.0.2.1', 'owner:one'));
});

test('restart preserves lock state and counters contain no raw account or address', t => {
  const f = guardFixture(t);
  for (let n = 0; n < 5; n++) { f.guard().reserve('192.0.2.42', 'private-account-name'); f.advance(2500); }
  const rows = f.db().prepare('SELECT * FROM login_throttles').all();
  assert.ok(rows.length); assert.doesNotMatch(JSON.stringify(rows), /private-account-name|192\.0\.2/);
  for (const row of rows) assert.match(row.key_hash, /^[a-f0-9]{64}$/);
  f.reopen(); assert.throws(() => f.guard().reserve('192.0.2.42', 'private-account-name'), { reason: 'LOGIN_THROTTLED' });
});

test('rotating IPs cannot bypass the account budget; another account on another IP is unaffected', t => {
  const f = guardFixture(t), g = f.guard();
  for (let n = 0; n < 10; n++) g.reserve('192.0.2.' + n, 'owner:target');
  assert.throws(() => g.reserve('198.51.100.1', 'owner:target'), { status: 429 });
  assert.doesNotThrow(() => g.reserve('198.51.100.1', 'owner:unrelated'));
  f.advance(60_001); assert.doesNotThrow(() => g.reserve('198.51.100.1', 'owner:target'));
});

test('successful logins do not reset the IP password-spray budget; IPv4-mapped addresses share it', t => {
  const f = guardFixture(t), g = f.guard();
  for (let n = 0; n < 30; n++) g.succeeded(g.reserve('192.0.2.1', 'owner:' + n));
  assert.throws(() => g.reserve('::ffff:192.0.2.1', 'another-owner'), { status: 429 });
});

test('new CSRF sessions do not clear counters, valid passwords remain blocked until cooldown, and no session is granted', async t => {
  let now = Date.now(); const f = await siteFixture(t, {}, { now: () => now });
  for (let n = 0; n < 5; n++) {
    const c = f.client(); await c.init();
    const response = await c.request('/sessions', 'POST', { username: n % 2 ? 'FIXTURE-ADMIN' : 'fixture-admin', password: 'wrong-password' });
    assert.equal(response.status, 401); now += 2500;
  }
  const c = f.client(); await c.init();
  const blocked = await c.request('/sessions', 'POST', { username: 'fixture-admin', password: testPassword });
  assert.equal(blocked.status, 429); assert.equal(blocked.data.error.reason, 'LOGIN_THROTTLED');
  assert.equal(Number(blocked.response.headers.get('retry-after')), blocked.data.error.retryAfterSeconds);
  assert.equal((await c.request('/session')).data.owner, null);
  now += 300_001;
  assert.equal((await c.request('/sessions', 'POST', { username: 'fixture-admin', password: testPassword })).status, 200);
});

test('concurrent password requests reserve budget before async scrypt; unknown usernames have the same responses', async t => {
  const f = await siteFixture(t);
  for (const username of ['fixture-admin', 'not-an-account']) {
    const clients = await Promise.all(Array.from({ length: 8 }, async () => { const c = f.client(); await c.init(); return c; }));
    const attempts = await Promise.all(clients.map(c => c.request('/sessions', 'POST', { username, password: 'wrong-password' })));
    assert.equal(attempts.filter(r => r.status === 401).length, 3);
    assert.equal(attempts.filter(r => r.status === 429).length, 5);
    for (const reply of attempts) assert.match(reply.data.error.reason, /^(LOGIN_FAILED|LOGIN_THROTTLED)$/);
  }
});

test('verified email and username aliases share the canonical owner budget across proxy visitors', async t => {
  const f = await siteFixture(t, { publicOrigin: 'https://world.example.test' });
  const owner = f.portal.store.ownerByName('fixture-admin');
  f.portal.store.db.prepare('INSERT INTO owner_emails(owner_id,email,verified_at) VALUES(?,?,?)').run(owner.id, 'member@example.test', Date.now());
  function request(endpoint, method = 'GET', body, cookie = '', csrf = '', peer = '192.0.2.1') {
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(f.origin + '/api/v1' + endpoint, { method, headers: {
        Host: 'world.example.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': peer,
        Origin: 'https://world.example.test', Cookie: cookie, 'X-CSRF-Token': csrf,
        ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}),
      } }, res => { let raw = ''; res.on('data', chunk => { raw += chunk; }); res.on('end', () => resolve({ status: res.statusCode,
        data: JSON.parse(raw), cookie: res.headers['set-cookie']?.[0].split(';')[0] })); });
      req.on('error', reject); req.end(bytes);
    });
  }
  for (let n = 0; n < 10; n++) {
    const peer = '192.0.2.' + n, session = await request('/session', 'GET', undefined, '', '', peer);
    const reply = await request('/sessions', 'POST', { username: n % 2 ? 'member@example.test' : 'FIXTURE-ADMIN', password: 'wrong-password' }, session.cookie, session.data.csrfToken, peer);
    assert.equal(reply.status, 401);
  }
  const session = await request('/session');
  assert.equal((await request('/sessions', 'POST', { username: 'member@example.test', password: testPassword }, session.cookie, session.data.csrfToken, '198.51.100.1')).status, 429);
});

test('website password confirmation uses the same counter instead of a parallel guessing endpoint', async t => {
  let now = Date.now(); const f = await siteFixture(t, {}, { now: () => now });
  for (let n = 0; n < 5; n++) {
    assert.equal((await f.admin.request('/account/reauth', 'POST', { password: 'wrong-password' })).status, 401);
    now += 2500;
  }
  const c = f.client(); await c.init();
  assert.equal((await c.request('/sessions', 'POST', { username: 'fixture-admin', password: testPassword })).status, 429);
  assert.equal((await f.admin.request('/session')).data.owner.id, f.portal.store.ownerByName('fixture-admin').id);
});
