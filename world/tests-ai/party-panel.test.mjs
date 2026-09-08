import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { projectParty, projectWorld } from '../admin/read-model.mjs';
import { createPanelServer } from '../admin/server.mjs';

const hearing = (now = Date.now()) => ({state: 'heard', receipt: {heard: true, phase: 'heard', channel: 'nearby', distance: 2.5, radius: 24, emittedAt: now}});
const fixture = (now = Date.now()) => ({ schema: 1, updatedAt: now, enabled: true, status: 'running',
  members: [{agentId: 'qd-survivor', displayName: '桐人', kind: 'survivor', bodyUuid: '12345678-1234-1234-1234-123456789012'},
    {agentId: 'dynamic-maid-fixture', displayName: '旅行伙伴', kind: 'maid', bodyUuid: '87654321-4321-4321-4321-210987654321'}],
  counts: {pending: 1, unknown: 0, submitted: 0, answered: 1, expired: 0, failed: 0},
  budget: {reservedDispatches24h: 2, dailyDispatchCap: 8, remaining: 6, blocked: false, nextDispatchAt: now / 1000 + 60},
  messages: [{messageId: 'private-message-id', status: 'answered', createdAt: now / 1000 - 30, text: '一起去村庄收集种子。',
    sender: {agentId: 'qd-survivor'}, worldDelivery: hearing(now),
    reply: {text: '我会先检查食物和工具。', createdAt: now / 1000, sender: {agentId: 'dynamic-maid-fixture'}, worldDelivery: hearing(now)}}] });

test('party projection hides routing and credentials while retaining names, bounded dialogue and counts', () => {
  const raw = fixture(), secret = 'PRIVATE_SENTINEL';
  raw.token = secret; raw.sessionId = secret; raw.members[0].sessionId = secret; raw.members[0].mcpToken = secret;
  raw.messages[0].reply.sender.token = secret; raw.messages[0].taskId = secret;
  raw.budget.apiKey = secret;
  const value = projectParty(raw);
  assert.equal(value.available, true); assert.equal(value.stale, false);
  assert.equal(value.members[1].displayName, '旅行伙伴'); assert.equal(value.counts.pending, 1);
  assert.equal(value.budget.remaining, 6); assert.equal(value.messages[0].reply.senderAgentId, 'dynamic-maid-fixture');
  assert.equal(Date.parse(value.messages[0].createdAt), raw.messages[0].createdAt * 1000);
  const encoded = JSON.stringify(value);
  for (const privateValue of [secret, raw.members[0].bodyUuid, raw.members[1].bodyUuid, 'private-message-id'])
    assert.equal(encoded.includes(privateValue), false);
  raw.messages = Array.from({length: 30}, () => ({...raw.messages[0], text: '文'.repeat(5000)}));
  const bounded = projectParty(raw);
  assert.equal(bounded.messages.length, 8); assert.equal(bounded.messages[0].text.length, 160);
  raw.messages[0].reply.sender.agentId = 'unrelated-role';
  assert.equal(projectParty(raw).messages[0].reply, null);
});

test('unheard drafts stay hidden and actual game msg is not restricted to nearby radius', () => {
  const raw = fixture();
  raw.messages[0].worldDelivery.state = 'unknown';
  assert.equal(projectParty(raw).messages[0].text, null);
  assert.equal(projectParty(raw).messages[0].reply, null);
  raw.messages[0].worldDelivery = hearing();
  raw.messages[0].reply.worldDelivery.state = 'rejected';
  assert.equal(projectParty(raw).messages[0].reply, null);
  raw.messages[0].worldDelivery.receipt.distance = 25;
  assert.equal(projectParty(raw).messages[0].text, null);
  raw.messages[0].worldDelivery.receipt.channel = 'msg';
  raw.messages[0].worldDelivery.receipt.radius = null;
  const value = projectParty(raw).messages[0];
  assert.equal(value.hearing.heard, true);
  assert.equal(value.hearing.channel, 'msg');
  assert.equal(value.hearing.distance, null);
  assert.equal(value.text, '一起去村庄收集种子。');
});

test('missing, stale, future and malformed party states cannot look live', () => {
  const now = Date.now();
  assert.equal(projectParty(null, now).status, 'unconfigured');
  assert.equal(projectParty({}, now).status, 'unavailable');
  assert.equal(projectParty(fixture(now - 90001), now).stale, true);
  assert.equal(projectParty(fixture(now + 6000), now).stale, true);
  assert.equal(projectParty(fixture(now - 90000), now).stale, false);
  for (const change of [{schema: 2}, {updatedAt: 1e25}, {enabled: 'true'}, {members: []}, {status: '<script>'}])
    assert.equal(projectParty({...fixture(), ...change}).available, false);
  const raw = fixture(); raw.counts.pending = -1; raw.budget.remaining = '6'; raw.budget.blocked = 'no';
  const result = projectParty(raw);
  assert.equal(result.counts.pending, null); assert.equal(result.budget.remaining, null); assert.equal(result.budget.blocked, null);
});

test('historical framework output is marked as interruption without rewriting the game record', () => {
  const raw = fixture();
  raw.messages[0].reply.text = 'Max iterations (6) reached';
  const projected = projectParty(raw).messages[0];
  assert.equal(projected.frameworkInterruption, true);
  assert.equal(projected.detail, 'native_framework_interruption');
  assert.equal(projected.reply.text, raw.messages[0].reply.text);
  assert.equal(raw.messages[0].status, 'answered');
  raw.messages[0].reply.text = '那次出现 Max iterations (6) reached，后来恢复了。';
  assert.equal(projectParty(raw).messages[0].frameworkInterruption, false);
});

test('identity and labelled credentials accidentally echoed in dialogue are redacted', () => {
  const raw = fixture();
  raw.messages[0].text = 'body=' + raw.members[0].bodyUuid + ' token=TOP_SECRET session_id=hidden-session Bearer credential';
  const value = JSON.stringify(projectParty(raw));
  for (const secret of [raw.members[0].bodyUuid, 'TOP_SECRET', 'hidden-session', 'Bearer credential']) assert.equal(value.includes(secret), false);
});

test('the panel reads only the projected party file, independently of the world snapshot', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qd-party-panel-'));
  const server = createPanelServer({stateDir: directory}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await fs.rm(directory, {recursive: true}); });
  const get = () => new Promise((resolve, reject) => {
    const req = http.get({hostname: '127.0.0.1', port: server.address().port, path: '/api/state', headers: {Host: '127.0.0.1:9090'}}, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks))));
    }); req.on('error', reject);
  });
  assert.equal((await get()).party.status, 'unconfigured');
  const raw = fixture(); raw.private = 'PRIVATE_SENTINEL';
  await fs.writeFile(path.join(directory, 'party.json'), JSON.stringify(raw));
  const result = await get(); assert.equal(result.available, false); assert.equal(result.party.available, true);
  assert.equal(result.party.stale, false); assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
});

test('party card safely renders replies, waiting, stale and missing states on desktop and mobile', {timeout: 30000}, async t => {
  let executablePath;
  for (const candidate of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']) {
    try { await fs.access(candidate); executablePath = candidate; break; } catch { /* next browser */ }
  }
  assert.ok(executablePath);
  const {chromium} = await import('playwright-core');
  const browser = await chromium.launch({executablePath, headless: true, args: ['--disable-background-networking']});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 1280, height: 900}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assets = Object.fromEntries(await Promise.all([['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'],
    ['/management.js', 'management.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']].map(async ([route, file, contentType]) =>
    [route, {contentType, body: await fs.readFile(new URL('../admin/public/' + file, import.meta.url), 'utf8') }])));
  let raw = fixture(), failed = false;
  raw.messages[0].text = '<img src=x onerror="window.partyXss=true">一起去村庄';
  raw.messages[0].reply.text = '<script>window.partyXss=true</script>我会准备好';
  const world = projectWorld({heartbeat: {ts: Date.now()}, npc: {}, board: {}});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()); assert.equal(url.origin, 'http://party-fixture.test');
    const json = body => route.fulfill({contentType: 'application/json', body: JSON.stringify(body)});
    if (url.pathname === '/api/state') return failed ? route.abort() : json({...world, party: projectParty(raw), links: {qwenpaw: 'http://127.0.0.1:18089'}, warnings: []});
    if (url.pathname === '/healthz') return json({ok: true});
    if (url.pathname === '/api/manage/session') return json({configured: false, authenticated: false});
    if (url.pathname === '/api/manage/services') return json({services: []});
    if (url.pathname === '/favicon.ico') return route.fulfill({status: 404, body: ''});
    assert.ok(Object.hasOwn(assets, url.pathname)); return route.fulfill(assets[url.pathname]);
  });
  const refresh = async () => { await page.getByRole('button', {name: '刷新', exact: true}).click(); };
  await page.goto('http://party-fixture.test/#survivor');
  await page.locator('#survivor-party-badge').filter({hasText: '小队已连接'}).waitFor();
  assert.match(await page.locator('#survivor-party-members').innerText(), /桐人.*旅行伙伴/s);
  assert.match(await page.locator('#survivor-party-messages').innerText(), /旅行伙伴的回复/);
  assert.equal(await page.locator('#survivor-party img, #survivor-party script').count(), 0);
  assert.equal(await page.evaluate(() => window.partyXss), undefined);
  assert.equal(await page.locator('#survivor-party-console').getAttribute('href'), 'http://127.0.0.1:18089/agents');
  assert.ok(await page.evaluate(() => Array.from(document.querySelector('#view-survivor').children).findIndex(node => node.id === 'survivor-party') < 2));
  raw.budget.blocked = true; await refresh();
  await page.locator('#survivor-party-badge').filter({hasText: '等待交流额度'}).waitFor();
  assert.match(await page.locator('#survivor-party-reason').innerText(), /最早再次投递/);
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.PARTY_PANEL_QA_IMAGE) await page.locator('#survivor-party').screenshot({path: process.env.PARTY_PANEL_QA_IMAGE});
  raw.updatedAt = Date.now() - 91000; await refresh();
  await page.locator('#survivor-party-badge').filter({hasText: '历史记录'}).waitFor();
  raw = fixture(); await refresh(); await page.locator('#survivor-party-badge').filter({hasText: '小队已连接'}).waitFor();
  failed = true; await refresh(); await page.locator('#survivor-party-badge').filter({hasText: '历史记录'}).waitFor();
  failed = false; raw = null; await refresh();
  await page.locator('#survivor-party-badge').filter({hasText: '尚未配置'}).waitFor();
  assert.match(await page.locator('#survivor-party-members').innerText(), /尚未登记/);
  assert.equal(await page.locator('#survivor-party-messages .party-message').count(), 0);
  assert.deepEqual(errors, []);
});
