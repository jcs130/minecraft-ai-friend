import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const moduleSource = fs.readFileSync(path.join(root, 'vendor/modern-viewer/runtime-budget.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'vendor/modern-viewer/modern-viewer.js'), 'utf8');
function runtime(extra = {}) {
  let time = 0; const timers = [];
  const context = vm.createContext({ performance: { now: () => time }, setTimeout: (fn, delay) => { timers.push({ fn, delay }); }, ...extra });
  vm.runInContext(moduleSource, context);
  return { context, api: context.__qdViewerRuntime, timers, tick: amount => { time += amount; },
    async resume() { assert.ok(timers.length); timers.shift().fn(); await Promise.resolve(); } };
}
function bundledQueue(context) {
  const start = source.indexOf('async processMessageQueue(e){'), end = source.indexOf('handleMessage(e){', start);
  assert.ok(start > 0 && end > start);
  return vm.runInContext('({' + source.slice(start, end) + '})', context).processMessageQueue;
}

test('bundle embeds the exact readable runtime and preserves existing one-worker/30fps/distance budgets', () => {
  assert.ok(source.includes('/* QIANDENG_VIEWER_RUNTIME_V2_BEGIN */\n' + moduleSource.trimEnd() + '\n/* QIANDENG_VIEWER_RUNTIME_V2_END */'));
  assert.ok(source.startsWith('/* QIANDENG_RENDER_BUDGET_V1 */'));
  assert.ok(source.includes('let o=1;ja=new ire('));
  assert.ok(source.includes('config:{fpsLimit:30,sceneBackground:'));
  assert.ok(source.includes('x0=DC(Tk("distance"),2,4,2)'));
  assert.ok(source.includes('maximumPixelRatio:1,preference:y4'));
});

test('actual bundled queue stays single-consumer across yields and processes every message exactly once', async () => {
  const r = runtime(), seen = [], owner = { messageQueue: Array.from({ length: 150 }, (_, i) => i),
    handleMessage(value) { seen.push(value); }, isProcessingQueue: false };
  const process = bundledQueue(r.context), first = process.call(owner, 'worker');
  assert.equal(seen.length, 64); assert.equal(owner.isProcessingQueue, true); assert.equal(r.timers.length, 1);
  await process.call(owner, 'concurrent-worker');
  assert.equal(seen.length, 64); assert.equal(r.timers.length, 1, 'Concurrent arrival must not create another drain loop');
  while (r.timers.length) await r.resume(); await first;
  assert.deepEqual(seen, Array.from({ length: 150 }, (_, i) => i));
  assert.equal(owner.isProcessingQueue, false); assert.equal(r.api.snapshot().queueYields, 2);
});

test('8ms time budget yields before the backlog drains, including when rendering is hidden', async () => {
  const r = runtime(), seen = [], owner = { messageQueue: Array.from({ length: 12 }, (_, i) => i), renderingActive: false,
    handleMessage(value) { seen.push(value); r.tick(3); } };
  const pending = bundledQueue(r.context).call(owner, 'hidden-worker');
  assert.equal(seen.length, 3); assert.equal(r.timers.length, 1);
  while (r.timers.length) await r.resume(); await pending;
  assert.equal(seen.length, 12); assert.ok(r.api.snapshot().longestSliceMs <= 8 + 3,
    'A single message is indivisible; the budget includes at most one message of overshoot');
});

test('queue replacement cancels the old drain without clearing a new drain owner', async () => {
  const r = runtime(), seen = [], owner = { messageQueue: Array.from({ length: 65 }, (_, i) => i), handleMessage(value) { seen.push(value); } };
  const process = bundledQueue(r.context), old = process.call(owner, 'old');
  owner.messageQueue = Array.from({ length: 65 }, (_, i) => 'new-' + i); owner.isProcessingQueue = false;
  const next = process.call(owner, 'new'); assert.equal(r.timers.length, 2);
  await r.resume(); await old; assert.equal(owner.isProcessingQueue, true);
  await r.resume(); await next; assert.equal(owner.isProcessingQueue, false);
  assert.equal(seen.includes(64), false); assert.equal(seen.filter(value => typeof value === 'string').length, 65);
});

test('paused queues remain intact and message exceptions surface with the consumer lock released', async () => {
  const r = runtime(), seen = [], owner = { messageQueue: ['safe'], stopMesherMessagesProcessing: true, handleMessage(value) { seen.push(value); } };
  const process = bundledQueue(r.context), pending = process.call(owner, 'paused');
  assert.equal(seen.length, 0); assert.equal(r.timers[0].delay, 25);
  owner.stopMesherMessagesProcessing = false; await r.resume(); await pending; assert.deepEqual(seen, ['safe']);
  owner.messageQueue = ['bad']; owner.handleMessage = () => { throw new Error('visible-error'); };
  await assert.rejects(process.call(owner, 'failed'), /visible-error/);
  assert.equal(owner.isProcessingQueue, false); assert.equal(r.api.snapshot().lastError, 'mesher-message-failed');
});

test('actual quality controller stays within cap1 and does not demote a healthy 30fps renderer', () => {
  const start = source.indexOf('function iie('), end = source.indexOf('function yP(', start);
  const next = source.indexOf('V();U();var SP=', end);
  assert.ok(next > end && next - start < 4000);
  const context = vm.createContext({ kUe: ['auto', 'high', 'balanced', 'performance'], sie: {} });
  vm.runInContext(source.slice(start, next), context);
  const quality = context.iie({ nativePixelRatio: 2, maximumPixelRatio: 1, preference: 'auto', warmupSamples: 0 });
  for (let i = 0; i < 30; i++) quality.sample({ fps: 30 });
  assert.equal(quality.getSnapshot().mode, 'high'); assert.equal(quality.getSnapshot().changes, 0);
  for (let i = 0; i < 3; i++) quality.sample({ fps: 20 });
  assert.equal(quality.getSnapshot().mode, 'balanced');
  for (let i = 0; i < 10; i++) quality.sample({ fps: 29.8 });
  assert.equal(quality.getSnapshot().mode, 'high'); assert.equal(quality.getSnapshot().pixelRatio, 1);
});

test('actual boot notice waits for attached nonempty chunk geometry rather than a backend-only ready flag', () => {
  const state = { textContent: '', classList: { toggle() {} } };
  const r = runtime({ Ju: state, od: false, Ma: false, URLSearchParams, location: { search: '' } });
  const start = source.indexOf('function v5('), end = source.indexOf('function Lk(', start);
  const status = vm.runInContext('(' + source.slice(start, end) + ')', r.context);
  // v5's deferred callback refers to the real global function just as the bundle does.
  r.context.v5 = status;
  status('backend-ready', false, true);
  assert.equal(state.textContent, '正在生成世界区块…'); assert.equal(r.api.snapshot().sceneReady, false);
  r.tick(180); r.api.markGeometry();
  assert.equal(state.textContent, '画面已连接 · 第一人称'); assert.equal(r.api.snapshot().firstGeometryAtMs, 180);
  assert.ok(source.includes('o&&globalThis.__qdViewerRuntime.markGeometry(),o&&this.getModule("futuristicReveal")'));
});

test('failed startup cannot be overwritten by delayed geometry and diagnostics retain degradation stages', () => {
  const r = runtime(); let ready = false;
  r.api.stage('loading-assets'); r.tick(20); r.api.assetsLoaded(false); r.api.deferReady(() => { ready = true; });
  r.api.fail(); r.api.markGeometry();
  assert.equal(ready, false); assert.equal(r.api.snapshot().phase, 'failed'); assert.equal(r.api.snapshot().degradedAssets, true);
  assert.ok(source.includes('callbacks:{displayCriticalError:r=>{console.error("Modern renderer backend failure",r);hHe(r)}'));
  assert.ok(source.includes('signal:AbortSignal.timeout(30000)'));
});

test('performance phases and current queue/column counts are visible only with diagnostic opt-in', () => {
  for (const enabled of [false, true]) {
    const elements = new Map(), intervals = [];
    const document = { body: { appendChild(element) { elements.set(element.id, element); } },
      getElementById: id => elements.get(id), createElement: () => ({ style: {}, textContent: '' }) };
    const r = runtime({ document, URLSearchParams, location: { search: enabled ? '?diagnostic' : '' },
      setInterval: fn => { intervals.push(fn); return 1; }, clearInterval() {},
      world: { loadedChunks: { a: true, b: true }, finishedChunks: { a: true } } });
    r.api.stage('loading-assets'); r.tick(40); r.api.assetsLoaded(true); r.tick(60); r.api.stage('starting-backend');
    r.tick(100); r.api.markGeometry(); r.api.renderDiagnostics();
    assert.equal(elements.has('qd-runtime-diagnostics'), enabled); assert.equal(intervals.length, enabled ? 1 : 0);
    if (enabled) {
      const text = elements.get('qd-runtime-diagnostics').textContent;
      assert.match(text, /资源下载\/JSON：40 ms/); assert.match(text, /图集\/注册表：60 ms/);
      assert.match(text, /首个区块几何：200 ms/); assert.match(text, /已收列 \/ 已网格列：2 \/ 1/);
      assert.match(text, /Three.js main thread \/ WebGL2/);
    }
  }
});

test('guarded patcher is idempotent without writing or touching services', () => {
  const output = execFileSync('python', ['-X', 'utf8', path.join(root, 'tools/patch_modern_viewer_runtime.py'), '--check'], { encoding: 'utf8' });
  const result = JSON.parse(output); assert.equal(result.changed, false); assert.equal(result.check, true);
});
