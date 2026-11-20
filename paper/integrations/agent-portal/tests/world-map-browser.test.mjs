import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createWorldMapService } from '../src/world-map-service.mjs';

let executablePath;
for (const file of [process.env.PORTAL_BROWSER_EXECUTABLE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].filter(Boolean)) {
  try { await fs.access(file); executablePath = file; break; } catch {}
}

test('map follow controls hide unavailable NPC streams in rendered CSS and restore player streams', { skip: !executablePath }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qd-map-browser-'));
  const service = createWorldMapService({ dataDir: root, publicDir: fileURLToPath(new URL('../public', import.meta.url)), tokenHash: 'f'.repeat(64) });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (service.server.listening) await new Promise(resolve => service.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  // This test exercises the actual outer UI/CSS, not BlueMap terrain rendering.
  await service.map.write('index.html', Buffer.from('<!doctype html><title>Map fixture</title>'));
  const position = { dimension: 'minecraft:overworld', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 };
  await service.map.acceptState({ schemaVersion: 1, sequence: 1, observedAt: new Date().toISOString(),
    players: [{ ...position, uuid: '11111111-1111-3111-8111-111111111111', name: 'PlayerFixture' }],
    npcs: [{ ...position, uuid: '22222222-2222-3222-8222-222222222222', name: '桐人', kind: 'npc', profession: 'ranger' }],
    maps: [{ id: 'overworld', label: '主世界', dimension: 'minecraft:overworld', bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }] });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + service.server.address().port + '/map.html');
  await page.waitForSelector('.atlas-player');
  for (const width of [390, 844, 1366]) {
    await page.setViewport({ width, height: 900 });
    await page.evaluate(() => [...document.querySelectorAll('.atlas-player')].find(e => e.textContent.includes('桐人')).click());
    await page.waitForFunction(() => document.querySelector('#follow-label').textContent.includes('桐人'));
    assert.equal(await page.$eval('#follow-live', e => getComputedStyle(e).display), 'none', `NPC stream actually hidden at ${width}px`);
    assert.equal(await page.$eval('#follow-live', e => e.getClientRects().length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => [...document.querySelectorAll('.atlas-player')].find(e => e.textContent.includes('PlayerFixture')).click());
    await page.waitForFunction(() => document.querySelector('#follow-label').textContent.includes('PlayerFixture'));
    assert.notEqual(await page.$eval('#follow-live', e => getComputedStyle(e).display), 'none');
    assert.equal(await page.$eval('#follow-live', e => new URL(e.href).hash), '#live?player=PlayerFixture');
    await page.click('#stop-follow');
    assert.equal(await page.$eval('#follow-bar', e => getComputedStyle(e).display), 'none');
  }
});

test('addresses filter and bookmark the verified home camera even with a stale live feed', { skip: !executablePath }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qd-map-address-browser-'));
  const publicDir = path.join(root, 'public');
  await fs.mkdir(publicDir);
  for (const file of ['map.html', 'world-map.js', 'world-map-model.js', 'world-map.css', 'site-shell.js', 'site-shell.css']) {
    await fs.copyFile(fileURLToPath(new URL('../public/' + file, import.meta.url)), path.join(publicDir, file));
  }
  const home = { id: 'lane-01', kind: 'home', districtId: 'old-town', streetId: 'lane', number: '01', name: '槐影小屋',
    position: { x: -679, y: 67, z: 824 }, residents: [{ name: '小葵', profession: '园艺' }] };
  const directory = {
    version: 1, world: 'minecraft:aincrad',
    districts: [{ id: 'old-town', name: '旧城' }, { id: 'market', name: '市集' }],
    streets: [{ id: 'lane', districtId: 'old-town', name: '槐荫巷', path: [{ x: -682, y: 67, z: 824 }, { x: -674, y: 67, z: 824 }] }],
    places: [
      home,
      { id: 'lower-room', kind: 'room', districtId: 'old-town', parentId: home.id, name: '地下小室', position: { x: -679, y: 32, z: 824 } },
      { id: 'west-stall', kind: 'market', districtId: 'market', name: '西侧摊位', position: { x: -700, y: 67, z: 843 } }
    ]
  };
  await fs.writeFile(path.join(publicDir, 'aincrad-addresses.json'), JSON.stringify(directory));
  const service = createWorldMapService({ dataDir: root, publicDir, tokenHash: 'f'.repeat(64) });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (service.server.listening) await new Promise(resolve => service.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  await service.map.write('index.html', Buffer.from('<!doctype html><title>Map fixture</title>'));
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + service.server.address().port;
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900 });
  await page.goto(base + '/map.html');
  await page.waitForFunction(() => /实时位置暂不可用/.test(document.querySelector('#map-status').textContent));
  await page.evaluate(() => {
    const frame = document.querySelector('#world-map-frame');
    const viewer = { map: { data: { id: 'overworld', freeFlightView: true } }, controlsManager: { position: { set: (...args) => { window.locationSample = args; } } } };
    frame.contentWindow.bluemap = { mapViewer: viewer, mapsMap: new Set(['aincrad']), switchMap: id => { viewer.map.data.id = id; },
      setFreeFlight: (...args) => { window.flightSample = args; } };
  });
  await page.click('#show-addresses');
  await page.waitForSelector('[data-place="lane-01"]', { visible: true });
  await page.select('#address-district', 'old-town');
  await page.select('#address-street', 'lane');
  await page.type('#address-search', '园艺 01');
  assert.equal(await page.$$eval('.atlas-address', rows => rows.length), 1);
  await page.click('[data-place="lane-01"]');
  assert.deepEqual(await page.evaluate(() => window.locationSample), [-679, 67, 824]);
  assert.equal(new URL(page.url()).searchParams.get('place'), home.id);
  assert.match(await page.$eval('#address-selection', node => node.textContent), /X -679 · Y 67 · Z 824/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.$eval('#address-search', input => { input.value = '地下'; input.dispatchEvent(new Event('input')); });
  await page.click('[data-place="lower-room"]');
  assert.deepEqual(await page.evaluate(() => window.locationSample), [-679, 32, 824]);
  assert.deepEqual(await page.evaluate(() => window.flightSample), [0, 32]);
  assert.match(await page.$eval('#address-selection', node => node.textContent), /房间定位点/);
  await page.goto(base + '/map.html?place=lane-01');
  await page.waitForSelector('[data-place="lane-01"][aria-current="location"]', { visible: true });
  assert.equal(await page.$eval('#address-street', node => node.value), 'lane');
  assert.match(await page.$eval('#address-selection', node => node.textContent), /槐影小屋/);
});
