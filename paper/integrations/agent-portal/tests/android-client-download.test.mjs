import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';
import { packageAt } from '../src/download-catalog.mjs';

const regular = packageAt('/downloads/android-client');
const native = packageAt('/downloads/android-native-client');
const oldNative = '/downloads/qiandengji-android-1.21.1-neoforge-1.0.0-preview.3.mrpack';
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
  assert.equal(regular.version, '1.0.0-preview.5-touch');
  const previous = await fetch(available.origin + '/downloads/qiandengji-android-1.21.1-neoforge-1.0.0-preview.1.mrpack', { redirect: 'manual' });
  assert.equal(previous.status, 307);
  assert.equal(previous.headers.get('x-checksum-sha256'), '0da4f0207be0a9ebdb5935da64493e0c14df5798697474087eab102412b70220');
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
  assert.equal(native.version, '1.0.0-preview.5');
  const previous = await fetch(f.origin + '/downloads/qiandengji-android-1.21.1-neoforge-1.0.0-preview.4.mrpack', { redirect: 'manual' });
  assert.equal(previous.status, 307);
  assert.equal(previous.headers.get('x-checksum-sha256'), 'ccf0f717a2385c9731222fd78553c8a0ea758117ba288f224e2ebf021dc6599c');
  const legacy = await fetch(f.origin + oldNative, { redirect: 'manual' });
  assert.equal(legacy.status, 307);
  assert.equal(legacy.headers.get('x-checksum-sha256'), '76e8f1f05fa11b28100711be2c23d4bd28b0794a6d6ea48006a7bfaee9c9e1ba');
  const { packages } = await (await fetch(f.origin + '/api/v1/downloads')).json();
  const release = packages.find(row => row.id === native.id);
  assert.equal(release.androidDeviceVerified, false);
  assert.equal(release.available, true);
  assert.equal(release.url, '/downloads/' + native.filename);
});

test('phone download and setup pages link to the latest native pack', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages: [regular.id, native.id] } });
  const html = await (await fetch(f.origin + '/downloads.html')).text();
  const dom = new JSDOM(html, { url: f.origin + '/downloads.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const fallback = dom.window.document.querySelector('#android-client-downloads a[download]');
  assert.equal(fallback.getAttribute('href'), '/downloads/android-native-client');
  assert.match(html, /已补上通话键/);
  dom.window.fetch = url => fetch(new URL(url, f.origin));
  dom.window.eval(await fs.readFile(new URL('../public/downloads.js', import.meta.url), 'utf8'));
  const deadline = Date.now() + 4000;
  while (!dom.window.document.querySelector('#android-client-downloads .download-card') && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 10));
  const card = dom.window.document.querySelector('#android-client-downloads .download-card');
  assert.ok(card);
  const link = card.querySelector('a[download]');
  assert.equal(link.getAttribute('download'), native.filename);
  const redirect = await fetch(link.href, { method: 'HEAD', redirect: 'manual' });
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('x-checksum-sha256'), native.sha256);
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
  assert.match(text, /潜行.*打开圆形施法轮盘/);
  assert.match(text, /Xbox <strong>B<\/strong>/);
  assert.match(text, /音量触发.*解除麦克风静音/);
  assert.doesNotMatch(text, /检查映射|手机已实测/);
});
