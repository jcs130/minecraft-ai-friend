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
    '/embodied-architecture.js': ['embodied-architecture.js', 'text/javascript'],
    '/unified-decision.js': ['unified-decision.js', 'text/javascript'],
  };
  // Every request, including unexpected URLs, is fulfilled here. No live service or world is reachable.
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({method: request.method(), url: request.url()});
    if (request.url() === 'http://127.0.0.1:19092/third/' && request.method() === 'GET') {
      return route.fulfill({contentType:'text/html',body:'<p>Isolated world viewer fixture</p>'});
    }
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
  await page.locator('[data-node="policy/gate"]').waitFor();
  await page.clock.runFor(100);
  assert.equal(await page.locator('#decision-canvas').count(),1);
  assert.equal(await page.locator('[data-view]').count(),0,'No decision-view switching remains');
  assert.equal(await page.locator('[data-lane]').count(),4);
  for(const id of ['policy/gate','llm/llm','l2/dream','l3/gate'])assert.equal(await page.locator(`[data-node="${id}"]`).count(),1);
  assert.equal(await page.locator('#world-frame').isVisible(),true);
  assert.equal(await page.locator('[data-node="llm/llm"]').evaluate(n=>n.classList.contains('live-now')),true);
  await page.locator('[data-node="policy/gate"]').click();
  assert.match(await page.locator('#node-detail').innerText(),/决策置信度\s*13%/);
  assert.match(await page.locator('#node-detail').innerText(),/已选候选概率\s*57%/);
  await page.locator('[data-node="policy/fallback"]').click();
  assert.match(await page.locator('#node-detail').innerText(),/未派发动作/);
  await page.locator('.evidence-link').click();
  assert.match(await page.locator('#inspector-content').innerText(),/后续 LLM 轮次未绑定/);
  await page.locator('#close-inspector').click();
  const initialBox=await page.locator('#decision-canvas').getAttribute('viewBox');
  await page.locator('#zoom-in').click();
  const zoomedBox=await page.locator('#decision-canvas').getAttribute('viewBox');
  assert.notEqual(zoomedBox,initialBox);
  await page.locator('#record-select').selectOption('llm:turn-with-actions');
  assert.equal(await page.locator('[data-lane]').count(),4,'Selecting history never hides the other systems');
  assert.equal(await page.locator('#decision-canvas').getAttribute('viewBox'),zoomedBox,'History changes preserve zoom and pan');
  assert.equal(await page.locator('[data-node="llm/llm"]').evaluate(n=>n.classList.contains('live-now')),false);
  await page.locator('#fit-graph').click();
  await page.locator('[data-node="llm/action-0"]').click();
  assert.match(await page.locator('#node-detail').innerText(),/1.20 s/);
  assert.equal(await page.locator('[data-node="policy/gate"]').count(),1);
  await page.locator('[data-node="l2/dream"]').click();
  assert.match(await page.locator('#node-detail').innerText(),/未提供 Dream 运行回执/);
  await page.locator('[data-node="l3/gate"]').press('Enter');
  assert.match(await page.locator('#node-detail').innerText(),/独立评测确认改善/);
  await page.locator('#decision-canvas').focus();
  const beforePan=await page.locator('#decision-canvas').getAttribute('viewBox');
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.locator('#decision-canvas').getAttribute('viewBox'),beforePan);
  await page.locator('#fit-graph').click();
  const bounds=await page.locator('#decision-canvas').boundingBox();
  await page.mouse.move(bounds.x+5,bounds.y+5);
  await page.mouse.down();await page.mouse.move(bounds.x+65,bounds.y+45);await page.mouse.up();
  assert.notEqual(await page.locator('#decision-canvas').getAttribute('viewBox'),beforePan,'Background drag pans the complete graph');
  await page.locator('#fit-graph').click();
  assert.equal(await page.locator('#expand-graph').count(),0,'The graph cannot replace the broadcast with an overlay');
  const scene=await page.locator('#world-frame').boundingBox();
  const canvas=await page.locator('#decision-canvas').boundingBox();
  assert.ok(scene.height>=220 && scene.y>=0,'The live scene remains a substantial part of the first screen');
  assert.ok(canvas.y>=scene.y+scene.height && canvas.y+canvas.height<=1080,'The whole graph and live scene fit together at 1080p');
  assert.ok(canvas.height<=400,'The graph is compact, with local zoom for detail');
  assert.equal(await page.locator('.workbench').evaluate(n=>getComputedStyle(n).position==='fixed'),false);
  assert.equal(await page.locator('[data-lane]').count(),4);
  for(const expected of ['2×','0.5×','1×']){await page.locator('#speed').click();assert.equal(await page.locator('#speed').innerText(),expected);}
  await page.locator('#step').click();
  assert.equal(await page.locator('.edge.flowing').count(),0);
  await page.locator('#speed').click();await page.locator('#loop').click();await page.locator('#play').click();
  const stepCount=await page.locator('#playback-progress').evaluate(n=>n.max);
  await page.clock.runFor(stepCount*750);
  assert.equal(await page.locator('#play').getAttribute('aria-label'),'暂停记录动画');
  assert.equal(await page.locator('.edge.mechanism.flowing').count(),0,'No unbound handoff or evolution is replayed as execution');
  await page.locator('#loop').click();await page.clock.runFor((stepCount+1)*750);
  assert.equal(await page.locator('#playback-status').innerText(),'回放结束');
  await page.locator('#latest').click();
  assert.equal(await page.locator('#latest').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-node="llm/llm"]').evaluate(n=>n.classList.contains('live-now')),true);
  const originalMission=await page.locator('#mission').innerText();
  trace={...trace,agent:{...trace.agent,goal:'仅恢复更新后可见的新目标'}};
  holdTrace=true;const pending=new Promise(resolve=>{traceStarted=resolve;});
  await page.clock.runFor(5000);await pending;await page.locator('#pause').click();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/survivor-trace');releaseTrace();await(await response).finished();
  await page.clock.runFor(100);assert.equal(await page.locator('#mission').innerText(),originalMission);
  const frozenReads=traceReads;await page.clock.runFor(10000);assert.equal(traceReads,frozenReads);
  await page.locator('#pause').click();await page.waitForFunction(()=>document.getElementById('mission').textContent==='仅恢复更新后可见的新目标');
  for(const width of [1920,390]){await page.setViewportSize({width,height:1080});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
  await page.setViewportSize({width:480,height:1080});await page.locator('#mode').click();
  assert.equal(await page.locator('[data-lane]').count(),4,'OBS also retains every lane');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin+'/observatory');await page.locator('[data-node="policy/gate"]').waitFor();
  assert.equal(await page.locator('#play').getAttribute('aria-label'),'播放记录动画');
  await page.locator('#play').click();await page.clock.runFor(1600);
  assert.equal(await page.locator('.edge-signal').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).display==='none')),true);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  assert.ok(requests.every(r=>r.method==='GET'&&(r.url.startsWith(origin+'/')||r.url==='http://127.0.0.1:19092/third/')));
});
