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
