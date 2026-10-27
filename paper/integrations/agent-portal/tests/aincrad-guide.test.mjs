import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { siteFixture } from './helpers.mjs';

test('Aincrad release is readable without login or JavaScript and serves its own small visual', async t => {
  const f = await siteFixture(t);
  const response = await fetch(f.origin + '/aincrad.html');
  assert.equal(response.status, 200);
  const dom = new JSDOM(await response.text()); t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.querySelectorAll('script,form').length, 0);
  assert.match(document.querySelector('h1').textContent, /千灯纪：重返艾恩葛朗特/);
  assert.match(document.body.textContent, /VortexRPG.*尚未接管正式角色数据/);
  assert.match(document.body.textContent, /后续楼层逐步建设/);
  assert.match(document.body.textContent, /有8魔力时/);
  assert.match(document.body.textContent, /有2魔力后/);
  assert.match(document.body.textContent, /与NPC聊过天不等于自动接单或完成任务/);
  assert.equal(document.querySelectorAll('a[href^="/#"]').length >= 4, true);
  for (const element of document.querySelectorAll('link[rel="stylesheet"],img')) {
    const url = element.getAttribute('href') || element.getAttribute('src');
    const asset = await fetch(f.origin + url);
    assert.equal(asset.status, 200, url); await asset.arrayBuffer();
  }
  const art = await fetch(f.origin + '/assets/aincrad-season.svg');
  assert.match(art.headers.get('content-type'), /image\/svg\+xml/);
  const svg = await art.text(); assert.ok(Buffer.byteLength(svg) < 10000);
  assert.ok(!/<(?:script|foreignObject)|https?:|data:/i.test(svg.replace('http://www.w3.org/2000/svg', '')));
  const css = await fetch(f.origin + '/aincrad.css', { method:'HEAD' });
  assert.equal(css.status, 200); assert.equal((await css.arrayBuffer()).byteLength, 0);
});
