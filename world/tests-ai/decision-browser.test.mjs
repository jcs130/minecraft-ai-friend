import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const instant = Date.parse('2026-09-21T03:58:42.402Z');
const origin = 'http://decision-observatory.test';

function fixtures() {
  const action = {actionId: 'action-planks', turnId: 'turn-with-actions', decisionSource: 'llm', tool: 'craft',
    args: {item_id: 'minecraft:oak_planks', count: 1}, status: 'completed', completionConfirmed: true,
    startedAt: instant - 5000, observedAt: instant - 3800, durationMs: 1200,
    inventoryDelta: {'minecraft:oak_planks': 4}, hpDelta: 0, hungerDelta: 0};
  return {
    trace: {schema: 1, available: true, stale: false, generatedAt: new Date(instant).toISOString(),
      agent: {name: '桐人', hp: 18, hunger: 12, goal: '准备工作台材料'},
      turns: [
        {turnId: 'turn-latest-empty', decisionSource: 'llm', status: 'active', startedAt: instant + 1000,
          finishedAt: null, durationMs: null, input: {mission: '查看背包'}, summary: null, actions: []},
        {turnId: 'turn-with-actions', decisionSource: 'llm', status: 'completed', startedAt: instant - 6000,
          finishedAt: instant - 3000, durationMs: 3000, input: {body: null, mission: null},
          summary: {goal: '合成木板', lesson: '已确认收到木板回执', nextFocus: '准备工作台'}, actions: [action]},
      ],
      // Reproduce the retained Jev example without contacting the policy service.
      policyDecisions: [{source: 'jev', model: 'jev-1.13.0', at: instant, observedAt: instant - 1700,
        skill: 'prepare_for_task', version: 'fixture-v1', practiceRunId: 'fixture-practice', choice: 'craft_planks',
        confidence: .13, selectedProbability: .57, latencyMs: 613.38, handoffMs: 1643.93,
        code: 'policy_escalated', reason: 'low_confidence', outcome: 'fallback', association: 'no_dispatch_link',
        dispatchTurnId: null, llmFollowupTurnId: null, actions: [],
        candidates: [
          {id: 'craft_planks', description: '用原木合成木板', probability: .57, selected: true,
            action: {tool: 'craft', args: {item_id: 'minecraft:oak_planks', count: 1}}},
          {id: 'null', description: '交回慢系统', probability: .43, selected: false, action: null},
        ]}],
      routing: {activeSource: 'llm', activeLlmTurnId: 'turn-latest-empty', llmAlternativesRecorded: false},
      coverage: {partial: true, unavailable: []}},
    rsi: {schema: 1, available: true, generatedAt: instant,
      sources: {learning: true, shared: true, knowledge: true, engineering: true, receipts: true, cases: true},
      l1: {generation: {memoryEpoch: 'fixture-epoch'}, behaviors: [{category: 'craft', sampled: 1, succeeded: 1}]},
      l2: {localSkills: [{name: 'prepare', revision: 'fixture-v1', enabled: true, behaviorVerified: false}],
        sharedSkills: [], drafts: [], knowledge: [{name: 'crafting.md', at: instant, size: 200}],
        knowledgePartial: false, feedback: []},
      l3: {enabled: false, baseCommit: 'fixture-base', plans: [], receipts: [], verifiedImprovement: null,
        cases: {available: true, counts: {open: 1}, items: [{id: 'fixture-case', title: '检查补给', status: 'open'}]},
        notice: '机制示意，改进收益没有完整验收。'}},
  };
}

test('decision canvas preserves evidence, playback controls, frozen snapshots and accessible layouts', {timeout: 60000}, async t => {
  const candidates = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  let executablePath;
  for (const candidate of candidates) {
    try {await fs.access(candidate); executablePath = candidate; break;} catch { /* optional local browser */ }
  }
  if (!executablePath) {t.skip('This optional UI check requires an installed Chromium browser'); return;}
  const {chromium} = await import('playwright-core');
  const browser = await chromium.launch({executablePath, headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}, reducedMotion: 'no-preference'});
  page.setDefaultTimeout(8000);
  const errors = [], requests = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  const {rsi} = fixtures();
  let {trace} = fixtures(), traceReads = 0, holdTrace = false, releaseTrace, traceStarted;
  const assets = {
    '/observatory': ['observatory.html', 'text/html'], '/observatory.js': ['observatory.js', 'text/javascript'],
    '/observatory.css': ['observatory.css', 'text/css'], '/observatory-motion.css': ['observatory-motion.css', 'text/css'],
    '/decision-model.js': ['decision-model.js', 'text/javascript'], '/decision-canvas.js': ['decision-canvas.js', 'text/javascript'],
  };
  // Every request, including unexpected URLs, is fulfilled here. No live service or world is reachable.
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({method: request.method(), url: request.url()});
    if (url.origin !== origin || request.method() !== 'GET') {
      unexpected.push(request.url()); return route.fulfill({status: 403, body: ''});
    }
    if (url.pathname === '/api/survivor-trace') {
      traceReads++;
      const body = JSON.stringify(trace);
      if (holdTrace) {
        holdTrace = false;
        await new Promise(resolve => {releaseTrace = resolve; traceStarted?.();});
      }
      return route.fulfill({contentType: 'application/json', body});
    }
    if (url.pathname === '/api/rsi-observatory') return route.fulfill({contentType: 'application/json', body: JSON.stringify(rsi)});
    if (url.pathname === '/favicon.ico') return route.fulfill({status: 204, body: ''});
    if (!Object.hasOwn(assets, url.pathname)) {
      unexpected.push(request.url()); return route.fulfill({status: 404, body: ''});
    }
    const [name, contentType] = assets[url.pathname];
    return route.fulfill({contentType, body: await fs.readFile(new URL('../admin/public/' + name, import.meta.url), 'utf8')});
  });
  // Real timers never need to sleep through animation or the five-second refresh interval.
  await page.clock.install({time: new Date(instant)});
  await page.clock.pauseAt(new Date(instant + 1000));
  await page.goto(origin + '/observatory');
  await page.locator('[data-node="gate"]').waitFor();
  await page.clock.runFor(600);
  assert.match(await page.locator('#graph-title').innerText(), /Jev/);
  assert.equal(await page.locator('[data-node^="action-"]').count(), 0, 'A selected fallback candidate must never become an executed action');
  assert.equal(await page.locator('[data-node="fallback"]').count(), 1);
  assert.match(await page.locator('[data-node="candidate-0"]').textContent(), /57%/);
  assert.match(await page.locator('[data-node="gate"]').textContent(), /13%/);
  assert.equal(await page.locator('#play').getAttribute('aria-label'), '暂停记录动画');
  await page.locator('#play').click();
  await page.locator('[data-node="gate"]').click();
  assert.match(await page.locator('#node-detail').innerText(), /决策置信度\s*13%/);
  assert.match(await page.locator('#node-detail').innerText(), /已选候选概率\s*57%/);
  await page.locator('[data-node="fallback"]').click();
  assert.match(await page.locator('#node-detail').innerText(), /未派发动作/);
  await page.locator('.evidence-link').click();
  assert.equal(await page.locator('#inspector').isVisible(), true);
  assert.match(await page.locator('#inspector-content').innerText(), /后续 LLM 轮次未绑定/);
  await page.locator('#close-inspector').click();

  const stoppedAt = await page.locator('#playback-progress').evaluate(element => element.value);
  await page.locator('#step').click();
  assert.equal(await page.locator('#playback-progress').evaluate(element => element.value), stoppedAt + 1);
  assert.equal(await page.locator('.edge.flowing').count(), 0, 'Single step remains paused');
  for (const speed of ['2×', '0.5×', '1×']) {
    await page.locator('#speed').click();
    assert.equal(await page.locator('#speed').innerText(), speed);
  }
  await page.locator('#speed').click(); // 2×, 750 ms per reading step.
  await page.locator('#loop').click();
  assert.equal(await page.locator('#loop').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#playback-note').innerText(), /同一记录循环回放.*非新的执行/);
  const stepCount = await page.locator('#playback-progress').evaluate(element => element.max);
  await page.locator('#play').click();
  await page.clock.runFor(stepCount * 750);
  assert.equal(await page.locator('#play').getAttribute('aria-label'), '暂停记录动画', 'Opt-in replay loops the same historical record');
  assert.equal(await page.locator('.edge.mechanism.flowing').count(), 0, 'A policy feedback loop is a mechanism, not a recorded transition');
  assert.notEqual(await page.locator('.edge.mechanism .edge-base').first().evaluate(element => getComputedStyle(element).strokeDasharray), 'none');
  await page.locator('#loop').click();
  await page.clock.runFor((stepCount + 1) * 750);
  assert.equal(await page.locator('#playback-status').innerText(), '回放结束');
  assert.equal(await page.locator('#play').getAttribute('aria-label'), '播放记录动画');
  assert.equal(await page.locator('#playback-progress').evaluate(element => element.value === element.max), true);

  await page.locator('[data-view="llm"]').click();
  assert.equal(await page.locator('#record-select').inputValue(), 'llm:turn-with-actions', 'Default LLM record has actions even when the newest turn is empty');
  assert.equal(await page.locator('[data-node^="action-"]').count(), 1);
  await page.locator('[data-node="action-0"]').click();
  assert.match(await page.locator('#node-detail').innerText(), /1.20 s/);
  await page.locator('#node-detail').getByText('调用参数', {exact: true}).click();
  assert.match(await page.locator('#node-detail').innerText(), /minecraft:oak_planks/);
  await page.locator('[data-view="rsi"]').click();
  assert.match(await page.locator('#graph-mode').innerText(), /机制示意.*非执行记录/);
  assert.equal(await page.locator('.edge.recorded').count(), 0);
  assert.ok(await page.locator('.edge.mechanism').count() > 0);
  assert.match(await page.locator('#playback-note').innerText(), /机制演示.*不代表已发生/);
  await page.locator('[data-view="policy"]').click();

  // Start a response, pause before it arrives, then prove it cannot replace the visible snapshot.
  const originalMission = await page.locator('#mission').innerText();
  trace = {...trace, agent: {...trace.agent, goal: '仅恢复更新后可见的新目标'}};
  holdTrace = true;
  const pending = new Promise(resolve => {traceStarted = resolve;});
  await page.clock.runFor(5000);
  await pending;
  await page.locator('#pause').click();
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/survivor-trace');
  releaseTrace();
  await (await response).finished();
  await page.clock.runFor(100);
  assert.equal(await page.locator('#mission').innerText(), originalMission, 'An in-flight fetch cannot overwrite a frozen snapshot');
  const frozenReads = traceReads;
  await page.clock.runFor(10000);
  assert.equal(traceReads, frozenReads, 'Paused updates do not issue new trace reads');
  assert.equal(await page.locator('.edge.flowing').count(), 0);
  await page.locator('#pause').click();
  await page.waitForFunction(() => document.getElementById('mission').textContent === '仅恢复更新后可见的新目标');

  for (const [width, height] of [[1920, 1080], [390, 844]]) {
    await page.setViewportSize({width, height});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Page overflows at ${width}px`);
  }
  await page.setViewportSize({width: 480, height: 1080});
  await page.locator('#mode').click();
  assert.equal(await page.locator('#decision-canvas').evaluate(element => element.viewBox.baseVal.width), 480);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'OBS sidebar keeps its canvas inside the page');
  for (const layer of ['l1', 'l2', 'l3']) assert.equal(await page.locator(`[data-inspect="${layer}"]`).isVisible(), true);

  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(origin + '/observatory');
  await page.locator('[data-node="gate"]').waitFor();
  assert.equal(await page.locator('#play').getAttribute('aria-label'), '播放记录动画', 'Reduced motion suppresses automatic playback');
  assert.equal(await page.locator('#playback-progress').evaluate(element => element.value), 0);
  await page.locator('#play').click();
  await page.clock.runFor(1600);
  const motion = await page.locator('#decision-canvas').evaluate(element => ({
    signals: [...element.querySelectorAll('.edge-signal')].every(node => getComputedStyle(node).display === 'none'),
    halos: [...element.querySelectorAll('.node-halo')].every(node => getComputedStyle(node).animationName === 'none'),
  }));
  assert.deepEqual(motion, {signals: true, halos: true}, 'Manual reduced-motion playback keeps signals and pulses disabled');
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  assert.ok(requests.length > 0 && requests.every(request => request.method === 'GET' && request.url.startsWith(origin + '/')));
});
