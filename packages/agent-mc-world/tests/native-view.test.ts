import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { expect, it, vi } from 'vitest';
import { serveNativeView } from '../src/client/native-view.ts';
it('native view is explicitly local, read only, shares captures and never proxies arbitrary requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-view-')), page = join(dir, 'view.html'); writeFileSync(page, '<title>Native frame</title>');
  const probe = createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r)); const port = (probe.address() as any).port; await new Promise<void>(r => probe.close(() => r()));
  const capture = vi.fn(async () => Buffer.from('actual-png')), server = await serveNativeView(port, page, capture, () => ({ connected: true }));
  const origin = `http://127.0.0.1:${port}`;
  try {
    expect((await fetch(origin)).status).toBe(200);
    const frames = await Promise.all([fetch(origin + '/native/frame'), fetch(origin + '/native/frame')]);
    expect(await frames[0].text()).toBe('actual-png'); expect(capture).toHaveBeenCalledTimes(1);
    expect((await fetch(origin + '/native/status')).status).toBe(200);
    expect((await fetch(origin + '/native/frame', { headers: { Origin: 'https://foreign.test' } })).status).toBe(403);
    expect((await fetch(origin + '/native/frame', { method: 'POST' })).status).toBe(403);
    expect((await fetch(origin + '/v1/rpc')).status).toBe(404);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
});
