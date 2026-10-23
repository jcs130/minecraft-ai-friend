import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { describe, expect, it, vi } from 'vitest';
import { startModernViewer } from '../core/modern-viewer.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
import { bubbleEntity, freeViewerPort, viewerBot } from './fixtures/viewer-bot.ts';

// Build first. An explicit engine-only manifest has no viewer to exercise.
// A missing manifest or broken included bundle still fails normally.
const engineOnly = JSON.parse(readFileSync(new URL('../dist/build.json', import.meta.url), 'utf8')).viewer.included === false;
describe.skipIf(engineOnly)('packaged viewer content (requires locked optional viewer assets)', () => {
  it('serves original fonts and relays current text, maps and particles to both socket paths without replaying deleted dialogue', async () => {
    const { bot, protocol, registry } = viewerBot();
    const port = await freeViewerPort();
    const viewer = await startModernViewer(bot as never, {
      port, assetsDir: MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir, speechSourceId: 'offline-viewer-test',
    });
    const clients: Socket[] = [];
    const connect = async (path: string) => {
      const events: Array<{ name: string; value: Record<string, unknown> }> = [];
      const socket = io(viewer.url, { path, autoConnect: false, reconnection: false,
        forceNew: true, transports: ['websocket'] });
      clients.push(socket);
      socket.onAny((name, value) => events.push({ name, value }));
      const ready = new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve); socket.once('connect_error', reject);
      });
      socket.connect();
      await ready;
      await vi.waitFor(() => expect(events.some(e => e.name === 'textDisplay' && e.value.id === 40)).toBe(true));
      return { socket, events };
    };
    try {
      for (const page of ['/', '/third/', '/3dview/']) {
        const response = await fetch(viewer.url + page);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('/index.js');
        expect(response.headers.get('content-security-policy')).not.toContain("script-src 'self' 'unsafe-eval' 'sha256-");
      }
      const photoResponse = await fetch(viewer.url + '/photo/?photo=1&distance=2');
      expect(photoResponse.status).toBe(200);
      const photo = await photoResponse.text();
      expect(photo).toContain('globalThis.__photoReady');
      expect(photo).not.toContain('/speech-bubble.js');
      const assetBase = new URL(photo.match(/<base\s+href="([^"]+)"/)![1], photoResponse.url);
      for (const [asset, type] of [['mesher.js', 'javascript'], ['textures/entity/zombie/zombie.png', 'image/png']]) {
        const assetResponse = await fetch(new URL(asset, assetBase));
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get('content-type')).toContain(type);
      }
      const readyScript = photo.match(/<script>([\s\S]*?)<\/script>/)![1];
      const scriptHash = createHash('sha256').update(readyScript).digest('base64');
      expect(photoResponse.headers.get('content-security-policy')).toContain(`script-src 'self' 'unsafe-eval' 'sha256-${scriptHash}'`);
      const fontResponse = await fetch(viewer.url + '/text-display-font.json');
      expect(fontResponse.status).toBe(200);
      const font = await fontResponse.json() as { files: Record<string, { sha256: string }> };
      const zipResponse = await fetch(viewer.url + '/fonts/1.21.1/unifont.zip');
      expect(zipResponse.status).toBe(200);
      expect(zipResponse.headers.get('content-type')).toBe('application/zip');
      const zip = Buffer.from(await zipResponse.arrayBuffer());
      expect(createHash('sha256').update(zip).digest('hex')).toBe(font.files['fonts/1.21.1/unifont.zip'].sha256);
      expect(zip).toEqual(await readFile(join(MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir, 'public/fonts/1.21.1/unifont.zip')));

      const first = await connect('/socket.io');
      const third = await connect('/third/socket.io');
      for (const client of [first, third]) {
        const bubble = client.events.find(e => e.name === 'textDisplay' && e.value.id === 40)!.value;
        expect(bubble).toMatchObject({ epoch: 0, runs: [{ text: '中文问候\n继续探索\n▼', color: '#ffffff' }] });
        expect(client.events.some(e => e.name === 'entity' && e.value.id === 40)).toBe(false);
      }
      protocol.emit('spawn_entity', { entityId: 41, type: registry.entitiesByName.text_display.id,
        x: 0, y: 66, z: -2, yaw: 0, pitch: 0 });
      protocol.emit('entity_metadata', { entityId: 41,
        metadata: Object.entries(bubbleEntity(41, '当前私人对白').metadata).map(([key, value]) => ({ key: Number(key), value })) });
      protocol.emit('map', { itemDamage: 7, scale: 0, columns: 1, rows: 1, x: 0, y: 0, data: Uint8Array.of(12) });
      for (const client of [first, third]) {
        await vi.waitFor(() => {
          expect(client.events.some(e => e.name === 'textDisplay' && JSON.stringify(e.value.runs).includes('当前私人对白'))).toBe(true);
          expect(client.events.some(e => e.name === 'mapPixels' && e.value.mapId === 7)).toBe(true);
        });
      }
      protocol.emit('world_particles', { particle: { type: 'happy_villager' }, x: 0, y: 65, z: -2,
        amount: 1, offsetX: 0, offsetY: 0, offsetZ: 0, velocityOffset: 0 });
      const health = await (await fetch(viewer.url + '/healthz')).json();
      expect(health.content).toMatchObject({ viewers: 2, particles: 1, rejected: 0 });
      for (const client of [first, third]) {
        await vi.waitFor(() => expect(client.events.some(e => e.name === 'particleBatch')).toBe(true));
        expect(client.events.filter(e => e.name === 'presentationEvent' && e.value.kind === 'particle')).toHaveLength(0);
      }
      protocol.emit('entity_destroy', { entityIds: [41] });
      await vi.waitFor(() => expect(third.events.some(e => e.name === 'textDisplay' && e.value.id === 41 && e.value.delete)).toBe(true));
      first.socket.disconnect();
      const reconnect = await connect('/socket.io');
      expect(reconnect.events.some(e => e.name === 'textDisplay' && e.value.id === 41)).toBe(false);
      bot.emit('respawn');
      await vi.waitFor(() => expect(third.events.some(e => e.name === 'contentReset' && e.value.epoch === 1)).toBe(true));
      await vi.waitFor(() => expect(third.socket.connected).toBe(false));
    } finally {
      for (const client of clients) client.disconnect();
      await viewer.close();
    }
    expect(protocol.listenerCount('entity_metadata')).toBe(0);
    expect(protocol.listenerCount('world_particles')).toBe(0);
    expect(protocol.listenerCount('entity_destroy')).toBe(0);
    expect(bot.listenerCount('respawn')).toBe(0);
  }, 15_000);
});
