import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';
import { packageAt } from '../src/download-catalog.mjs';

const baseUrl = 'https://downloads.example.test/releases/';
const alias = '/downloads/java-client';
const release = packageAt(alias);

test('desktop pack is public when enabled and keeps the old optional maid downloads separate', async t => {
  const disabled = await siteFixture(t);
  assert.equal((await fetch(disabled.origin + alias, { redirect: 'manual' })).status, 503);
  const enabled = await siteFixture(t, { downloads: { baseUrl, enabledPackages: [release.id, 'maids-client-pack'] } });
  for (const path of [alias, '/downloads/' + release.filename]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(enabled.origin + path + '?token=private', { method, redirect: 'manual' });
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('location'), baseUrl + release.sha256 + '/' + release.filename);
      assert.equal(response.headers.get('x-checksum-sha256'), release.sha256);
    }
  }
  const previous = await fetch(enabled.origin + '/downloads/maid-client', { redirect: 'manual' });
  assert.equal(previous.headers.get('x-checksum-sha256'), '100bed28de217904debeebbea8103233ff0228f2a10f696ac403b607b868e1d2');
});

test('download page distinguishes desktop, FCL and existing launcher controller paths', async t => {
  const site = await siteFixture(t, {
    downloads: { baseUrl, enabledPackages: [release.id, 'android-client-pack', 'maids-client-pack'] },
  });
  const html = await (await fetch(site.origin + '/downloads.html')).text();
  const dom = new JSDOM(html, { url: site.origin + '/downloads.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.querySelector('#desktop-client-downloads a').getAttribute('href'), alias);
  assert.match(document.querySelector('#game-clients details').textContent, /NeoForge.*Controlify.*Fabric.*Controlify.*Fabric API/s);
  dom.window.fetch = path => fetch(new URL(path, site.origin));
  dom.window.eval(await fs.readFile(new URL('../public/downloads.js', import.meta.url), 'utf8'));
  const deadline = Date.now() + 3000;
  while (!document.querySelector('#desktop-client-downloads .download-card') && Date.now() < deadline) await delay(20);
  assert.equal(document.querySelector('#desktop-client-downloads .download-card a[download]').getAttribute('download'), release.filename);
  assert.match(document.querySelector('#desktop-client-downloads').textContent, /Controlify 3\.0\.1 LTS/);
  assert.match(document.querySelector('#android-client-downloads .download-card').textContent, /FCL/);
  assert.equal(document.querySelector('#game-client-downloads').textContent.includes('原生女仆'), false);
  const guide = await (await fetch(site.origin + '/android.html')).text();
  assert.match(guide, /连接手柄/);
  assert.match(guide, /选择手柄输入模式/);
});
