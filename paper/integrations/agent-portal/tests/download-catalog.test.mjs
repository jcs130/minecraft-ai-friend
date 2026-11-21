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
  assert.equal(data.packages.find(row => row.id === 'dsh-adapter').version, '0.3.0-rc.26');
  assert.equal(data.packages.find(row => row.id === 'cortico-world').version, '0.4.1-rc.70');
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
  assert.deepEqual(site.agentClients.find(row => row.id === 'neko').downloads.map(row => row.id), ['neko-base', 'neko-plugin']);
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

test('the configured standalone SAO pack bootstraps and serves its original release', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages: ['sao-client'] } });
  const data = (await f.client().request('/downloads')).data;
  const available = data.packages.filter(row => row.available);
  assert.deepEqual(available.map(row => row.id), ['sao-client']);
  const release = available[0];
  assert.equal(release.filename, 'MyAgentWorld-SAO-0.76.1-lite-1.20.1-r2.mrpack');
  assert.equal(release.sha256, 'e858aee6e22b249a32c33c3a379274683bdedf5b26bd7f682a379f69c6ddb612');
  const reply = await fetch(f.origin + release.url, { method: 'HEAD', redirect: 'manual' });
  assert.equal(reply.status, 307);
  assert.equal(reply.headers.get('location'), baseUrl + release.sha256 + '/' + release.filename);
});

test('permanent host and component links redirect to the reviewed OSS object without forwarding request secrets',async t=>{
 const f=await siteFixture(t,{downloads:{baseUrl,enabledPackages}});
 for(const[alias,id]of[['cortico','cortico-world'],['dsh','dsh-adapter'],['neko','neko-base'],['audio','shared-audio'],['browser','shared-browser']]){
  const row=packageReleases.find(row=>row.id===id);
  for(const method of ['GET','HEAD']){
   const reply=await fetch(f.origin+'/downloads/'+alias+'?token=private',{method,redirect:'manual',headers:{Cookie:'irrelevant=private'}});
   assert.equal(reply.status,307);assert.equal(reply.headers.get('location'),baseUrl+row.sha256+'/'+row.filename);
   assert.equal(reply.headers.get('x-checksum-sha256'),row.sha256);assert.equal((await reply.arrayBuffer()).byteLength,0);
  }
 }
});

test('download page separates current host, Lite and shared component downloads without a website login', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages } });
  const html = await (await fetch(f.origin + '/downloads.html')).text();
  const dom = new JSDOM(html, { url: f.origin + '/downloads.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = url => fetch(new URL(url, f.origin));
  dom.window.eval(await fs.readFile(new URL('../public/downloads.js', import.meta.url), 'utf8'));
  const cards=()=>dom.window.document.querySelectorAll('#package-downloads .download-card,#component-downloads .download-card');
  const deadline = Date.now() + 4000;
  while (cards().length !== 7 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(cards().length, 7);
  assert.ok([...cards()].every(card=>card.querySelectorAll('a[download]').length===1));
  assert.equal(dom.window.document.querySelectorAll('#package-downloads .download-card').length, 5);
  assert.equal(dom.window.document.querySelectorAll('#component-downloads .download-card').length, 2);
  assert.equal(dom.window.document.querySelector('#advanced-downloads'), null);
  const recommended = dom.window.document.querySelector('#package-downloads');
  assert.match(recommended.textContent, /Cortico World 联网版.*0\.4\.1-rc\.70/s);
  assert.match(recommended.textContent, /DSH Minecraft 插件联网版.*0\.3\.0-rc\.26/s);
  assert.match(recommended.textContent, /NEKO 插件文件.*Linux/s);
  assert.doesNotMatch(dom.window.document.body.textContent, /旧版离线|历史离线/);
  assert.ok([...dom.window.document.querySelectorAll('a[download]')].every(link => link.href.startsWith(f.origin + '/downloads/')));
  assert.equal((await f.client().request('/session')).data.owner, null);
});

test('current Windows and Linux Neko releases identify their actual dependencies', () => {
  const lite=packageReleases.find(row=>row.id==='cortico-lite');assert.equal(lite.version,'0.1.2');assert.equal(lite.gameDependenciesBundled,false);assert.match(lite.install,/联网安装依赖/);
  for (const id of ['cortico-world', 'dsh-adapter']) {
    const row = packageReleases.find(release => release.id === id);
    assert.equal(row.category, 'host');
    assert.match(row.includes + row.install, /联网/);
  }
  const windows = packageReleases.find(row => row.id === 'neko-base');
  assert.equal(windows.version, '0.6.114');
  assert.equal(windows.viewerIncluded, true);
  assert.equal(windows.gameDependenciesBundled, true);
  assert.deepEqual(windows.requires, []);
  assert.match(windows.install, /保留原人物与记忆/);
  assert.match(packageReleases.find(row => row.id === 'neko-plugin').platform, /Linux/);
});

test('retired host selections are ignored without enabling their successors', async t => {
  const retired = ['cortico-bundle', 'dsh-bundle', 'neko-offline'];
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages: [...retired, 'neko-base'] } });
  const data = (await f.client().request('/downloads')).data;
  assert.ok(data.packages.every(row => !retired.includes(row.id)));
  assert.deepEqual(data.packages.filter(row => row.available).map(row => row.id), ['neko-base']);
  assert.equal((await fetch(f.origin + '/downloads/cortico', {redirect:'manual'})).status, 503);
});

test('retired edition filenames are unavailable even with every current release enabled', async t => {
  const f = await siteFixture(t, { downloads: { baseUrl, enabledPackages } });
  for (const filename of [
    'cortico-world-qiandengji-0.4.1-rc.14.tgz',
    'qiandengji-cortico-0.4.1-rc.14-with-viewer-data.tgz',
    'jcs130-dsh-minecraft-agent-0.3.0-rc.24.tgz',
    'jcs130-dsh-minecraft-agent-0.3.0-rc.12.tgz',
    'qiandengji-dsh-0.3.0-rc.12-with-viewer-data.tgz',
    'NEKO-MC-0.6.109-Windows.zip',
    'qiandengji-neko-0.6.70-base-with-viewer-data.zip',
    'Minecraft-Autonomous-0.6.70-Windows-x64-offline.zip',
    'minecraft-autonomous-0.6.70.neko-plugin',
  ]) {
    const reply = await fetch(f.origin + '/downloads/' + filename, {method:'HEAD', redirect:'manual'});
    assert.equal(reply.status, 404, filename);
    assert.equal(reply.headers.get('location'), null);
  }
});
