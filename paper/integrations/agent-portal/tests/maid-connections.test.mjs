import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import { siteFixture, testPassword } from './helpers.mjs';

const publicOrigin = 'https://portal.example';
const base = '/api/v1/maid-connect';
const ownerUuid = '11111111-1111-3111-8111-111111111111';
const maidId = '10000000-0000-0000-0000-000000000011';
const otherMaid = '10000000-0000-0000-0000-000000000012';
const tokenFor = () => 'mdw_' + randomBytes(32).toString('base64url');
const hash = token => createHash('sha256').update(token).digest('hex');

function proxy(fixture) {
  let cookie, csrf;
  return async (path, method = 'GET', body, extra = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    const raw = await new Promise((resolve, reject) => {
      const req = http.request(fixture.origin + path, {
        method, headers: {
          Host: 'portal.example', 'X-Forwarded-Proto': 'https',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method !== 'GET' ? { Origin: publicOrigin, 'X-CSRF-Token': csrf || '' } : {}),
          ...(text ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) } : {}),
          ...extra,
        },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({
          status: res.statusCode, headers: res.headers, data: JSON.parse(Buffer.concat(chunks)),
        }));
      });
      req.once('error', reject);
      req.end(text);
    });
    if (raw.headers['set-cookie']) cookie = raw.headers['set-cookie'][0].split(';')[0];
    if (raw.data.csrfToken) csrf = raw.data.csrfToken;
    return raw;
  };
}

test('maid connection authorization is off until configured', async t => {
  const fixture = await siteFixture(t);
  const result = await fixture.admin.request('/maid-connect');
  assert.equal(result.status, 404);
});

test('the released desktop URL keeps trial consent or opens owner login with the same request',
  { skip: !process.env.PORTAL_BROWSER_EXECUTABLE }, async t => {
    const f = await siteFixture(t, { publicOrigin, maidConnections: {
      enabled: true, bodyEndpoint: 'https://maid.example/api/v1/maid-body', bindings: [],
    } });
    const device = proxy(f);
    const granted = await device(base + '/request', 'POST', { tokenHash: hash(tokenFor()) }, { Origin: '' });
    const fragment = new URL(granted.data.verificationUrl).hash;
    const entry = f.origin + '/maid-connect.html' + fragment;
    const browser = await puppeteer.launch({ executablePath: process.env.PORTAL_BROWSER_EXECUTABLE, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    let state = { active: true, name: '试用女仆', expiresAt: Date.now() + 60_000 };
    page.on('request', req => new URL(req.url()).pathname === base + '/trial'
      ? req.respond({ contentType: 'application/json', body: JSON.stringify(state) })
      : req.continue());
    await page.goto(entry);
    await page.waitForSelector('#consent', { visible: true });
    assert.equal(page.url(), entry);
    assert.equal(await page.$eval('#role', e => e.textContent), '托管「试用女仆」');
    state = (await device(base + '/trial')).data;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login', { visible: true });
    assert.equal(page.url(), f.origin + '/maid-owner-connect.html' + fragment);
  });

test('official website session consents to one verified maid and revokes without sharing login', async t => {
  let now = Date.now();
  const endpoint = 'https://maid.example/api/v1/maid-body';
  const f = await siteFixture(t, { publicOrigin, maidConnections: {
    enabled: true, bodyEndpoint: endpoint, bindings: [
      { maidId, ownerId: ownerUuid, name: '禾穗' },
      { maidId: otherMaid, ownerId: '22222222-2222-3222-8222-222222222222', name: '别人的女仆' },
    ],
  } }, { now: () => now });
  const device = proxy(f), browser = proxy(f), outsider = proxy(f);
  const start = token => device(base + '/request', 'POST', { tokenHash: hash(token) }, { Origin: '' });
  const check = token => device(base + '/check', 'POST', {}, { Origin: '', Authorization: 'Bearer ' + token });
  const token = tokenFor();
  assert.equal((await f.admin.request('/maid-connect')).status, 403);
  assert.deepEqual((await device(base + '/trial')).data, { active: false, mode: 'owner' });
  const begun = await start(token);
  const { confirmationCode, verificationUrl } = begun.data;
  assert.equal(begun.status, 201);
  assert.match(verificationUrl, /^https:\/\/portal\.example\/maid-connect\.html#request=/);
  assert.match(confirmationCode, /^[0-9A-F]{6}$/);
  assert.equal(begun.headers['cache-control'], 'no-store');
  assert.equal((await start(token)).data.verificationUrl, verificationUrl);
  assert.equal((await check(token)).status, 202);
  assert.equal((await check(tokenFor())).status, 401);
  const id = new URLSearchParams(new URL(verificationUrl).hash.slice(1)).get('request');
  const approval = base + '/requests/' + id;
  assert.equal((await browser(approval)).status, 401);

  await browser('/api/v1/session');
  const signup = await browser('/api/v1/accounts', 'POST', { username: 'portal-owner', password: testPassword });
  assert.equal(signup.status, 201);
  const account = signup.data.owner.id;
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(account, ownerUuid, 'fixture confirmed', now);
  assert.deepEqual((await browser(approval)).data.maids, [{ id: maidId, name: '禾穗' }]);
  const body = { confirmationCode, maidId };
  assert.equal((await browser(approval, 'POST', body, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await browser(approval, 'POST', body, { Origin: 'https://unrelated.example' })).status, 403);
  const wrongCode = confirmationCode === '000000' ? 'FFFFFF' : '000000';
  assert.equal((await browser(approval, 'POST', { ...body, confirmationCode: wrongCode })).status, 403);
  assert.equal((await browser(approval, 'POST', { ...body, maidId: otherMaid })).status, 404);
  assert.equal((await browser(base + '/check', 'POST', {}, { Authorization: 'Bearer ' + token })).status, 403);

  await outsider('/api/v1/session');
  await outsider('/api/v1/sessions', 'POST', { username: 'fixture-admin', password: testPassword });
  assert.deepEqual((await outsider(approval)).data.maids, []);
  assert.equal((await outsider(approval, 'POST', body)).status, 404);
  const approved = await browser(approval, 'POST', body);
  assert.equal(approved.status, 200);
  assert.equal(approved.data.name, '禾穗');
  assert(!JSON.stringify(approved.data).includes(token));
  assert.equal((await browser(approval, 'POST', body)).status, 404);
  assert.equal((await start(token)).status, 409);
  assert.deepEqual((await check(token)).data, {
    state: 'approved', ownerId: ownerUuid, maidId, bodyEndpoint: endpoint, expiresAt: now + 86_400_000,
  });
  assert.equal((await outsider(base + '/' + id, 'DELETE')).status, 404);
  assert.equal((await browser(base + '/' + id, 'DELETE')).status, 200);
  assert.equal((await check(token)).status, 401);

  const second = tokenFor();
  const pending = (await start(second)).data;
  const request = base + '/requests/' + pending.verificationUrl.split('=')[1];
  assert.equal((await browser(request, 'POST', { maidId, confirmationCode: pending.confirmationCode })).status, 200);
  f.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(ownerUuid);
  assert.equal((await check(second)).status, 401);
  f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(account, ownerUuid, 'fixture confirmed', now + 1);
  assert.equal((await check(second)).status, 401);
  const third = tokenFor();
  const next = (await start(third)).data;
  const nextRequest = base + '/requests/' + next.verificationUrl.split('=')[1];
  assert.equal((await browser(nextRequest, 'POST', { maidId, confirmationCode: next.confirmationCode })).status, 200);
  assert.equal((await check(third)).status, 200);
  assert.equal((await browser('/api/v1/session', 'DELETE')).status, 200);
  assert.equal((await check(third)).status, 401);
  now += 600_001;
  const expiredToken = tokenFor();
  assert.equal((await start(expiredToken)).status, 201);
  now += 600_001;
  assert.equal((await check(expiredToken)).status, 401);
});
