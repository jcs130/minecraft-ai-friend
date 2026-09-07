import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { projectSurvivor, projectWorld } from '../admin/read-model.mjs';
import { SERVICES, buildPlan } from '../admin/control-service.mjs';

const fixture = (now = Date.now()) => ({ schema: 1, project: 'qiandengji-survivor', character: '桐人', bodyName: 'Kirito',
  generatedAt: new Date(now).toISOString(), status: 'observing', enabled: true, goal: '准备生存工具，探索附近环境',
  body: { hp: 20, hunger: 18, online: true, position: { x: 100, y: 64, z: 100 }, counts: { 'minecraft:bread': 13 } },
  lastDecision: { turnId: 'survival-fixture', completed: true, at: new Date(now).toISOString(),
    actions: [{ tool: 'mine', acceptedAt: now, result: { ok: true, code: 'accepted', completionConfirmed: false,
      result: { success: true, data: { task_id: 't1', async: true } } } }] },
  skills: [{ name: 'find_food', description: '根据真实饥饿和库存选择食物', activeVersion: 'v1', draftVersion: 'v2' }],
  budgets: { decisionsUsed: 1, decisionLimit: 12, cooldownSeconds: 300, modelRequests: 2, promptTokens: 1234, completionTokens: 50 },
  episodes: [{ at: new Date(now).toISOString(), kind: 'decision_finished', turnId: 'survival-fixture', taskId: 'fixture-native-task', completed: true },
    { at: new Date(now).toISOString(), kind: 'action_observed', action: 'mine',
      inventoryDelta: { 'minecraft:oak_log': 4, 'minecraft:bread': -1 },
      positionBefore: { x: 100, y: 64, z: 100 }, positionAfter: { x: 105, y: 64, z: 102 } },
    { at: new Date(now).toISOString(), kind: 'skill_stopped', name: 'find_food', reason: 'skill_execution_budget' }] });

test('survivor public fields are bounded and exclude private or unrelated records', () => {
  const input = fixture(); input.secrets = 'PRIVATE'; input.body.playerdata = 'PRIVATE'; input.skills[0].source = 'PRIVATE';
  input.episodes[0].chat = 'PRIVATE'; input.budgets.apiKey = 'PRIVATE';
  input.lastDecision.prompt = 'PRIVATE'; input.lastDecision.actions[0].result.result.message = 'PRIVATE';
  input.lastDecision.actions[0].args = { command: 'PRIVATE' };
  const view = projectSurvivor(input);
  assert.equal(view.available, true); assert.equal(view.stale, false);
  assert.equal(view.body.counts['minecraft:bread'], 13);
  assert.equal(view.budgets.promptTokens, 1234);
  assert.equal(view.lastDecision.completed, true);
  assert.equal(view.lastDecision.actions[0].code, 'accepted');
  assert.equal(view.lastDecision.actions[0].completionConfirmed, false);
  assert.equal(view.skills[0].activeVersion, 'v1');
  assert.equal(view.skills[0].draftVersion, 'v2');
  assert.equal(view.skills[0].description, '根据真实饥饿和库存选择食物');
  assert.equal(view.episodes[1].inventoryDelta['minecraft:bread'], -1);
  assert.equal(view.episodes[1].positionAfter.x, 105);
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
  assert.equal(projectSurvivor({ ...input, project: 'host' }).available, false);
  assert.equal(projectSurvivor({ ...input, bodyName: 'Naruto' }).available, false);
  assert.equal(projectSurvivor(fixture(Date.now() - 91000)).stale, true);
  input.budgets.modelRequests = 'zero'; assert.equal(projectSurvivor(input).budgets.modelRequests, null);
});

test('malformed decisions, versions and observed deltas stay unknown and bounded', () => {
  const input = fixture(); input.lastDecision = 'legacy unstructured text';
  input.skills[0].activeVersion = { private: 'PRIVATE' }; input.episodes[1].inventoryDelta = {
    'minecraft:oak_log': 4.5, 'minecraft:stone': true, 'minecraft:bread': -2, 'invalid item': 3 };
  const view = projectSurvivor(input);
  assert.equal(view.lastDecision, null); assert.equal(view.skills[0].activeVersion, null);
  assert.deepEqual(view.episodes[1].inventoryDelta, { 'minecraft:bread': -2 });
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
});

test('existing maintenance plans stop survivor before Minecraft and require ready Minecraft to start', () => {
  const rows = SERVICES.map((id, i) => ({ id, owned: true, containerId: i.toString(16).padStart(64, '0'), state: 'running', health: 'healthy' }));
  const stop = buildPlan({ action: 'stop', services: ['mc'] }, rows);
  assert.ok(stop.stop.indexOf('survivor') < stop.stop.indexOf('mc'));
  const start = buildPlan({ action: 'start', services: ['survivor'] }, rows);
  assert.deepEqual(start.required, ['mc']); assert.deepEqual(start.start, ['survivor']);
  rows.find(row => row.id === 'mc').health = 'unhealthy';
  assert.throws(() => buildPlan({ action: 'start', services: ['survivor'] }, rows), /dependency_not_ready/);
});

test('survivor page shows real body, budget, skill and stale state without calling external services', async t => {
  let executablePath;
  for (const file of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']) {
    try { await fs.access(file); executablePath = file; break; } catch { /* next browser */ }
  }
  assert.ok(executablePath);
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let survivor = fixture();
  const assets = Object.fromEntries(await Promise.all([['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'],
    ['/management.js', 'management.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']].map(async ([key, file, contentType]) =>
    [key, { body: await fs.readFile(new URL('../admin/public/' + file, import.meta.url), 'utf8'), contentType }])));
  const world = projectWorld({ heartbeat: { ts: Date.now() }, npc: {}, board: {} });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()); assert.equal(url.origin, 'http://survivor-fixture.test');
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/state') return json({ ...world, survivor: projectSurvivor(survivor), links: {}, warnings: [] });
    if (url.pathname === '/healthz') return json({ ok: true });
    if (url.pathname === '/api/manage/session') return json({ configured: false, authenticated: false });
    if (url.pathname === '/api/manage/services') return json({ services: [] });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 404, body: '' });
    assert.ok(Object.hasOwn(assets, url.pathname), url.pathname);
    return route.fulfill(assets[url.pathname]);
  });
  await page.goto('http://survivor-fixture.test/#survivor');
  await page.locator('#survivor-goal').filter({ hasText: '准备生存工具' }).waitFor();
  assert.match(await page.locator('#survivor-metrics').innerText(), /在线/);
  assert.match(await page.locator('#survivor-inventory').innerText(), /minecraft:bread/);
  assert.match(await page.locator('#survivor-budgets').innerText(), /1,234/);
  assert.match(await page.locator('#survivor-budgets').innerText(), /近24小时决策/);
  assert.match(await page.locator('#survivor-budgets').innerText(), /累计模型请求/);
  assert.doesNotMatch(await page.locator('#survivor-budgets').innerText(), /今日/);
  assert.match(await page.locator('#survivor-decision').innerText(), /本轮规划已结束/);
  assert.match(await page.locator('#survivor-decision').innerText(), /采集：已受理，实际结果待观察/);
  assert.match(await page.locator('#survivor-skills').innerText(), /find_food/);
  assert.match(await page.locator('#survivor-skills').innerText(), /已启用版本：v1/);
  assert.match(await page.locator('#survivor-skills').innerText(), /草稿版本：v2/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /minecraft:oak_log \+4/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /minecraft:bread -1/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /达到步数或时间限制/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /实际状态变化，不能单独证明任务已完成/);
  assert.equal(await page.getByRole('link', { name: '打开桐人控制台 ↗' }).getAttribute('href'), 'http://127.0.0.1:18091/agents');
  const statusLabels = { thinking: '正在思考', acting: '正在行动', waiting: '等待下一步', cooldown: '等待下次决策',
    idle: '等待新任务或环境变化', budget_wait: '等待决策额度恢复', executing_skill: '正在执行已学技能', body_offline: '等待身体连接', paused: '已暂停', stopped: '服务已停止' };
  for (const [status, label] of Object.entries(statusLabels)) {
    survivor = { ...survivor, status, enabled: status !== 'paused' };
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.locator('#survivor-badge').filter({ hasText: label }).waitFor();
  }
  survivor.generatedAt = new Date(Date.now() - 95000).toISOString();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('#survivor-badge').filter({ hasText: '历史记录' }).waitFor();
  assert.match(await page.locator('#survivor-freshness').innerText(), /已过期/);
  assert.deepEqual(errors, []);
});
