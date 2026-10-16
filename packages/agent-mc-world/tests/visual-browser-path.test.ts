import { afterEach, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { MinecraftViewCaptureManager } from '../core/visual-capture.ts';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('uses the explicit neutral browser executable in the real launch boundary', async () => {
  vi.stubEnv('AGENT_MC_BROWSER_EXECUTABLE', process.execPath);
  const launch = vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('fixture launch stopped'));
  const manager = new MinecraftViewCaptureManager({ fetcher: async () => new Response(JSON.stringify({ ok: true, maxCaptureSessions: 1 })) });
  try {
    await expect(manager.capture({ viewerUrl: 'http://127.0.0.1:7793' })).rejects.toMatchObject({ code: 'browser', cause: expect.objectContaining({ message: 'fixture launch stopped' }) });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ executablePath: process.execPath, headless: true }));
  } finally { await manager.stop(); }
});

it.each(['', 'Z:/agent-mc-missing-fixture/browser.exe'])('fails closed for an invalid explicit browser path: %s', async value => {
  vi.stubEnv('AGENT_MC_BROWSER_EXECUTABLE', value);
  const launch = vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('must not launch'));
  const manager = new MinecraftViewCaptureManager({ fetcher: async () => new Response(JSON.stringify({ ok: true, maxCaptureSessions: 1 })) });
  try {
    await expect(manager.capture({ viewerUrl: 'http://127.0.0.1:7793' })).rejects.toThrow('AGENT_MC_BROWSER_EXECUTABLE');
    expect(launch).not.toHaveBeenCalled();
  } finally { await manager.stop(); }
});
