import { afterEach, expect, it, vi } from 'vitest';
import { MinecraftViewCaptureManager, viewerCaptureState } from '../core/visual-capture.ts';

afterEach(() => vi.unstubAllGlobals());

it('admits the committed native scene without inventing legacy chunk maps', () => {
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  const marked: string[] = [];
  const canvas = { id: 'native-scene', width: 1280, height: 720, closest: () => null,
    getBoundingClientRect: () => ({ width: 1280, height: 720 }), setAttribute: (key: string) => marked.push(key) };
  const boot = { classList: { contains: (name: string) => name === 'is-compact' }, textContent: '原生模型 100/100' };
  vi.stubGlobal('document', { querySelector: (selector: string) => selector === '.boot' ? boot
    : selector === 'meta[name="native-viewer-build"]' ? {} : null, querySelectorAll: () => [canvas] });
  vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 720);
  expect(viewerCaptureState()).toBe(false);
  now = 351;
  expect(viewerCaptureState()).toBe('ready');
  expect(marked).toEqual(['data-cortico-capture-scene']);
});

it('uses the real native first-person route and captures that scene', async () => {
  const paths: string[] = [];
  let captured = false;
  const page = { isClosed: () => false, goto: async (url: string) => paths.push(url), addStyleTag: async () => {},
    waitForFunction: async () => ({ jsonValue: async () => 'ready', dispose: async () => {} }),
    evaluate: async () => {}, locator: () => ({ screenshot: async () => { captured = true; return Buffer.from('png'); } }),
    close: async () => {} };
  const manager = new MinecraftViewCaptureManager({
    fetcher: (async () => new Response(JSON.stringify({ ok: true, schemaVersion: 1, mode: 'live_same_player_connection', readOnly: true }))) as typeof fetch,
    launchBrowser: (async () => ({ newPage: async () => page, close: async () => {} })) as any,
  });
  try {
    const image = await manager.capture({ viewerUrl: 'http://127.0.0.1:28985/3dview/', mode: 'first' });
    expect(paths[0]).toBe('http://127.0.0.1:28985/?photo=1&clean=1');
    expect(captured).toBe(true); expect(image.mode).toBe('first');
  } finally { await manager.stop(); }
});

it.each([{ mode: 'overview' }, { mode: 'first', fov: 90 }] as const)(
  'refuses unsupported native camera requests before opening a browser: %o', async args => {
    const launchBrowser = vi.fn(async () => { throw Error('must not launch'); });
    const manager = new MinecraftViewCaptureManager({
      fetcher: (async () => new Response(JSON.stringify({ ok: true, schemaVersion: 1, mode: 'live_same_player_connection', readOnly: true }))) as typeof fetch,
      launchBrowser,
    });
    await expect(manager.capture({ viewerUrl: 'http://127.0.0.1:28985/', ...args })).rejects.toThrow(/first|third|3dview/);
    expect(launchBrowser).not.toHaveBeenCalled(); await manager.stop();
  });
