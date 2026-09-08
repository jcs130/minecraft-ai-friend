import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { projectSurvivor, projectWorld } from '../admin/read-model.mjs';
import { SERVICES, buildPlan } from '../admin/control-service.mjs';

const fixture = (now = Date.now()) => ({ schema: 1, project: 'qiandengji-survivor', character: '桐人', bodyName: 'Kirito',
  bodyUuid: '00000000-0000-0000-0000-000000000001',
  generatedAt: new Date(now).toISOString(), status: 'observing', enabled: true, autonomous: true, nextReviewAt: now / 1000 + 1800,
  goalState: 'ongoing', goal: '准备生存工具，探索附近环境',
  adventure: {schema: 1, body: {fresh: true, observedAt: now}, resources: {known: true, items: {
    food: [{id: 'minecraft:bread', count: 13}], tools: [{id: 'minecraft:iron_pickaxe', count: 1}],
    materials: [{id: 'minecraft:oak_planks', count: 24}], agriculture: [{id: 'minecraft:wheat_seeds', count: 4}], other: []}},
    equipment: {known: true, slots: [{slot: 'mainhand', id: 'minecraft:iron_pickaxe'}]},
    capabilities: {actionTools: ['mine', 'place_block', 'farm']}, opportunities: {
      guild: {known: true, fresh: true, board: [{no: 7, title: '交付小麦', status: 'open'}]},
      villagers: {known: true, fresh: false, nearby: [{type: 'minecraft:villager', distance: 5}], offersKnown: false}}},
  constructionAreas: [{name: '桐人宅地', dimension: 'minecraft:overworld', minX: 95, maxX: 110, minY: 63, maxY: 75, minZ: 95, maxZ: 110}],
  guild: {ok: true, code: 'guild_observed', actor: 'Kirito', actorUuid: '00000000-0000-0000-0000-000000000001',
    historicalQuery: true, observedAt: now - 3600000, boardDate: '2026-09-08', quests: [
      {questId: '2026-09-08:7', title: '交付小麦', type: 'gather', status: 'claimed', claimedBy: ['Kirito'],
       itemId: 'minecraft:wheat', count: 16, blockedReason: 'missing_goods'}]},
  perception: { pendingCount: 1, sources: { 'player-chat.jsonl': {available: true} },
    events: [{kind: 'chat', at: now, speaker: 'Explorer', text: '桐人，附近有村庄任务。'}] },
  environment: {ok: true, world: {weather: 'rain', is_dark_outside: false}, entities: [{type: 'minecraft:villager', distance: 5}]},
  body: { hp: 20, hunger: 18, online: true, position: { x: 100, y: 64, z: 100 }, counts: { 'minecraft:bread': 13 },
    ownedSkillBooks: [{id: 'minecraft:written_book', count: 1, slot: 4, bookName: '轻身秘笈', recognized: true,
      recognition: 'recognized', skill_id: 'feather', name: '轻身术', requiredLevel: 3, type: 'passive', knownLearned: false, catalogObservedAt: now - 3600000},
    {id: 'minecraft:written_book', count: 1, slot: 5, bookName: '无名秘笈', recognized: false, recognition: 'unrecognized'}] },
  gameSkills: {schema: 1, available: true, historicalQuery: true, observedAt: now - 3600000,
    sourceObservedAt: {status: now - 7200000, skills: now - 3600000, 'spells irons': now - 5400000},
    playerLevel: 5, legacySkillsKnown: true, learned: [{id: 'rasengan', name: '螺旋丸', level: 1, mana: 10}],
    currentlyAvailable: [{id: 'lightning', name: '闪电', level: 5, mana: 20}], locked: [],
    nativeSpellsKnown: true, nativeSpells: [], nativeLevel: 8, nativeMana: 0, nativeMaxMana: 100,
    legacyMana: 30, legacyMaxMana: 40, attributes: {health: 20, spellPower: 1.2},
    pufferfish: {known: true, ok: true, categories: [{id: 'puffish_skills:combat', available: true,
      level: 3, experience: 15, points_total: 2, points_spent: 1, points_left: 1}]}},
  lastDecision: { turnId: 'survival-fixture', completed: true, at: new Date(now).toISOString(),
    actions: [{ tool: 'mine', acceptedAt: now, result: { ok: true, code: 'accepted', completionConfirmed: false,
      result: { success: true, data: { task_id: 't1', async: true } } } }] },
  skills: [{ name: 'find_food', description: '根据真实饥饿和库存选择食物', activeVersion: 'v1', draftVersion: 'v2' }],
  budgets: { decisionsUsed: 1, decisionLimit: 12, cooldownSeconds: 300, modelRequests: 2, promptTokens: 1234, completionTokens: 50 },
  episodes: [{ at: new Date(now).toISOString(), kind: 'decision_finished', turnId: 'survival-fixture', taskId: 'fixture-native-task', completed: true },
    { at: new Date(now).toISOString(), kind: 'action_observed', action: 'mine',
      inventoryDelta: { 'minecraft:oak_log': 4, 'minecraft:bread': -1 },
      positionBefore: { x: 100, y: 64, z: 100 }, positionAfter: { x: 105, y: 64, z: 102 } },
    { at: new Date(now).toISOString(), kind: 'skill_stopped', name: 'find_food', reason: 'skill_execution_budget' },
    { at: new Date(now).toISOString(), kind: 'action_observed', action: 'goto',
      positionBefore: {x: 105, y: 64, z: 102}, positionAfter: {x: 106, y: 64, z: 102},
      navigationOutcome: {task_id: 'navigation-fixture', navigation_epoch: 'epoch-fixture', state: 'failed', success: false,
        reason: 'no_walk_only_path', finished_at: now, navigation_mode: 'walk_only', world_interaction_blocked: true}}] });

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

test('life facts project only observed resources and bounded authorized areas without inventing achievements', () => {
  const input = fixture();
  input.adventure.resources.items.food[0].nbt = 'PRIVATE'; input.adventure.secret = 'PRIVATE';
  input.constructionAreas[0].secret = 'PRIVATE';
  let view = projectSurvivor(input);
  assert.equal(view.adventure.available, true);
  assert.equal(view.adventure.resources.items.food[0].count, 13);
  assert.equal(view.adventure.villagers.fresh, false);
  assert.equal(view.adventure.villagers.offersKnown, false);
  assert.equal(view.constructionAreas[0].name, '桐人宅地');
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
  assert.equal(Object.hasOwn(view.adventure, 'achievements'), false);
  input.adventure.resources.known = false;
  input.adventure.equipment.known = false;
  input.adventure.resources.items.food.push({id: '<script>', count: 99});
  input.constructionAreas[0].minX = 500;
  view = projectSurvivor(input);
  assert.deepEqual(view.adventure.resources.items.food, []);
  assert.deepEqual(view.adventure.equipment.slots, []);
  assert.deepEqual(view.constructionAreas, []);
  input.adventure.schema = 2;
  assert.deepEqual(projectSurvivor(input).adventure, {available: false});
});

test('guild card requires the exact body and exposes only its historical contracts', () => {
  const input = fixture();
  input.guild.quests.push({questId: '2026-09-08:8', title: 'PRIVATE', claimedBy: ['OtherPlayer']});
  input.guild.quests[0].secret = 'PRIVATE';
  let view = projectSurvivor(input).guild;
  assert.equal(view.historicalQuery, true);
  assert.equal(view.contracts.length, 1);
  assert.equal(view.contracts[0].blockedReason, 'missing_goods');
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
  input.guild.actorUuid = '00000000-0000-0000-0000-000000000002';
  assert.equal(projectSurvivor(input).guild.available, false);
});

test('game skills retain historical known/empty distinction and reject private or malformed fields', () => {
  const input = fixture(), raw = input.gameSkills;
  raw.secret = 'PRIVATE'; raw.sourceObservedAt.other = 'PRIVATE'; raw.learned[0].source = 'PRIVATE';
  raw.attributes.secret = 'PRIVATE'; raw.pufferfish.categories[0].nbt = 'PRIVATE';
  raw.nativeMana = 0; raw.nativeMaxMana = '100'; raw.playerLevel = -1;
  const projected = projectSurvivor(input).gameSkills;
  assert.equal(projected.observedAt, raw.observedAt);
  assert.equal(projected.sourceObservedAt.skills, raw.sourceObservedAt.skills);
  assert.equal(projected.legacyLevel, null);
  assert.equal(projected.nativeMana, 0); assert.equal(projected.nativeMaxMana, null);
  assert.equal(projected.nativeSpellsKnown, true); assert.deepEqual(projected.nativeSpells, []);
  assert.equal(projected.learned[0].name, '螺旋丸'); assert.equal(projected.eligible[0].name, '闪电');
  assert.equal(projected.pufferfish.categories[0].pointsLeft, 1);
  assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
  raw.nativeSpellsKnown = false;
  assert.equal(projectSurvivor(input).gameSkills.nativeSpellsKnown, false);
  raw.learned = Array.from({length: 50}, (_, i) => ({id: 'spell_' + i, name: '长'.repeat(300)}));
  raw.pufferfish.categories = Array.from({length: 50}, (_, i) => ({id: 'category_' + i, available: true}));
  assert.equal(projectSurvivor(input).gameSkills.learned.length, 24);
  assert.equal(projectSurvivor(input).gameSkills.learned[0].name.length, 64);
  assert.equal(projectSurvivor(input).gameSkills.pufferfish.categories.length, 12);
  raw.learned = [{id: 'invalid id', name: 'PRIVATE'}];
  assert.deepEqual(projectSurvivor(input).gameSkills.learned, []);
  for (const change of [{schema: 2}, {available: false}, {historicalQuery: false}]) {
    input.gameSkills = {...raw, ...change};
    assert.deepEqual(projectSurvivor(input).gameSkills, {available: false, historicalQuery: true});
  }
});

test('book ownership does not imply learned skills and unknown books expose no skill identity', () => {
  const input = fixture();
  input.body.ownedSkillBooks[0].pages = ['PRIVATE'];
  input.body.ownedSkillBooks[1].skill_id = 'PRIVATE'; input.body.ownedSkillBooks[1].knownLearned = true;
  const books = projectSurvivor(input).body.ownedSkillBooks;
  assert.equal(books[0].skillId, 'feather'); assert.equal(books[0].knownLearned, false);
  assert.equal(books[1].recognized, false); assert.equal(Object.hasOwn(books[1], 'skillId'), false);
  assert.equal(Object.hasOwn(books[1], 'knownLearned'), false);
  assert.equal(JSON.stringify(books).includes('PRIVATE'), false);
  input.body.ownedSkillBooks = Array(30).fill(input.body.ownedSkillBooks[0]);
  assert.equal(projectSurvivor(input).body.ownedSkillBooks.length, 12);
});

test('only internally consistent native terminal navigation receipts survive projection', () => {
  const input = fixture(), episode = input.episodes.at(-1);
  episode.navigationOutcome.secret = 'PRIVATE';
  let projected = projectSurvivor(input).episodes.at(-1).navigationOutcome;
  assert.equal(projected.state, 'failed'); assert.equal(projected.success, false);
  assert.equal(projected.taskId, 'navigation-fixture');
  assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
  for (const state of ['success', 'failed', 'timeout', 'cancelled']) {
    episode.navigationOutcome.state = state; episode.navigationOutcome.success = state === 'success';
    assert.equal(projectSurvivor(input).episodes.at(-1).navigationOutcome.state, state);
  }
  for (const invalid of [{state: 'running'}, {state: 'failed', success: true}, {task_id: ''}, {navigation_epoch: null}]) {
    const malformed = structuredClone(input); Object.assign(malformed.episodes.at(-1).navigationOutcome, invalid);
    assert.equal(projectSurvivor(malformed).episodes.at(-1).navigationOutcome, null);
  }
  episode.action = 'mine';
  assert.equal(projectSurvivor(input).episodes.at(-1).navigationOutcome, null);
});

test('existing maintenance plans stop survivor before Minecraft and require ready Minecraft to start', () => {
  const rows = SERVICES.map((id, i) => ({ id, owned: true, containerId: i.toString(16).padStart(64, '0'), state: 'running', health: 'healthy' }));
  const stop = buildPlan({ action: 'stop', services: ['mc'] }, rows);
  assert.ok(stop.stop.indexOf('survivor') < stop.stop.indexOf('mc'));
  const start = buildPlan({ action: 'start', services: ['survivor'] }, rows);
  assert.deepEqual(start.required, ['mc', 'qwenpaw']); assert.deepEqual(start.start, ['survivor']);
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
  assert.match(await page.locator('#survivor-decision').innerText(), /采集：已受理；后续结果见最近的经历/);
  assert.match(await page.locator('#survivor-skills').innerText(), /find_food/);
  assert.match(await page.locator('#survivor-skills').innerText(), /已启用版本：v1/);
  assert.match(await page.locator('#survivor-skills').innerText(), /草稿版本：v2/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /minecraft:oak_log \+4/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /minecraft:bread -1/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /达到步数或时间限制/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /实际状态变化，不能单独证明任务已完成/);
  assert.equal(await page.getByRole('link', { name: '打开桐人控制台 ↗' }).getAttribute('href'), 'http://127.0.0.1:18089/agents');
  assert.match(await page.locator('#survivor-autonomy').innerText(), /持续自主生活/);
  assert.match(await page.locator('#survivor-perception').innerText(), /minecraft:villager/);
  assert.match(await page.locator('#survivor-events').innerText(), /附近有村庄任务/);
  assert.match(await page.locator('#survivor-life-badge').innerText(), /观察摘要/);
  assert.match(await page.locator('#survivor-life-resources').innerText(), /minecraft:wheat_seeds ×4/);
  assert.match(await page.locator('#survivor-life-equipment').innerText(), /主手 minecraft:iron_pickaxe/);
  assert.match(await page.locator('#survivor-life-area').innerText(), /桐人宅地 X 95～110/);
  assert.match(await page.locator('#survivor-life-area').innerText(), /不代表已经建成住所/);
  assert.match(await page.locator('#survivor-life-opportunities').innerText(), /历史观察 · 村民 5 格；报价尚未核对/);
  assert.match(await page.locator('#survivor-life-contracts').innerText(), /本人合同 · 历史查询/);
  assert.match(await page.locator('#survivor-life-contracts').innerText(), /缺少条件：所需物资不足/);
  assert.match(await page.locator('#survivor-life-contracts').innerText(), /不是已交付数量/);
  if (process.env.SURVIVOR_PANEL_QA_IMAGE) await page.locator('#survivor-life').screenshot({path: process.env.SURVIVOR_PANEL_QA_IMAGE});
  assert.match(await page.locator('#survivor-game-skills-badge').innerText(), /历史查询/);
  assert.match(await page.locator('#survivor-game-skills-freshness').innerText(), /历史查询/);
  assert.match(await page.locator('#survivor-legacy-query').innerText(), /历史查询/);
  assert.match(await page.locator('#survivor-learned').innerText(), /螺旋丸/);
  assert.doesNotMatch(await page.locator('#survivor-learned').innerText(), /闪电/);
  assert.match(await page.locator('#survivor-eligible').innerText(), /闪电/);
  assert.match(await page.locator('#survivor-native-spells').innerText(), /上次查询未装备可用法术或卷轴/);
  assert.doesNotMatch(await page.locator('#survivor-native-spells').innerText(), /已学/);
  assert.match(await page.locator('#survivor-game-levels').innerText(), /0 \/ 100/);
  assert.match(await page.locator('#survivor-progression').innerText(), /等级 3 · 经验 15 · 技能点剩余 1 \/ 共 2/);
  assert.match(await page.locator('#survivor-game-attributes').innerText(), /1.2/);
  assert.match(await page.locator('#survivor-skill-books').innerText(), /轻身秘笈/);
  assert.match(await page.locator('#survivor-skill-books').innerText(), /目录查询时尚未学会/);
  assert.match(await page.locator('#survivor-skill-books').innerText(), /技能目录暂未识别此书/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /导航失败 · 原生任务回执/);
  assert.match(await page.locator('#survivor-episodes').innerText(), /no_walk_only_path/);
  assert.doesNotMatch(await page.locator('#survivor-episodes').innerText(), /导航已完成/);
  survivor.gameSkills.nativeSpellsKnown = false;
  await page.getByRole('button', {name: '刷新', exact: true}).click();
  await page.locator('#survivor-native-spells').filter({hasText: '尚未查询，技能情况未知'}).waitFor();
  survivor.gameSkills.nativeSpellsKnown = true;
  survivor.gameSkills.nativeSpells = [{id: 'irons_spellbooks:lightning_bolt', name: '雷电术', level: 2, mana: 20, ready: false, cooldownMs: 2500}];
  await page.getByRole('button', {name: '刷新', exact: true}).click();
  await page.locator('#survivor-native-spells').filter({hasText: '查询时未就绪'}).waitFor();
  assert.match(await page.locator('#survivor-native-spells').innerText(), /冷却 2.5 秒/);
  survivor.gameSkills = {available: false};
  await page.getByRole('button', {name: '刷新', exact: true}).click();
  await page.locator('#survivor-game-skills-badge').filter({hasText: '尚未查询'}).waitFor();
  assert.match(await page.locator('#survivor-progression').innerText(), /尚未查询成长数据/);
  assert.match(await page.locator('#survivor-learned').innerText(), /尚未查询/);
  survivor.adventure.resources.known = false; survivor.adventure.equipment.known = false;
  survivor.guild = {ok: false}; survivor.constructionAreas = [];
  await page.getByRole('button', {name: '刷新', exact: true}).click();
  await page.locator('#survivor-life-contracts').filter({hasText: '本人合同进度尚未查询'}).waitFor();
  assert.match(await page.locator('#survivor-life-resources').innerText(), /尚未观察/);
  assert.match(await page.locator('#survivor-life-equipment').innerText(), /尚未观察/);
  assert.match(await page.locator('#survivor-life-area').innerText(), /当前没有授权建造范围/);
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({width: 1280, height: 900});
  const statusLabels = { thinking: '正在思考', acting: '正在行动', waiting: '等待下一步', cooldown: '等待下次决策',
    idle: '等待新任务或环境变化', budget_wait: '等待决策额度恢复', waiting_for_tools: '等待世界工具连接', executing_skill: '正在执行已学技能', body_offline: '等待身体连接', paused: '已暂停', stopped: '服务已停止' };
  for (const [status, label] of Object.entries(statusLabels)) {
    survivor = { ...survivor, status, enabled: status !== 'paused' };
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.locator('#survivor-badge').filter({ hasText: label }).waitFor();
  }
  survivor.generatedAt = new Date(Date.now() - 95000).toISOString();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('#survivor-badge').filter({ hasText: '历史记录' }).waitFor();
  assert.match(await page.locator('#survivor-freshness').innerText(), /已过期/);
  assert.match(await page.locator('#survivor-life-badge').innerText(), /历史观察/);
  survivor.adventure = undefined;
  await page.getByRole('button', {name: '刷新', exact: true}).click();
  await page.locator('#survivor-life-badge').filter({hasText: '来源未知'}).waitFor();
  assert.deepEqual(errors, []);
});
