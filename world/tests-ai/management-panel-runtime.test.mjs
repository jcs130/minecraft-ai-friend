import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { projectWorld } from '../admin/read-model.mjs';

const ORIGIN = 'http://management-recovery-fixture.test';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(check) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('The browser did not reach the expected state');
}

async function fixture(t, { sessionFailure = null, holdSession = 0, holdPlan = false, executeFailure = false } = {}) {
  let executablePath;
  for (const candidate of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']) {
    try { await fs.access(candidate); executablePath = candidate; break; } catch { /* next installed browser */ }
  }
  assert.ok(executablePath, 'A real Chromium browser is required for these regressions');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking', '--no-default-browser-check'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const now = new Date(); await page.clock.install({ time: now }); await page.clock.pauseAt(now);
  const gates = { session: deferred(), plan: deferred() }, requests = [], errors = [];
  if (!holdPlan) gates.plan.resolve();
  let reads = 0, closing = false;
  t.after(async () => { closing = true; gates.session.resolve(); gates.plan.resolve(); await browser.close(); });
  page.on('pageerror', error => errors.push(error.message));
  const assets = Object.fromEntries(await Promise.all([
    ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'],
    ['/management.js', 'management.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'],
  ].map(async ([route, file, contentType]) => [route, { contentType, body: await fs.readFile(new URL('../admin/public/' + file, import.meta.url), 'utf8') }])));
  const world = projectWorld({ heartbeat: { ts: Date.now() }, npc: {}, board: {} });
  // All traffic is fulfilled inside the fixture. Nothing reaches a running panel,
  // Docker service, real session or model endpoint, including mutation tests.
  await context.route('**/*', async route => {
    try {
      const req = route.request(), url = new URL(req.url());
      requests.push({ method: req.method(), path: url.pathname, body: req.method() === 'POST' ? req.postDataJSON() : undefined });
      const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      assert.equal(url.origin, ORIGIN, 'Fixture must not access another origin');
      if (url.pathname === '/api/manage/session') {
        const count = ++reads;
        if (count === holdSession) await gates.session.promise;
        if (sessionFailure && (count === 1 || sessionFailure.always)) return await json({ error: sessionFailure.error }, sessionFailure.status);
        return await json({ configured: true, authMode: 'local', authenticated: true, csrf: 'fixture-only-csrf', expiresAt: Date.now() + 3600000 });
      }
      if (url.pathname === '/api/manage/services') return await json({ services: ['world', 'npc'].map(id => ({ id, state: 'running', health: 'healthy', canControl: true })) });
      if (url.pathname === '/api/manage/operations') return await json({ operations: [], active: null });
      if (url.pathname === '/api/manage/plan') {
        assert.equal(req.method(), 'POST'); await gates.plan.promise;
        return await json({ id: 'fixture-plan', plan: { explanation: 'Fixture preview only', stop: req.postDataJSON().services, start: req.postDataJSON().services, saveMinecraft: false } });
      }
      if (url.pathname === '/api/manage/execute') {
        assert.equal(req.method(), 'POST'); assert.equal(req.headers()['x-csrf-token'], 'fixture-only-csrf');
        if (executeFailure === 'csrf_required') return await json({ error: 'csrf_required' }, 403);
        return executeFailure ? await route.abort('failed') : await json({ operationId: 'fixture-operation' });
      }
      if (url.pathname === '/api/state') return await json({ ...world, stale: false, links: {}, warnings: [] });
      if (url.pathname === '/healthz') return await json({ ok: true });
      if (url.pathname === '/favicon.ico') return await route.fulfill({ status: 404, body: '' });
      assert.ok(Object.hasOwn(assets, url.pathname), 'Unexpected fixture route: ' + url.pathname);
      return await route.fulfill(assets[url.pathname]);
    } catch (error) { if (!closing) { errors.push(error.message); await route.abort().catch(() => {}); } }
  });
  await page.goto(ORIGIN + '/#services', { waitUntil: 'domcontentloaded' });
  return { page, gates, requests, errors, reads: () => reads,
    count: path => requests.filter(row => row.path === path).length,
    ready: () => until(async () => (await page.locator('#admin-session-label').innerText()).includes('无需密码')) };
}

test('first-session 503 recovers automatically with one request even during manual refresh', { timeout: 15000 }, async t => {
  const f = await fixture(t, { sessionFailure: { status: 503, error: 'management_request_unavailable' }, holdSession: 2 });
  await until(async () => (await f.page.locator('#admin-session-label').innerText()).includes('自动重连'));
  assert.equal(f.reads(), 1);
  await f.page.clock.runFor(4999); assert.equal(f.reads(), 1, 'Transient errors do not retry immediately');
  await f.page.clock.runFor(1); await until(() => f.reads() === 2);
  await f.page.locator('#refresh-button').dispatchEvent('click');
  await f.page.clock.runFor(15000);
  assert.equal(f.reads(), 2, 'A held session is shared across timer and manual requests');
  f.gates.session.resolve(); await f.ready();
  assert.equal(await f.page.locator('#managed-services button').filter({ hasText: '重启' }).first().isEnabled(), true);
  assert.equal(f.requests.filter(row => row.method === 'POST').length, 0);
  assert.deepEqual(f.errors, []);
});

test('session retries back off and stop for Host and configuration errors until explicit refresh', { timeout: 45000 }, async t => {
  for (const [status, error] of [[403, 'local_access_required'], [503, 'management_not_configured']]) {
    await t.test(error, async st => {
      const f = await fixture(st, { sessionFailure: { status, error, always: true } });
      await until(async () => (await f.page.locator('#admin-session-label').innerText()).includes('检查配置后点击刷新'));
      await f.page.clock.runFor(90000); assert.equal(f.reads(), 1);
      await f.page.locator('#refresh-button').dispatchEvent('click'); await until(() => f.reads() === 2);
      assert.equal(f.requests.filter(row => row.method === 'POST').length, 0); assert.deepEqual(f.errors, []);
    });
  }
  await t.test('transient backoff', async st => {
    const f = await fixture(st, { sessionFailure: { status: 503, error: 'management_request_unavailable', always: true } });
    await until(async () => (await f.page.locator('#admin-session-label').innerText()).includes('自动重连'));
    for (const [wait, count] of [[5000, 2], [5000, 2], [5000, 3], [15000, 3], [5000, 4], [25000, 4], [5000, 5]]) {
      await f.page.clock.runFor(wait); await until(() => f.reads() === count);
    }
    assert.deepEqual(f.errors, []);
  });
});

test('pending preview shows feedback, blocks duplicate requests and discards replies after navigation', { timeout: 15000 }, async t => {
  const f = await fixture(t, { holdPlan: true }); await f.ready();
  const buttons = f.page.locator('#managed-services button').filter({ hasText: '重启' });
  await buttons.first().dispatchEvent('click'); await until(() => f.count('/api/manage/plan') === 1);
  assert.match(await f.page.locator('#management-message').innerText(), /正在准备.*世界玩法.*维护预览/);
  assert.equal(await buttons.first().isEnabled(), false); assert.equal(await buttons.last().isEnabled(), false);
  await buttons.last().dispatchEvent('click');
  assert.equal(f.count('/api/manage/plan'), 1, 'Guard also rejects already queued click events');
  await f.page.locator('[data-view="overview"]').dispatchEvent('click');
  f.gates.plan.resolve();
  await until(() => buttons.first().isEnabled());
  assert.equal(await f.page.locator('#operation-dialog').isVisible(), false, 'Late preview cannot open a dialog after leaving');
  await f.page.locator('[data-view="services"]').dispatchEvent('click');
  await buttons.last().dispatchEvent('click');
  await until(() => f.page.locator('#operation-dialog').isVisible());
  assert.equal(await f.page.locator('#plan-heading').innerText(), '重启 村务');
  assert.equal(f.count('/api/manage/plan'), 2);
  await f.page.locator('#plan-cancel').dispatchEvent('click');
  await f.page.locator('#plan-execute').dispatchEvent('click');
  assert.equal(f.count('/api/manage/execute'), 0, 'Cancel removes the plan, including queued execute clicks');
  assert.deepEqual(f.errors, []);
});

test('failed executions are never replayed by refresh or session recovery', { timeout: 25000 }, async t => {
  for (const [executeFailure, expected] of [[true, '未能确认请求结果'], ['csrf_required', '管理会话已变化']]) {
    await t.test(String(executeFailure), async st => {
      const f = await fixture(st, { executeFailure }); await f.ready();
      await f.page.locator('#managed-services button').filter({ hasText: '重启' }).first().dispatchEvent('click');
      await until(() => f.page.locator('#operation-dialog').isVisible());
      await f.page.locator('#plan-execute').dispatchEvent('click');
      await f.page.locator('#plan-execute').dispatchEvent('click');
      await until(async () => (await f.page.locator('#management-message').innerText()).includes(expected));
      await f.page.clock.runFor(10000); await f.ready();
      if (executeFailure === 'csrf_required') assert.ok(f.reads() > 1, 'The lost session recovers without replaying the execution');
      await f.page.locator('#refresh-button').dispatchEvent('click');
      await f.page.clock.runFor(60000);
      assert.equal(f.count('/api/manage/execute'), 1); assert.equal(f.count('/api/manage/plan'), 1);
      assert.equal(await f.page.locator('#operation-dialog').isVisible(), false);
      assert.deepEqual(f.errors, []);
    });
  }
});
