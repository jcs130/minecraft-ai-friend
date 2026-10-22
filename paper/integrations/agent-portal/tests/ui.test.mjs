import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createPortal } from '../src/server.mjs';
import { loadConfig, projectRoot } from '../src/config.mjs';
import { WorldCatalog } from '../src/world-catalog.mjs';

// Programmatic DOM integration, not browser rendering or visual acceptance.
const fixtureBase = path.resolve(projectRoot, '.local', 'tests');
const playerUuid = '11111111-1111-3111-8111-111111111111';
const password = 'ui-isolated-password-2026';
const waitFor = async predicate => {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('UI integration did not reach the expected state within four seconds');
};

async function screen(t, { capabilitiesReady = false, initialView = 'overview', photos = [], media = {} } = {}) {
  const root = path.join(fixtureBase, 'ui-' + randomUUID());
  const savedAt = '2026-10-10T01:00:00.000Z';
  const agent = { id: 'a'.repeat(24), name: 'ag_Alpha', playerUuid, kind: 'agent', online: true, authenticated: true, isReserved: false, available: true, observedAt: savedAt };
  const game = {
    roster: async () => [agent],
    publicAgent: row => ({ id: row.id, name: row.name, kind: row.kind, online: row.online, available: true, observedAt: row.observedAt }),
    serverSummary: async () => ({ online: true, version: 'Isolated UI fixture', playersOnline: 1, playersMax: 40, rosterCount: 1, agentCount: 1, latencyMs: 2, authHealthy: true, observedAt: savedAt }),
    playerState: async () => ({ agent, freshness: 'saved', savedAt, liveState: { available: false },
      vitals: { health: 18, food: 20, level: 7, gameMode: 0, dimension: 'minecraft:overworld' }, savedPosition: [1, 64, 3],
      inventory: [{ slot: 5, id: 'minecraft:player_head', name: '大背包', count: 1, enchanted: false }],
      stats: { savedAt, playTicks: 72000, blocksMined: 14, deaths: 0, mobKills: null },
      account: { balance: '0', lastLoginAt: savedAt },
      progress: { savedAt, professionSavedAt: savedAt, guild: null, profession: { combat: 'mage', life: [], learned: { mage_bolt: { level: 1 } }, basicLearned: { home: { level: 2 } } }, life: null }, connection: { reason: '原客户端尚未接入' } })
  };
  const world = {
    insert: (event, identity) => WorldCatalog.prototype.insert.call({ store: portal.store }, event, identity),
    players: async () => ({ players: [{ ...game.publicAgent(agent), savedAt, growth: { level: 7, fame: 14, completed: 2, rank: '黑铁 III', gradeIndex: 3, profession: 'mage' } }], freshness: 'saved' }),
    events: async ({ kind = 'all', page = 1 } = {}) => ({ events: kind === 'all' || kind === 'notice' ? [{ id: 'event-fixture', kind: 'notice', title: '<script>unsafe()</script>', body: '隔离测试公告', occurredAt: savedAt, timePrecision: 'second' }] : [], page, pages: 1, total: 1 })
  };
  const portal = createPortal(loadConfig({ host: '127.0.0.1', port: 0, dataDir: path.join(root, 'data'), publicMedia: media }), { game, world });
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + portal.server.address().port;
  const html = await fs.readFile(path.join(projectRoot, 'public/index.html'), 'utf8');
  const code = await fs.readFile(path.join(projectRoot, 'public/app.js'), 'utf8');
  const errors = [];
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: initialView === 'home' ? origin : origin + '/#' + initialView, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const { window } = dom; const { document } = window;
  let cookie = ''; let networkFailure = false; let hold = null;
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.fetch = async (resource, options = {}) => {
    const url = new URL(resource, origin);
    // Simulate the bridge going offline between displaying a ready form and
    // submitting it; the actual backend still returns its unavailable receipt.
    if (url.pathname === '/api/v1/gallery') return new Response(JSON.stringify({ photos }));
    if (capabilitiesReady && url.pathname === '/api/v1/game-capabilities') return new Response(JSON.stringify({ ready: true }));
    if (networkFailure && ['/api/v1/server', '/api/v1/roster'].includes(url.pathname)) throw new Error('Isolated network outage');
    const headers = { ...options.headers, ...(cookie ? { Cookie: cookie } : {}), ...(options.method && options.method !== 'GET' ? { Origin: origin } : {}) };
    const response = await fetch(url, { ...options, headers });
    const incoming = response.headers.get('set-cookie'); if (incoming) cookie = incoming.split(';')[0];
    if (hold && url.pathname === '/api/v1/agents') { hold.entered(); await hold.pending; }
    return response;
  };
  const click = selector => { const element = document.querySelector(selector); assert.ok(element, 'Expected a clickable element: ' + selector); element.click(); };
  const fill = (name, value, form = '#auth-form') => { const input = document.querySelector(`${form} [name="${name}"]`); assert.ok(input); input.value = value; };
  const submit = selector => document.querySelector(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const setup = async () => {
    click('[data-action="setup"]'); fill('username', 'ui-admin'); fill('password', password); fill('confirmPassword', password); submit('#auth-form');
    await waitFor(() => document.querySelector('.profile-button strong')?.textContent === 'ui-admin');
  };
  t.after(async () => {
    hold?.release();
    dom.window.close(); await portal.close();
    assert.ok(path.resolve(root).startsWith(fixtureBase + path.sep)); await fs.rm(root, { recursive: true, force: true });
    assert.deepEqual(errors, [], 'No unexpected DOM runtime errors');
  });
  window.eval(code + '\nwindow.__portalRefreshForTest = refresh;');
  await waitFor(() => document.querySelector('.onboarding-notice') && (initialView === 'home' ? document.querySelector('[data-world-roster] strong')?.textContent === 'Alpha' : document.querySelector('tbody strong')?.textContent === 'ag_Alpha'));
  const holdPrivate = () => {
    let entered, release;
    const ready = new Promise(resolve => { entered = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    hold = { entered, release, pending };
    return { ready, release };
  };
  return { portal, document, window, origin, click, fill, submit, setup, holdPrivate, refresh: () => window.__portalRefreshForTest(true), outage: () => { networkFailure = true; } };
}

test('public growth, event filters and an offline live page work without exposing private profiles or executing announcement HTML', async t => {
  const ui = await screen(t);
  ui.window.location.hash = 'growth'; await waitFor(() => ui.document.querySelector('.growth-table'));
  assert.match(ui.document.querySelector('.growth-table').textContent, /黑铁 III/);
  assert.match(ui.document.querySelector('.growth-table').textContent, /法师/);
  assert.ok(!ui.document.body.textContent.includes(playerUuid));
  ui.window.location.hash = 'events'; await waitFor(() => ui.document.querySelector('.world-event'));
  assert.ok(ui.document.querySelector('.event-body').textContent.includes('<script>unsafe()</script>'));
  assert.equal(ui.document.querySelectorAll('.event-body script').length, 0);
  ui.click('[data-action="event-filter"][data-kind="quest"]'); await waitFor(() => !ui.document.querySelector('.world-event'));
  ui.window.location.hash = 'live'; await waitFor(() => ui.document.querySelector('#main').textContent.includes('直播间正在准备'));
  assert.equal(ui.document.querySelectorAll('iframe').length, 0);
});

test('phone navigation closes from its scrim and LAN HTTP forms work without secure-context randomUUID', async t => {
  const ui = await screen(t, { capabilitiesReady: true }); await ui.setup();
  ui.click('.mobile-menu'); assert.ok(ui.document.querySelector('.layout').classList.contains('menu-open'));
  assert.equal(ui.document.querySelector('.mobile-menu').getAttribute('aria-expanded'), 'true');
  ui.click('.nav-scrim'); assert.ok(!ui.document.querySelector('.layout').classList.contains('menu-open'));
  Object.defineProperty(ui.window.crypto, 'randomUUID', { value: undefined });
  ui.window.location.hash = 'agents'; await waitFor(() => ui.document.querySelector('[data-action="new-game-agent"]'));
  ui.click('[data-action="new-game-agent"]');
  assert.ok(ui.document.querySelector('#game-account-form'));
  assert.match(ui.document.querySelector('#game-account-form').dataset.request, /^[a-f0-9-]{36}$/);
  assert.equal(ui.document.querySelector('#game-account-form [name="username"]').getAttribute('autocapitalize'), 'none');
  ui.fill('username', 'ag_Phone', '#game-account-form'); ui.fill('gamePassword', 'phone-game-password', '#game-account-form'); ui.fill('confirmGamePassword', 'phone-game-password', '#game-account-form'); ui.submit('#game-account-form');
  await waitFor(() => ui.document.querySelector('#game-account-form .form-error').textContent.includes('账号桥'));
  assert.ok(!ui.document.querySelector('#game-account-form .form-error').textContent.includes('TypeError'));
});

test('announcement and live management forms submit, rotate and delete; logout clears private channel metadata', async t => {
  const ui = await screen(t); await ui.setup();
  ui.window.location.hash = 'events'; await waitFor(() => ui.document.querySelector('[data-action="new-notice"]'));
  ui.click('[data-action="new-notice"]');
  ui.fill('title', '网页公告已提交', '#notice-form'); ui.fill('body', '表单必须得到服务端确认。', '#notice-form'); ui.submit('#notice-form');
  await waitFor(() => !ui.document.querySelector('#modal').open);
  assert.equal(ui.portal.store.db.prepare("SELECT count(*) AS n FROM public_events WHERE title=?").get('网页公告已提交').n, 1);
  ui.window.location.hash = 'live'; await waitFor(() => ui.document.querySelector('[data-action="new-channel"]'));
  ui.click('[data-action="new-channel"]'); ui.fill('title', '本人私有直播标题', '#channel-form'); ui.submit('#channel-form');
  await waitFor(() => ui.document.querySelector('#created-token'));
  const oldToken = ui.document.querySelector('#created-token').textContent;
  assert.match(oldToken, /^pub_/); ui.click('[data-action="close-modal"]');
  ui.click('[data-action="rotate-publisher"]'); ui.submit('#rotate-publisher-form');
  await waitFor(() => ui.document.querySelector('#created-token'));
  assert.notEqual(ui.document.querySelector('#created-token').textContent, oldToken);
  ui.click('[data-action="close-modal"]');
  ui.click('[data-action="delete-channel"]'); ui.submit('#delete-channel-form');
  await waitFor(() => !ui.document.querySelector('#modal').open);
  assert.equal(ui.portal.store.db.prepare('SELECT count(*) AS n FROM live_channels').get().n, 0);
  ui.click('[data-action="new-channel"]'); ui.fill('title', '不得残留的私有标题', '#channel-form'); ui.submit('#channel-form');
  await waitFor(() => ui.document.querySelector('#created-token')); ui.click('[data-action="close-modal"]');
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客');
  ui.window.location.hash = 'live'; await waitFor(() => ui.document.querySelector('#main').textContent.includes('直播间正在准备'));
  assert.ok(!ui.document.body.textContent.includes('不得残留的私有标题'));
});

test('page flow protects private data, validates setup, reads the saved backpack and revokes a one-time client token', async t => {
  const ui = await screen(t);
  assert.ok(!ui.document.body.textContent.includes(playerUuid));
  ui.click('[data-action="detail"]');
  assert.match(ui.document.querySelector('#detail').textContent, /登录，查看角色的私有资料/);
  assert.ok(!ui.document.querySelector('#detail').textContent.includes(playerUuid));
  ui.click('[data-action="close-detail"]'); ui.click('[data-action="setup"]');
  ui.fill('username', 'ui-admin'); ui.fill('password', password); ui.fill('confirmPassword', 'different-password'); ui.submit('#auth-form');
  await waitFor(() => ui.document.querySelector('.form-error')?.textContent.includes('不一致'));
  assert.equal(ui.portal.store.countOwners(), 0);
  ui.fill('confirmPassword', password); ui.submit('#auth-form');
  await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === 'ui-admin');
  ui.click('[data-action="detail"]');
  await waitFor(() => ui.document.querySelector('#detail .vitals'));
  assert.match(ui.document.querySelector('#detail').textContent, /不代表角色此刻的位置或背包/);
  assert.ok(ui.document.querySelector('#detail').textContent.includes(playerUuid));
  ui.click('[data-action="detail-tab"][data-tab="inventory"]');
  assert.match(ui.document.querySelector('.item-list').textContent, /大背包.*minecraft:player_head/s);
  assert.equal(ui.document.querySelectorAll('.inventory-slot').length, 36);
  ui.click('[data-action="detail-tab"][data-tab="progress"]');
  assert.match(ui.document.querySelector('#detail').textContent, /生活职业未选择/);
  assert.match(ui.document.querySelector('#detail').textContent, /mage_bolt等级 1/);
  assert.match(ui.document.querySelector('#detail').textContent, /home等级 2/);
  ui.click('[data-action="close-detail"]');
  ui.window.location.hash = 'connections'; await waitFor(() => ui.document.querySelector('[data-action="new-token"]'));
  ui.click('[data-action="new-token"]'); ui.fill('label', 'UI reader', '#token-form'); ui.submit('#token-form');
  await waitFor(() => ui.document.querySelector('#created-token'));
  const token = ui.document.querySelector('#created-token').textContent;
  assert.match(token, /^pat_[A-Za-z0-9_-]{43}$/);
  assert.equal((await fetch(ui.origin + '/api/v1/agents', { headers: { Authorization: 'Bearer ' + token } })).status, 200);
  ui.click('[data-action="close-modal"]');
  assert.ok(!ui.document.body.textContent.includes(token));
  assert.equal(ui.window.localStorage.length, 0);
  ui.click('[data-action="revoke-token"]'); ui.submit('#revoke-token-form');
  await waitFor(() => ui.document.querySelector('.token-row')?.textContent.includes('已撤销') && !ui.document.querySelector('#modal').open);
  assert.equal((await fetch(ui.origin + '/api/v1/agents', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
});

test('revoked browser sessions clear open private role details on refresh', async t => {
  const ui = await screen(t); await ui.setup(); ui.click('[data-action="detail"]');
  await waitFor(() => ui.document.querySelector('#detail .vitals'));
  ui.portal.store.db.prepare('DELETE FROM sessions WHERE owner_id IS NOT NULL').run();
  await ui.refresh();
  assert.equal(ui.document.querySelector('#detail').open, false);
  assert.equal(ui.document.querySelector('#detail').textContent, '');
  assert.ok(!ui.document.body.textContent.includes(playerUuid));
  assert.equal(ui.document.querySelector('.profile-button strong').textContent, '访客');
});

test('loss of server and roster requests changes stale online indicators to unknown', async t => {
  const ui = await screen(t); ui.outage(); await ui.refresh();
  assert.match(ui.document.querySelector('.online-badge').textContent, /状态暂未确认/);
  assert.match(ui.document.querySelector('tbody .status').textContent, /待确认/);
  assert.match(ui.document.querySelector('.footer').textContent, /角色状态暂未确认/);
  assert.equal(ui.document.querySelector('.stat-value').textContent.trim(), '—/ —');
});

test('a delayed private refresh cannot restore account information after logout', async t => {
  const ui = await screen(t); await ui.setup();
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  const held = ui.holdPrivate(); const refreshing = ui.refresh(); await held.ready;
  ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客');
  held.release(); await refreshing;
  assert.equal(ui.document.querySelector('.profile-button strong').textContent, '访客');
  assert.ok(!ui.document.body.textContent.includes('ui-admin'));
  assert.ok(!ui.document.body.textContent.includes(playerUuid));
});

test('ordinary registration, human role binding and returning login lead to the same saved backpack', async t => {
  const ui = await screen(t); await ui.setup();
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  const logout = async () => { ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客'); };
  const login = async username => {
    ui.click('[data-action="login"]'); ui.fill('username', username); ui.fill('password', password); ui.submit('#auth-form');
    await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === username);
  };
  await logout();
  ui.click('[data-action="login"]'); ui.click('[data-action="register"]');
  ui.fill('username', 'Alice'); ui.fill('password', password); ui.fill('confirmPassword', password); ui.submit('#auth-form');
  await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === 'Alice');
  ui.window.location.hash = 'agents'; await waitFor(() => ui.document.querySelector('[data-action="detail"]'));
  ui.click('[data-action="detail"]');
  assert.match(ui.document.querySelector('#detail').textContent, /这个角色尚未授权给你/);
  assert.ok(!ui.document.querySelector('#detail').textContent.includes(playerUuid));
  ui.click('[data-action="close-detail"]');
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  await logout(); await login('ui-admin');
  ui.click('[data-action="binding"]');
  ui.fill('ownerId', ui.portal.store.ownerByName('Alice').id, '#binding-form');
  ui.fill('proof', '隔离页面测试：已独立核验此网站用户的原角色归属', '#binding-form');
  ui.document.querySelector('#binding-form [name="confirmedOwnership"]').checked = true;
  ui.submit('#binding-form');
  await waitFor(() => !ui.document.querySelector('#modal').open && ui.document.querySelector('#toast').textContent.includes('已绑定原角色'));
  await logout(); await login('Alice');
  ui.window.location.hash = 'inventory'; await waitFor(() => ui.document.querySelector('[data-action="inventory-detail"]'));
  ui.click('[data-action="inventory-detail"]'); await waitFor(() => ui.document.querySelector('#detail .item-list'));
  assert.ok(ui.document.querySelector('#detail').textContent.includes(playerUuid));
  assert.match(ui.document.querySelector('#detail .item-list').textContent, /大背包/);
});


test('the default homepage introduces a shared Agent living world and exhibits only escaped attributed game photographs', async t => {
  const photo = { id: '11111111-1111-4111-8111-111111111112', author: 'ag_CorMy', title: '<script>unsafe()</script>', story: '在千灯纪安下的家。', capturedAt: '2026-10-20T01:00:00Z', width: 1536, height: 1536, imageUrl: '/api/v1/gallery/11111111-1111-4111-8111-111111111112/image?rev=test' };
  const ui = await screen(t, { initialView: 'home', photos: [photo] });
  assert.match(ui.document.querySelector('h1').textContent, /让 Agent 在这里/);
  assert.match(ui.document.querySelector('.home-world-strip').textContent, /NEKO.*Cortico.*QwenPaw/);
  assert.equal(ui.document.querySelectorAll('img[src*=neko-cover]').length, 0);
  assert.match(ui.document.querySelector('.home-rescue-note').textContent, /4格内连续停留10秒/);
  assert.equal(ui.document.querySelectorAll('.photo-card script').length, 0);
  assert.match(ui.document.querySelector('.photo-caption').textContent, /可米/);
  assert.match(ui.document.querySelector('.photo-caption').textContent, /在千灯纪安下的家/);
  assert.equal(ui.document.querySelectorAll('[data-world-roster] .resident-card').length, 1);
  ui.click('[data-action="photo"]');
  assert.match(ui.document.querySelector('#modal-title').textContent, /<script>/);
  assert.equal(ui.document.querySelectorAll('#modal script').length, 0);
  assert.match(ui.document.querySelector('.photo-story').textContent, /安下的家/);
  ui.click('[data-action="close-modal"]');
  ui.click('.mobile-menu'); assert.ok(ui.document.querySelector('.layout').classList.contains('menu-open'));
  ui.click('.nav-scrim'); assert.ok(!ui.document.querySelector('.layout').classList.contains('menu-open'));
  ui.window.location.hash = 'gallery'; await waitFor(() => ui.document.querySelector('.full-gallery'));
  assert.equal(ui.document.querySelectorAll('.photo-card').length, 1);
});


test('configured promotion and character art appear in the shared world homepage without autoplay', async t => {
  const ui = await screen(t, { initialView: 'home', media: { video: 'intro.mp4', poster: 'poster.jpg', character: 'cormy.webp', credit: '千灯纪 / 可米' } });
  const video = ui.document.querySelector('.home-film video');
  assert.ok(video); assert.ok(video.hasAttribute('controls')); assert.ok(video.hasAttribute('playsinline')); assert.equal(video.hasAttribute('autoplay'), false);
  assert.equal(video.getAttribute('preload'), 'none'); assert.equal(video.querySelector('source').getAttribute('src'), '/media/intro.mp4');
  assert.equal(ui.document.querySelector('.character-feature img').getAttribute('src'), '/media/cormy.webp');
  assert.match(ui.document.querySelector('.home-world-strip').textContent, /NEKO.*Cortico/);
});
