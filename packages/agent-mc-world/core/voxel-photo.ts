/** Explicit one-frame renderer for artistic input. No model, game login or body controls. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { edgeExecutablePath } from './visual-capture.ts';
import type { VoxelScene } from '../src/contracts/voxel-scene.ts';
import type { VoxelPhotoConfiguration } from '../src/contracts/photography.ts';

export async function renderVoxelPhoto(scene: VoxelScene, config: VoxelPhotoConfiguration, mode: 'first' | 'third' | '3dview', signal: AbortSignal) {
  signal.throwIfAborted();
  if (scene.source.minecraftVersion !== '1.21.1') throw new Error('Voxel photography needs an exact supported asset/scene version, currently Java 1.21.1');
  const renderer = resolve(config.rendererSource), assets = resolve(config.assetPack);
  if (![config.rendererSource, config.assetPack, config.threeModule].every(p => typeof p === 'string' && isAbsolute(p))) throw new Error('Explicit absolute renderer, asset-pack and Three.js paths required');
  if (mode !== 'first' && (!config.cameraOffset || config.cameraOffset.length !== 3 || !config.cameraOffset.every(n => Number.isFinite(n) && Math.abs(n) <= 24)))
    throw new Error('Voxel third-person photography requires an explicit virtual camera offset');
  const manifest = JSON.parse(await readFile(join(assets, 'pack.json'), 'utf8'));
  if (manifest.minecraftVersion !== scene.source.minecraftVersion) throw new Error('Voxel asset/scene version mismatch');
  const evidence: Record<string, unknown> = { minecraftVersion: manifest.minecraftVersion, clientJarSha256: manifest.source?.clientJarSha256, assets: {} };
  const original = async (name: string) => {
    const bytes = await readFile(join(assets, name)), hash = createHash('sha256').update(bytes).digest('hex'), expected = manifest.files?.[name];
    if (expected?.sha256 !== hash || expected?.bytes !== bytes.length) throw new Error('Voxel asset integrity failure: ' + name);
    (evidence.assets as Record<string, unknown>)[name] = { sha256: hash, bytes: bytes.length }; return bytes;
  };
  const catalog = await original('public/blocksStates/1.21.1.json'), atlas = await original('public/textures/1.21.1.png');
  const buffers = new Map<string, Uint8Array>([['/scene.json', Buffer.from(JSON.stringify(scene))], ['/catalog.json', catalog], ['/atlas.png', atlas],
    ['/asset-evidence.json', Buffer.from(JSON.stringify(evidence))], ['/render.json', Buffer.from(JSON.stringify({
      showSelf: mode !== 'first', ...(mode !== 'first' ? { cameraOffset: config.cameraOffset } : {}),
      surfaceStyle: config.surfaceStyle ?? 'original', geometryStyle: config.geometryStyle ?? 'original',
      allowDocumentedApproximations: config.allowDocumentedApproximations === true }))]]);
  const three = resolve(config.threeModule), files = new Map([['/three.module.js', three], ['/three.core.js', join(dirname(three), 'three.core.js')]]);
  const server = createServer(async (req, res) => {
    try {
      const route = new URL(req.url!, 'http://127.0.0.1').pathname;
      const bytes = buffers.get(route);
      if (bytes) { res.setHeader('Content-Type', route.endsWith('.png') ? 'image/png' : 'application/json'); res.end(bytes); return; }
      let file = files.get(route);
      if (route.startsWith('/viewer/src/')) {
        const candidate = resolve(renderer, 'src', route.slice('/viewer/src/'.length)), part = relative(join(renderer, 'src'), candidate);
        if (part.startsWith('..') || isAbsolute(part) || !/\.(?:m?js|html)$/.test(candidate)) { res.writeHead(404); res.end(); return; }
        file = candidate;
      }
      if (!file) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/javascript'); res.end(await readFile(file));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const abort = () => { void browser?.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    browser = await chromium.launch({ executablePath: config.browserExecutable ?? edgeExecutablePath(), headless: true,
      args: ['--mute-audio', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-default-apps'] });
    signal.throwIfAborted();
    const page = await browser.newPage({ viewport: { width: 1280, height: 704 } });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Renderer address unavailable');
    const origin = `http://127.0.0.1:${address.port}`, errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin + '/viewer/src/modern-viewer/voxel-proxy.html');
    await page.waitForFunction(() => (window as any).proxyReady === true, undefined, { timeout: 45000 });
    if (errors.length) throw new Error('Voxel renderer failed: ' + errors[0]);
    const rendered = await page.evaluate(() => {
      const api = window as any;
      api.renderProxy(0, true);
      const semantics = { ...api.proxyDetails(), ...api.semanticPixels() };
      return { png: api.renderProxy(0, false), semantics };
    });
    signal.throwIfAborted();
    const selfPixels = rendered.semantics.visible.find((item: any) => item.name === 'agent:self')?.pixels ?? 0;
    return { image: { bytes: Buffer.from(rendered.png.split(',')[1], 'base64'), mime: 'image/png' },
      semantics: { ...rendered.semantics, sceneSha256: createHash('sha256').update(JSON.stringify(scene)).digest('hex'),
        selfVisiblePixels: selfPixels, compositionWarning: mode !== 'first' && selfPixels < 2500 ? 'Self is mostly occluded or too small; inspect proxy and choose another camera_offset before character enhancement' : null,
        renderer: pathToFileURL(renderer).href, cameraMode: mode, source: 'explicit-bounded-voxel-proxy', originalScreenshotPreserved: true } };
  } finally {
    signal.removeEventListener('abort', abort); await browser?.close().catch(() => {});
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  }
}
