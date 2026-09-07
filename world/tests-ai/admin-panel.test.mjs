import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createPanelServer } from '../admin/server.mjs';
import { projectWorld, freshness, projectHealth, projectOperations } from '../admin/read-model.mjs';

function operationsFixture(now = Date.now()) {
  return { schema: 1, project: 'qiandengji', generatedAt: new Date(now).toISOString(),
    runtimes: [{ id: 'qiandengji', label: 'D 项目 QwenPaw', kind: 'compose', version: '2.1.0',
      endpoint: 'http://127.0.0.1:18089', state: 'running', purpose: '游戏世界运营', enabledAgentCount: 1, agentCount: 2 }],
    agents: [{ id: 'mc-god', label: '灯语女神', runtimeId: 'qiandengji', enabled: true, role: '世界叙事与运营建议',
      modelProvider: 'cloud', model: 'model-v1', toolCount: 0, mcpCount: 0, jobCount: 0 },
    { id: 'reserved', label: '预留角色', runtimeId: 'qiandengji', enabled: false, role: null, modelProvider: null,
      model: null, toolCount: null, mcpCount: null, jobCount: null }],
    services: [{ id: 'voice', label: '世界配音', group: 'D 项目', container: 'qiandengji-voice-1', state: 'running',
      health: 'healthy', purpose: '语音队列', managedBy: 'qiandengji', dependencies: ['tts-local'] }],
    issues: [{ code: 'tts-owner', severity: 'warning', title: '共享 TTS 待登记', detail: '确认 8100 的运行环境和维护归属。' }],
    commands: [{ label: '查看服务', command: 'python tools/project.py status' }],
  };
}

function operationsTeamFixture(now = Date.now()) {
  const fixture = operationsFixture(now);
  fixture.runtimes[0].agentCount = 4; fixture.runtimes[0].enabledAgentCount = 3;
  fixture.runtimes.push({ ...fixture.runtimes[0], id: 'qiandengji-ops', label: '千灯纪世界运营组',
    version: '2.2.0', endpoint: 'http://127.0.0.1:18090', agentCount: 7, enabledAgentCount: 6 });
  fixture.agents[0].label = '游戏女神';
  fixture.agents[1] = { ...fixture.agents[0], id: 'mc-herald', label: '游戏司礼' };
  const names = { 'mc-god': '运营天神', default: '司灯', 'mc-herald': '灯语女神',
    'mc-priest': '灶火祭司', 'mc-guard-kirito': '桐人体验官', 'mc-guard-naruto': '鸣人体验官' };
  fixture.agents.push(...Object.entries(names).map(([id, label]) => ({ ...fixture.agents[0], id, label,
    runtimeId: 'qiandengji-ops', modelProvider: id === 'mc-god' ? 'zhipu-cn-codingplan' : 'aliyun-codingplan',
    model: id === 'mc-god' ? 'glm-5.3' : 'qwen3.6-plus' })));
  fixture.teamPolicy = { packageVersion: '2.2.0', mode: 'manual', maxConcurrentModels: 1, maxQueriesPerMinute: 6,
    maxIterations: 5, automaticRetries: false, delegationCooldownSeconds: 1800, maxDelegationsPerDay: 4,
    scheduledJobs: 0, heartbeat: false, roleSkills: Object.fromEntries(Object.keys(names).map(role => [role, ['qd-evidence-report']])) };
  const specialties = { default: 'qd-team-coordination', 'mc-god': 'qd-priority-review', 'mc-herald': 'qd-service-triage',
    'mc-priest': 'qd-world-events', 'mc-guard-kirito': 'qd-casting-acceptance', 'mc-guard-naruto': 'qd-onboarding-exploration' };
  for (const [role, skill] of Object.entries(specialties)) fixture.teamPolicy.roleSkills[role].push(skill);
  fixture.teamUsage = { callCount: 3, promptTokens: 1234, completionTokens: 56, cachedTokens: 800,
    window: 'today', generatedAt: new Date(now).toISOString() };
  fixture.teamRound = { schema: 1, project: 'qiandengji-ops', runId: 'ops-fixture', ok: true,
    finishedAt: new Date(now).toISOString(), modelCalls: 3, promptTokens: 1234, completionTokens: 56, elapsedSeconds: 18.5,
    roles: [{ role: 'default', ok: true, requestId: 'ops-fixture-default', summary: '整理运营待办，等待人工处理。',
      modelCalls: 3, promptTokens: 1234, completionTokens: 56, elapsedSeconds: 18.5 }] };
  return fixture;
}

test('operations policy, usage and round metrics expose only bounded public records', () => {
  const fixture = operationsTeamFixture(), sentinel = 'PRIVATE_BUDGET_SENTINEL';
  for (const field of ['teamPolicy', 'teamUsage', 'teamRound']) fixture[field].secret = sentinel;
  fixture.teamPolicy.roleSkills.host = [sentinel]; fixture.teamRound.roles[0].providerConfig = sentinel;
  fixture.teamPolicy.roleSkills.default.push(null, {}, '', 'qd-team-coordination', 'x'.repeat(500));
  fixture.teamRound.roles.push({ role: 'host', summary: sentinel });
  const result = projectOperations(fixture);
  assert.equal(result.teamPolicy.maxConcurrentModels, 1); assert.equal(result.teamPolicy.automaticRetries, false);
  assert.equal(result.teamPolicy.scheduledJobs, 0); assert.equal(result.teamPolicy.heartbeat, false);
  assert.deepEqual(result.teamPolicy.roleSkills.default, ['qd-evidence-report', 'qd-team-coordination', 'x'.repeat(100)]);
  assert.equal(result.teamUsage.callCount, 3); assert.equal(result.teamUsage.cachedTokens, 800);
  assert.equal(result.teamRound.elapsedSeconds, 18.5); assert.equal(result.teamRound.roles[0].modelCalls, 3);
  assert.equal(result.teamRound.roles.length, 1); assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test('missing or malformed operations budgets and measured usage remain unknown instead of zero', () => {
  const fixture = operationsTeamFixture();
  fixture.teamPolicy.maxConcurrentModels = '1'; fixture.teamPolicy.maxIterations = -1;
  fixture.teamPolicy.automaticRetries = 0; fixture.teamPolicy.roleSkills = { default: null, 'mc-god': [] };
  fixture.teamUsage = { callCount: true, promptTokens: -1, completionTokens: Infinity, cachedTokens: 0.5, window: 'forever' };
  fixture.teamRound.modelCalls = false; fixture.teamRound.elapsedSeconds = -0.1;
  delete fixture.teamRound.roles[0].promptTokens; fixture.teamRound.roles[0].elapsedSeconds = '18';
  const result = projectOperations(fixture);
  assert.equal(result.teamPolicy.maxConcurrentModels, null); assert.equal(result.teamPolicy.maxIterations, null);
  assert.equal(result.teamPolicy.automaticRetries, null); assert.equal(result.teamPolicy.roleSkills.default, null);
  assert.deepEqual(result.teamPolicy.roleSkills['mc-god'], []);
  for (const field of ['callCount', 'promptTokens', 'completionTokens', 'cachedTokens', 'window', 'generatedAt']) assert.equal(result.teamUsage[field], null);
  assert.equal(result.teamRound.modelCalls, null); assert.equal(result.teamRound.elapsedSeconds, null);
  assert.equal(result.teamRound.roles[0].promptTokens, null); assert.equal(result.teamRound.roles[0].elapsedSeconds, null);
  for (const fixture of [operationsFixture(), { ...operationsFixture(), teamPolicy: [], teamUsage: [] },
    operationsTeamFixture(Date.now() + 60000)]) {
    const result = projectOperations(fixture);
    assert.equal(result.teamPolicy, null); assert.equal(result.teamUsage, null); assert.equal(result.teamRound, null);
  }
});

test('round summaries derive missing metrics only from a complete measured roster', () => {
  const fixture = operationsTeamFixture();
  for (const field of ['modelCalls', 'promptTokens', 'completionTokens', 'elapsedSeconds']) delete fixture.teamRound[field];
  let result = projectOperations(fixture).teamRound;
  assert.equal(result.modelCalls, 3); assert.equal(result.promptTokens, 1234);
  assert.equal(result.completionTokens, 56); assert.equal(result.elapsedSeconds, 18.5);
  fixture.teamRound.roles.push({ ...fixture.teamRound.roles[0], role: 'mc-herald', modelCalls: 1,
    promptTokens: 100, completionTokens: 10, elapsedSeconds: 5 });
  result = projectOperations(fixture).teamRound;
  assert.equal(result.modelCalls, 4); assert.equal(result.promptTokens, 1334);
  assert.equal(result.completionTokens, 66); assert.equal(result.elapsedSeconds, null, 'Concurrent durations must not be summed');
  fixture.teamRound.startedAt = '2026-09-07T20:00:00+08:00';
  fixture.teamRound.finishedAt = '2026-09-07T12:00:30.100Z';
  assert.equal(projectOperations(fixture).teamRound.elapsedSeconds, 30.1);
  fixture.teamRound.modelCalls = 8;
  assert.equal(projectOperations(fixture).teamRound.modelCalls, 8, 'An explicit total may include calls outside the role reports');
  delete fixture.teamRound.modelCalls;
  delete fixture.teamRound.roles[1].promptTokens;
  result = projectOperations(fixture).teamRound;
  assert.equal(result.promptTokens, null); assert.equal(result.modelCalls, 4, 'Completeness is checked independently per metric');
  fixture.teamRound.finishedAt = 'invalid';
  assert.equal(projectOperations(fixture).teamRound.elapsedSeconds, null);
  for (const roles of [[], [{ role: 'default' }], [{ ...fixture.teamRound.roles[0], role: 'host' }],
    [fixture.teamRound.roles[0], fixture.teamRound.roles[0]],
    [fixture.teamRound.roles[0], { role: 'host', modelCalls: 9 }]]) {
    const result = projectOperations({ ...fixture, teamRound: { ...fixture.teamRound, roles } }).teamRound;
    assert.equal(result.modelCalls, null); assert.equal(result.promptTokens, null);
    assert.equal(result.completionTokens, null); assert.equal(result.elapsedSeconds, null);
  }
  fixture.teamRound.roles = [{ role: 'default', modelCalls: 0, promptTokens: 0, completionTokens: 0, elapsedSeconds: 0 }];
  result = projectOperations(fixture).teamRound;
  assert.equal(result.modelCalls, 0); assert.equal(result.promptTokens, 0);
  assert.equal(result.completionTokens, 0); assert.equal(result.elapsedSeconds, 0, 'Measured zero remains a real zero');
});

test('operations projection keeps only named public fields and preserves unknown counts', () => {
  const now = Date.now(), fixture = operationsFixture(now), sentinel = 'PRIVATE_OPERATIONS_SENTINEL';
  fixture.secret = sentinel;
  for (const name of ['runtimes', 'agents', 'services', 'issues', 'commands']) {
    fixture[name][0].config = { token: sentinel }; fixture[name][0].private = sentinel;
  }
  fixture.agents[1].enabled = 'true'; fixture.agents[1].toolCount = true;
  fixture.agents[1].mcpCount = -1; fixture.agents[1].jobCount = 0.5;
  const result = projectOperations(fixture, now);
  assert.equal(result.available, true); assert.equal(result.stale, false);
  assert.equal(result.agents[0].enabled, true); assert.equal(result.agents[1].enabled, null);
  assert.equal(result.agents[1].toolCount, null); assert.equal(result.agents[1].mcpCount, null);
  assert.equal(result.agents[1].jobCount, null); assert.equal(result.agents[0].toolCount, 0);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(Object.hasOwn(result.runtimes[0], 'config'), false);
});

test('operations freshness uses a 300 second TTL and rejects future or timezone-less evidence', () => {
  const now = Date.parse('2026-09-07T12:00:00Z');
  for (const [age, stale, available, reason] of [[0, false, true, null], [300000, false, true, null],
    [300001, true, true, 'expired'], [-1, true, false, 'future']]) {
    const result = projectOperations(operationsFixture(now - age), now);
    assert.equal(result.stale, stale); assert.equal(result.available, available); assert.equal(result.staleReason, reason);
    assert.equal(result.ttlSeconds, 300); assert.equal(result.runtimes.length, available ? 1 : 0);
  }
  const fixture = operationsFixture(now); fixture.generatedAt = '2026-09-07T20:00:00+08:00';
  assert.equal(projectOperations(fixture, now).stale, false);
  for (const generatedAt of ['2026-09-07T12:00:00', '2026-02-30T12:00:00Z', 'invalid', null, 1788782400000]) {
    assert.equal(projectOperations({ ...fixture, generatedAt }, now).available, false);
  }
});

test('malformed operations identity and collections fail closed without hiding normal panel state', () => {
  const fixture = operationsFixture();
  for (const value of [null, [], {}, { ...fixture, schema: true }, { ...fixture, project: 'shadow' },
    ...['runtimes', 'agents', 'services', 'issues', 'commands'].map(key => ({ ...fixture, [key]: {} }))]) {
    const result = projectOperations(value);
    assert.equal(result.available, false); assert.equal(result.stale, true);
    assert.deepEqual(result.runtimes, []); assert.deepEqual(result.commands, []);
  }
});

test('operations endpoint projection removes credentials and URL payloads', () => {
  const fixture = operationsFixture();
  for (const endpoint of ['javascript:alert(1)', 'file:///server/secret', 'ftp://127.0.0.1',
    'http://user:secret@127.0.0.1:18089', 'https://secret@example.test', null, {}, 'bad-url']) {
    fixture.runtimes[0].endpoint = endpoint;
    assert.equal(projectOperations(fixture).runtimes[0].endpoint, null);
  }
  fixture.runtimes[0].endpoint = 'https://example.test/console?token=PRIVATE#password';
  assert.equal(projectOperations(fixture).runtimes[0].endpoint, 'https://example.test/console');
});

test('operations projection bounds records and treats malformed values as unknown', () => {
  const fixture = operationsFixture();
  fixture.agents = Array.from({ length: 220 }, () => ({ id: 'a'.repeat(500), role: 'r'.repeat(1000), enabled: 1, toolCount: Infinity }));
  fixture.services[0].dependencies = [null, { secret: 'private' }, ...Array(60).fill('s'.repeat(300))];
  fixture.issues[0].severity = '__proto__'; fixture.runtimes.push(null, [], 'invalid');
  const result = projectOperations(fixture);
  assert.equal(result.agents.length, 200); assert.equal(result.agents[0].id.length, 64);
  assert.equal(result.agents[0].role.length, 360); assert.equal(result.agents[0].enabled, null);
  assert.equal(result.agents[0].toolCount, null); assert.equal(result.runtimes.length, 1);
  assert.equal(result.services[0].dependencies.length, 30); assert.equal(result.services[0].dependencies[0].length, 64);
  assert.equal(result.issues[0].severity, null);
});

test('operations browser view remains read-only, navigable and scrollable on desktop and mobile', async t => {
  const candidates = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  let executablePath;
  for (const candidate of candidates) {
    try { await fs.access(candidate); executablePath = candidate; break; } catch { /* optional local browser */ }
  }
  if (!executablePath) { t.skip('This optional layout check requires an installed Chromium browser'); return; }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = operationsFixture();
  fixture.agents[0].label = '<img src=x onerror=alert(1)>';
  fixture.services[0].container = 'qiandengji-' + 'long-container-name-'.repeat(8);
  fixture.commands[0].command = 'python tools/project.py logs ' + 'very-long-service-id-'.repeat(25);
  const world = projectWorld({ heartbeat: { ts: Date.now() }, npc: {}, board: {} });
  let operations = projectOperations(fixture), failState = false;
  // Every request is fulfilled locally; never reaches an existing panel or service.
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/state') return route.fulfill({ status: failState ? 503 : 200,
      contentType: 'application/json', body: JSON.stringify({ ...world, operations, stale: false, links: {}, warnings: [] }) });
    if (pathname === '/healthz') return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    if(pathname === '/api/manage/session')return route.fulfill({contentType:'application/json',body:'{"configured":true,"authenticated":false}'});
    if(pathname === '/api/manage/services')return route.fulfill({contentType:'application/json',body:'{"services":[]}'});
    const names = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/management.js':['management.js','text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (!Object.hasOwn(names, pathname)) return route.fulfill({ status: 404, body: '' });
    const [name, contentType] = names[pathname];
    return route.fulfill({ contentType, body: await fs.readFile(new URL('../admin/public/' + name, import.meta.url), 'utf8') });
  });
  await page.goto('http://operations-panel.test/#operations');
  await page.waitForFunction(() => document.getElementById('operations-badge').textContent === '快照新鲜');
  assert.equal(await page.locator('#view-operations').isVisible(), true);
  await page.getByText('终端管理命令', {exact:true}).click();
  assert.equal(await page.locator('#operations-agents img').count(), 0);
  assert.match(await page.locator('#operations-agents').innerText(), /<img src=x onerror=alert\(1\)>/);
  assert.match(await page.locator('#operations-agents').innerText(), /已启用/);
  assert.equal(await page.locator('#operations-agents .badge.good').count(), 0);
  assert.equal(await page.locator('#operations-commands button').count(), 0);
  assert.equal(await page.locator('#operations-commands code').textContent(), fixture.commands[0].command.slice(0, 800));
  assert.equal(await page.locator('#overview-metrics > *').count(), 0, 'Hidden world sections stay idle at startup');
  await page.locator('[data-view="overview"]').click();
  assert.ok(await page.locator('#overview-metrics > *').count() > 0, 'Navigation renders the latest stored snapshot');
  const overviewMetric = await page.locator('#overview-metrics > *').first().elementHandle();
  await page.locator('[data-view="operations"]').click();
  await page.locator('#refresh-button').click();
  await page.waitForFunction(() => !document.getElementById('refresh-button').disabled);
  assert.equal(await overviewMetric.evaluate(element => element.isConnected), true, 'Refreshing another section does not rebuild hidden cards');
  await page.locator('[data-view="agent"]').click();
  await page.locator('#view-agent a[href="#operations"]').click();
  await page.locator('#view-operations').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#view-operations').isVisible(), true);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 780 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `page overflow at ${width}px`);
    await page.locator('#operations-commands code').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#operations-commands code').isVisible(), true);
    const code = await page.locator('#operations-commands pre').evaluate(element => ({
      client: element.clientWidth, scroll: element.scrollWidth, overflow: getComputedStyle(element).overflowX }));
    assert.equal(code.overflow, 'auto'); assert.ok(code.scroll > code.client);
  }
  operations = projectOperations(operationsFixture(Date.now() - 301000));
  await page.locator('#refresh-button').click();
  await page.waitForFunction(() => document.getElementById('operations-badge').textContent === '历史快照');
  assert.equal(await page.locator('#view-operations .badge.good').count(), 0);
  operations = projectOperations(operationsFixture(Date.now() + 60000));
  await page.locator('#refresh-button').click();
  await page.waitForFunction(() => document.getElementById('operations-notice').textContent.includes('晚于当前时间'));
  assert.equal(await page.locator('#operations-runtimes .operations-card').count(), 0);
  operations = projectOperations(fixture); await page.locator('#refresh-button').click();
  await page.waitForFunction(() => document.getElementById('operations-badge').textContent === '快照新鲜');
  failState = true; await page.locator('#refresh-button').click();
  await page.waitForFunction(() => document.getElementById('operations-notice').textContent.includes('连接中断'));
  assert.equal(await page.locator('#view-operations .badge.good').count(), 0);
  assert.deepEqual(errors, []);
});

test('operations UI shows six operators and two game roles, with truthful budgets, skills and usage', async t => {
  const candidates = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  let executablePath;
  for (const candidate of candidates) {
    try { await fs.access(candidate); executablePath = candidate; break; } catch { /* optional local browser */ }
  }
  if (!executablePath) { t.skip('This UI regression requires an installed Chromium browser'); return; }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], requestedMutations = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = operationsTeamFixture();
  fixture.teamPolicy.roleSkills.default.push('custom-future-skill');
  for (const field of ['modelCalls', 'promptTokens', 'completionTokens', 'elapsedSeconds']) delete fixture.teamRound[field];
  fixture.runtimes.push(
    { ...fixture.runtimes[0], id: 'host', label: 'UNRELATED_HOST_RUNTIME', endpoint: 'http://127.0.0.1:8088', agentCount: 15, enabledAgentCount: 15 },
    { ...fixture.runtimes[0], id: 'shadow', label: 'RETIRED_SHADOW_RUNTIME', endpoint: 'http://127.0.0.1:8090', agentCount: 8, enabledAgentCount: 8 });
  fixture.agents.push(
    { ...fixture.agents[0], id: 'host-operator', label: 'UNRELATED_HOST_OPERATOR', runtimeId: 'host' },
    { ...fixture.agents[0], id: 'shadow-operator', label: 'RETIRED_SHADOW_OPERATOR', runtimeId: 'shadow' },
    { ...fixture.agents[0], id: 'default', label: 'BUILT_IN_DEFAULT', runtimeId: 'qiandengji' },
    { ...fixture.agents[0], id: 'QwenPaw_QA_Agent_0.2', label: 'BUILT_IN_QA_PROFILE', runtimeId: 'qiandengji' },
    { ...fixture.agents[0], id: 'QwenPaw_QA_Agent_0.3', label: 'BUILT_IN_OPS_QA_PROFILE', runtimeId: 'qiandengji-ops' });
  fixture.services.push(
    { ...fixture.services[0], id: 'legacy-agent', label: 'LEGACY_TEAM_SERVICE', group: 'legacy-team' },
    { ...fixture.services[0], id: 'retired-agent', label: 'RETIRED_SERVICE', group: 'retired' },
    { ...fixture.services[0], id: 'tts-local', label: 'REQUIRED_DEPENDENCY', group: 'dependencies' });
  fixture.issues.push(
    { code: 'runtime_versions_differ', severity: 'info', title: 'OLD_RUNTIME_BACKGROUND', detail: 'Historical version comparison' },
    { code: 'host_non_game_jobs', severity: 'info', title: 'UNRELATED_JOB_BACKGROUND', detail: 'Host non-game jobs' },
    { code: 'retired_game_running', severity: 'warning', title: 'RETIRED_SERVICE_DRIFT', detail: 'Unexpected old service restart still needs attention' });
  let operations = projectOperations(fixture);
  const originalSnapshot = JSON.stringify(operations);
  assert.equal(operations.agents.length, 13, 'The read model must retain other environments; scoping belongs to the UI');
  assert.equal(operations.runtimes.length, 4);
  const world = projectWorld({ heartbeat: { ts: Date.now() }, npc: {}, board: {} });
  // Exercise the actual page scripts without contacting any project/host service.
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') requestedMutations.push(pathname);
    if (pathname === '/api/state') return route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ ...world, operations, stale: false, links: {}, warnings: [] }) });
    if (pathname === '/api/manage/session') return route.fulfill({ contentType: 'application/json', body: '{"configured":true,"authenticated":false}' });
    if (pathname === '/api/manage/services') return route.fulfill({ contentType: 'application/json', body: '{"services":[]}' });
    if (pathname === '/healthz') return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
      '/management.js': ['management.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (!Object.hasOwn(assets, pathname)) return route.fulfill({ status: 404, body: '' });
    const [name, contentType] = assets[pathname];
    return route.fulfill({ contentType, body: await fs.readFile(new URL('../admin/public/' + name, import.meta.url), 'utf8') });
  });
  await page.goto('http://operations-scope.test/#operations');
  await page.waitForFunction(() => document.getElementById('operations-badge').textContent === '快照新鲜');
  const roleIds = page.locator('#operations-agents .operations-heading .operations-id');
  const expectedRoles = ['mc-god', 'mc-herald', 'mc-god', 'default', 'mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto'];
  assert.deepEqual(await roleIds.allTextContents(), expectedRoles);
  assert.equal(await page.locator('#operations-agents .operations-card').count(), 8);
  assert.match(await page.locator('#operations-agents .operations-card').nth(3).innerText(), /司灯[\s\S]*已启用[\s\S]*团队协调[\s\S]*custom-future-skill/);
  const skillNames = await page.locator('#operations-agents .chip-list .chip').allTextContents();
  for (const name of ['证据与报告', '团队协调', '服务排障', '优先级与验收', '世界活动策划', '施法与操作验收', '新手与探索体验']) assert.ok(skillNames.includes(name), name);
  assert.equal(await page.locator('#operations-agents .chip[title="qd-team-coordination"]').innerText(), '团队协调');
  assert.deepEqual(await page.locator('#operations-runtimes .operations-heading .operations-id').allTextContents(), ['qiandengji', 'qiandengji-ops']);
  for (const marker of ['UNRELATED_HOST_RUNTIME', 'RETIRED_SHADOW_RUNTIME', 'UNRELATED_HOST_OPERATOR',
    'RETIRED_SHADOW_OPERATOR', 'BUILT_IN_DEFAULT', 'BUILT_IN_QA_PROFILE', 'BUILT_IN_OPS_QA_PROFILE']) {
    assert.equal((await page.locator('#view-operations').innerText()).includes(marker), false, marker);
  }
  const metrics = await page.locator('#operations-metrics > *').evaluateAll(cards => cards.map(card => ({
    label: card.querySelector('.metric-label').textContent,
    value: card.querySelector('.metric-value').textContent,
    detail: card.querySelector('.metric-detail').textContent,
  })));
  assert.equal(metrics.find(row => row.label === '运行环境').value, '2');
  const agents = metrics.find(row => row.label === '启用角色');
  assert.equal(agents.value, '8'); assert.match(agents.detail, /共 8 个项目角色/);
  assert.equal(metrics.find(row => row.label === '服务记录').value, '2');
  assert.equal(metrics.find(row => row.label === '待处理项').value, '2');
  assert.deepEqual(await page.locator('#operations-services .operations-heading .operations-id').allTextContents(), ['voice', 'tts-local']);
  assert.deepEqual(await page.locator('#operations-issues .operations-id').allTextContents(), ['tts-owner', 'retired_game_running']);
  assert.match(await page.locator('#operations-issues').innerText(), /RETIRED_SERVICE_DRIFT/);
  assert.match(await page.locator('#operations-runtimes').innerText(), /启用 2 \/ 登记 2/);
  assert.match(await page.locator('#operations-runtimes').innerText(), /启用 6 \/ 登记 6/);
  assert.equal(await page.locator('#operations-policy-version').innerText(), 'QwenPaw 2.2.0');
  assert.match(await page.locator('#operations-policy-summary').innerText(), /按需触发.*同时 1 个模型.*每分钟最多 6 次请求.*5 轮迭代.*自动重试关闭/);
  assert.match(await page.locator('#operations-policy-delegation').innerText(), /30 分钟.*24 小时最多 4 次.*定时任务 0 个.*心跳关闭/);
  assert.deepEqual(await page.locator('#operations-usage-metrics .metric-value').allTextContents(), ['3', '1,234', '56', '800']);
  assert.match(await page.locator('#operations-round-reports').innerText(), /司灯.*[\s\S]*整理运营待办[\s\S]*3 次[\s\S]*1,234 \/ 56[\s\S]*18.5 秒/);
  assert.match(await page.locator('#operations-round-usage').innerText(), /3 次[\s\S]*1,234 \/ 56[\s\S]*18.5 秒/);
  assert.equal(await page.locator('#operations-round-status').innerText(), '已完成');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 780 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
      `Team budgets and eight role cards must fit at ${width}px`);
    await page.locator('#operations-policy-summary').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#operations-policy-summary').isVisible(), true);
  }
  assert.equal(await page.locator('#operations-runtime-filter').count(), 0);
  assert.equal(await page.getByRole('combobox', { name: '筛选角色所属环境' }).count(), 0);
  await page.locator('#refresh-button').click();
  await page.waitForFunction(() => !document.getElementById('refresh-button').disabled);
  assert.deepEqual(await roleIds.allTextContents(), expectedRoles);
  assert.equal(await page.evaluate(() => JSON.stringify(snapshot.operations)), originalSnapshot,
    'Rendering must not change the collected public snapshot in browser memory');
  delete fixture.teamUsage;
  delete fixture.teamPolicy.roleSkills.default;
  delete fixture.teamRound.roles[0].modelCalls;
  operations = projectOperations(fixture);
  await page.locator('#refresh-button').click();
  await page.waitForFunction(() => !document.getElementById('refresh-button').disabled);
  assert.deepEqual(await page.locator('#operations-usage-metrics .metric-value').allTextContents(), ['未知', '未知', '未知', '未知']);
  assert.match(await page.locator('#operations-usage-note').innerText(), /用量更新：未记录/);
  assert.match(await page.locator('#operations-agents .operations-card').nth(3).innerText(), /技能记录未知/);
  assert.match(await page.locator('#operations-round-reports').innerText(), /模型请求[\s\S]*未知/);
  operations = projectOperations({ ...fixture, generatedAt: new Date(Date.now() - 301000).toISOString() });
  await page.locator('#refresh-button').click();
  await page.waitForFunction(() => document.getElementById('operations-badge').textContent === '历史快照');
  assert.equal(await page.locator('#view-operations .badge.good').count(), 0, 'Completed historical reports must not appear current');
  assert.match(await page.locator('#operations-round-status').innerText(), /历史/);
  assert.deepEqual(requestedMutations, []); assert.deepEqual(errors, []);
});

test('public projection excludes raw instructions, secrets, private waypoints and reserved probes', () => {
  const sentinel = 'PRIVATE_SENTINEL';
  const result = projectWorld({ heartbeat: { ts: Date.now(), watching: ['MengMeng', 'QDGuildProbe'],
    agentProvider: { id: 'replacement', label: '替换后端', token: sentinel, capabilities: { chat: true, task: false } } },
    state: { players: { MengMeng: { level: 4, mana: 20, maxMana: 136, learned: ['home'], token: sentinel }, QDGuildProbe: {} } },
    waypoints: { shared: [{ id: 1, name: '<script>alert(1)</script>', x: 1, y: 64, z: 2, dim: 'minecraft:overworld' }], players: { private: sentinel } },
    npc: { updated_at: Date.now() / 1000, llm_enabled: false, config: sentinel }, board: { date: '2026-09-07', board: [] },
    atoms: { atoms: [{ id: 'home', name: '归乡', commands: [sentinel], words: ['归乡'], cost: { mana: 20 } }] },
    rawCatalog: { featuredDetails: { home: { name: '归乡' } } }, catalog: { featured: ['home'], icons: new Map(),
      entries: new Map([['home', { status: 'featured', reason: '返回家', nativeHints: [] }]]) } });
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(result.players.length, 1);
  assert.deepEqual(result.world.observedPlayers, ['MengMeng']);
  assert.equal(result.agent.id, 'replacement');
  assert.equal(result.npc.llmEnabled, false);
  assert.equal(result.skills.featured[0].name, '归乡');
});

test('missing flags and malformed catalogue are unknown rather than healthy or enabled', () => {
  const result = projectWorld({ npc: {}, board: {}, catalog: null });
  assert.equal(result.npc.llmEnabled, null);
  assert.equal(result.skills.available, false);
  assert.equal(result.guild.available, false);
  assert.equal(result.world.available, false);
  assert.equal(result.agent.id, 'unknown');
});

test('current, old, missing and future snapshots are distinguished', () => {
  const now = Date.now();
  assert.equal(freshness(new Date(now - 1000).toISOString(), now).stale, false);
  assert.equal(freshness(new Date(now - 100000).toISOString(), now).stale, true);
  assert.equal(freshness(new Date(now + 10000).toISOString(), now).stale, true);
  assert.equal(freshness(null, now).stale, true);
  assert.equal(projectHealth(null).available, false);
});

function request(server, route, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route,
      method, headers: { host: '127.0.0.1:9090', ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject); req.end();
  });
}

test('independent HTTP page and errors never require Minecraft, QwenPaw or raw world access', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qd-panel-'));
  const server = createPanelServer({ stateDir: directory });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  await t.test('health remains live without dependencies', async () => {
    const res = await request(server, '/healthz'); assert.equal(res.status, 200); assert.equal(res.json().ok, true);
    const state = (await request(server, '/api/state')).json(); assert.equal(state.available, false); assert.equal(state.stale, true);
    assert.equal(state.links.qwenpaw, 'http://127.0.0.1:18089/');
  });
  await t.test('damaged and oversized snapshots degrade explicitly', async () => {
    await fs.writeFile(path.join(directory, 'world.json'), '{broken');
    assert.equal((await request(server, '/api/state')).json().available, false);
    await fs.writeFile(path.join(directory, 'world.json'), ' '.repeat(2 * 1024 * 1024 + 1));
    assert.equal((await request(server, '/api/state')).json().available, false);
  });
  await t.test('old snapshots remain inspectable but are marked stale', async () => {
    const value = projectWorld({ heartbeat: {}, npc: {}, board: {} }, Date.now() - 120000);
    await fs.writeFile(path.join(directory, 'world.json'), JSON.stringify(value));
    const state = (await request(server, '/api/state')).json(); assert.equal(state.available, true); assert.equal(state.stale, true);
    assert.ok(state.warnings.some(message => message.includes('已过期')));
  });
  await t.test('operations remain independently available with fixed public projection', async () => {
    await fs.writeFile(path.join(directory, 'world.json'), '{broken');
    const fixture = operationsFixture(); fixture.token = 'DO_NOT_PUBLISH'; fixture.agents[0].config = 'DO_NOT_PUBLISH';
    await fs.writeFile(path.join(directory, 'operations.json'), JSON.stringify(fixture));
    const res = await request(server, '/api/state'), state = res.json();
    assert.equal(state.available, false); assert.equal(state.operations.available, true);
    assert.equal(state.operations.stale, false); assert.equal(state.operations.agents[0].id, 'mc-god');
    assert.equal(res.text.includes('DO_NOT_PUBLISH'), false);
    assert.equal((await request(server, '/operations.json')).status, 404);
    assert.equal((await request(server, '/api/operations/restart', { method: 'POST' })).status, 405);
  });
  await t.test('bad and oversized operations degrade without breaking other snapshots', async () => {
    await fs.writeFile(path.join(directory, 'world.json'), JSON.stringify(projectWorld({ heartbeat: {}, npc: {}, board: {} })));
    for (const value of ['{broken', ' '.repeat(2 * 1024 * 1024 + 1), JSON.stringify(operationsFixture(Date.now() + 60000))]) {
      await fs.writeFile(path.join(directory, 'operations.json'), value);
      const state = (await request(server, '/api/state')).json();
      assert.equal(state.available, true); assert.equal(state.operations.available, false); assert.equal(state.operations.stale, true);
    }
    await fs.unlink(path.join(directory, 'operations.json'));
    assert.equal((await request(server, '/api/state')).json().operations.available, false);
  });
  await t.test('legacy mutation routes and arbitrary paths are unavailable', async () => {
    for (const route of ['/api/tp?target=MengMeng', '/api/eye', '/api/world', '/api/npc/settings', '/api/skins/assign', '/rcon-secret.txt', '/%2e%2e/server/.env'])
      assert.equal((await request(server, route)).status, 404, route);
    assert.equal((await request(server, '/api/state', { method: 'POST' })).status, 405);
  });
  await t.test('fresh export cannot hide an old heartbeat or failed guild poll', async () => {
    const value = projectWorld({ heartbeat: { ts: Date.now() - 200000 }, npc: { updated_at: Date.now() / 1000 },
      guildHealth: { last_success_at: Date.now() / 1000, error_type: 'RuntimeError' }, board: { board: [] } });
    await fs.writeFile(path.join(directory, 'world.json'), JSON.stringify(value));
    const state = (await request(server, '/api/state')).json();
    assert.equal(state.stale, false); assert.equal(state.world.stale, true); assert.equal(state.npc.stale, false);
    assert.equal(state.guild.pollingOk, false); assert.equal(state.guild.stale, true);
  });
  await t.test('the actual static page and both assets are served', async () => {
    for (const route of ['/', '/app.js', '/style.css']) {
      const response = await request(server, route); assert.equal(response.status, 200, route);
      assert.ok(response.text.length > 100);
    }
  });
  await t.test('host and cross-origin requests are refused', async () => {
    assert.equal((await request(server, '/api/state', { headers: { host: 'evil.example:9090' } })).status, 403);
    assert.equal((await request(server, '/api/state', { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request(server, '/api/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  });
  await t.test('JSON content and browser policy prevent content sniffing and framing', async () => {
    const res = await request(server, '/api/state'); assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff'); assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  });
});
