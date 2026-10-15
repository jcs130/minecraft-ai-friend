import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import minecraftData from 'minecraft-data';
import { io } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import { startModernViewer } from '../core/modern-viewer.ts';
import { MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
import { freeViewerPort, viewerBot } from './fixtures/viewer-bot.ts';

const engineOnly = JSON.parse(readFileSync(new URL('../dist/build.json', import.meta.url), 'utf8')).viewer.included === false;
describe.skipIf(engineOnly)('packaged exact Minecraft 1.21.1 viewer', () => {
  it('serves and streams only the matching registry, font and block-state bytes without game actions', async () => {
    const { bot, protocol } = viewerBot();
    Object.assign(bot, { version: '1.21.1', registry: minecraftData('1.21.1'), entities: {} });
    const viewer = await startModernViewer(bot as never, { port: await freeViewerPort(), assetsDir: MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir });
    const socket = io(viewer.url, { autoConnect: false, reconnection: false, transports: ['websocket'] });
    try {
      const version = new Promise(resolve => socket.once('version', resolve)); socket.connect();
      expect(await version).toBe('1.21.1');
      expect(await (await fetch(viewer.url + '/healthz')).json()).toMatchObject({ ok: true, version: '1.21.1' });
      const font = await (await fetch(viewer.url + '/text-display-font.json')).json();
      expect(font.minecraftVersion).toBe('1.21.1');
      const content = await (await fetch(viewer.url + '/viewer-content.json')).json();
      expect(content.minecraftVersion).toBe('1.21.1');expect(content.mapColors).toHaveLength(62);
      expect((await fetch(viewer.url + '/particle-content.png')).status).toBe(200);
      expect(await (await fetch(viewer.url + '/speech-source')).json()).toMatchObject({available:false});
      const unavailable = await fetch(viewer.url + '/head-texture/' + 'a'.repeat(64) + '.png');
      expect(unavailable.status).toBe(503);expect(unavailable.headers.get('content-type')).toContain('application/json');
      expect(await unavailable.json()).toMatchObject({available:false,reason:'remote_textures_disabled'});
      const patch = new Promise<Record<string,unknown>>(resolve => socket.once('mapPixels', resolve));
      protocol.emit('map', {itemDamage:725,scale:0,locked:false,columns:1,rows:1,x:0,y:0,data:Buffer.from([4])});
      expect(await patch).toMatchObject({mapId:725,columns:1});
      const bytes = Buffer.from(await (await fetch(viewer.url + '/blocksStates/1.21.1.json')).arrayBuffer());
      const original = readFileSync(join(MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir, 'versions/1.21.1/public/blocksStates/1.21.1.json'));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
      expect((await fetch(viewer.url + '/fonts/1.20.6/unifont.zip')).status).toBe(404);
    } finally { socket.disconnect(); await viewer.close(); }
  }, 15000);
});
