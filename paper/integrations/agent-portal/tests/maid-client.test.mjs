import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {packageAt} from '../src/download-catalog.mjs';

test('optional native maid downloads are available without JavaScript or an account and match their reviewed manifest',async()=>{
 const release=JSON.parse(await fs.readFile(new URL('../../touhou-maids/client-release.json',import.meta.url),'utf8'));
 const source=await fs.readFile(new URL('../public/downloads.html',import.meta.url),'utf8');
 const dom=new JSDOM(source);try{
  const section=dom.window.document.querySelector('#maid-client');assert(section);
  const links=[...section.querySelectorAll('a[download]')];assert.equal(links.length,2);
  for(const link of links){
   const published=packageAt(link.getAttribute('href'));assert(published);
   const row=release.artifacts.find(row=>row.filename===published.filename&&row.sha256===published.sha256);assert(row);
   assert(row.filename.endsWith('.zip')||row.filename.endsWith('.mrpack'));
   assert(link.closest('article').textContent.includes(row.sha256));
   assert(link.getAttribute('href').startsWith('/downloads/'));assert(!link.getAttribute('href').includes('?'));
  }
  assert.match(section.textContent,/原版 Java、现有 Fabric、Mineflayer 和基岩版仍可进服/);
  assert.match(section.textContent,/独立 NeoForge 实例/);assert.match(section.textContent,/Java 21/);
  assert.equal(release.client.mod.modified,false);assert.equal(release.client.mod.sha256,'f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27');
  assert.equal(release.client.loader.version,'21.1.248');assert.deepEqual(release.client.vanillaJavaRequiredMods,[]);assert.deepEqual(release.client.bedrockRequiredMods,[]);
  assert(dom.window.document.querySelector('#package-downloads'));assert(dom.window.document.querySelector('#component-downloads'));
  assert(!section.textContent.includes('必须安装'));assert(!section.textContent.includes('测试密码'));
 }finally{dom.window.close();}
});
