/* Embedded by tools/patch_modern_viewer_runtime.py; no additional HTTP route. */
(function installViewerRuntime(root) {
  'use strict';
  if (root.__qdViewerRuntime?.schema === 2) return;
  const clock = () => root.performance.now();
  const startedAt = clock(), drains = new WeakMap();
  const state = {
    schema: 2, phase: 'bundle-loaded', sceneReady: false, degradedAssets: false,
    bundleReadyAtNavigationMs: Math.round(startedAt), firstGeometryAtNavigationMs: null,
    phases: [{ phase: 'bundle-loaded', elapsedMs: 0 }],
    mesherBudgetMs: 8, mesherMaxMessagesPerSlice: 64,
    messagesProcessed: 0, pendingMessages: 0, queueSlices: 0, queueYields: 0, queuePeak: 0,
    longestSliceMs: 0, firstGeometryAtMs: null, geometrySections: 0, lastError: null,
  };
  let readyCallback = null;
  const stage = phase => {
    if (state.phase === 'failed' || state.sceneReady && !['scene-ready', 'failed'].includes(phase)) return;
    if (state.phase === phase) return;
    state.phase = phase;
    if (state.phases.length < 16) state.phases.push({ phase, elapsedMs: Math.round(clock() - startedAt) });
  };
  const yieldToBrowser = delay => new Promise(resolve => root.setTimeout(resolve, delay));
  async function drainMesherQueue(owner) {
    const queue = owner.messageQueue;
    if (!Array.isArray(queue) || queue.length === 0) return;
    const existing = drains.get(owner);
    if (existing?.queue === queue) return;
    const token = { queue }; drains.set(owner, token); owner.isProcessingQueue = true;
    try {
      while (queue === owner.messageQueue && queue.length && !owner.disconnected) {
        state.queuePeak = Math.max(state.queuePeak, queue.length);
        state.pendingMessages = queue.length;
        // Keep a paused debug queue intact, yielding even while the canvas is hidden.
        if (owner.stopMesherMessagesProcessing) { await yieldToBrowser(25); continue; }
        const start = clock(); let count = 0;
        while (queue === owner.messageQueue && queue.length && !owner.stopMesherMessagesProcessing) {
          owner.handleMessage(queue.shift()); count++; state.messagesProcessed++; state.pendingMessages = queue.length;
          if (count >= state.mesherMaxMessagesPerSlice || clock() - start >= state.mesherBudgetMs) break;
        }
        state.queueSlices++; state.longestSliceMs = Math.max(state.longestSliceMs, clock() - start);
        if (queue === owner.messageQueue && queue.length) { state.queueYields++; await yieldToBrowser(0); }
      }
    } catch (error) {
      state.lastError = 'mesher-message-failed'; throw error;
    } finally {
      if (drains.get(owner) === token) { drains.delete(owner); owner.isProcessingQueue = false; }
    }
  }
  function markGeometry() {
    state.geometrySections++;
    if (state.sceneReady || state.phase === 'failed') return;
    state.sceneReady = true; state.firstGeometryAtMs = Math.round(clock() - startedAt);
    state.firstGeometryAtNavigationMs = Math.round(clock());
    stage('scene-ready');
    const callback = readyCallback; readyCallback = null;
    if (callback) callback();
  }
  function snapshot() {
    const world = root.world;
    return { ...state, backend: 'Three.js main thread / WebGL2', elapsedMs: Math.round(clock() - startedAt),
      loadedColumns: world?.loadedChunks ? Object.keys(world.loadedChunks).length : 0,
      meshedColumns: world?.finishedChunks ? Object.keys(world.finishedChunks).length : 0,
      phases: state.phases.map(row => ({ ...row })) };
  }
  const diagnostic = !!root.document && new root.URLSearchParams(root.location?.search || '').has('diagnostic');
  function renderDiagnostics() {
    if (!diagnostic || !root.document.body) return;
    let panel = root.document.getElementById('qd-runtime-diagnostics');
    if (!panel) {
      panel = root.document.createElement('pre'); panel.id = 'qd-runtime-diagnostics';
      panel.style.cssText = 'position:fixed;right:8px;top:72px;z-index:99999;max-width:440px;white-space:pre-wrap;padding:8px;background:#10202eef;color:#d8efdf;font:12px/1.4 monospace;pointer-events:none';
      root.document.body.appendChild(panel);
    }
    const data = snapshot(), at = name => data.phases.find(row => row.phase === name)?.elapsedMs;
    const elapsed = (end, start) => at(end) === undefined || at(start) === undefined ? '等待' : at(end) - at(start) + ' ms';
    panel.textContent = [
      '查看器诊断 · ' + data.phase,
      '后端：' + data.backend,
      '脚本下载/解析就绪（导航起）：' + data.bundleReadyAtNavigationMs + ' ms',
      '资源下载/JSON：' + elapsed('building-atlas', 'loading-assets'),
      '图集/注册表：' + elapsed('starting-backend', 'building-atlas'),
      '首个区块几何：' + (data.firstGeometryAtMs === null ? '等待' : data.firstGeometryAtMs + ' ms'),
      '首个区块几何（导航起）：' + (data.firstGeometryAtNavigationMs === null ? '等待' : data.firstGeometryAtNavigationMs + ' ms'),
      '已收列 / 已网格列：' + data.loadedColumns + ' / ' + data.meshedColumns,
      '排队消息 / 峰值：' + data.pendingMessages + ' / ' + data.queuePeak,
      '处理消息 / 主线程让出：' + data.messagesProcessed + ' / ' + data.queueYields,
      '最长处理批次：' + Math.round(data.longestSliceMs * 10) / 10 + ' ms',
      '模组资产：' + (data.degradedAssets ? '未完整载入' : '按当前资源包'),
      data.lastError ? '错误：' + data.lastError : '',
    ].filter(Boolean).join('\n');
  }
  root.__qdViewerRuntime = Object.freeze({
    schema: 2, stage, drainMesherQueue, markGeometry,
    get sceneReady() { return state.sceneReady; },
    deferReady(callback) { readyCallback = callback; stage('waiting-for-chunk-geometry'); },
    assetsLoaded(available) { state.degradedAssets = !available; stage('building-atlas'); },
    fail() { readyCallback = null; state.lastError = 'renderer-start-failed'; stage('failed'); },
    snapshot, renderDiagnostics,
  });
  if (diagnostic) {
    renderDiagnostics();
    const timer = root.setInterval(renderDiagnostics, 1000);
    root.addEventListener?.('pagehide', () => root.clearInterval(timer), { once: true });
  }
})(globalThis);
