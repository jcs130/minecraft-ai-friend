/** Capture the current read-only Minecraft viewer scene for visual inspection. */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

export type MinecraftViewMode = 'first' | 'third' | 'dungeon';

export interface MinecraftViewCaptureOptions {
  viewerUrl: string;
  mode?: MinecraftViewMode;
  width?: number;
  height?: number;
  includeHud?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface MinecraftViewCapture {
  png: Buffer;
  mode: MinecraftViewMode;
  width: number;
  height: number;
  capturedAt: string;
  viewerVersion?: string;
  includesHud?: boolean;
  timings?: { warmupMs: number; healthMs: number; browserMs: number; pageMs: number; sceneMs: number; pngMs: number; reusedPage: boolean };
}

export type VisualCaptureErrorCode = 'invalid_url' | 'unavailable' | 'busy' | 'browser' | 'renderer' | 'timeout' | 'cancelled';

export class VisualCaptureError extends Error {
  constructor(readonly code: VisualCaptureErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VisualCaptureError';
  }
}

interface CaptureDependencies {
  fetcher?: typeof fetch;
  launchBrowser?: () => Promise<Browser>;
}

interface ViewerHealth {
  ok?: boolean;
  version?: string;
  viewers?: number;
  maxSessions?: number;
  captureSessions?: number;
  maxCaptureSessions?: number;
}

interface CapturePageElement {
  classList: { contains(className: string): boolean };
  textContent: string | null;
}

interface CapturePageCanvas {
  id: string;
  width: number;
  height: number;
  closest(selector: string): unknown;
  getBoundingClientRect(): { width: number; height: number };
  setAttribute(name: string, value: string): void;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_TIMEOUT_MS = 18_000;
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const LEGACY_SESSION_MS = 50_000;
const LEASE_INTERVAL_MS = 15_000;
const activeOrigins = new Set<string>();

function viewportDimension(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`visual capture dimension must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function localViewerOrigin(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new VisualCaptureError('invalid_url', 'viewerUrl 不是有效地址'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) {
    throw new VisualCaptureError('invalid_url', '截图仅支持本机 127.0.0.1 的 HTTP viewer');
  }
  return url.origin;
}

function edgeExecutablePath(): string {
  const candidates = [
    process.env.CORTICO_EDGE_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/google-chrome',
  ];
  const found = candidates.find(candidate => candidate && existsSync(candidate));
  if (!found) throw new VisualCaptureError('browser', '未找到 Edge/Chromium；可设置 CORTICO_EDGE_EXECUTABLE');
  return found;
}

function remaining(deadlineAtMs: number): number {
  const ms = deadlineAtMs - Date.now();
  if (ms <= 0) throw new VisualCaptureError('timeout', '等待 viewer 截图超时');
  return ms;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new VisualCaptureError('cancelled', 'viewer 截图已取消');
}

export function viewerCaptureState(): false | string {
  const browserWindow = globalThis as unknown as {
    document: {
      querySelector(selector: string): CapturePageElement | null;
      querySelectorAll(selector: string): CapturePageCanvas[];
    };
    innerWidth: number;
    innerHeight: number;
    world?: {
      loadedChunks?: Record<string, unknown>;
      finishedChunks?: Record<string, unknown>;
      sectionsWaiting?: { size: number };
      messageQueue?: { length: number };
    };
    __corticoCapture?: { chunks: string; since: number };
  };
  const boot = browserWindow.document.querySelector('.boot');
  if (boot?.classList.contains('is-error')) return `error:${boot.textContent?.trim() ?? ''}`;
  if (!boot?.classList.contains('is-compact')) return false;
  const world = browserWindow.world;
  const loaded = Object.keys(world?.loadedChunks ?? {});
  const meshed = Object.keys(world?.finishedChunks ?? {}).sort();
  if (meshed.length === 0 || loaded.some(key => !world?.finishedChunks?.[key])
      || (world?.sectionsWaiting?.size ?? 0) > 0 || (world?.messageQueue?.length ?? 0) > 0) {
    delete browserWindow.__corticoCapture;
    return false;
  }
  const canvas = [...browserWindow.document.querySelectorAll('canvas')].find(candidate => {
    if (candidate.id === 'corti-tactical-canvas' || candidate.closest('.corti-minimap')) return false;
    const rect = candidate.getBoundingClientRect();
    return rect.width >= browserWindow.innerWidth / 2 && rect.height >= browserWindow.innerHeight / 2
      && candidate.width >= browserWindow.innerWidth / 2 && candidate.height >= browserWindow.innerHeight / 2;
  });
  if (!canvas) return false;
  const chunks = meshed.join(';');
  const previous = browserWindow.__corticoCapture;
  if (!previous || previous.chunks !== chunks) {
    browserWindow.__corticoCapture = { chunks, since: performance.now() };
    return false;
  }
  if (performance.now() - previous.since < 350) return false;
  canvas.setAttribute('data-cortico-capture-scene', 'true');
  return 'ready';
}

interface CaptureSession {
  browser: Browser;
  page?: Page;
  mode?: MinecraftViewMode;
  width?: number;
  height?: number;
  openedAtMs?: number;
  captureLane?: boolean;
  leaseKey?: string;
  renewable?: boolean;
  leaseTimer?: ReturnType<typeof setInterval>;
}

async function waitForWarmup(pending: Promise<void>, deadlineAtMs: number, signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal);
  const cancellation = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(remaining(deadlineAtMs))]);
  let onAbort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new VisualCaptureError(signal?.aborted ? 'cancelled' : 'timeout',
      signal?.aborted ? 'viewer 截图已取消' : '等待 viewer 预热超时'));
    cancellation.addEventListener('abort', onAbort, { once: true });
  });
  try { await Promise.race([pending.catch(() => undefined), interrupted]); }
  finally { cancellation.removeEventListener('abort', onAbort); }
}

/** Owns read-only capture pages in the viewer's independent connection lane. */
export class MinecraftViewCaptureManager {
  private readonly sessions = new Map<string, CaptureSession>();
  private readonly warming = new Map<string, Promise<void>>();
  private generation = 0;

  constructor(private readonly dependencies: CaptureDependencies = {}) {}

  async capture(options: MinecraftViewCaptureOptions): Promise<MinecraftViewCapture> {
    const origin = localViewerOrigin(options.viewerUrl);
    const mode = options.mode ?? 'third';
    if (mode !== 'first' && mode !== 'third' && mode !== 'dungeon') throw new RangeError('invalid Minecraft view mode');
    const width = viewportDimension(options.width, DEFAULT_WIDTH, 640, 1920);
    const height = viewportDimension(options.height, DEFAULT_HEIGHT, 360, 1080);
    const timeoutMs = viewportDimension(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
    const generation = this.generation;
    const deadlineAtMs = Date.now() + timeoutMs;
    const timings = { warmupMs: 0, healthMs: 0, browserMs: 0, pageMs: 0, sceneMs: 0, pngMs: 0, reusedPage: false };
    const warming = this.warming.get(origin);
    if (warming) {
      const warmingStarted = performance.now();
      await waitForWarmup(warming, deadlineAtMs, options.signal);
      timings.warmupMs = performance.now() - warmingStarted;
    }
    if (this.generation !== generation) throw new VisualCaptureError('cancelled', 'viewer 截图已取消');
    if (activeOrigins.has(origin)) throw new VisualCaptureError('busy', '该 viewer 正在截图，请稍后再试');
    activeOrigins.add(origin);
    const signal = options.signal;
    let session = this.sessions.get(origin);
    let closePromise: Promise<void> | undefined;
    const close = () => this.sessions.has(origin) ? closePromise ??= this.closeSession(origin) : Promise.resolve();
    const onAbort = () => { void close(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      assertNotAborted(signal);
      if (session && !session.browser.isConnected()) {
        await close();
        closePromise = undefined;
        session = undefined;
      }
      if (session?.page && (session.page.isClosed() || session.mode !== mode || session.width !== width || session.height !== height
          || (!session.renewable && Date.now() - session.openedAtMs! >= LEGACY_SESSION_MS))) {
        await this.closePage(origin, session);
      }
      const fetcher = this.dependencies.fetcher ?? fetch;
      const healthStarted = performance.now();
      let health: ViewerHealth;
      try {
        const response = await fetcher(`${origin}/healthz`, {
          signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(Math.min(3_000, remaining(deadlineAtMs)))]),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        health = await response.json() as ViewerHealth;
      } catch (error) {
        assertNotAborted(signal);
        throw new VisualCaptureError('unavailable', '本地 viewer 健康检查失败', { cause: error });
      }
      if (!health.ok) throw new VisualCaptureError('unavailable', '本地 viewer 尚未就绪');
      const captureLane = Number.isInteger(health.maxCaptureSessions) && health.maxCaptureSessions! > 0;
      if (session?.page && session.captureLane !== captureLane) await this.closePage(origin, session);
      if (session?.page && session.renewable && !await this.renewLease(origin, session)) await this.closePage(origin, session);
      timings.healthMs = performance.now() - healthStarted;
      const ownsCaptureSlot = captureLane && !!session?.page && !session.page.isClosed();
      if (captureLane && !ownsCaptureSlot && (health.captureSessions ?? 0) >= health.maxCaptureSessions!) {
        throw new VisualCaptureError('busy', '独立截图连接正在使用，请稍后再试');
      }
      if (!captureLane && typeof health.viewers === 'number' && health.viewers >= (health.maxSessions ?? 2)) {
        throw new VisualCaptureError('busy', 'viewer 会话已满，无法建立截图连接');
      }
      if (!session) {
        const browserStarted = performance.now();
        const browser = await (this.dependencies.launchBrowser ?? (() => chromium.launch({
          executablePath: edgeExecutablePath(), headless: true, timeout: remaining(deadlineAtMs),
          args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'],
        })))();
        if (this.generation !== generation) {
          await browser.close().catch(() => undefined);
          throw new VisualCaptureError('cancelled', 'viewer 截图已取消');
        }
        session = { browser };
        this.sessions.set(origin, session);
        timings.browserMs = performance.now() - browserStarted;
        assertNotAborted(signal);
      }
      if (!session.page) {
        const pageStarted = performance.now();
        session.leaseKey = randomUUID();
        session.page = await session.browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1,
          ...(captureLane ? { extraHTTPHeaders: { 'x-mc-viewer-capture': '1', 'x-mc-viewer-capture-key': session.leaseKey } } : {}) });
        session.mode = mode; session.width = width; session.height = height;
        session.captureLane = captureLane;
        const pagePath = mode === 'first' ? '/' : `/${mode}/`;
        await session.page.goto(`${origin}${pagePath}`, { waitUntil: 'domcontentloaded', timeout: remaining(deadlineAtMs) });
        session.openedAtMs = Date.now();
        await session.page.addStyleTag({ content: 'body[data-cortico-capture-hide-hud="true"] *{visibility:hidden!important}body[data-cortico-capture-hide-hud="true"] canvas[data-cortico-capture-scene="true"]{visibility:visible!important}' });
        timings.pageMs = performance.now() - pageStarted;
      } else {
        timings.reusedPage = true;
      }
      const page = session.page!;
      const sceneStarted = performance.now();
      const state = await page.waitForFunction(viewerCaptureState, undefined, { polling: 100, timeout: remaining(deadlineAtMs) });
      const result = await state.jsonValue();
      await state.dispose();
      timings.sceneMs = performance.now() - sceneStarted;
      if (typeof result === 'string' && result.startsWith('error:')) {
        throw new VisualCaptureError(result.includes('连接已满') ? 'busy' : 'renderer', result.slice(6) || 'viewer 渲染失败');
      }
      if (captureLane && !session.renewable && await this.renewLease(origin, session)) {
        session.renewable = true;
        const current = session;
        const leaseKey = session.leaseKey;
        session.leaseTimer = setInterval(() => {
          void this.renewLease(origin, current).then(ok => {
            if (!ok && current.leaseKey === leaseKey && this.sessions.get(origin) === current) void this.closePage(origin, current);
          });
        }, LEASE_INTERVAL_MS);
        session.leaseTimer.unref();
      }
      if (this.generation !== generation) throw new VisualCaptureError('cancelled', 'viewer 截图已取消');
      assertNotAborted(signal);
      await page.evaluate((hide: boolean) => {
        const document = (globalThis as unknown as { document: { body: { setAttribute(name: string, value: string): void } } }).document;
        document.body.setAttribute('data-cortico-capture-hide-hud', String(hide));
      }, !options.includeHud);
      const pngStarted = performance.now();
      const screenshotOptions = { type: 'png' as const, timeout: remaining(deadlineAtMs) };
      const png = options.includeHud ? await page.screenshot(screenshotOptions)
        : await page.locator('canvas[data-cortico-capture-scene="true"]').screenshot(screenshotOptions);
      timings.pngMs = performance.now() - pngStarted;
      if (png.length === 0 || png.length > MAX_PNG_BYTES) throw new VisualCaptureError('renderer', 'viewer 截图大小异常');
      if (!captureLane) await this.closePage(origin, session);
      return { png, mode, width, height, capturedAt: new Date().toISOString(), viewerVersion: health.version,
        includesHud: options.includeHud === true, timings };
    } catch (error) {
      await close();
      if (this.generation !== generation) throw new VisualCaptureError('cancelled', 'viewer 截图已取消', { cause: error });
      if (error instanceof VisualCaptureError) throw error;
      assertNotAborted(signal);
      if (Date.now() >= deadlineAtMs || (error instanceof Error && /Timeout/i.test(error.name))) {
        throw new VisualCaptureError('timeout', '等待 viewer 场景渲染超时', { cause: error });
      }
      throw new VisualCaptureError(session ? 'renderer' : 'browser', session ? 'viewer 场景截图失败' : '截图浏览器启动失败', { cause: error });
    } finally {
      signal?.removeEventListener('abort', onAbort);
      activeOrigins.delete(origin);
    }
  }

  warm(viewerUrl: string): Promise<void> {
    const origin = localViewerOrigin(viewerUrl);
    const current = this.warming.get(origin);
    if (current) return current;
    const pending = this.capture({ viewerUrl, mode: 'third', timeoutMs: 25_000 }).then(() => undefined).finally(() => {
      if (this.warming.get(origin) === pending) this.warming.delete(origin);
    });
    this.warming.set(origin, pending);
    return pending;
  }

  async stop(): Promise<void> {
    this.generation++;
    await Promise.all([...this.sessions.keys()].map(origin => this.closeSession(origin)));
  }

  private async renewLease(origin: string, session: CaptureSession): Promise<boolean> {
    if (!session.leaseKey || !session.page || session.page.isClosed()) return false;
    try {
      const response = await (this.dependencies.fetcher ?? fetch)(`${origin}/capture-lease`, {
        headers: { 'x-mc-viewer-capture': '1', 'x-mc-viewer-capture-key': session.leaseKey },
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch { return false; }
  }

  private async closePage(origin: string, session: CaptureSession): Promise<void> {
    clearInterval(session.leaseTimer);
    session.leaseTimer = undefined;
    const page = session.page;
    const leaseKey = session.leaseKey;
    const releaseLease = page && session.captureLane && session.renewable && leaseKey;
    session.page = undefined;
    session.leaseKey = undefined;
    session.renewable = false;
    // A page close can return before its socket disconnect reaches the server. Release the
    // keyed slot first so an immediate viewpoint change cannot collide with our own connection.
    if (releaseLease) {
      try {
        await (this.dependencies.fetcher ?? fetch)(`${origin}/capture-lease`, {
          method: 'DELETE', headers: { 'x-mc-viewer-capture': '1', 'x-mc-viewer-capture-key': leaseKey },
          signal: AbortSignal.timeout(3_000),
        });
      } catch { /* Page closure still disconnects an unavailable or legacy viewer. */ }
    }
    await page?.close().catch(() => undefined);
  }

  private async closeSession(origin: string): Promise<void> {
    const session = this.sessions.get(origin);
    if (!session) return;
    this.sessions.delete(origin);
    await this.closePage(origin, session);
    await session.browser.close().catch(() => undefined);
  }
}

const captureManager = new MinecraftViewCaptureManager();

export async function closeMinecraftViewCapture(): Promise<void> {
  await captureManager.stop();
}

export function warmMinecraftViewCapture(viewerUrl: string): Promise<void> {
  return captureManager.warm(viewerUrl);
}

export async function captureMinecraftView(
  options: MinecraftViewCaptureOptions,
  dependencies: CaptureDependencies = {},
): Promise<MinecraftViewCapture> {
  const manager = Object.keys(dependencies).length > 0 ? new MinecraftViewCaptureManager(dependencies) : captureManager;
  try {
    return await manager.capture(options);
  } finally {
    if (manager !== captureManager) await manager.stop();
  }
}
