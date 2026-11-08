import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';
import { packageReleases } from '../src/download-catalog.mjs';

const row = packageReleases.find(entry => entry.id === 'android-client-pack');
const baseUrl = 'https://downloads.example.test/releases/';

test('Android download keeps the existing explicit activation and fixed-byte redirect', async t => {
  const unavailable = await siteFixture(t);
  assert.equal((await fetch(unavailable.origin + '/downloads/android-client')).status, 503);
  const available = await siteFixture(t, { downloads: { baseUrl, enabledPackages: [row.id] } });
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(available.origin + '/downloads/android-client?token=do-not-forward&target=https://other.test/', { method, redirect: 'manual' });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), baseUrl + row.sha256 + '/' + row.filename);
    assert.equal(response.headers.get('x-checksum-sha256'), row.sha256);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  assert.equal((await available.client().request('/session')).data.owner, null);
});

test('phone page presents an import pack, instructions and the actual voice preview status', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages: [row.id] } });
  const html = await (await fetch(f.origin + '/downloads.html')).text();
  const dom = new JSDOM(html, { url: f.origin + '/downloads.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = url => fetch(new URL(url, f.origin));
  dom.window.eval(await fs.readFile(new URL('../public/downloads.js', import.meta.url), 'utf8'));
  const deadline = Date.now() + 4000;
  while (!dom.window.document.querySelector('#android-client-downloads .download-card') && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 10));
  const card = dom.window.document.querySelector('#android-client-downloads .download-card');
  assert.ok(card);
  assert.equal(card.querySelector('a[download]').getAttribute('download'), row.filename);
  assert.match(card.textContent, /兼容预览/);
  assert.match(card.textContent, /实机验证/);
  assert.equal(dom.window.document.querySelectorAll('#android-client-downloads .download-card').length, 1);
  const guide = await fetch(f.origin + '/android.html');
  assert.equal(guide.status, 200);
  const text = await guide.text();
  assert.match(text, /Java 21/);
  assert.match(text, /原角色名与游戏密码/);
  assert.match(text, /麦克风/);
  assert.match(text, /micro\.kangqiang\.site:25702/);
  assert.doesNotMatch(text, /语音已全部通过|手机已实测/);
});
