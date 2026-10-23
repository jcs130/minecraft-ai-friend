import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';
import { packageReleases } from '../src/download-catalog.mjs';
import { loadConfig } from '../src/config.mjs';

const baseUrl = 'https://our-downloads.example.test/qiandengji/releases/';
const enabledPackages = packageReleases.map(row => row.id);

test('public catalogue lists only our fixed plugin packages, with exact versions and honest unavailable state', async t => {
  const f = await siteFixture(t);
  const data = (await f.client().request('/downloads')).data;
  assert.deepEqual(data.packages.map(row => row.id), enabledPackages);
  for (const row of data.packages) {
    assert.equal(row.available, false); assert.equal(row.url, null);
    assert.match(row.sha256, /^[a-f0-9]{64}$/); assert.ok(row.bytes > 0);
    assert.ok(row.platform && row.install && row.includes && row.sourceUrl.startsWith('https://'));
    assert.ok(!row.name.includes('主项目'));
    assert.equal((await fetch(f.origin + '/downloads/' + row.filename)).status, 503);
  }
  assert.equal(data.packages.find(row => row.id === 'dsh-adapter').version, '0.3.0-rc.12');
  assert.equal(data.packages.find(row => row.id === 'cortico-world').version, '0.4.1-rc.14');
});

test('approved mirrors serve GET and HEAD redirects for exact plugin paths without relaying the archive or private data', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages } });
  const data = (await f.client().request('/downloads')).data;
  for (const row of data.packages) {
    assert.equal(row.available, true);
    for (const method of ['GET', 'HEAD']) {
      const reply = await fetch(f.origin + row.url + '?token=private&target=https://evil.test/', { method, redirect: 'manual' });
      assert.equal(reply.status, 307); assert.equal(reply.headers.get('location'), baseUrl + row.sha256 + '/' + row.filename);
      assert.equal(reply.headers.get('referrer-policy'), 'no-referrer'); assert.equal(reply.headers.get('cache-control'), 'no-store');
      assert.equal(reply.headers.get('x-checksum-sha256'), row.sha256); assert.equal((await reply.arrayBuffer()).byteLength, 0);
    }
  }
  for (const pathname of ['/downloads/config.local.json', '/downloads/unreviewed.tgz', '/downloads/.env']) {
    assert.equal((await fetch(f.origin + pathname, { redirect: 'manual' })).status, 404);
  }
  const site = (await f.client().request('/site')).data, api = await (await fetch(f.origin + '/api/v1/agent-access')).json();
  assert.deepEqual(site.agentClients, api.clients);
  assert.deepEqual(site.agentClients.map(row => row.id), ['core', 'neko', 'cortico', 'dsh']);
  assert.equal(site.agentClients.find(row => row.id === 'neko').downloads.length, 2);
});

test('mirror activation requires an explicit reviewed package id, not just a base URL', async t => {
  assert.throws(() => loadConfig({ skipLocalConfig: true, downloads: { enabledPackages: ['unreviewed'] } }));
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages: ['dsh-adapter'] } });
  const data = (await f.client().request('/downloads')).data;
  assert.deepEqual(data.packages.filter(row => row.available).map(row => row.id), ['dsh-adapter']);
});

test('download page shows our four packages and versioned download buttons without a website login', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages } });
  const html = await (await fetch(f.origin + '/downloads.html')).text();
  const dom = new JSDOM(html, { url: f.origin + '/downloads.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = url => fetch(new URL(url, f.origin));
  dom.window.eval(await fs.readFile(new URL('../public/downloads.js', import.meta.url), 'utf8'));
  const deadline = Date.now() + 4000;
  while (dom.window.document.querySelectorAll('.download-card').length !== 4 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(dom.window.document.querySelectorAll('.download-card').length, 4);
  assert.equal(dom.window.document.querySelectorAll('.download-card a[download]').length, 4);
  assert.match(dom.window.document.body.textContent, /DSH.*0\.3\.0-rc\.12/s);
  assert.match(dom.window.document.body.textContent, /1\.11 GB/);
  assert.ok([...dom.window.document.querySelectorAll('a[download]')].every(link => link.href.startsWith(f.origin + '/downloads/')));
  assert.equal((await f.client().request('/session')).data.owner, null);
});
