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
    // Each matrix row represents a separate downloader. Do not let catalogue
    // growth turn this routing test into a burst-limit test; that is below.
    const downloader = await siteFixture(t, { downloads: { baseUrl, enabledPackages } });
    for (const method of ['GET', 'HEAD']) {
      const reply = await fetch(downloader.origin + row.url + '?token=private&target=https://evil.test/', { method, redirect: 'manual' });
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
  assert.equal(site.agentClients.find(row => row.id === 'neko').downloads.length, 1);
  assert.equal(site.agentClients.find(row => row.id === 'neko').downloads[0].id, 'neko-base');
});

test('adding client packs preserves the twenty-per-minute download burst limit',async t=>{
 const f=await siteFixture(t,{downloads:{baseUrl,enabledPackages}});
 for(let i=0;i<20;i++){
  const response=await fetch(f.origin+'/downloads/maid-client',{method:'HEAD',redirect:'manual'});
  assert.equal(response.status,307);
 }
 const blocked=await fetch(f.origin+'/downloads/maid-client',{method:'HEAD',redirect:'manual'});
 assert.equal(blocked.status,429);assert.equal(blocked.headers.get('location'),null);
});

test('mirror activation requires an explicit reviewed package id, not just a base URL', async t => {
  assert.throws(() => loadConfig({ skipLocalConfig: true, downloads: { enabledPackages: ['unreviewed'] } }));
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages: ['dsh-adapter'] } });
  const data = (await f.client().request('/downloads')).data;
  assert.deepEqual(data.packages.filter(row => row.available).map(row => row.id), ['dsh-adapter']);
});

test('permanent host and component links redirect to the reviewed OSS object without forwarding request secrets',async t=>{
 const f=await siteFixture(t,{downloads:{baseUrl,enabledPackages}});
 for(const[alias,id]of[['cortico','cortico-bundle'],['dsh','dsh-bundle'],['neko','neko-base'],['audio','shared-audio'],['browser','shared-browser']]){
  const row=packageReleases.find(row=>row.id===id);
  for(const method of ['GET','HEAD']){
   const reply=await fetch(f.origin+'/downloads/'+alias+'?token=private',{method,redirect:'manual',headers:{Cookie:'irrelevant=private'}});
   assert.equal(reply.status,307);assert.equal(reply.headers.get('location'),baseUrl+row.sha256+'/'+row.filename);
   assert.equal(reply.headers.get('x-checksum-sha256'),row.sha256);assert.equal((await reply.arrayBuffer()).byteLength,0);
  }
 }
});

test('download page separates three host bundles, two shared components and original files without a website login', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages } });
  const html = await (await fetch(f.origin + '/downloads.html')).text();
  const dom = new JSDOM(html, { url: f.origin + '/downloads.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = url => fetch(new URL(url, f.origin));
  dom.window.eval(await fs.readFile(new URL('../public/downloads.js', import.meta.url), 'utf8'));
  // Native client releases have their own static cards. Verify these three
  // dynamic host/component/legacy groups without counting unrelated releases.
  const cards=()=>dom.window.document.querySelectorAll('#package-downloads .download-card,#component-downloads .download-card,#advanced-downloads .download-card');
  const deadline = Date.now() + 4000;
  while (cards().length !== 9 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(cards().length, 9);
  assert.ok([...cards()].every(card=>card.querySelectorAll('a[download]').length===1));
  assert.equal(dom.window.document.querySelectorAll('#package-downloads .download-card').length, 3);
  assert.equal(dom.window.document.querySelectorAll('#component-downloads .download-card').length, 2);
  assert.equal(dom.window.document.querySelectorAll('#advanced-downloads .download-card').length, 4);
  assert.equal(dom.window.document.querySelector('.legacy-downloads').open, false);
  assert.equal(dom.window.document.querySelectorAll('#package-downloads .download-contents').length, 2);
  assert.match(dom.window.document.body.textContent, /DSH.*0\.3\.0-rc\.12/s);
  assert.match(dom.window.document.body.textContent, /1\.11 GB/);
  assert.ok([...dom.window.document.querySelectorAll('a[download]')].every(link => link.href.startsWith(f.origin + '/downloads/')));
  assert.equal((await f.client().request('/session')).data.owner, null);
});

test('recommended Neko is one complete archive; other hosts keep their explicit shared components', () => {
  const hosts = packageReleases.filter(row => row.category === 'host');
  assert.deepEqual(hosts.map(row => row.framework), ['cortico', 'dsh', 'neko']);
  for (const row of hosts) {
    assert.equal(row.viewerIncluded, true); assert.equal(row.gameDependenciesBundled, true);
    assert.ok(row.bytes > 100_000_000);
    assert.deepEqual(row.requires, row.framework === 'neko' ? [] : ['shared-audio', 'shared-browser']);
    for (const id of row.requires) assert.equal(packageReleases.find(part => part.id === id)?.category, 'component');
  }
  assert.match(packageReleases.find(row => row.id === 'neko-plugin').platform, /Linux/);
  assert.equal(packageReleases.find(row => row.id === 'neko-offline').bytes, 1111598162);
});

test('new complete Neko selection preserves the previous immutable base download', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages } });
  const current = packageReleases.find(row => row.id === 'neko-base');
  assert.equal(current.version, '0.6.109');
  assert.deepEqual(current.requires, []);
  assert.match(current.install, /无需管理员.*注册表/);
  const oldName = 'qiandengji-neko-0.6.70-base-with-viewer-data.zip';
  const oldHash = '701716c351f8cd3dd43b0837b34131b793648eab740e60d4145748fea59e2dc2';
  const old = await fetch(f.origin + '/downloads/' + oldName + '?token=private', { redirect: 'manual' });
  assert.equal(old.status, 307);
  assert.equal(old.headers.get('location'), baseUrl + oldHash + '/' + oldName);
  assert.equal(old.headers.get('x-checksum-sha256'), oldHash);
});
