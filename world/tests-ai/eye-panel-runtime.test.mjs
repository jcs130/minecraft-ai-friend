import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { projectWorld } from '../admin/read-model.mjs';

const PUBLIC = new URL('../admin/public/', import.meta.url);
const PANEL_ORIGIN = 'http://eye-panel-fixture.test';
const VIEWER_ORIGIN = 'http://127.0.0.1:19092';
const CSRF = 'fixture-only-csrf-not-a-real-token';
const TARGET = 'FixtureTraveler';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t, { holdServices = false, holdFollow = false } = {}) {
  let executablePath;
  for (const candidate of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe']) {
    try { await fs.access(candidate); executablePath = candidate; break; } catch { /* next installed browser */ }
  }
  assert.ok(executablePath, 'These runtime regressions require the installed Chromium browser; do not claim a skip as a pass');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--disable-background-networking', '--no-default-browser-check'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const gates = { services: deferred(), follow: deferred(), serviceRequested: deferred(), followRequested: deferred(), parkRequested: deferred() };
  if (!holdServices) gates.services.resolve();
  if (!holdFollow) gates.follow.resolve();
  let closing = false, servicesCompleted = false, iframeLoads = 0, stateReads = 0;
  const errors = [], unexpected = [], mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    closing = true;
    gates.services.resolve(); gates.follow.resolve();
    await browser.close();
  });
  const assets = Object.fromEntries(await Promise.all([
    ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'],
    ['/management.js', 'management.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'],
  ].map(async ([route, file, contentType]) => [route, { contentType, body: await fs.readFile(new URL(file, PUBLIC), 'utf8') }])));
  const world = projectWorld({ heartbeat: { ts: Date.now() }, npc: {}, board: {} });
  const observer = { online: true, name: 'Goddess', dimension: 'minecraft:overworld', position: { x: 10, y: 65, z: 20 } };
  let eye = { observer, targets: [{ name: TARGET, nearby: true }], follow: { active: false, parked: true }, entities: { total: 1 } };
  // Every HTTP(S) request, including the hard-coded 19092 iframe URL, is fulfilled
  // in process. There is no route.continue(), local server, actual session or token.
  await context.route('**/*', async route => {
    try {
      const request = route.request(), url = new URL(request.url());
      const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      if (url.origin === VIEWER_ORIGIN && request.method() === 'GET') {
        iframeLoads++;
        return await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body data-fixture-load="${iframeLoads}">Isolated renderer fixture</body></html>` });
      }
      if (url.origin !== PANEL_ORIGIN) {
        unexpected.push(request.url());
        return await route.fulfill({ status: 404, body: 'Network access blocked by fixture' });
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        mutations.push({ route: url.pathname, body, csrf: request.headers()['x-csrf-token'] });
        assert.equal(url.pathname, '/api/eye/observer');
        assert.equal(request.headers()['x-csrf-token'], CSRF);
        if (body.action === 'follow') {
          assert.deepEqual(body, { action: 'follow', target: TARGET });
          gates.followRequested.resolve();
          await gates.follow.promise;
          eye = { ...eye, follow: { active: true, parked: false, target: TARGET,
            leaseId: 'fixture-only-lease', expiresAt: Date.now() + 120000 } };
          return await json({ state: eye });
        }
        assert.deepEqual(body, { action: 'park' });
        eye = { ...eye, follow: { active: false, parked: true } };
        gates.parkRequested.resolve();
        return await json({ state: eye });
      }
      if (url.pathname === '/api/manage/services') {
        gates.serviceRequested.resolve();
        await gates.services.promise;
        servicesCompleted = true;
        return await json({ services: [{ id: 'mc', state: 'running', health: 'healthy', canControl: false }] });
      }
      if (url.pathname === '/api/manage/session') return await json({ configured: true, authenticated: true, csrf: CSRF });
      if (url.pathname === '/api/state') return await json({ ...world, schema: 1, available: true, stale: false, links: {}, warnings: [] });
      if (url.pathname === '/healthz') return await json({ ok: true });
      if (url.pathname === '/api/eye/state') { stateReads++; return await json(eye); }
      if (url.pathname === '/api/eye/renderer') return await json({ observerOnline: true, ok: true });
      if (url.pathname === '/api/eye/compatibility') return await json({ stats: { blocks: 3276, fallbackBlocks: 57 } });
      if (url.pathname === '/api/eye/map.png') return await route.fulfill({ contentType: 'image/png', body: PNG });
      if (url.pathname === '/favicon.ico') return await route.fulfill({ status: 404, body: '' });
      if (Object.hasOwn(assets, url.pathname)) return await route.fulfill(assets[url.pathname]);
      unexpected.push(request.url());
      return await route.fulfill({ status: 404, body: 'No fixture route' });
    } catch (error) {
      if (!closing) { errors.push(error.message); await route.abort().catch(() => {}); }
    }
  });
  await page.goto(PANEL_ORIGIN + '/#eye', { waitUntil: 'domcontentloaded' });
  return { page, gates, errors, unexpected, mutations,
    state: () => ({ servicesCompleted, iframeLoads, stateReads }) };
}

test('slow service queries do not gate eye state or the iframe, and same-view refresh preserves its document', { timeout: 20000 }, async t => {
  const f = await fixture(t, { holdServices: true });
  await f.gates.serviceRequested.promise;
  await f.page.waitForFunction(() => document.getElementById('eye-badge').textContent === '已连接');
  await f.page.frameLocator('#eye-frame').locator('body[data-fixture-load="1"]').waitFor();
  assert.equal(f.state().servicesCompleted, false, 'Eye rendered while the service response remains deliberately unresolved');
  assert.ok(f.state().stateReads >= 1);
  assert.equal(f.state().iframeLoads, 1);
  await f.page.waitForFunction(() => !document.getElementById('refresh-button').disabled);
  await f.page.locator('[data-view="eye"]').click();
  await f.page.locator('#refresh-button').click();
  await f.page.waitForFunction(() => !document.getElementById('refresh-button').disabled);
  assert.equal(f.state().servicesCompleted, false);
  assert.equal(f.state().iframeLoads, 1, 'Neither same-view navigation nor refresh requests the renderer again');
  assert.equal(await f.page.frameLocator('#eye-frame').locator('body').getAttribute('data-fixture-load'), '1');
  f.gates.services.resolve();
  await f.page.waitForFunction(() => document.getElementById('services-badge').textContent.includes('1 / 1'));
  assert.equal(f.state().iframeLoads, 1, 'A late service response must not rebuild the iframe');
  assert.deepEqual(f.mutations, []);
  assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
});

test('a follow success received after leaving the eye immediately parks and never restores the iframe', { timeout: 20000 }, async t => {
  const f = await fixture(t, { holdFollow: true });
  await f.page.waitForFunction(() => document.getElementById('eye-target').options.length === 2 &&
    document.getElementById('admin-session-label').textContent.includes('管理已解锁'));
  await f.page.frameLocator('#eye-frame').locator('body[data-fixture-load="1"]').waitFor();
  await f.page.locator('#eye-target').selectOption(TARGET);
  await f.page.locator('#eye-follow').click();
  await f.gates.followRequested.promise;
  await f.page.locator('[data-view="overview"]').click();
  await f.page.locator('#view-overview').waitFor({ state: 'visible' });
  assert.equal(await f.page.locator('#eye-frame').getAttribute('src'), null);
  assert.equal(f.mutations.filter(row => row.body.action === 'park').length, 0,
    'The follow response is still held, so leaving cannot yet know its lease');
  f.gates.follow.resolve();
  await f.gates.parkRequested.promise;
  // A browser task checkpoint lets the completed handler run its return path.
  await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(f.mutations.map(row => row.body.action), ['follow', 'park']);
  assert.equal(await f.page.locator('#eye-frame').getAttribute('src'), null);
  assert.equal(await f.page.locator('#view-eye').isVisible(), false);
  assert.equal(f.state().iframeLoads, 1, 'The late follow response must not recreate a hidden renderer');
  assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
});
