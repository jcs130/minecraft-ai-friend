import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { musicFixture, wav, metadata, descriptor } from './music-fixtures.mjs';
import { testPassword } from './helpers.mjs';

let executablePath;
for (const candidate of [process.env.PORTAL_BROWSER_EXECUTABLE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
  try { await fs.access(candidate); executablePath = candidate; break; } catch {}
}
test('desktop/mobile music UI, literal lyrics, manual playback, owner controls and browser direct upload', { skip: !executablePath }, async t => {
  let browser;
  t.after(async () => { await browser?.close(); });
  const f = await musicFixture(t), bytes = wav();
  for (let i = 1; i <= 8; i++) {
    const work = (await f.api('', 'POST', { ...metadata, title: '隔离试听 ' + i, requestId: randomUUID() })).data;
    const prepare = (await f.api('/' + work.id + '/audio', 'POST', { ...descriptor(bytes), requestId: randomUUID() })).data;
    await fetch(prepare.upload.uploadUrl, { method: 'PUT', headers: prepare.upload.headers, body: bytes });
    const ready = (await f.api('/' + work.id + '/complete', 'POST', { uploadId: prepare.uploadId })).data;
    assert.equal((await f.api('/' + work.id + '/publication', 'PUT', { requestId: randomUUID(), published: true, expectedRevision: ready.revision })).status, 200);
  }
  await f.api('', 'POST', { ...metadata, title: '未完成的歌词草稿', requestId: randomUUID() });
  // GitHub's disposable Ubuntu runner blocks Chromium user namespaces. This
  // exception is only for this synthetic loopback fixture, never the app or a
  // real user's browser/profile; Windows and ordinary launches keep defaults.
  const ciArguments = process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' ? ['--no-sandbox'] : [];
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', ...ciArguments], userDataDir: path.join(f.root, 'isolated-browser') });
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 900 }); await page.goto(f.origin + '/music.html');
  await page.waitForFunction(() => document.querySelectorAll('.work').length === 8);
  assert.equal(await page.$('audio'), null, 'public list does not download audio');
  assert.equal(await page.$eval('body', node => node.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(f.config.dataDir, '..', '..', '..', 'music-desktop.png'), fullPage: true });
  await page.click('[data-open]'); await page.waitForSelector('audio');
  assert.equal(await page.$eval('audio', node => node.preload), 'none');
  assert.equal(await page.$eval('.lyrics', node => node.textContent), metadata.lyrics); assert.equal(await page.$eval('#detail-content', node => node.querySelector('script')), null);
  await page.$eval('audio', async node => { await node.play(); });
  await page.waitForFunction(() => document.querySelector('audio').readyState >= 2);
  await page.click('#close-detail');
  // Authenticate using the ordinary isolated website login, never a real cookie.
  const login = await page.evaluate(async password => {
    const session = await fetch('/api/v1/session').then(r => r.json());
    return (await fetch('/api/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify({ username: 'fixture-admin', password }) })).status;
  }, testPassword); assert.equal(login, 200);
  await page.click('#mine-tab'); await page.waitForFunction(() => document.querySelectorAll('.work').length === 9);
  await page.setViewport({ width: 390, height: 844 }); assert.equal(await page.$eval('body', node => node.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(f.config.dataDir, '..', '..', '..', 'music-mobile.png'), fullPage: true });
  const draft = await page.$$('article');
  await draft[0].$eval('button', node => node.click()); await page.waitForSelector('#publish-work');
  assert.equal(await page.$eval('#publish-work', node => node.disabled), true); await page.click('#close-detail');
  await page.click('#new-work'); await page.waitForSelector('#editor[open]');
  await page.type('[name=title]', '浏览器隔离上传'); await page.type('[name=lyrics]', '不属于正式采用歌曲。');
  const audioFile = path.join(f.root, 'browser.wav'); await fs.writeFile(audioFile, bytes);
  await (await page.$('[name=audio]')).uploadFile(audioFile); await page.click('#save-work');
  await page.waitForFunction(() => !document.getElementById('editor').open, { timeout: 20000 });
  assert.equal((await f.api()).data.total, 10); assert.equal((await fetch(f.origin + '/api/v1/music').then(r => r.json())).total, 8, 'new upload remains private');
  assert.deepEqual(errors, []);
});
