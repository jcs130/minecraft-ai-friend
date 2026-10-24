import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createPortal } from '../src/server.mjs';
import { loadConfig, projectRoot } from '../src/config.mjs';
import { WorldCatalog } from '../src/world-catalog.mjs';
import { agentSkill } from '../src/agent-skill.mjs';

// Programmatic DOM integration, not browser rendering or visual acceptance.
const fixtureBase = path.resolve(projectRoot, '.local', 'tests');
const playerUuid = '11111111-1111-3111-8111-111111111111';
const password = 'ui-isolated-password-2026';
const waitFor = async predicate => {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('UI integration did not reach the expected state within four seconds');
};

async function screen(t, { capabilitiesReady = false, initialView = 'overview', photos = [], media = {}, emailMode = 'username', emailSender = null, challengeSnapshot = null, managedLive = false } = {}) {
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
  const portal = createPortal(loadConfig({ skipLocalConfig: true, emailAuth: { registrationMode: emailMode }, host: '127.0.0.1', port: 0, dataDir: path.join(root, 'data'), publicMedia: media }), { game, world, emailSender });
  if (challengeSnapshot) { portal.challenges.capture=async()=>{};portal.challenges.saveMetadata(challengeSnapshot);for(const row of challengeSnapshot.runs)portal.challenges.put(row); }
  await new Promise(resolve => portal.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + portal.server.address().port;
  const html = await fs.readFile(path.join(projectRoot, 'public/index.html'), 'utf8');
  const code = await fs.readFile(path.join(projectRoot, 'public/app.js'), 'utf8');
  const errors = [];
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: initialView === 'home' ? origin : origin + '/#' + initialView, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const { window } = dom; const { document } = window;
  let cookie = ''; let networkFailure = false; let hold = null; let observationState = 'live';
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.fetch = async (resource, options = {}) => {
    const url = new URL(resource, origin);
    // Simulate the bridge going offline between displaying a ready form and
    // submitting it; the actual backend still returns its unavailable receipt.
    if (url.pathname === '/api/v1/gallery') return new Response(JSON.stringify({ photos }));
    // Frontend-only fixture. Native streaming and actual ACLs have separate
    // HTTP/WS tests and real Paper/WebGL acceptance.
    if (managedLive && url.pathname === '/api/v1/live') return new Response(JSON.stringify({mode:'native-3d',channels:[{id:'a'.repeat(32),playerName:'ag_Alpha',managed:true,online:true,available:true,visibility:'public'}]}));
    if (managedLive && /^\/api\/v1\/live\/[a-f0-9]{32}\/watch$/.test(url.pathname)) {
      if(observationState==='offline')throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({accepted:true,available:observationState==='live',message:'当前观战场景已满，空闲后自动连接',watchUrl:'/watch/'+'a'.repeat(32)+'/'}));
    }

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
  window.eval(await fs.readFile(path.join(projectRoot, 'public/memories.js'), 'utf8'));
  window.eval(await fs.readFile(path.join(projectRoot, 'public/challenges.js'), 'utf8'));
  window.eval(await fs.readFile(path.join(projectRoot, 'public/viewer-fullscreen.js'), 'utf8'));
  window.eval(code + '\nwindow.__portalRefreshForTest = refresh; window.__portalPollWorldForTest = () => { worldLastRenew = 0; return pollLiveFrame(); };');
  await waitFor(() => managedLive ? document.querySelector('[data-world-screen]') : initialView==='challenges' ? document.querySelector('.challenge-points') : document.querySelector('.onboarding-notice') && (initialView === 'home' ? document.querySelector('[data-world-roster] strong')?.textContent === 'Alpha' : document.querySelector('tbody strong')?.textContent === 'ag_Alpha'));
  const holdPrivate = () => {
    let entered, release;
    const ready = new Promise(resolve => { entered = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    hold = { entered, release, pending };
    return { ready, release };
  };
  return { portal, game, agent, document, window, origin, click, fill, submit, setup, holdPrivate, refresh: (manual = true) => window.__portalRefreshForTest(manual), outage: () => { networkFailure = true; }, observation: value => { observationState=value; return window.__portalPollWorldForTest(); } };
}

test('historical owned bodies are labelled with separate UUIDs and cannot offer live skin or password actions',async t=>{
 const ui=await screen(t,{capabilitiesReady:true});await ui.setup();const id='b'.repeat(24),uuid='22222222-2222-3222-8222-222222222222';
 const historical={...ui.agent,id,playerUuid:uuid,name:'Fishy',historical:true,online:false};
 ui.game.roster=async()=>[ui.agent,historical];
 const owner=ui.portal.store.ownerByName('ui-admin');ui.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id,uuid,'Isolated verified original UUID',Date.now());
 ui.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id,ui.agent.playerUuid,'Isolated current game role',Date.now());
 await ui.refresh();ui.window.location.hash='agents';
 await waitFor(()=>ui.document.querySelector('#roster-grid')?.textContent.includes('历史身体（只读）'));
 const card=[...ui.document.querySelectorAll('.agent-card')].find(r=>r.textContent.includes('Fishy'));
 assert.ok(card.textContent.includes('22222222'));assert.equal(card.querySelector('[data-action="agent-appearance"]'),null);
 ui.window.location.hash='account';await waitFor(()=>ui.document.querySelector('[data-action="change-game-password"]'));
 ui.click('[data-action="change-game-password"]');await waitFor(()=>ui.document.querySelector('#game-account-form'));
 assert.equal(ui.document.querySelector('#game-account-form select[name="username"] option[value="Fishy"]'),null);
});

test('an owner creates a one-time invite, closes its secret, and revokes it through the connection page', async t => {
  const ui = await screen(t); await ui.setup();
  const copied = []; Object.defineProperty(ui.window.navigator, 'clipboard', { value: { writeText: async value => copied.push(value) } });
  ui.window.location.hash = 'connections';
  await waitFor(() => ui.document.querySelector('[data-action="new-agent-invite"]'));
  ui.click('[data-action="new-agent-invite"]');
  ui.fill('label', '我的探索伙伴', '#agent-invite-form'); ui.fill('username', 'ag_NewGuide', '#agent-invite-form');
  ui.submit('#agent-invite-form');
  await waitFor(() => /^qdi_/.test(ui.document.querySelector('#created-token')?.textContent || ''));
  const secret = ui.document.querySelector('#created-token').textContent;
  assert.match(ui.document.querySelector('#modal').textContent, /不能认领已有角色/);
  ui.click('[data-action="copy-invite-link"]'); await waitFor(() => copied.length === 1);
  assert.ok(copied[0].endsWith('#invite=' + secret));
  ui.click('[data-action="copy-invite-prompt"]'); await waitFor(() => copied.length === 2);
  assert.match(copied[1], /\/mycli status/); assert.ok(copied[1].includes(copied[0]));
  ui.click('#modal [data-action="close-modal"]');
  assert.ok(!ui.document.body.textContent.includes(secret));
  assert.match(ui.document.body.textContent, /我的探索伙伴/);
  assert.match(ui.document.body.textContent, /等待认证桥上线/);
  ui.click('[data-action="revoke-agent-invite"]'); ui.submit('#revoke-agent-invite-form');
  await waitFor(() => !ui.document.querySelector('[data-action="revoke-agent-invite"]'));
  assert.match(ui.document.body.textContent, /已结束/);
  ui.click('[data-action="route"][data-view="account"]'); await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  ui.click('[data-action="logout"]'); await waitFor(() => !ui.document.querySelector('[data-action="logout"]'));
  assert.ok(!ui.document.body.textContent.includes('我的探索伙伴'));
});

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
  ui.window.location.hash = 'live'; await waitFor(() => ui.document.querySelector('#main').textContent.includes('女神之眼'));
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

test('announcements still submit and private legacy metadata clears on logout; viewers never configure a publisher', async t => {
  const ui = await screen(t); await ui.setup();
  ui.window.location.hash = 'events'; await waitFor(() => ui.document.querySelector('[data-action="new-notice"]'));
  ui.click('[data-action="new-notice"]');
  ui.fill('title', '网页公告已提交', '#notice-form'); ui.fill('body', '表单必须得到服务端确认。', '#notice-form'); ui.submit('#notice-form');
  await waitFor(() => !ui.document.querySelector('#modal').open);
  assert.equal(ui.portal.store.db.prepare("SELECT count(*) AS n FROM public_events WHERE title=?").get('网页公告已提交').n, 1);
  ui.portal.live.create({title:'不得残留的私有标题',playerName:'ag_Alpha',playerUuid,visibility:'owner'});
  await ui.refresh(false);
  ui.window.location.hash = 'live'; await waitFor(() => ui.document.querySelector('#main').textContent.includes('ag_Alpha'));
  assert.equal(ui.document.querySelector('[data-action="new-channel"]'),null);
  assert.equal(ui.document.querySelector('[data-action="rotate-publisher"]'),null);
  assert.equal(ui.document.querySelector('#created-token'),null);
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客');
  ui.window.location.hash = 'live'; await waitFor(() => ui.document.querySelector('#main').textContent.includes('女神之眼'));
  assert.ok(!ui.document.body.textContent.includes('不得残留的私有标题'));
});

test('managed viewing embeds the original modern page and metadata refresh keeps the same camera iframe', async t => {
  const ui=await screen(t,{initialView:'live',managedLive:true});
  await waitFor(()=>ui.document.querySelector('[data-world-frame]'));
  const frame=ui.document.querySelector('[data-world-frame]');
  assert.equal(frame.getAttribute('src'),'/watch/'+'a'.repeat(32)+'/');
  assert.match(frame.getAttribute('sandbox'),/allow-pointer-lock/);
  assert.ok(!ui.document.body.textContent.includes('接入直播'));
  await ui.refresh(false);assert.equal(ui.document.querySelector('[data-world-frame]'),frame);
  await ui.refresh(true);assert.equal(ui.document.querySelector('[data-world-frame]'),frame);
  const previousFooter=ui.document.querySelector('.footer').textContent,summary=ui.game.serverSummary;
  ui.game.serverSummary=async()=>({...await summary(),observedAt:'2026-10-10T03:10:00.000Z'});
  ui.click('.topbar [data-action="refresh"]');
  await waitFor(()=>!ui.document.querySelector('.topbar [data-action="refresh"]').disabled);
  assert.equal(ui.document.querySelector('[data-world-frame]'),frame);assert.notEqual(ui.document.querySelector('.footer').textContent,previousFooter);
});

test('live fullscreen expands the existing scene, retains its iframe on refresh and exits cleanly',async t=>{
  const ui=await screen(t,{initialView:'live',managedLive:true});
  await waitFor(()=>ui.document.querySelector('[data-world-frame]'));
  const frame=ui.document.querySelector('[data-world-frame]'),scene=ui.document.querySelector('[data-world-screen]');
  ui.click('[data-world-fullscreen]');
  await waitFor(()=>scene.dataset.viewerFullscreen==='window');
  assert.equal(ui.document.body.style.overflow,'hidden');assert.equal(ui.document.querySelector('[data-world-fullscreen]').textContent,'退出全屏');
  await ui.refresh(false);assert.equal(ui.document.querySelector('[data-world-frame]'),frame);assert.equal(scene.dataset.viewerFullscreen,'window');
  ui.window.dispatchEvent(new ui.window.KeyboardEvent('keydown',{key:'Escape'}));
  assert.equal(scene.dataset.viewerFullscreen,undefined);assert.equal(ui.document.body.style.overflow,'');
  ui.click('[data-world-fullscreen]');await waitFor(()=>scene.dataset.viewerFullscreen==='window');
  ui.window.location.hash='#help';await waitFor(()=>!ui.document.querySelector('[data-world-screen]'));
  assert.equal(ui.document.body.style.overflow,'','navigation must release fullscreen scroll lock');
});

test('unavailable observation clears the old scene, explains capacity and recovers without English network errors', async t => {
  const ui=await screen(t,{initialView:'live',managedLive:true});await waitFor(()=>ui.document.querySelector('[data-world-frame]'));
  const frame=ui.document.querySelector('[data-world-frame]');await ui.observation('pending');
  assert.equal(frame.isConnected,false);assert.equal(ui.document.querySelector('[data-world-frame]'),null);
  assert.match(ui.document.querySelector('[data-world-reason]').textContent,/场景已满/);
  await ui.observation('live');assert.ok(ui.document.querySelector('[data-world-frame]'));
  await ui.observation('offline');assert.equal(ui.document.querySelector('[data-world-frame]'),null);
  assert.match(ui.document.querySelector('[data-world-reason]').textContent,/恢复后自动重试/);assert.ok(!ui.document.body.textContent.includes('Failed to fetch'));
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


test('resident scene art and promotion preserve playback while background state updates', async t => {
  const ui = await screen(t, { initialView: 'home', media: { video: 'intro.mp4', poster: 'poster.jpg', character: 'cormy.webp', portrait: 'cormy-standing.png', credit: '千灯纪 / 可米' } });
  const video = ui.document.querySelector('.home-film video');
  assert.ok(video); assert.ok(video.hasAttribute('controls')); assert.ok(video.hasAttribute('playsinline')); assert.equal(video.hasAttribute('autoplay'), false);
  assert.equal(video.getAttribute('preload'), 'none'); assert.equal(video.querySelector('source').getAttribute('src'), '/media/intro.mp4');
  assert.equal(ui.document.querySelector('.character-feature'), null);
  assert.equal(ui.document.querySelector('.world-hero-resident'), null);
  assert.equal(ui.document.querySelector('.world-hero-art img').getAttribute('src'), '/assets/scenes/lantern-village.webp');
  assert.equal(ui.document.querySelectorAll('.world-scenes img[loading="lazy"]').length, 3);
  assert.match(ui.document.querySelector('.world-art-label').textContent, /可米与千灯纪.*世界概念/);
  assert.match(ui.document.querySelector('.home-world-strip').textContent, /NEKO.*Cortico/);
  video.currentTime = 42;
  ui.outage(); await ui.refresh(false);
  assert.equal(ui.document.querySelector('.home-film video'), video, 'Background polling must preserve the actual video node');
  assert.equal(video.currentTime, 42, 'Playback and paused seek positions must survive background polling');
  assert.match(ui.document.querySelector('.home-live-status').textContent, /等待世界的消息/);
});

test('an authorized owner edits private role settings and explicitly grants reference-reading scope', async t => {
  const ui = await screen(t); await ui.setup();
  ui.window.location.hash = 'agents'; await waitFor(() => ui.document.querySelector('[data-action="agent-profile"]'));
  ui.click('[data-action="agent-profile"]'); await waitFor(() => ui.document.querySelector('#agent-profile-form'));
  ui.fill('displayName', '小旅人', '#agent-profile-form');
  ui.fill('bio', '<script>unsafe()</script> 爱探索的旅人', '#agent-profile-form');
  ui.click('#agent-profile-form [name="useReferences"]'); ui.submit('#agent-profile-form');
  await waitFor(() => ui.document.querySelector('#toast').textContent.includes('角色设定已保存'));
  assert.equal(ui.document.querySelector('#agent-profile-form [name="displayName"]').value, '小旅人');
  assert.equal(ui.document.querySelectorAll('#agent-profile-form script').length, 0);
  assert.equal(ui.portal.store.db.prepare('SELECT use_references FROM agent_profiles').get().use_references, 0);
  assert.equal(ui.document.querySelector('#agent-profile-form [name="reference"]').getAttribute('accept'), 'image/png,image/jpeg,image/webp');
  ui.click('[data-action="close-modal"]'); ui.window.location.hash = 'connections';
  await waitFor(() => ui.document.querySelector('[data-action="new-token"]')); ui.click('[data-action="new-token"]');
  assert.ok(ui.document.querySelector('#token-form [name="profile"]'));
});


test('email signup UI waits for code confirmation and recovery returns to login instead of assuming authentication', async t => {
  const messages = [], ui = await screen(t, { emailMode: 'email', emailSender: { ready: true, send: async message => messages.push(message) } });
  await ui.setup(); ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客');
  ui.click('[data-action="login"]'); ui.click('[data-action="register"]');
  ui.fill('username', 'MailPlayer'); ui.fill('email', 'player@example.test'); ui.fill('password', password); ui.fill('confirmPassword', password); ui.submit('#auth-form');
  await waitFor(() => ui.document.querySelector('#email-code-form'));
  assert.equal(ui.portal.store.ownerByName('MailPlayer'), undefined);
  assert.equal(ui.document.querySelector('#email-code-form [name="code"]').getAttribute('inputmode'), 'numeric');
  ui.fill('code', messages.at(-1).code, '#email-code-form'); ui.submit('#email-code-form');
  await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === 'MailPlayer');
  assert.equal(ui.document.querySelector('#modal').open, false);
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  assert.match(ui.document.querySelector('#main').textContent, /player@example.test/);
  ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客');
  ui.click('[data-action="login"]'); ui.click('[data-action="forgot-password"]');
  ui.portal.store.db.prepare('UPDATE email_challenges SET created_at=created_at-61000').run();
  ui.fill('email', 'player@example.test', '#email-request-form'); ui.submit('#email-request-form'); await waitFor(() => ui.document.querySelector('#email-code-form'));
  ui.fill('code', messages.at(-1).code, '#email-code-form'); ui.fill('newPassword', 'new123', '#email-code-form'); ui.fill('confirmPassword', 'new123', '#email-code-form'); ui.submit('#email-code-form');
  await waitFor(() => ui.document.querySelector('#auth-form[data-mode="login"]'));
  assert.equal(ui.document.querySelector('.profile-button strong').textContent, '访客');
});

test('optional-email registration UI accepts a blank email and logs in the new password account', async t => {
  const ui = await screen(t, { emailMode: 'optional-email' }); await ui.setup();
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客');
  ui.click('[data-action="login"]'); ui.click('[data-action="register"]');
  assert.ok(ui.document.querySelector('#auth-form[data-mode="register"]'));
  assert.equal(ui.document.querySelector('#auth-form [name="email"]').required, false);
  assert.equal(ui.document.querySelector('#auth-form [name="email"]').disabled, true);
  ui.fill('username', 'LightPlayer'); ui.fill('password', 'abc123'); ui.fill('confirmPassword', 'abc123'); ui.submit('#auth-form');
  await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === 'LightPlayer');
  assert.equal(ui.document.querySelector('#email-code-form'), null);
  assert.equal(ui.portal.store.ownerByName('LightPlayer').role, 'owner');
});

test('optional-email UI verifies a supplied address instead of registering before the code', async t => {
  const messages = [], ui = await screen(t, { emailMode: 'optional-email', emailSender: { ready: true, send: async value => messages.push(value) } }); await ui.setup();
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客');
  ui.click('[data-action="login"]'); ui.click('[data-action="register"]');
  assert.equal(ui.document.querySelector('#auth-form [name="email"]').required, false);
  assert.equal(ui.document.querySelector('#auth-form [name="email"]').disabled, false);
  ui.fill('username', 'VerifiedPlayer'); ui.fill('email', 'verified@example.test'); ui.fill('password', 'abc123'); ui.fill('confirmPassword', 'abc123'); ui.submit('#auth-form');
  await waitFor(() => ui.document.querySelector('#email-code-form'));
  assert.equal(ui.portal.store.ownerByName('VerifiedPlayer'), undefined);
  ui.fill('code', messages[0].code, '#email-code-form'); ui.submit('#email-code-form');
  await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === 'VerifiedPlayer');
  assert.equal(ui.portal.emailAuth.ownerByEmail('verified@example.test').username, 'VerifiedPlayer');
});

test('unconfigured email registration UI states the actual limitation and preserves returning login', async t => {
  const ui = await screen(t, { emailMode: 'email' }); await ui.setup();
  ui.window.location.hash = 'account'; await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  ui.click('[data-action="logout"]'); await waitFor(() => ui.document.querySelector('.profile-button strong')?.textContent === '访客');
  ui.click('[data-action="login"]'); ui.click('[data-action="register"]');
  assert.match(ui.document.querySelector('#modal').textContent, /发信服务尚未配置/);
  assert.equal(ui.document.querySelector('#auth-form'), null);
  ui.click('#modal [data-action="login"]'); assert.ok(ui.document.querySelector('#auth-form[data-mode="login"]'));
});


test('my roles filters by ownership instead of administrator access and unbound roles show a claim entry', async t => {
  const ui = await screen(t); await ui.setup();
  ui.window.location.hash = 'agents'; await waitFor(() => ui.document.querySelector('[data-filter="authorized"]'));
  ui.click('[data-filter="authorized"]'); assert.equal(ui.document.querySelectorAll('.agent-card').length, 0);
  const admin = ui.portal.store.ownerByName('ui-admin');
  ui.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(admin.id, playerUuid, 'Isolated explicit owner approval', Date.now());
  await ui.refresh(); assert.equal(ui.document.querySelectorAll('.agent-card').length, 1); assert.match(ui.document.querySelector('.agent-card').textContent, /本人角色/);
  ui.portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(playerUuid); await ui.refresh();
  ui.click('[data-filter="all"]'); ui.click('[data-action="claim-role"]');
  assert.match(ui.document.querySelector('#modal').textContent, /账号桥尚未上线|认证桥|代理/);
  assert.equal(ui.document.querySelector('#game-account-form'), null);
});

test('game appearance is offered to the actual role owner and separates file upload from verified application', async t => {
  const ui = await screen(t); await ui.setup(); ui.window.location.hash = 'agents';
  await waitFor(() => ui.document.querySelector('[data-filter="all"]'));
  assert.equal(ui.document.querySelector('[data-action="agent-appearance"]'), null);
  const owner = ui.portal.store.ownerByName('ui-admin');
  ui.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, playerUuid, 'Isolated owner proof', Date.now());
  await ui.refresh(); ui.click('[data-action="agent-appearance"]');
  await waitFor(() => ui.document.querySelector('#appearance-upload-form'));
  assert.match(ui.document.querySelector('#modal').textContent, /上传不代表已换装/);
  assert.match(ui.document.querySelector('#modal').textContent, /不支持加密/);
  assert.ok(ui.document.querySelector('#appearance-upload-form [name="publicConsent"]').required);
  assert.equal(ui.document.querySelector('[data-action="apply-appearance"]'), null);
});


test('shared memories keep uploads private until preview and explicit publication, with working comparison and withdrawal', async t => {
  const ui = await screen(t); await ui.setup();
  ui.window.location.hash = 'memories';
  await waitFor(() => ui.document.querySelector('[data-memory-action="new"]'));
  ui.click('[data-memory-action="new"]');
  ui.fill('title', '工坊旁的日常', '#memory-form');
  ui.fill('story', '可米整理箱子，记录自己的生活。', '#memory-form');
  ui.fill('participants', 'ag_CorMy', '#memory-form');
  const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
  for (const name of ['original', 'redraw']) Object.defineProperty(ui.document.querySelector(`#memory-form [name="${name}"]`), 'files', { configurable: true, value: [new File([bytes], name + '.png', { type: 'image/png' })] });
  ui.submit('#memory-form');
  await waitFor(() => ui.document.querySelector('#memory-publish-form'));
  assert.match(ui.document.querySelector('#memory-dialog').textContent, /私人草稿/);
  assert.equal(ui.portal.memories.list().total, 0);
  const slider = ui.document.querySelector('.memory-comparison input[type="range"]'); slider.value = '77';
  slider.dispatchEvent(new ui.window.Event('input', { bubbles: true }));
  assert.equal(ui.document.querySelector('.memory-compare-redraw').style.clipPath, 'inset(0 0 0 77%)');
  assert.equal(ui.document.querySelector('.memory-compare-divider').style.left, '77%');
  ui.document.querySelector('#memory-publish-form [name="confirmPublic"]').checked = true;
  ui.submit('#memory-publish-form');
  await waitFor(() => ui.portal.memories.list().total === 1 && ui.document.querySelector('[data-memory-action="withdraw"]'));
  assert.equal(ui.portal.memories.list().items[0].title, '工坊旁的日常');
  ui.click('[data-memory-action="withdraw"]');
  await waitFor(() => ui.portal.memories.list().total === 0 && ui.document.querySelector('#toast').textContent.includes('已撤回为私人草稿'));
  ui.click('#memory-dialog [data-memory-action="close"]');
  ui.click('[data-memory-action="mine"]');
  await waitFor(() => ui.document.querySelector('.memory-draft-label') && ui.document.querySelector('.memory-toolbar').getAttribute('aria-busy') === 'false');
  assert.match(ui.document.querySelector('.memory-card').textContent, /私人草稿/);
});

test('public deep links render escaped stories, participant filtering and sharing without exposing private drafts', async t => {
  const ui = await screen(t); await ui.setup();
  const owner = ui.portal.store.ownerByName('ui-admin'), context = { owner };
  const post = ui.portal.memories.create(context, { requestId: randomUUID(), title: '<img src=x onerror=bad()>', story: '<script>bad()</script>\n同行的一刻', participants: ['ag_CorMy', 'LittleFish0510'], credit: '玩家分享' });
  const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
  for (const kind of ['original', 'redraw']) ui.portal.memories.upload(post.id, kind, context, bytes, 'image/png');
  ui.portal.memories.publish(post.id, context, { confirmPublic: true, revision: ui.portal.memories.detail(post.id, context).revision });
  const copies = []; Object.defineProperty(ui.window.navigator, 'clipboard', { value: { writeText: async value => copies.push(value) } });
  ui.window.location.hash = 'memories/' + post.id;
  await waitFor(() => ui.document.querySelector('.memory-story-text'));
  assert.ok(ui.document.querySelector('.memory-story-text').textContent.includes('<script>bad()</script>'));
  assert.equal(ui.document.querySelectorAll('#memory-dialog script, #memory-title img').length, 0);
  assert.match(ui.document.querySelector('.memory-people').textContent, /可米/);
  ui.click('[data-memory-action="share"]'); await waitFor(() => copies.length === 1);
  assert.equal(copies[0], ui.origin + '/#memories/' + post.id);
  ui.click('#memory-dialog [data-memory-action="close"]');
  await waitFor(() => ui.window.location.hash === '#memories');
  await ui.refresh(false);
  assert.equal(ui.document.querySelector('#memory-dialog').open, false, 'Background refresh must not reopen a dismissed shared link');
  ui.click('.memory-card-image');
  await waitFor(() => ui.document.querySelector('.memory-story-text'));
  ui.window.location.hash = 'home';
  await waitFor(() => ui.document.querySelector('.world-hero') && !ui.document.querySelector('#memory-dialog').open);
  ui.window.location.hash = 'memories/' + post.id;
  await waitFor(() => ui.document.querySelector('.memory-story-text'));
  ui.click('#memory-dialog [data-memory-action="participant"][data-name="LittleFish0510"]');
  await waitFor(() => ui.window.location.hash === '#memories' && ui.document.querySelector('.memory-filter'));
  assert.match(ui.document.querySelector('.memory-filter').textContent, /小鱼/);
  ui.window.location.hash = 'account';
  await waitFor(() => ui.document.querySelector('[data-action="logout"]'));
  ui.click('[data-action="logout"]');
  await waitFor(() => ui.document.querySelector('#toast').textContent.includes('已退出网站'));
  assert.equal(ui.document.querySelectorAll('.memory-draft-label').length, 0);
});


test('home and connection center expose three real client choices with parent projects and current SDK', async t => {
 const ui = await screen(t, { initialView:'home' });
 const source = 'https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world';
 assert.equal(ui.document.querySelectorAll('.client-choices .client-card').length,4);
 assert.ok(ui.document.querySelector(`.client-choices a[href="${source}"]`));
 for (const url of ['https://github.com/Project-N-E-K-O/N.E.K.O','https://github.com/Pal-AI-Lab/Cortico']) assert.ok(ui.document.querySelector(`.client-choices a[href="${url}"]`));
 ui.window.location.hash='connections'; await waitFor(()=>ui.document.querySelector('a[download]'));
 assert.ok(ui.document.querySelector('a[download]').href.endsWith(agentSkill.url));
 assert.ok(ui.document.querySelector('#main').textContent.includes(agentSkill.sdkVersion));
 assert.equal(ui.document.querySelectorAll('.client-choices .client-card').length,4);
 await ui.refresh(false);
 assert.equal(ui.document.querySelectorAll('.client-choices .client-card').length,4);
});


test('homepage presents FOM as coming soon without any connection action',async t=>{
 const ui=await screen(t,{initialView:'home'}),card=ui.document.querySelector('.home-upcoming-world');
 assert.ok(card);assert.match(card.textContent,/FOM 模组世界/);assert.match(card.textContent,/敬请期待/);assert.match(card.textContent,/尚未正式开放/);
 assert.equal(card.querySelectorAll('a,button,input,code').length,0);assert.ok(!card.textContent.includes('28977'));assert.ok(!card.textContent.includes('28976'));
 await ui.refresh(false);assert.equal(ui.document.querySelectorAll('.home-upcoming-world').length,1);
});

function uiChallenges(stale=false){
 const now=new Date().toISOString(),base={party:['ag_Alpha'],hiddenMembers:0,difficulty:'normal',reachedUnits:15,clearedUnits:15,totalUnits:15,startedAt:now,endedAt:now,observedAt:now,reason:'cleared',evidence:'saved-outcome'};
 return {schemaVersion:1,available:true,observedAt:stale?new Date(Date.now()-120000).toISOString():now,activities:[{id:'trial_tower',type:'tower',name:'试炼塔',unit:'层',totalUnits:15},{id:'crypt',type:'dungeon',name:'测试墓穴',unit:'室',totalUnits:3}],runs:[{...base,id:'a'.repeat(24),activityId:'trial_tower',state:'completed'},{...base,id:'b'.repeat(24),activityId:'crypt',state:'paused',totalUnits:3,reachedUnits:2,clearedUnits:1,endedAt:null,reason:'data_unavailable'}]};
}
test('public challenge page shows verified team difficulty progress and website points without login',async t=>{
 const ui=await screen(t,{initialView:'challenges',challengeSnapshot:uiChallenges()});
 await waitFor(()=>ui.document.querySelector('.challenge-points'));
 assert.match(ui.document.body.textContent,/普通难度榜/);assert.match(ui.document.querySelector('.challenge-party').textContent,/ag_Alpha/);
 assert.equal(ui.document.querySelector('.challenge-points').textContent,'2000');assert.match(ui.document.querySelector('.challenge-run-progress').textContent,/已通关 15 \/ 15 层/);
 assert.match(ui.document.querySelector('.challenge-notes').textContent,/网站挑战积分/);assert.equal(ui.document.querySelectorAll('.challenge-meter .complete').length,15);
});
test('challenge and difficulty controls preserve paused dungeon progress and select independent rankings',async t=>{
 const ui=await screen(t,{initialView:'challenges',challengeSnapshot:uiChallenges()});await waitFor(()=>ui.document.querySelector('.challenge-points'));
 const select=ui.document.querySelector('#challenge-activity');select.value='crypt';select.dispatchEvent(new ui.window.Event('change',{bubbles:true}));
 await waitFor(()=>ui.document.querySelector('.challenge-hero h2').textContent==='测试墓穴');
 assert.match(ui.document.querySelector('.challenge-run').textContent,/挑战暂停/);assert.match(ui.document.querySelector('.challenge-run-progress').textContent,/已通关 1 \/ 3 室/);assert.match(ui.document.querySelector('.challenge-run').textContent,/运行数据异常/);
 assert.equal(ui.document.querySelectorAll('.challenge-ranking tbody tr').length,0);
 ui.click('[data-challenge-level="adventure"]');await waitFor(()=>ui.document.querySelectorAll('.challenge-ranking').length===1);
 assert.equal(ui.document.querySelectorAll('.challenge-run').length,0);await ui.refresh(false);assert.equal(ui.document.querySelector('#challenge-activity').value,'crypt');
});
test('stale challenge snapshots keep saved achievements visible and say current progress may have changed',async t=>{
 const ui=await screen(t,{initialView:'challenges',challengeSnapshot:uiChallenges(true)});await waitFor(()=>ui.document.querySelector('.challenge-points'));
 assert.match(ui.document.querySelector('.challenge-warning').textContent,/已保存记录/);assert.match(ui.document.querySelector('.challenge-warning').textContent,/可能已变化/);assert.equal(ui.document.querySelector('.challenge-points').textContent,'2000');
});


test('historical archives are collapsed separately from a real player sharing the same name', async t => {
  const ui = await screen(t); await ui.setup();
  const player = { ...ui.agent, id: 'c'.repeat(24), playerUuid: '33333333-3333-3333-8333-333333333333', name: 'Fishy', kind: 'player', online: false };
  const history = [4, 5].map(n => ({ ...ui.agent, id: String(n).repeat(24), playerUuid: `${n}`.repeat(8) + '-4444-4444-8444-' + `${n}`.repeat(12), name: 'fishy', historical: true, online: false }));
  const rows = [ui.agent, player, ...history], owner = ui.portal.store.ownerByName('ui-admin');
  for (const row of rows) ui.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, row.playerUuid, 'Isolated original UUID evidence', Date.now());
  ui.game.roster = async () => rows;
  await ui.refresh(); ui.window.location.hash = 'agents';
  await waitFor(() => ui.document.querySelectorAll('#roster-grid > article.agent-card').length === 2);
  const names = () => [...ui.document.querySelectorAll('#roster-grid > article.agent-card h2')].map(row => row.textContent);
  assert.deepEqual(names(), ['ag_Alpha', 'Fishy']);
  let archive = ui.document.querySelector('[data-role-history]');
  assert.ok(archive); assert.equal(archive.open, false);
  assert.match(archive.querySelector('summary').textContent, /2 份/);
  assert.equal(archive.querySelectorAll('article.agent-card').length, 2);
  assert.ok([...archive.querySelectorAll('.status')].every(row => row.textContent === '历史存档'));
  ui.click('[data-role-history] > summary'); assert.equal(archive.open, true);
  await ui.refresh(false); archive = ui.document.querySelector('[data-role-history]'); assert.equal(archive.open, true);
  const search = ui.document.querySelector('#roster-search'); search.value = 'fishy';
  search.dispatchEvent(new ui.window.Event('input', { bubbles: true }));
  assert.deepEqual(names(), ['Fishy']);
  assert.equal(ui.document.querySelector('[data-role-history]').open, true);
  assert.equal(ui.document.querySelectorAll('[data-role-history] article').length, 2);
  assert.equal(ui.portal.store.ownedUuids(owner.id).length, 4);
});

test('an archive-only account can open each saved inventory by UUID without showing current duplicates', async t => {
  const ui = await screen(t); await ui.setup();
  const history = [6, 7].map(n => ({ ...ui.agent, id: String(n).repeat(24), playerUuid: `${n}`.repeat(8) + '-4444-4444-8444-' + `${n}`.repeat(12), name: 'fishy', historical: true, online: false }));
  const owner = ui.portal.store.ownerByName('ui-admin');
  for (const row of history) ui.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner.id, row.playerUuid, 'Isolated historical UUID', Date.now());
  ui.game.roster = async () => history;
  let inspectedUuid = null; const original = ui.game.playerState;
  ui.game.playerState = async row => { inspectedUuid = row.playerUuid; return { ...await original(), agent: row }; };
  await ui.refresh(); ui.window.location.hash = 'inventory';
  await waitFor(() => ui.document.querySelector('[data-role-history]'));
  assert.equal(ui.document.querySelectorAll('.roster-grid.gap-top > article.agent-card').length, 0);
  assert.ok(ui.document.querySelector('main').textContent.includes('暂无已绑定的当前角色'));
  const archive = ui.document.querySelector('[data-role-history]'); assert.equal(archive.open, false);
  assert.equal(archive.querySelectorAll('[data-action="inventory-detail"]').length, 2);
  ui.click('[data-role-history] > summary'); assert.equal(archive.open, true);
  ui.click(`[data-action="inventory-detail"][data-id="${history[1].id}"]`);
  await waitFor(() => inspectedUuid === history[1].playerUuid && ui.document.querySelector('dialog[open]'));
  assert.equal(inspectedUuid, history[1].playerUuid);
  assert.equal(ui.portal.store.ownedUuids(owner.id).length, 2);
});
