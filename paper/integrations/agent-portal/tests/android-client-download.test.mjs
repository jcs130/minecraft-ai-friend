import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';
import { packageAt } from '../src/download-catalog.mjs';

const regular = packageAt('/downloads/android-client');
const native = packageAt('/downloads/android-native-client');
const baseUrl = 'https://downloads.example.test/releases/';

test('Android download keeps the existing explicit activation and fixed-byte redirect', async t => {
  const unavailable = await siteFixture(t);
  assert.equal((await fetch(unavailable.origin + '/downloads/android-client')).status, 503);
  assert.equal((await fetch(unavailable.origin + '/downloads/android-native-client')).status, 503);
  const available = await siteFixture(t, { downloads: { baseUrl, enabledPackages: [regular.id] } });
  assert.equal((await fetch(available.origin + '/downloads/android-native-client')).status, 503);
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(available.origin + '/downloads/android-client?token=do-not-forward&target=https://other.test/', { method, redirect: 'manual' });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), baseUrl + regular.sha256 + '/' + regular.filename);
    assert.equal(response.headers.get('x-checksum-sha256'), regular.sha256);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  assert.equal(regular.sha256, '0da4f0207be0a9ebdb5935da64493e0c14df5798697474087eab102412b70220');
  assert.equal(packageAt('/downloads/' + regular.filename), regular);
  assert.equal((await available.client().request('/session')).data.owner, null);
});

test('native gamepad preview has an independent activation, direct link and download hash', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages: [native.id] } });
  assert.equal((await fetch(f.origin + '/downloads/android-client')).status, 503);
  for (const path of ['/downloads/android-native-client', '/downloads/' + native.filename]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(f.origin + path + '?token=do-not-forward', { method, redirect: 'manual' });
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('location'), baseUrl + native.sha256 + '/' + native.filename);
      assert.equal(response.headers.get('x-checksum-sha256'), native.sha256);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    }
  }
  const { packages } = await (await fetch(f.origin + '/api/v1/downloads')).json();
  const release = packages.find(row => row.id === native.id);
  assert.equal(release.androidDeviceVerified, false);
  assert.equal(release.available, true);
  assert.equal(release.url, '/downloads/' + native.filename);
});

test('phone page offers both packs and documents SDL passthrough', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages: [regular.id, native.id] } });
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
  assert.equal(card.querySelector('a[download]').getAttribute('download'), native.filename);
  assert.match(card.textContent, /兼容预览/);
  assert.match(card.textContent, /实机验证/);
  assert.deepEqual(
    [...dom.window.document.querySelectorAll('#android-client-downloads a[download]')].map(link => link.getAttribute('download')),
    [native.filename, regular.filename],
  );
  const guide = await fetch(f.origin + '/android.html');
  assert.equal(guide.status, 200);
  const text = await guide.text();
  assert.match(text, /Java 21/);
  assert.match(text, /原角色名与游戏密码/);
  assert.match(text, /麦克风/);
  assert.match(text, /micro\.kangqiang\.site:25702/);
  assert.match(text, /href="\/downloads\/android-native-client"/);
  assert.match(text, /SDL 直通/);
  assert.match(text, /连续模拟移动/);
  assert.doesNotMatch(text, /检查映射|手机已实测/);
});
