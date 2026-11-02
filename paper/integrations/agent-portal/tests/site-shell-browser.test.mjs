import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { siteFixture } from './helpers.mjs';

let executablePath;
for (const candidate of [process.env.PORTAL_BROWSER_EXECUTABLE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
  try { await fs.access(candidate); executablePath = candidate; break; } catch {}
}
test('public site navigation works on desktop and phone; document anchors reveal folded instructions', { skip: !executablePath }, async t => {
  let browser;
  t.after(async () => { await browser?.close(); });
  const f = await siteFixture(t);
  const extra = ['ag_Beta', 'ag_Gamma', 'ag_Delta'].map((name, i) => ({ ...f.agent, id: String(i + 2).repeat(24), name }));
  f.game.roster = async () => [f.agent, ...extra];
  const ciArguments = process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' ? ['--no-sandbox'] : [];
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', ...ciArguments], userDataDir: path.join(f.root, 'isolated-site-browser') });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let legacyDocument = false;
  await page.setRequestInterception(true);
  page.on('request', async request => {
    if (request.isNavigationRequest() && request.url() === f.origin + '/' && !legacyDocument) {
      legacyDocument = true;
      const html = await (await fetch(request.url())).text();
      await request.respond({ status: 200, contentType: 'text/html', body: html.replace('<script src="/site-shell.js" defer></script>', '').replace('<link rel="stylesheet" href="/site-shell.css">', '') });
    } else await request.continue();
  });
  const artifacts = process.env.PORTAL_UI_ARTIFACT_DIR;
  if (artifacts) await fs.mkdir(artifacts, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1 });
    for (const [url, marker, name] of [['/', '[data-world-roster] .resident-card', 'home'], ['/#help', '.help-topics', 'join'], ['/downloads.html#shared', '#component-downloads .download-card', 'downloads'], ['/join#existing-agent', '#existing-agent', 'agent-join'], ['/agent-api.html', 'h1', 'api'], ['/aincrad.html', 'h1', 'guide']]) {
      await page.goto(f.origin + url, { waitUntil: 'networkidle0' });
      await page.waitForSelector(marker);
      assert.deepEqual(await page.$$eval('.site-navigation>a', links => links.map(a => a.textContent)), ['世界', '直播', '作品', '加入']);
      assert.equal(await page.$$eval('header.site-header', rows => rows.length), 1);
      assert.equal(await page.$eval('html', node => node.scrollWidth <= innerWidth), true, `${name} at ${width}px must not overflow`);
      assert.equal(await page.$eval('.site-navigation', node => getComputedStyle(node).display !== 'none'), true);
      if (name === 'home') {
        assert.equal(await page.$eval('link[href="/site-shell.css"]', node => !!node.sheet), true, 'old HTML also loads the current navigation styles');
        assert.equal(await page.$$eval('.resident-card', rows => rows.length), 4);
        assert.equal(await page.$$eval('img', imgs => imgs.filter(img => img.complete && !img.naturalWidth).length), 0);
        await page.click('.site-navigation>a[href="#help"]'); await page.waitForSelector('.help-topics');
        await page.goBack({ waitUntil: 'networkidle0' }); await page.waitForSelector('.resident-card');
      }
      if (name === 'downloads') assert.equal(await page.$eval('#shared', node => node.open), true);
      if (name === 'agent-join') assert.equal(await page.$eval('#skill-setup', node => node.open), true);
      if (artifacts && ['home', 'join', 'downloads'].includes(name)) await page.screenshot({ path: path.join(artifacts, `${name}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
});
