import { expect, it } from 'vitest';
import { MinecraftViewCaptureManager } from '../core/visual-capture.ts';
import { visualArgumentError } from '../src/client/visual.ts';

it('validates perspective FOV before any browser or network work', async () => {
  let calls = 0;
  const manager = new MinecraftViewCaptureManager({ fetcher: (() => { calls++; throw Error('unexpected'); }) as typeof fetch });
  for (const fov of [29, 141, NaN, Infinity, '120']) {
    expect(visualArgumentError({ fov })?.failed).toBe(true);
    await expect(manager.capture({ viewerUrl: 'http://127.0.0.1:7793', fov: fov as number })).rejects.toThrow('fov');
  }
  for (const mode of ['overview', 'dungeon'] as const)
    expect(visualArgumentError({ mode, fov: 120 })?.failed).toBe(true);
  expect(calls).toBe(0);
});

it('warms and captures first-person at 120 degrees by default, preserves explicit third-person and refuses an unapplied angle', async () => {
  const urls: string[] = [];
  let closed = 0, actual = 120, wrongRenderer = false;
  const png = Buffer.from('iVBORw0KGgo=', 'base64');
  const manager = new MinecraftViewCaptureManager({
    fetcher: (async () => new Response(JSON.stringify({ ok: true, maxCaptureSessions: 1, captureSessions: 0 }))) as typeof fetch,
    launchBrowser: async () => ({ isConnected: () => true, close: async () => {}, newPage: async () => ({
      isClosed: () => false, close: async () => { closed++; },
      goto: async (url: string) => { urls.push(url); actual = Number(new URL(url).searchParams.get('fov')); },
      addStyleTag: async () => {}, waitForFunction: async () => ({ jsonValue: async () => 'ready', dispose: async () => {} }),
      evaluate: async (_fn: unknown, input: unknown) => typeof input === 'boolean' ? undefined : wrongRenderer ? 75 : actual,
      locator: () => ({ screenshot: async () => png }),
    }) }) as never,
  });
  try {
    await manager.warm('http://127.0.0.1:7793');
    const defaultView = await manager.capture({ viewerUrl: 'http://127.0.0.1:7793' });
    expect(defaultView.fov).toBe(120);
    expect(defaultView.mode).toBe('first');
    await manager.capture({ viewerUrl: 'http://127.0.0.1:7793' });
    expect(urls).toHaveLength(1);
    expect((await manager.capture({ viewerUrl: 'http://127.0.0.1:7793', fov: 110 })).fov).toBe(110);
    expect(closed).toBe(1);
    expect(urls).toEqual(['http://127.0.0.1:7793/?photo=1&fov=120', 'http://127.0.0.1:7793/?photo=1&fov=110']);
    expect((await manager.capture({ viewerUrl: 'http://127.0.0.1:7793', mode: 'third' })).mode).toBe('third');
    expect(urls.at(-1)).toBe('http://127.0.0.1:7793/third/?photo=1&fov=120');
    await manager.capture({ viewerUrl: 'http://127.0.0.1:7793' });
    expect(urls.at(-1)).toBe('http://127.0.0.1:7793/?photo=1&fov=120');
    wrongRenderer = true;
    await expect(manager.capture({ viewerUrl: 'http://127.0.0.1:7793', mode: 'first' })).rejects.toThrow('未应用');
  } finally { await manager.stop(); }
});
