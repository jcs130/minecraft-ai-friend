import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {siteFixture} from './helpers.mjs';

let executablePath;
for (const candidate of [process.env.PORTAL_BROWSER_EXECUTABLE, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)) {
  try { await fs.access(candidate); executablePath = candidate; break; } catch {}
}
test('Android import and voice instructions fit portrait, landscape and desktop', {skip: !executablePath}, async t => {
  const f = await siteFixture(t, {downloads: {baseUrl: 'https://downloads.example.test/releases/', enabledPackages: ['android-client-pack']}});
  const browser = await puppeteer.launch({executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const artifacts = process.env.PORTAL_UI_ARTIFACT_DIR;
  if (artifacts) await fs.mkdir(artifacts, {recursive: true});
  for (const [width, height] of [[390, 844], [844, 390], [1440, 900]]) {
    await page.setViewport({width, height});
    await page.goto(f.origin + '/downloads.html#android-client', {waitUntil: 'networkidle0'});
    await page.waitForSelector('#android-client-downloads a[download]');
    assert.equal(await page.$eval('html', node => node.scrollWidth <= innerWidth), true, `downloads ${width}`);
    assert.match(await page.$eval('#android-client-downloads', node => node.textContent), /兼容预览/);
    if (artifacts) await page.screenshot({path: path.join(artifacts, `android-downloads-${width}.png`), fullPage: true});
    await page.goto(f.origin + '/android.html', {waitUntil: 'networkidle0'});
    assert.equal(await page.$eval('html', node => node.scrollWidth <= innerWidth), true, `guide ${width}`);
    assert.equal(await page.$$eval('header.site-header', rows => rows.length), 1);
    if (artifacts) await page.screenshot({path: path.join(artifacts, `android-guide-${width}.png`), fullPage: true});
  }
  assert.deepEqual(errors, []);
});
